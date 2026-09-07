import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Breadcrumb } from 'src/app/shared/_components/breadcrumb/breadcrumb.component';
import { TangyErrorHandler } from 'src/app/shared/_services/tangy-error-handler.service';
import { _TRANSLATE } from 'src/app/shared/_services/translation-marker';
import { GroupsService } from '../services/groups.service';
import { TangerineFormsService } from '../services/tangerine-forms.service';
import { ProcessMonitorService } from 'src/app/shared/_services/process-monitor.service';
import { ProcessMonitorDialogComponent } from 'src/app/shared/_components/process-monitor-dialog/process-monitor-dialog.component';
import { MatDialog } from '@angular/material/dialog';

@Component({
  selector: 'app-release-online-survey',
  templateUrl: './release-online-survey.component.html',
  styleUrls: ['./release-online-survey.component.css']
})
export class ReleaseOnlineSurveyComponent implements OnInit {
  title = _TRANSLATE('Release Survey');
  breadcrumbs: Array<Breadcrumb> = [];
  groupId;
  forms;
  group;
  publishedSurveys;
  unPublishedSurveys;
  dialogRef:any
  panelOpenState: boolean = false;
  baseUrl = window.location.origin;
  respectToken = '';

  constructor(private route: ActivatedRoute,
    private groupService: GroupsService,
    private errorHandler: TangyErrorHandler,
    private tangyFormService: TangerineFormsService,
    private processMonitorService: ProcessMonitorService,
    private dialog: MatDialog,
    private httpClient: HttpClient,
  ) { }

  async ngOnInit() {
    this.groupId = this.route.snapshot.paramMap.get('groupId');
    this.breadcrumbs = [
      <Breadcrumb>{
        label: _TRANSLATE('Release Online Survey'),
        url: 'onlineSurvey'
      }
    ];
    this.processMonitorService.change.subscribe((isDone) => {
      if (this.processMonitorService.processes.length === 0) {
        this.dialog.closeAll()
      } else {
        this.dialog.closeAll()
        this.dialogRef = this.dialog.open(ProcessMonitorDialogComponent, {
          data: {
            messages: this.processMonitorService.processes.map(process => process.description).reverse()
          },
          disableClose: true
        })
      }
    })

    await this.getForms();
    try {
      // Used to build per-form RESPECT share links (like a Google Docs link).
      // The server resolves the token for every user, including user1.
      // respectUrl also tells us the host the server advertises (T_PROTOCOL +
      // T_HOST_NAME). We use its origin (not window.location.origin) so copied
      // links work from devices/emulators, where 'localhost' is unreachable.
      const result: any = await this.httpClient.get('/users/respectUrl').toPromise();
      const data = result?.data;
      this.respectToken = data?.respectToken || '';
      if (data?.respectUrl) {
        try {
          this.baseUrl = new URL(data.respectUrl).origin;
        } catch (err) {
          // Fall back to window.location.origin if the URL is malformed.
        }
      }
    } catch (error) {
      console.error(error);
      this.respectToken = '';
    }
  }

  async getForms() {
    const forms = await this.tangyFormService.getFormsInfo(this.groupId);
    this.group = await this.groupService.getGroupInfo(this.groupId);
    const groupOnlineSurveys = this.group?.onlineSurveys ?? [];
    const surveyData = forms.map(f => {
      const survey = groupOnlineSurveys.find(s => f.id === s.formId) || {};
      return { ...f, ...survey };
    });
    this.publishedSurveys = surveyData.filter(e => e.published && e.type == "form");
    this.unPublishedSurveys = surveyData.filter(e => !e.published && e.type == "form");
  }
  async publishSurvey(formId, appName, locked) {
    const process = this.processMonitorService.start('publishSurvey', 'Publishing Survey');

    try {
      await this.groupService.publishSurvey(this.groupId, formId, 'prod', appName, locked);
      await this.getForms();
      this.errorHandler.handleError(_TRANSLATE('Survey Published Successfully.'));
    } catch (error) {
      console.error(error);
      this.errorHandler.handleError(_TRANSLATE('Could Not Contact Server.'));
    } finally {
      this.processMonitorService.stop(process.id);
    }
  }
  async unPublishSurvey(formId) {
    const process = this.processMonitorService.start('unpublishSurvey', 'Un-publishing Survey');

    try {
      await this.groupService.unPublishSurvey(this.groupId, formId);
      await this.getForms();
      this.errorHandler.handleError(_TRANSLATE('Survey Un-published Successfully.'));
    } catch (error) {
      console.error(error);
      this.errorHandler.handleError(_TRANSLATE('Could Not Contact Server.'));
    } finally {
      this.processMonitorService.stop(process.id);
    }
  }

  /**
   * RESPECT app feed link (parallel /v2 manifest): points the RESPECT launcher
   * at the flat list of all published online-survey forms.
   */
  getRespectAppUrl() {
    if (!this.respectToken) {
      return '';
    }
    return `${this.baseUrl}/respect-app-manifest/v2?respectToken=${this.respectToken}`;
  }

  /**
   * Per-form RESPECT share link. This lets an admin add an individual form to
   * the UstadMobile/RESPECT launcher by pasting the URL, like sharing a link to
   * a Google Doc.
   */
  getRespectUrl(form) {
    if (!this.respectToken) {
      return '';
    }
    return `${this.baseUrl}/respect-app-manifest/${this.groupId}/${form.id}?respectToken=${this.respectToken}`;
  }

  copyRespectLink(form) {
    const url = this.getRespectUrl(form);
    if (!url) {
      this.errorHandler.handleError(_TRANSLATE('RESPECT link unavailable. Ask a server administrator to generate your RESPECT token.'));
      return;
    }
    this.copyText(url, _TRANSLATE('RESPECT link copied to clipboard.'));
  }

  copyRespectAppLink() {
    const url = this.getRespectAppUrl();
    if (!url) {
      this.errorHandler.handleError(_TRANSLATE('RESPECT link unavailable. Ask a server administrator to generate your RESPECT token.'));
      return;
    }
    this.copyText(url, _TRANSLATE('RESPECT app link copied to clipboard.'));
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

}
