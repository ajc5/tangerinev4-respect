import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

/**
 * OfflineOutboxService
 * ----------------
 * A tiny persistent outbox for online-survey-app submissions that were made
 * while the device had no connectivity (or the upload / LRS POST failed).
 *
 * Two kinds of items are queued, each stored with everything needed to replay
 * it later with no further user input:
 *
 *  1. `form-response`   – a completed tangy-form response that could not be
 *     POSTed to the Tangerine server (`/onlineSurvey/saveResponse/...`). We
 *     store the response JSON + the target `formUploadURL` + `uploadKey` and
 *     replay it exactly like `FormsService.uploadFormResponse` does.
 *
 *  2. `xapi-statements` – a batch of xAPI statements destined for the school
 *     LRS (RESPECT flow). We store the statements + the LRS `endpoint` + the
 *     `auth` string (verbatim, the same value the RESPECT launcher put in the
 *     launch URL and that ADL.XAPIWrapper already sends as the Authorization
 *     header) and, when available, the launcher IPC package so a native
 *     (Capacitor) host can relay it via TangyCache.forwardXapiStatements.
 *
 * The queue lives in `localStorage` under a single key so it survives WebView
 * reloads / app restarts (same origin). `flush()` is called on app start and
 * whenever the browser fires an `online` event; each item is removed only
 * after it is acknowledged by the server.
 */
const OUTBOX_KEY = 'tangerine-online-survey-outbox-v1';

export interface QueuedFormResponse {
  type: 'form-response';
  response: any;
  formUploadURL: string;
  uploadKey: string;
  queuedAt: number;
}

export interface QueuedXapiStatements {
  type: 'xapi-statements';
  statements: any[];
  endpoint: string;
  auth: string;
  ipcPackage?: string;
  queuedAt: number;
}

export type OutboxItem = QueuedFormResponse | QueuedXapiStatements;

@Injectable({
  providedIn: 'root'
})
export class OfflineOutboxService {

  constructor(private http: HttpClient) {
    // Tell the native host (tangy-app's injected XHR/xAPI interceptors) that
    // this app manages offline submission caching itself, so they stand down
    // and we avoid double-queueing / double-submitting the same submission.
    try {
      (window as any).__tangerineOutboxActive = true;
    } catch (e) { /* non-browser context */ }
  }

  private read(): OutboxItem[] {
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[Outbox] Could not read outbox:', e);
      return [];
    }
  }

  private write(items: OutboxItem[]): void {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn('[Outbox] Could not persist outbox:', e);
    }
  }

  /** Number of submissions currently waiting to be delivered. */
  pendingCount(): number {
    return this.read().length;
  }

  /**
   * Queue a completed form response that could not be uploaded. Returns the
   * number of items now waiting in the outbox.
   */
  async queueFormResponse(response: any, formUploadURL: string, uploadKey: string): Promise<number> {
    const items = this.read();
    // Avoid duplicating the exact same response if the user retries submit.
    const id = response && response._id;
    if (id) {
      const already = items.find(item => item.type === 'form-response' && item.response && item.response._id === id);
      if (already) {
        console.log('[Outbox] Response', id, 'already queued; skipping.');
        return items.length;
      }
    }
    items.push({
      type: 'form-response',
      response,
      formUploadURL,
      uploadKey,
      queuedAt: Date.now()
    });
    this.write(items);
    console.log('[Outbox] Queued form response for offline delivery (pending:', items.length + ')');
    this.scheduleRetryIfOnline();
    return items.length;
  }

  /**
   * Queue a batch of xAPI statements that could not reach the LRS.
   */
  async queueXapiStatements(statements: any[], endpoint: string, auth: string, ipcPackage?: string): Promise<number> {
    const items = this.read();
    items.push({
      type: 'xapi-statements',
      statements,
      endpoint,
      auth,
      ipcPackage,
      queuedAt: Date.now()
    });
    this.write(items);
    console.log('[Outbox] Queued', statements.length, 'xAPI statement(s) for offline delivery (pending:', items.length + ')');
    this.scheduleRetryIfOnline();
    return items.length;
  }

  /**
   * Attempt to deliver every queued item. Items are removed only on success.
   * Returns the number of items still pending after the attempt.
   *
   * A concurrency guard ensures only ONE flush runs at a time: flush() is
   * called from several places (app boot, the 'online' event, and each form
   * open), and running them concurrently caused double POSTs and a race that
   * could write back an empty queue - dropping undelivered submissions.
   */
  private flushPromise: Promise<number> | null = null;

  // Automatic retry loop. Queued items normally get flushed on app boot and on
  // the browser 'online' event. That is not enough: if the device itself never
  // lost connectivity (e.g. only the Tangerine server / LRS was briefly
  // unreachable), navigator.onLine stays true the whole time, so no 'online'
  // event ever fires and queued submissions would sit forever. This loop keeps
  // scheduling flush attempts (with exponential backoff) while items remain
  // queued and the browser believes we are online, so they are delivered as
  // soon as the server is reachable again - with no user action required.
  private retryTimer: any = null;
  private retryAttempt = 0;
  private readonly RETRY_BASE_MS = 5000;
  private readonly RETRY_MAX_MS = 60000;

  flush(): Promise<number> {
    if (this.flushPromise) {
      return this.flushPromise;
    }
    this.flushPromise = this.doFlush().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  /** Schedule a delayed flush attempt if none is already pending. */
  private scheduleRetry(): void {
    if (this.retryTimer !== null) {
      return;
    }
    const delay = Math.min(this.RETRY_BASE_MS * Math.pow(2, this.retryAttempt), this.RETRY_MAX_MS);
    this.retryAttempt = Math.min(this.retryAttempt + 1, 20);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        // Truly offline (airplane mode etc.): stop retrying - the 'online'
        // event will wake us again. Reset so the next attempt starts fresh.
        this.retryAttempt = 0;
        return;
      }
      const remaining = await this.flush();
      if (remaining > 0) {
        this.scheduleRetry();
      } else {
        this.retryAttempt = 0;
      }
    }, delay);
  }

  /** Kick off the retry loop only when it can make progress right now. */
  private scheduleRetryIfOnline(): void {
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      this.scheduleRetry();
    }
  }

  private async doFlush(): Promise<number> {
    // If the browser knows we have no connectivity, don't even try (the
    // requests would just hang/fail); we'll be woken again by the online event.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const count = this.pendingCount();
      if (count > 0) {
        console.log('[Outbox] Still offline;', count, 'item(s) remain queued.');
      }
      return count;
    }

    const items = this.read();
    if (items.length === 0) {
      return 0;
    }

    console.log('[Outbox] Flushing', items.length, 'queued item(s)...');
    const remaining: OutboxItem[] = [];
    for (const item of items) {
      try {
        if (item.type === 'form-response') {
          await this.sendQueuedFormResponse(item);
        } else {
          await this.sendQueuedXapiStatements(item);
        }
        console.log('[Outbox] Delivered', item.type === 'form-response' ? 'form response' : 'xAPI statements');
      } catch (error) {
        console.warn('[Outbox] Delivery failed for', item.type, '- will retry later:', error && error.message || error);
        remaining.push(item);
      }
    }
    this.write(remaining);
    console.log('[Outbox] Flush finished;', remaining.length, 'item(s) still pending.');
    // If anything could not be delivered but the browser still thinks we are
    // online, keep trying in the background rather than waiting for an 'online'
    // event or an app restart.
    if (remaining.length > 0) {
      this.scheduleRetryIfOnline();
    }
    return remaining.length;
  }

  /** Clear every queued item (used for tests / manual discard). */
  clear(): void {
    this.write([]);
  }

  private async sendQueuedFormResponse(item: QueuedFormResponse): Promise<void> {
    const headers = new HttpHeaders().set('formUploadToken', item.uploadKey);
    // groupId is normally stamped by FormsService.uploadFormResponse before the
    // POST; ensure it's present here too so the saved response is complete.
    if (item.response && !item.response.groupId) {
      const groupMatch = (item.formUploadURL || '').match(/\/onlineSurvey\/saveResponse\/([^/]+)\//);
      if (groupMatch) {
        item.response.groupId = groupMatch[1];
      }
    }
    await this.http.post(item.formUploadURL, item.response, { headers, observe: 'response' }).toPromise();
  }

  private async sendQueuedXapiStatements(item: QueuedXapiStatements): Promise<void> {
    // Prefer the native (Capacitor) IPC relay when the queued statements were
    // originally meant for it and the host is still the Tangerine app.
    const cap = (window as any).Capacitor;
    const tangyCache = cap && cap.Plugins && cap.Plugins.TangyCache;
    if (tangyCache && item.ipcPackage && item.endpoint && item.auth) {
      await tangyCache.forwardXapiStatements({
        endpoint: item.endpoint,
        auth: item.auth,
        ipcPackage: item.ipcPackage,
        statementsJson: JSON.stringify(item.statements)
      });
      return;
    }
    // Otherwise POST straight to the LRS /statements endpoint. `auth` is kept
    // verbatim (it is the same value ADL.XAPIWrapper sends as the
    // Authorization header when launched by the RESPECT launcher).
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'X-Experience-API-Version': '1.0.3',
      'Authorization': item.auth
    });
    const endpoint = (item.endpoint || '').replace(/\/+$/, '') + '/statements';
    await this.http.post(endpoint, item.statements, { headers }).toPromise();
  }
}
