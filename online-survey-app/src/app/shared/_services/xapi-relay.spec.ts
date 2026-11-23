import { isLocalXapiEndpoint } from './xapi-relay';

describe('isLocalXapiEndpoint', () => {
  it('recognises the launcher embedded server endpoint', () => {
    expect(isLocalXapiEndpoint('http://127.0.0.1:8123/e/https%3A%2F%2Flrs.example.com/')).toBe(true);
    expect(isLocalXapiEndpoint('http://localhost:8123/e/x/')).toBe(true);
    expect(isLocalXapiEndpoint('http://[::1]:8123/e/x/')).toBe(true);
  });

  it('treats remote or malformed endpoints as remote', () => {
    expect(isLocalXapiEndpoint('https://lrs.example.com/xapi/')).toBe(false);
    expect(isLocalXapiEndpoint('')).toBe(false);
    expect(isLocalXapiEndpoint(null)).toBe(false);
    expect(isLocalXapiEndpoint('not a url')).toBe(false);
  });
});
