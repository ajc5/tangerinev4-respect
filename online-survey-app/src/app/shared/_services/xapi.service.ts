import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class XapiService {

  constructor(private http: HttpClient) { }

  private getHeaders(auth: string): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'X-Experience-API-Version': '1.0.3',
      'Authorization': 'Basic ' + btoa(auth)
    });
  }

  /**
   * Normalize the LRS endpoint URL by removing any trailing slash so that
   * appending "/statements" does not result in a double slash.
   */
  private normalizeEndpointUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  async sendStatement(statement: any, lrsEndpointUrl:string, auth: string): Promise<void> {
    const headers = this.getHeaders(auth);
    const endpoint = this.normalizeEndpointUrl(lrsEndpointUrl) + "/statements";
    try {
      await this.http.post(endpoint, statement, { headers }).toPromise();
    } catch (err) {
      console.warn('Failed to send, saving offline', err);
    }
  }

  /**
   * Send multiple xAPI statements in a single batch request to the LRS.
   * This matches the pattern from respect.html which sends all form input statements at once.
   * The xAPI spec accepts an array of statements at the /statements endpoint.
   */
  async sendStatements(statements: any[], lrsEndpointUrl:string, auth: string): Promise<any> {
    const headers = this.getHeaders(auth);
    const endpoint = this.normalizeEndpointUrl(lrsEndpointUrl) + "/statements";
    console.log('[xAPI Service] POST to', endpoint);
    try {
      const response = await this.http.post(endpoint, statements, { headers, observe: 'response' }).toPromise();
      console.log('[xAPI Service] Response status:', response?.status, response?.statusText);
      console.log('[xAPI Service] Response body:', response?.body);
      return response;
    } catch (err) {
      console.error('[xAPI Service] HTTP error:', err.status, err.statusText);
      if (err.error) {
        console.error('[xAPI Service] Error body:', err.error);
      }
      throw err;
    }
  }
}