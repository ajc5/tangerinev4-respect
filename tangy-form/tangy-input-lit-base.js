import { LitElement } from 'lit';
import { shouldIncludeXapi } from './util/tangy-xapi-utils';

export class TangyInputLitBase extends LitElement {

  connectedCallback() {
    super.connectedCallback()
    this._initialProps = super.getProps()
  }
  
  getXapiStatement() {
    return null;
  }

  getProps() {
    const baseProps = super.getProps ? super.getProps() : {};
    let xapiStatement = null;
    try {
      xapiStatement = shouldIncludeXapi(this) ? this.getXapiStatement() : null;
      console.log(`[xAPI] ${this.tagName.toLowerCase()} getProps`, xapiStatement);
    } catch (e) {
      console.error(`[xAPI] ${this.tagName.toLowerCase()} getProps error`, e);
    }
    return {
      ...baseProps,
      xapiStatement
    };
  }

  getModProps() {
    const initialProps = this._initialProps
    const currentProps = super.getProps()
    const modifiedProps = {}
    for (const key of Object.keys(currentProps)) {
      if (typeof currentProps[key] === 'object' || initialProps[key] !== currentProps[key]) {
        modifiedProps[key] = currentProps[key]
      }
    }
    return {
      name: this.getAttribute('name'),
      value: this.value,
      ...modifiedProps
    }
  }

}
