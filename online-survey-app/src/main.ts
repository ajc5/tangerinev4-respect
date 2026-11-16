import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

if (environment.production) {
  enableProdMode();
}

/*
 * Accept both URL shapes for a learning unit.
 *
 * The release directory is named after the form it holds
 * (/releases/<type>/online-survey-apps/<groupId>/<formId>/), so the form can be
 * worked out from the path alone. A RESPECT learning-resource URL must not
 * contain a "#" (a fragment is never sent to the server, so such a URL does not
 * identify a fetchable resource), while this app keeps hash routing - which is
 * what lets a static release directory work with no server side SPA fallback,
 * because the browser path stays put and relative asset URLs resolve.
 *
 * So: leave a hash that is already there alone (legacy links, the launcher, a
 * reload, an internal deep link), and when there is none, reconstruct the hash
 * route from the path before the router starts. The router then behaves exactly
 * as it always has.
 */
const FORM_RELEASE_PATH = /\/releases\/[^/]+\/online-survey-apps\/[^/]+\/([^/?#]+)\/?$/;
if (!window.location.hash || window.location.hash === '#') {
  const formId = window.location.pathname.match(FORM_RELEASE_PATH)?.[1];
  if (formId) {
    history.replaceState(null, '', `${window.location.pathname}#/form/${formId}`);
  }
}

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
