import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnInit, ViewChild, Input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsService } from 'src/app/shared/_services/forms-service.service';
import { CaseService } from 'src/app/case/services/case.service';
import { TangyFormService } from '../tangy-form.service';
declare const ADL: any;

const sleep = (milliseconds) => new Promise((res) => setTimeout(() => res(true), milliseconds))

@Component({
  selector: 'app-tangy-forms-player',
  templateUrl: './tangy-forms-player.component.html',
  styleUrls: ['./tangy-forms-player.component.css']
})
export class TangyFormsPlayerComponent implements OnInit {
  @ViewChild('container', {static: true}) container: ElementRef;
  @Input('response') response;

  @Input('templateId') templateId:string
  @Input('location') location:any
  @Input('skipSaving') skipSaving = false
  @Input('preventSubmit') preventSubmit = false
  @Input('metadata') metadata:any

  // LRS configuration for sending xAPI statements on form submission
  @Input('lrsEndpoint') lrsEndpoint: string
  @Input('lrsAuth') lrsAuth: string

  // Optional registration UUID from URL params (like respect.html)
  private lrsRegistration: string

  // Actor from URL params
  private lrsActor: any

  // xAPI debug info to display in the UI
  xapiDebugInfo = {
    endpoint: '',
    auth: '',
    registration: '',
    actor: '',
  }

  formId: string;
  formResponseId: string;
  caseId: string;
  caseEventId: string;
  eventFormId: string;
  window: any;

  throttledSaveLoaded
  throttledSaveFiring
  
  constructor(
    private route: ActivatedRoute, 
    private formsService: FormsService, 
    private router: Router, 
    private httpClient:HttpClient,
    private caseService: CaseService,
    private tangyFormService: TangyFormService
  ) { 
    this.router.events.subscribe(async (event) => {
        this.formId = this.route.snapshot.paramMap.get('formId');
        this.formResponseId = this.route.snapshot.paramMap.get('formResponseId');
        this.caseId = this.route.snapshot.paramMap.get('case');
        this.caseEventId = this.route.snapshot.paramMap.get('event');
        this.eventFormId = this.route.snapshot.paramMap.get('form');
    });
  }

  async ngOnInit(): Promise<any> {
    this.window = window;

    // Parse xAPI launch parameters from URL query string (like respect.html)
    this.populateXapiFromUrlParams();

    // Loading the formResponse from a case must happen before rendering the innerHTML
    let formResponse;
    if (this.caseId && this.caseEventId && this.eventFormId) {
      // Store the caseUrlHash in sessionStorage so that we can redirect to the correct page after logout -> login
      sessionStorage.setItem('caseUrlHash', `/case/event/form/${this.caseId}/${this.caseEventId}/${this.eventFormId}`);

      try {
        const groupId = window.location.pathname.split('/')[4];
        this.tangyFormService.initialize(groupId);

        await this.caseService.load(this.caseId);
        this.caseService.setContext(this.caseEventId, this.eventFormId)

        this.window.T = {
          case: this.caseService,
          tangyForms: this.tangyFormService
        }
        this.window.caseService = this.caseService

        this.metadata = {
          caseId: this.caseId,
          caseEventId: this.caseEventId,
          eventFormId: this.eventFormId
        }

        try {
          // Attempt to load the form response for the event form
          const event = this.caseService.case.events.find(event => event.id === this.caseEventId);
          if (event.id) {
            const eventForm = event.eventForms.find(eventForm => eventForm.id === this.eventFormId);
              if (eventForm && eventForm.id === this.eventFormId && eventForm.formResponseId) {
                formResponse = await this.tangyFormService.getResponse(eventForm.formResponseId);
            }
          }
        } catch (error) {
          //pass
        }

      } catch (error) {
        console.log('Error loading case: ' + error)
      }
    }

    const data = await this.httpClient.get('./assets/form/form.html', {responseType: 'text'}).toPromise();
    this.container.nativeElement.innerHTML = data;
    let tangyForm = this.container.nativeElement.querySelector('tangy-form');

    if (formResponse) {
      tangyForm.response = formResponse;
    }

    if (this.caseId && this.caseService) {
      tangyForm.addEventListener('TANGY_FORM_UPDATE', async (event) => {
        let response = event.target.store.getState()
        this.throttledSaveResponse(response)
  
        if (this.caseService.eventForm && !this.caseService.eventForm.formResponseId) {
          this.caseService.eventForm.formResponseId = tangyForm.response._id;
          await this.caseService.save();
          await this.caseService.load(this.caseId);
        }
      })

      tangyForm.addEventListener('after-submit', async (event) => {
        event.preventDefault();

        let response = event.target.store.getState()
        await this.saveResponse(response)
        if (this.caseService && this.caseService.caseEvent && this.caseService.eventForm) {
          this.caseService.markEventFormComplete(this.caseService.caseEvent.id, this.caseService.eventForm.id)
          await this.caseService.save()
        }
        // Send xAPI statements to LRS if configured
        await this.sendXapiStatements(event.target);
        if (window['eventFormRedirect']) {
          try {
            // this.router.navigateByUrl(window['eventFormRedirect']) -- TODO figure this out later
            this.window['location'] = window['eventFormRedirect']
            window['eventFormRedirect'] = ''
          } catch (error) {
            console.error(error);
          }
        } else {
          this.router.navigate(['/form-submitted-success']);
        }
      });
    } else {
      tangyForm.addEventListener('after-submit', async (event) => {
        event.preventDefault();
        try {
          if (await this.formsService.uploadFormResponse(event.target.response)){
            // Send xAPI statements to LRS if configured
            await this.sendXapiStatements(event.target);
            this.router.navigate(['/form-submitted-success']);
          } else {
            alert('Form could not be submitted. Please retry');
          }
        } catch (error) {
          console.error(error);
        }
      });
    }
  }


  /**
   * Populate LRS configuration from URL query parameters (endpoint, auth, actor, registration).
   */
  private populateXapiFromUrlParams(): void {
    console.log('[xAPI Debug] Checking URL query parameters:', window.location.search);
    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.has('endpoint')) {
      const endpoint = this.validateEndpoint(urlParams.get('endpoint'));
      this.lrsEndpoint = endpoint || '';
      this.xapiDebugInfo.endpoint = this.lrsEndpoint;
      console.log('[xAPI Debug] Endpoint from URL:', this.lrsEndpoint || '(rejected - not a valid http(s) URL)');
    }
    if (urlParams.has('auth')) {
      this.lrsAuth = urlParams.get('auth') || '';
      this.xapiDebugInfo.auth = this.lrsAuth;
      console.log('[xAPI Debug] Auth from URL:', this.lrsAuth);
    }

    // Use a provided registration, or leave undefined so generateUUID is used
    if (urlParams.has('registration')) {
      this.lrsRegistration = urlParams.get('registration') || '';
      this.xapiDebugInfo.registration = this.lrsRegistration;
      console.log('[xAPI Debug] Registration from URL:', this.lrsRegistration);
    }
    if (urlParams.has('actor')) {
      try {
        this.lrsActor = JSON.parse(urlParams.get('actor'));
        this.xapiDebugInfo.actor = this.lrsActor.name || JSON.stringify(this.lrsActor);
        console.log('[xAPI Debug] Actor from URL:', this.lrsActor);
      } catch (e) {
        console.log('[xAPI Debug] Failed to parse actor from URL');
      }
    }

    // Also capture @Input values if set (in case they're set but URL params are not)
    if (this.lrsEndpoint && !this.xapiDebugInfo.endpoint) this.xapiDebugInfo.endpoint = this.lrsEndpoint;
    if (this.lrsAuth && !this.xapiDebugInfo.auth) this.xapiDebugInfo.auth = this.lrsAuth;

    if (!urlParams.has('endpoint') && !urlParams.has('auth') && !urlParams.has('registration')) {
      console.log('[xAPI Debug] No xAPI URL parameters found. Using @Input values if provided.');
    }
  }

private validateEndpoint(value: string | null): string | undefined {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? value : undefined;
    } catch {
      return undefined;
    }
  }

  // Prevent parallel saves which leads to race conditions. Only save the first and then last state of the store.
  // Everything else in between we can ignore.
  async throttledSaveResponse(response) {
    // If already loaded, return.
    if (this.throttledSaveLoaded) return
    // Throttle this fire by waiting until last fire is done.
    if (this.throttledSaveFiring) {
      this.throttledSaveLoaded = true
      while (this.throttledSaveFiring) await sleep(200)
      this.throttledSaveLoaded = false
    }
    // Fire it.
    this.throttledSaveFiring = true
    await this.saveResponse(response)
    this.throttledSaveFiring = false
  }

  async saveResponse(state) {
    let stateDoc = await this.tangyFormService.getResponse(state._id)
    const archiveStateChange = state.archived === stateDoc['archived']
    if (stateDoc && stateDoc['complete'] && state.complete && stateDoc['form'] && !stateDoc['form'].hasSummary && archiveStateChange) {
      // Since what is in the database is complete, and it's still complete, and it doesn't have 
      // a summary where they might add some input, don't save! They are probably reviewing data.
      this.response = stateDoc
    } else {
      // add metadata
      stateDoc = {
        ...state,
        location: this.location || state.location,
        ...this.metadata
      }
      const updatedStateDoc = await this.tangyFormService.saveResponse(stateDoc)
      if (updatedStateDoc) {
        this.response = updatedStateDoc
        return true;
      }
    }
    return false;
  }

  async saveFormResponse(formResponse) {

    try {
      if (!await this.formsService.uploadFormResponse(formResponse)) {
        alert('Form could not be saved. Please retry');
        return false;
      }
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Collect xAPI statements from form inputs and send them all in a single batch request to the LRS.
   */
  private async sendXapiStatements(formElement: any): Promise<void> {
    console.log('[xAPI Debug] sendXapiStatements called');
    
    // Skip if LRS is not configured or actor is missing
    if (!this.lrsEndpoint || !this.lrsAuth || !this.lrsActor) {
      console.log('[xAPI Debug] Skipping – endpoint/auth/actor not fully configured. endpoint:', this.lrsEndpoint, 'auth:', this.lrsAuth, 'actor:', this.lrsActor);
      return;
    }

    const inputs = formElement.inputs || [];
    if (inputs.length === 0) {
      console.log('[xAPI Debug] No inputs found on form element');
      return;
    }

    // Use the registration from URL params, or generate a new one for this submission
    const registration = this.lrsRegistration || this.generateUUID();
    console.log('[xAPI Debug] Using registration:', registration);

    // Collect all statements from inputs that have xapiStatement data
    const statements = [];
    for (const input of inputs) {
      if (input.xapiStatement && typeof input.xapiStatement === 'object') {
        // Set the actor and registration on each statement
        input.xapiStatement.actor = this.lrsActor;
        input.xapiStatement.context = input.xapiStatement.context || {};
        input.xapiStatement.context.registration = registration;
        statements.push(input.xapiStatement);
      }
    }

    // Collect form-level xAPI statements (form started and form completed)
    const response = formElement.response;
    if (response && response.form) {
      if (response.form.xapiStatementStarted && typeof response.form.xapiStatementStarted === 'object') {
        response.form.xapiStatementStarted.actor = this.lrsActor;
        response.form.xapiStatementStarted.context = response.form.xapiStatementStarted.context || {};
        response.form.xapiStatementStarted.context.registration = registration;
        statements.unshift(response.form.xapiStatementStarted);
      }
      if (response.form.xapiStatementCompleted && typeof response.form.xapiStatementCompleted === 'object') {
        response.form.xapiStatementCompleted.actor = this.lrsActor;
        response.form.xapiStatementCompleted.context = response.form.xapiStatementCompleted.context || {};
        response.form.xapiStatementCompleted.context.registration = registration;
        statements.push(response.form.xapiStatementCompleted);
      }
    }

    if (statements.length === 0) {
      console.log('[xAPI Debug] No inputs with xapiStatement property found');
      return;
    }

    console.log('[xAPI Debug] Sending', statements.length, 'statements to', this.lrsEndpoint);
    console.log('[xAPI Debug] Statements JSON:', JSON.stringify(statements, null, 2));

    // Configure ADL wrapper (same as in respect.html)
    ADL.XAPIWrapper.changeConfig({
      endpoint: this.lrsEndpoint,
      auth: this.lrsAuth
    });

    try {
      // Use ADL.XAPIWrapper.sendStatements (same as respect.html)
      const res = ADL.XAPIWrapper.sendStatements(statements);
      const xhr = res && res.xhr;
      if (xhr) {
        xhr.addEventListener('load', () => {
          console.log('[xAPI Debug] XHR status:', xhr.status, xhr.statusText);
          if (xhr.status >= 200 && xhr.status < 300) {
            console.log('[xAPI Debug] Statements DELIVERED to LRS:', xhr.responseText);
          } else {
            console.error('[xAPI Debug] Statements REJECTED by LRS:', xhr.status, xhr.statusText, 'body:', xhr.responseText);
          }
        });
        xhr.addEventListener('error', () => {
          console.error('[xAPI Debug] Statements FAILED to send (blocked/network/CORS/mixed-content). readyState:', xhr.readyState, 'status:', xhr.status);
        });
      }
      console.log('[xAPI Debug] Submission result:', res, statements);
    } catch (error) {
      console.error('[xAPI Debug] Submission failed:', error);
    }
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }


}
