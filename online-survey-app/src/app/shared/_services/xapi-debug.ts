/**
 * Diagnostics for the xAPI / offline-outbox delivery path.
 *
 * Off by default. Toggle per browser window - no reload, no cross-tab leakage:
 *   window.xapiDebug = true    // in the devtools console
 *   window.xapiDebug = false   // silence again
 * Opening the app with `?xapiDebug=1` enables it for that window at load.
 */
declare global {
  interface Window { xapiDebug?: boolean }
}

if (typeof window !== 'undefined' && /[?&]xapiDebug=1(&|$)/.test(window.location.search)) {
  window.xapiDebug = true;
}

export const xapiDebug = (...args: any[]): void => {
  if (window.xapiDebug === true) console.log(...args);
};
