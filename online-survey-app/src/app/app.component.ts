import { Component, OnInit, OnDestroy } from '@angular/core';
import { AppConfigService } from './shared/_services/app-config.service';
import { OfflineOutboxService } from './shared/_services/offline-outbox.service';
import { _TRANSLATE } from './shared/_services/translation-marker';
import { AuthenticationService } from './core/auth/_services/authentication.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy{
  languageDirection: string;
  appName: string;
  hasHelpLink: boolean = false;
  helpLink: string;
  sessionTimeoutCheckTimerID;
  isConfirmDialogActive = false;
  loggedIn = false;
  private _onlineHandler: any;

  constructor(
    private appConfigService: AppConfigService, 
    private authenticationService: AuthenticationService,
    private offlineOutbox: OfflineOutboxService,
    private router: Router
  ){
  }

  async ngOnInit(): Promise<any>{
    // Best-effort delivery of any submissions queued while offline: flush on
    // app start and whenever the browser reports connectivity is back.
    this.flushOutbox();
    this._onlineHandler = () => this.flushOutbox();
    window.addEventListener('online', this._onlineHandler);
    this.authenticationService.currentUserLoggedIn$.subscribe(async isLoggedIn => {
      if (isLoggedIn) {
        this.loggedIn = isLoggedIn;
        this.sessionTimeoutCheck();
        this.sessionTimeoutCheckTimerID =
        setInterval(await this.sessionTimeoutCheck.bind(this), 10 * 60 * 1000); // check every 10 minutes
      } else {
        this.loggedIn = false;
        this.router.navigate(['/survey-login']);
      }
    });

    try {
      const appConfig = await this.appConfigService.getAppConfig();
      this.appName = appConfig.appName;
      this.languageDirection = appConfig.languageDirection;
      if (appConfig.helpLink) {
        this.hasHelpLink = true;
        this.helpLink = appConfig.helpLink;
      }

    } catch (error) {
      this.appName = '';
      this.languageDirection = 'ltr';
      this.helpLink = '';
    }
  }
  
  async sessionTimeoutCheck() {
    const token = sessionStorage.getItem('token');
    const claims = JSON.parse(atob(token.split('.')[1]));
    const expiryTimeInMs = claims['exp'] * 1000;
    const minutesBeforeExpiry = expiryTimeInMs - (15 * 60 * 1000); // warn 15 minutes before expiry of token
    if (Date.now() >= minutesBeforeExpiry && !this.isConfirmDialogActive) {
      this.isConfirmDialogActive = true;
      const extendSession = confirm(_TRANSLATE('You are about to be logged out. Should we extend your session?'));
      if (extendSession) {
        this.isConfirmDialogActive = false;
        const extendedSession = await this.authenticationService.extendUserSession();
        if (!extendedSession) {
          await this.logout();
        }
      } else {
        this.isConfirmDialogActive = false;

        await this.logout();
      }
    } else if (Date.now() > expiryTimeInMs && this.isConfirmDialogActive) {
      // the token expired, and we warned them. Time to log out.
      await this.logout();
    }
  }

  async logout() {
    clearInterval(this.sessionTimeoutCheckTimerID);
    await this.authenticationService.logout();
    this.loggedIn = false;
    this.router.navigate(['/survey-login']);
  }

  private flushOutbox(): void {
    this.offlineOutbox.flush().then(remaining => {
      if (remaining > 0) {
        console.log('[Offline]', remaining, 'submission(s) still waiting for connectivity.');
      }
    }).catch(error => {
      console.warn('[Offline] Outbox flush error:', error);
    });
  }

  ngOnDestroy() {
    if (this._onlineHandler) {
      window.removeEventListener('online', this._onlineHandler);
    }
  }
}
