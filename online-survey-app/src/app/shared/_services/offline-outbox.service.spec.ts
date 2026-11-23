import { of } from 'rxjs';
import { OfflineOutboxService } from './offline-outbox.service';

describe('OfflineOutboxService offline delivery', () => {
  const OUTBOX_KEY = 'tangerine-online-survey-outbox-v1';
  const LOOPBACK_ENDPOINT = 'http://127.0.0.1:8123/e/https%3A%2F%2Flrs.example.com';
  const REMOTE_ENDPOINT = 'https://lrs.example.com';

  let store: { [key: string]: string };
  let http: any;
  let service: OfflineOutboxService;
  let online: boolean;

  const writeOutbox = (items: any[]) => {
    store[OUTBOX_KEY] = JSON.stringify(items);
  };

  const readOutbox = () => JSON.parse(store[OUTBOX_KEY] || '[]');

  beforeEach(() => {
    store = {};
    spyOn(localStorage, 'getItem').and.callFake(
      (key: string) => store[key] !== undefined ? store[key] : null
    );
    spyOn(localStorage, 'setItem').and.callFake(
      (key: string, value: string) => { store[key] = value; }
    );
    http = { post: jasmine.createSpy('post').and.returnValue(of({})) };
    service = new OfflineOutboxService(http);
    online = false;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
    (window as any).TangyCacheBridge = undefined;
    (window as any).Capacitor = undefined;
  });

  it('posts an xAPI batch to a launcher-local endpoint even when offline', async () => {
    writeOutbox([{
      type: 'xapi-statements',
      statements: [{ id: 's1' }],
      endpoint: LOOPBACK_ENDPOINT,
      auth: 'Basic x',
      queuedAt: Date.now(),
    }]);

    const remaining = await service.flush();

    expect(http.post).toHaveBeenCalled();
    expect(http.post.calls.mostRecent().args[0]).toBe(LOOPBACK_ENDPOINT + '/statements');
    expect(remaining).toBe(0);
    expect(readOutbox()).toEqual([]);
  });

  it('keeps a form response and a remote xAPI batch while offline', async () => {
    writeOutbox([
      {
        type: 'form-response',
        response: { _id: 'r1' },
        formUploadURL: '/onlineSurvey/saveResponse/group/form',
        uploadKey: 'key',
        queuedAt: Date.now(),
      },
      {
        type: 'xapi-statements',
        statements: [{ id: 's2' }],
        endpoint: REMOTE_ENDPOINT,
        auth: 'Basic x',
        queuedAt: Date.now(),
      },
    ]);

    const remaining = await service.flush();

    expect(http.post).not.toHaveBeenCalled();
    expect(remaining).toBe(2);
    expect(readOutbox().length).toBe(2);
  });
});
