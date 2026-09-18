import { MenuService } from './../../../../shared/_services/menu.service';
import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../_services/user.service';
import { TangyErrorHandler } from 'src/app/shared/_services/tangy-error-handler.service';
import { _TRANSLATE } from 'src/app/shared/_services/translation-marker';

@Component({
  selector: 'app-manage-users',
  templateUrl: './manage-users.component.html',
  styleUrls: ['./manage-users.component.css']
})
export class ManageUsersComponent implements OnInit {
  activeUsers;
  archivedUsers;
  usersDisplayedColumns = ['username', 'email', 'publicAccessUrl', 'actions'];
  baseUrl = window.location.origin;
  respectUrl = '';
  // Matches how app.component.ts surfaces the signed-in user: the JWT's
  // username, written to localStorage by AuthenticationService.setTokens().
  username: string = localStorage.getItem('user_id');

  constructor(
    private userService: UserService,
    private menuService: MenuService,
    private errorHandler: TangyErrorHandler,
    private httpClient: HttpClient
  ) { }

  async ngOnInit() {
    this.menuService.setContext(_TRANSLATE('Users'), '', 'users')
    this.getAllUsers();
    this.getMyRespectUrl();
  }

  /**
   * user1 is the only user without a profile page, because the profile route is
   * closed to it by the `non_user1_user` permission. This is therefore the only
   * page on which user1 can reach its own RESPECT link; the template shows the
   * field to user1 alone. /users/respectUrl resolves the token for the
   * signed-in user and handles user1 through the server's in-memory token
   * cache, so no user1-specific endpoint is needed.
   *
   * Distinct from getRespectUrl(user) below, which builds the link for a row in
   * the users tables from that user's stored respectToken.
   */
  async getMyRespectUrl() {
    try {
      const result: any = await this.httpClient.get('/users/respectUrl').toPromise();
      this.respectUrl = result?.data?.respectUrl || '';
    } catch (error) {
      this.respectUrl = '';
    }
  }

  copyRespectUrl() {
    if (!this.respectUrl) {
      this.errorHandler.handleError(_TRANSLATE('RESPECT link unavailable. Ask a server administrator to generate your RESPECT token.'));
      return;
    }
    this.copyText(this.respectUrl, _TRANSLATE('RESPECT link copied to clipboard.'));
  }

  private copyText(url: string, successMessage: string) {
    try {
      navigator.clipboard.writeText(url);
      this.errorHandler.handleError(successMessage);
    } catch (error) {
      // Fallback for browsers without async clipboard API
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      this.errorHandler.handleError(successMessage);
    }
  }

  async getAllUsers() {
    try {
      this.activeUsers = [...await this.userService.getAllUsers()].filter(user => user.isActive);
      this.archivedUsers = [...await this.userService.getAllUsers()].filter(user => !user.isActive);
    } catch (error) {
      this.activeUsers = [];
      this.archivedUsers = [];
      console.error(error);
    }
  }
  async deleteUser(username) {
    try {
      const confirmDelete = confirm(`${_TRANSLATE('Delete User named')} "${username}"?`);
      if (confirmDelete) {
        if (await this.userService.deleteUser(username)) {
          this.errorHandler.handleError(_TRANSLATE('User Deleted Successfully'));
          this.getAllUsers();
        } else {
          this.errorHandler.handleError(_TRANSLATE('Could not delete user'));
        }
      }
    } catch (error) {
      this.errorHandler.handleError(_TRANSLATE('Could not delete user'));
    }
  }

  async restoreUser(username) {
    try {
      const confirmRestore = confirm(`${_TRANSLATE('Restore User named')} "${username}"?`);
      if (confirmRestore) {
        if (await this.userService.restoreUser(username)) {
          this.errorHandler.handleError(_TRANSLATE('User Restored Successfully'));
          this.getAllUsers();
        } else {
          this.errorHandler.handleError(_TRANSLATE('Could not restore user'));
        }
      }
    } catch (error) {
      this.errorHandler.handleError(_TRANSLATE('Could not restore user'));
    }
  }

  getRespectUrl(user) {
    return `${this.baseUrl}/respect-app-manifest?respectToken=${user.respectToken}`;
  }

}