// xAPI interaction types for different input types
//
// numeric: TANGY-INPUT (number)
// fill-in: TANGY-INPUT (text, email, date, time), TANGY-KEYBOARD-INPUT, TANGY-PARTIAL-DATE, TANGY-ETHIO-DATE, TANGY-QR
// choice: TANGY-CHECKBOXES, TANGY-CHECKBOXES-DYNAMIC, TANGY-RADIO-BUTTONS, TANGY-RADIO-BLOCKS, TANGY-SELECT, TANGY-LOCATION, TANGY-EFTOUCH, TANGY-ACASI, TANGY-TIMED, TANGY-UNTIMED-GRID
// true-false: TANGY-CHECKBOX, TANGY-TOGGLE, TANGY-TOGGLE-BUTTON, TANGY-CONSENT
// other: TANGY-GPS, TANGY-PHOTO-CAPTURE, TANGY-VIDEO-CAPTURE, TANGY-AUDIO-RECORDING, TANGY-SIGNATURE, TANGY-INPUT-GROUPS
export const XAPI_INTERACTION_TYPE = {
  CHOICE: "choice",
  FILL_IN: "fill-in",
  LONG_FILL_IN: "long-fill-in",
  TRUE_FALSE: "true-false",
  MATCHING: "matching",
  PERFORMANCE: "performance",
  SEQUENCING: "sequencing",
  LIKERT: "likert",
  NUMERIC: "numeric",
  COMPOUND: "compound",
  OTHER: "other"
};

// xAPI Result property generation functions for groups of input types

// default: TANGY-INPUT, TANGY-PARTIAL-DATE, TANGY-ETHIO-DATE, TANGY-KEYBOARD-INPUT, TANGY-QR, TANGY-ACASI, TANGY-SIGNATURE
// media: TANGY-PHOTO-CAPTURE, TANGY-VIDEO-CAPTURE, TANGY-AUDIO-RECORDING
// choice: TANGY-RADIO-BUTTONS, TANGY-RADIO-BLOCKS, TANGY-SELECT, TANGY-CHECKBOXES, TANGY-CHECKBOXES-DYNAMIC
// grid: TANGY-TIMED, TANGY-UNTIMED-GRID
// trueFalse: TANGY-CHECKBOX, TANGY-TOGGLE, TANGY-TOGGLE-BUTTON, TANGY-CONSENT
export const xapiResultFactory = {
  default: (input) => {
    let result = {};
    if (!(input.value === undefined || input.value === null || input.value === '')) {
      result.response = input.value;
    }
    setXapiResultCommon(result);
    return result;
  },
  media: (input) => {
    let result = {};
    if (!(input.value === undefined || input.value === null || input.value === '')) {
      if (typeof input.value === 'string' && input.value.startsWith('blob:')) {
        const blobId = (input.value.split('/').pop() || '').split('?')[0];
        const extByTag = {
          "TANGY-PHOTO-CAPTURE": "jpg",
          "TANGY-VIDEO-CAPTURE": "mp4",
          "TANGY-AUDIO-RECORDING": "webm"
        };
        const fileExt = extByTag[input.tagName];
        result.response = `${blobId}.${fileExt}`;
      } else {
        result.response = input.value;
      }
    }
    setXapiResultCommon(result);
    return result;
  },
  choice: (input, correctResponsesPattern) =>{
    let result = {};
    const selectedVals = [];
    if (input.tagName === "TANGY-SELECT") {
      if (input.value) selectedVals.push({name: input.value});
    } else if (Array.isArray(input.value)) {
      selectedVals.push(...input.value.filter(v => v.value === 'on'));
    }
    if (selectedVals.length > 0) {
      const options = Array.from(input.querySelectorAll('option'));
      let opt;
      result.response = selectedVals.map(selVal => {
        opt = options.find(o => o.value === selVal.name || o.getAttribute('name') === selVal.name);
        return opt ? (opt.getAttribute('name') || opt.value) : selVal.name;
      }).join('[,]');
      // for radio-blocks and radio-buttons
      if (correctResponsesPattern) {
        result.success = opt ? opt.hasAttribute('correct') : false;
        result.score = { scaled: result.success ? 1 : 0 };
      }
    }
    setXapiResultCommon(result);
    return result;
  },
  grid: (input) => {
    let result = {};
    if (Array.isArray(input.value)) {
      let markedCells = [];
      for (let cell of input.value) {
        if (cell.value === 'on') {
          markedCells.push(cell.name);
        }
        if (cell.highlighted) {
          result.extensions = {
            'http://tangerinecentral.org/xapi/extensions/last-attempted': cell.name
          }
        }
      }
      if (markedCells.length > 0) {
        result.response = markedCells.join('[,]');
      }
    }
    let timedGridDuration = input.getAttribute('duration');
    let timedGridTimeRemaining = input.getAttribute('time-remaining');
    if (timedGridDuration && timedGridTimeRemaining) {
      result.duration = `PT${timedGridDuration - timedGridTimeRemaining}S`;
    }
    setXapiResultCommon(result);
    return result;
  },
  trueFalse: (input) => {
    let result = {};
    result.response = (input.value === 'on' || input.value === 'yes') ? 'true' : 'false';
    setXapiResultCommon(result);
    return result;
  }
}

export function setXapiResultCommon(result) {
  if (Object.prototype.toString.call(result.response) === '[object Object]') {
    result.response = JSON.stringify(result.response);
  }  // string, array, number, boolean, date
  else if (result.response !== undefined && result.response !== null && !Array.isArray(result.response)) {
    result.response = result.response.toString();
  }
  result.completion = true;
}

export function generateXapiStatementFromTemplate(input, xapiProperties = {}) {
  if (!input) return null;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = input.label || input.name;
  let inputLabel =  tempDiv.textContent || tempDiv.innerText || '';

  let locale = document.documentElement.lang || navigator.language;
  let { formId, groupId } = extractIdsFromUrl();
  let formTitle = input.closest('tangy-form') ? input.closest('tangy-form').getAttribute('title') : '';
  let inputId = {
    id: input.name || input.id,
    itemId: input.closest('tangy-form-item') ? input.closest('tangy-form-item').id : '',
    formId: formId,
    groupId: groupId
  }
  return deepMerge(xapiProperties, {
    "verb": {
      "id": "http://adlnet.gov/expapi/verbs/answered",
      "display": { [locale]: "answered" }
    },
    "object": {
      "id": getIDUrl(inputId),
      "objectType": "Activity",
      "definition": {
        "name": { [locale]: inputId.id },
        ...(inputLabel && { description: { [locale]: inputLabel } }),
        "type": "http://adlnet.gov/expapi/activities/cmi.interaction"
      }
    },
    "context": {
      "contextActivities": {
        "parent": [
          {
            "id": getIDUrl({formId, groupId}),
            "definition": {
              ...(formTitle && { "name": { [locale]: `${formTitle}` } }),
              "type": "http://adlnet.gov/expapi/activities/assessment"
            } 
          }
        ],
        "grouping": [
          {
            "id": getIDUrl({groupId}),
            "definition": {
              "type": "http://adlnet.gov/expapi/activities/course"
            }
          }
        ]
      }
    }
  });
}

export function getXapiMediaStatement(input) {
    return generateXapiStatementFromTemplate(input, {
      object: {
        definition: {
          interactionType: XAPI_INTERACTION_TYPE.OTHER,
        }
      },
      result: xapiResultFactory.media(input)
    })
}

export function getXapiTrueFalseStatement(input) {
    return generateXapiStatementFromTemplate(input, {
      object: {
        definition: {
          interactionType: XAPI_INTERACTION_TYPE.TRUE_FALSE,
        }
      },
      result: xapiResultFactory.trueFalse(input)
    })
}

export function getXapiFillInStatement(input) {
  return generateXapiStatementFromTemplate(input, {
    object: {
      definition: {
        interactionType: XAPI_INTERACTION_TYPE.FILL_IN
      }
    },
    result: xapiResultFactory.default(input)
  })
}

// Used by TANGY-RADIO-BUTTONS, TANGY-RADIO-BLOCKS, TANGY-SELECT, TANGY-CHECKBOXES, TANGY-CHECKBOXES-DYNAMIC, TANGY-EFTOUCH, TANGY-TIMED, TANGY-UNTIMED-GRID
export function getChoiceObjectDefinitionProps(input) {
  const locale = document.documentElement.lang || navigator.language;
  let choices = [];
  const options = Array.from(input.querySelectorAll('option'));
  for (let option of options) {
    if (!option.hasAttribute('disabled')) {
      choices.push({
        id: option.getAttribute('name') || option.value,
        ...(option.textContent.trim() && { description: { [locale]: option.textContent.trim()}})    
      });
    }
  }
  let correctResponsesPattern = [];
  if (input.tagName === "TANGY-RADIO-BUTTONS" || input.tagName === "TANGY-RADIO-BLOCKS" || input.tagName === "TANGY-EFTOUCH") {
    const options = Array.from(input.querySelectorAll('option'));
    options.forEach(option => {
      let optId = option.getAttribute('name') || option.value;
      if (option.hasAttribute('correct') && !option.hasAttribute('disabled') && !correctResponsesPattern.includes(optId)) {
        correctResponsesPattern.push(optId);
      }
    });
  }
  let timedGridDuration = input.getAttribute('duration');
  return {
    choices,
    ...(correctResponsesPattern.length > 0 && { correctResponsesPattern }),
    ...(timedGridDuration && { extensions: { "http://tangerinecentral.org/xapi/extensions/duration": `PT${timedGridDuration}S` }})
  };
}

export function shouldIncludeXapi(input) {
  let currInput = input;
  while (currInput) {
    if (currInput instanceof Element) {
      if (currInput.hasAttribute('skipped') || currInput.hasAttribute('hidden') || currInput.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      const cs = window ? window.getComputedStyle(currInput) : {};
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    currInput = currInput.parentElement;
  }
  return true;
}

/**
 * Generate a form-level xAPI statement for form start (attempted) or form end (completed).
 * Uses generateXapiStatementFromTemplate for common parts (actor, locale, URL IDs).
 * @param {HTMLElement} formElement - The <tangy-form> element
 * @param {string} verbType - 'attempted' or 'completed'
 * @returns {Object|null} xAPI statement object, or null if formElement is falsy
 */
export function generateFormXapiStatement(formElement, verbType = 'completed') {
  if (!formElement) return null;

  let locale = document.documentElement.lang || navigator.language;
  let { formId, groupId } = extractIdsFromUrl();
  let formTitle = formElement.getAttribute('title');

  const verbMap = {
    attempted: {
      id: 'http://adlnet.gov/expapi/verbs/attempted',
      display: { [locale]: 'attempted' }
    },
    completed: {
      id: 'http://adlnet.gov/expapi/verbs/completed',
      display: { [locale]: 'completed' }
    }
  };
  return generateXapiStatementFromTemplate(formElement, {
    verb: verbMap[verbType] || verbMap.completed,
    object: {
      objectType: 'Activity',
      definition: {
        ...(formTitle && { "name": { [locale]: `${formTitle}` } }),
        type: 'http://adlnet.gov/expapi/activities/assessment'
      }
    },
    context: {
      contextActivities: {
        parent: [
          {
            id: getIDUrl({ groupId }),
            definition: {
              type: 'http://adlnet.gov/expapi/activities/course'
            }
          }
        ]
      }
    },
    ...(verbType === 'completed' && { result: { completion: true } })
  });
}

// Extract groupId and formId from page URL
function extractIdsFromUrl() {
  const url = new URL(window.location.href);
  let groupId = "group-1", formId = "form-1";
  // common UUID pattern (works for typical Tangerine IDs)
  const uuidPattern = '[0-9a-fA-F-]{36}';

  // check pathname (e.g. /.../group-<uuid>/form-<uuid>/...)
  const path = url.pathname;
  const pathGroup = path.match(new RegExp(`group-(${uuidPattern})`));
  const pathForm = path.match(new RegExp(`form-(${uuidPattern})`));
  if (pathGroup) groupId = (pathGroup[1] || groupId);
  if (pathForm) formId = (pathForm[1] || formId);

  // check hash/fragment (e.g. #/form/form-<uuid-...>)
  const hash = url.hash || '';
  const hashGroup = hash.match(new RegExp(`group-(${uuidPattern})`));
  const hashForm = hash.match(new RegExp(`form-(${uuidPattern})`));
  if (hashGroup) groupId = (hashGroup[1] || groupId);
  if (hashForm) formId = (hashForm[1] || formId);

  return { groupId, formId };
}

function deepMerge(target, source) {
  const result = { ...source };
  for (const key in target) {
    if (target[key] instanceof Object && !Array.isArray(target[key]) && result[key] instanceof Object && !Array.isArray(result[key])) {
      result[key] = deepMerge(target[key], result[key]);
    } else {
      result[key] = target[key];
    }
  }
  return result;
}

function getIDUrl(inputId) {
  let baseUrl = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`;
  let groupUrl = `${baseUrl}/${encodeURIComponent(inputId.groupId)}`;
  let formUrl = `${groupUrl}/${encodeURIComponent(inputId.formId)}`;
    if (inputId.id) {
      return `${formUrl}/${encodeURIComponent(inputId.id)}`;
    } else if (inputId.formId) {
      return formUrl;
    } else if (inputId.groupId) {
      return groupUrl;
    } else {
      return baseUrl;
    }
}

