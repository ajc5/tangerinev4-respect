/**
 * Relaying xAPI statements to the app that launched this lesson.
 *
 * A lesson launched by the RESPECT launcher is handed a set of xAPI launch parameters
 * (`endpoint`, `auth`, `actor`, `activity_id`, `xapiIpcPackage`). Statement delivery then
 * has to go through the *launcher*: it owns the school's LRS credentials and, when the
 * lesson was opened from an assignment, adds the assignment context to each statement.
 *
 * Two host shapes can do that relay:
 *
 *  - `Capacitor.Plugins.TangyCache` - the native app's own WebView.
 *  - `window.TangyCacheBridge` - an object a host injects into a plain WebView that has no
 *    Capacitor bridge (the Tangerine app's cached-lesson WebView). Its
 *    `queueXapiStatements` answers synchronously with a boolean.
 *
 * Both are only useful when the launch carried `xapiIpcPackage`; without it there is no
 * launcher to relay to.
 *
 * IMPORTANT: the hop to the launcher is a local Binder call and works with no network at
 * all. Only the launcher's onward POST to the LRS needs connectivity, and the host owns
 * the retry for that. So being offline is NOT a reason to give up on the relay and park
 * statements in this app's own outbox - and it must not be treated as one.
 */
export interface XapiRelayPayload {
  endpoint: string;
  auth: string;
  ipcPackage: string;
  statementsJson: string;
}

export interface NativeXapiRelay {
  /**
   * Live send, for a form the user has just submitted: deliver now and let the host
   * hand the user back to the launcher.
   */
  forward(payload: XapiRelayPayload): Promise<any>;

  /**
   * Hand-off for delivery outside this page's lifetime: the host persists the batch and
   * retries it (e.g. a connectivity-constrained WorkManager job), so it arrives even if
   * this app is killed before the network returns. Resolves true once the batch is
   * durable - the caller may then drop its own copy.
   */
  queue(payload: XapiRelayPayload): Promise<boolean>;
}

/** The relay offered by the hosting app, or null when there is none. */
export function nativeXapiRelay(win: any = typeof window === 'undefined' ? null : window): NativeXapiRelay | null {
  if (!win) return null;

  const plugin = win.Capacitor && win.Capacitor.Plugins && win.Capacitor.Plugins.TangyCache;

  if (plugin && typeof plugin.forwardXapiStatements === 'function') {
    return {
      forward: (payload: XapiRelayPayload) => plugin.forwardXapiStatements(payload),
      queue: async (payload: XapiRelayPayload) => {
        if (typeof plugin.queueXapiStatements === 'function') {
          const result = await plugin.queueXapiStatements(payload);
          return !!(result && result.ok);
        }
        // Older host without the queue method: a live forward is still better than
        // leaving the batch in the page.
        await plugin.forwardXapiStatements(payload);
        return true;
      }
    };
  }

  const bridge = win.TangyCacheBridge;

  if (bridge && typeof bridge.forwardXapiStatements === 'function') {
    return {
      // The bridge is fire-and-forget and persists the batch natively, including a retry
      // when the launcher cannot take it, so there is nothing to await here.
      forward: async (payload: XapiRelayPayload) => {
        bridge.forwardXapiStatements(
          payload.endpoint, payload.auth, payload.ipcPackage, payload.statementsJson
        );
        return { ok: true, result: 'handed to the native IPC relay' };
      },
      queue: async (payload: XapiRelayPayload) => {
        if (typeof bridge.queueXapiStatements === 'function') {
          return bridge.queueXapiStatements(
            payload.endpoint, payload.auth, payload.ipcPackage, payload.statementsJson
          ) === true;
        }
        bridge.forwardXapiStatements(
          payload.endpoint, payload.auth, payload.ipcPackage, payload.statementsJson
        );
        return true;
      }
    };
  }

  return null;
}
