/* jshint esversion: 6 */

const express = require('express')
const bodyParser = require('body-parser');
const path = require('path')
const fs = require('fs-extra')
const fsc = require('fs')
const PouchDB = require('pouchdb')
const DB = require('./db.js')
// const pouchRepStream = require('pouchdb-replication-stream');
PouchDB.plugin(require('pouchdb-find'));
// PouchDB.plugin(pouchRepStream.plugin);
// PouchDB.adapter('writableStream', pouchRepStream.adapters.writableStream);
const compression = require('compression')
const log = require('tangy-log').log
const clog = require('tangy-log').clog
const sleep = (milliseconds) => new Promise((res) => setTimeout(() => res(true), milliseconds))
const multer = require('multer')
const upload = multer({ dest: '/tmp-uploads/' })
// Place a groupName in this array and between runs of the reporting worker it will be added to the worker's state. 
var newGroupQueue = []
const cors = require('cors')
const tangyModules = require('./modules/index.js')()
const { extendSession, findUserByUsername,
   USERS_DB, login, getSitewidePermissionsByUsername,
   updateUserSiteWidePermissions, getUserGroupPermissionsByGroupName, addRoleToGroup, findRoleByName, getAllRoles, updateRoleInGroup, isSuperAdmin} = require('./auth');
const {registerUser,  getUserByUsername, isUserSuperAdmin, isUserAnAdminUser, getGroupsByUser, deleteUser,
   getAllUsers, checkIfUserExistByUsername, findOneUserByUsername,
   findMyUser, updateUser, restoreUser, updateMyUser} = require('./users');
const {login: surveyLogin, saveResponse: saveSurveyResponse, publishSurvey, unpublishSurvey, getOnlineSurveys} = require('./online-survey')
const {
  getCaseDefinitions,
  getCaseDefinition,
  createCase,
  readCase,
  createCaseEvent,
  createEventForm,
  createParticipant,
  getCaseEventFormSurveyLinks
} = require('./case-api')
const { createUserProfile } = require('./user-profile')
log.info('heartbeat')
setInterval(() => log.info('heartbeat'), 5*60*1000)
const cookieParser = require('cookie-parser');
const { getPermissionsList } = require('./permissions-list.js');
const { releaseAPK, releasePWA, releaseOnlineSurveyApp, unreleaseOnlineSurveyApp, commitFilesToVersionControl } = require('./releases.js');
const {archiveToDiskConfig, passwordPolicyConfig} = require('./config-utils.js')
const { generateCSV, generateCSVDataSet, generateCSVDataSetsRoute, listCSVDataSets, getDatasetDetail } = require('./routes/group-csv.js');

// Middleware to protect routes.
const allowIfUser1 = require('./middleware/allow-if-user1.js');
const isAuthenticated = require('./middleware/is-authenticated.js')
const {permit, permitOnGroupIfAll} = require('./middleware/permitted.js')
const hasUploadToken = require('./middleware/has-upload-token.js')
const hasDeviceOrUploadToken = require('./middleware/has-device-token-or-has-upload-token.js')
const hasSurveyUploadKey = require('./middleware/has-online-survey-upload-key')
const hasRespectToken = require('./middleware/has-respect-token.js')
// const isAuthenticatedOrHasUploadToken = require('./middleware/is-authenticated-or-has-upload-token.js')
const isUnprotected = require("./middleware/is-unprotected");
const tangerineMySQLApi = require('./mysql-api/index.js');
// Deployment-wide server URL. T_PROTOCOL and T_HOST_NAME are fixed at process
// start, so resolve the string once here instead of re-deriving it in every
// route handler below (a handler that omitted the declaration threw a
// ReferenceError, which surfaced as a 500). The URL helpers and publication
// builders further down read this directly rather than taking it as a
// parameter: every call site passed this same value, so the parameter only
// advertised variability that did not exist.
const baseUrl = `${process.env.T_PROTOCOL}://${process.env.T_HOST_NAME}`;
const activityIdBase = `${baseUrl}/xapi/activities`;

if (process.env.T_AUTO_COMMIT === 'true') {
  setInterval(commitFilesToVersionControl,parseInt(process.env.T_AUTO_COMMIT_FREQUENCY))
}
module.exports = async function expressAppBootstrap(app) {

// URL prefixes that must be served with no Vary header and byte-identical
// content (see the OPDS/Learning Resource caching requirements below). The
// global CORS middleware would add `Vary: Origin`, and compression would add
// `Vary: Accept-Encoding` and drop Content-Length (chunked), so both are
// skipped for these paths. This lets network operators / schools pre-cache the
// resources and validate them later with If-None-Match / If-Modified-Since.
const CACHE_FRIENDLY_URL_PREFIXES = ['/opds', '/respect-app-manifest', '/releases']

// Enable CORS
try {
  if (process.env.T_CORS_ALLOWED_ORIGINS) {
    const origin = JSON.parse(process.env.T_CORS_ALLOWED_ORIGINS)
    const corsMiddleware = cors({ credentials: true, origin })
    app.use(function (req, res, next) {
      const url = req.originalUrl || req.url
      if (CACHE_FRIENDLY_URL_PREFIXES.some(prefix => url.startsWith(prefix))) {
        return next()
      }
      return corsMiddleware(req, res, next)
    })
    log.info(`CORS enabled for origins: ${origin}`)
  } else {
    log.info('CORS is disabled')
  }
} catch(e) {
  log.error(`Error parsing T_CORS_ALLOWED_ORIGINS: ${process.env.T_CORS_ALLOWED_ORIGINS}`)
  console.log(e)
}

// Enforce SSL behind Load Balancers.
if (process.env.T_PROTOCOL == 'https') {
  app.use(function (req, res, next) {
    if (req.get('X-Forwarded-Proto') == 'http') {
      res.redirect('https://' + req.get('Host') + req.url);
    }
    else {
      next();
    }
  });
}

// Proxy for CouchDB
var proxy = require('express-http-proxy');
var couchProxy = proxy(process.env.T_COUCHDB_ENDPOINT, {
  proxyReqPathResolver: function (req, res) {
    var path = require('url').parse(req.url).path;
    // clog("path:" + path + " req.originalUrl: " + req.originalUrl);
    return path;
  },
  limit: '1gb'
});
var mountpoint = '/db';
app.use(mountpoint, couchProxy);
app.use(mountpoint, function (req, res) {
  if (req.originalUrl === mountpoint) {
    res.redirect(301, req.originalUrl + '/');
  } else {
    couchProxy;
  }
});
app.use(cookieParser())
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: '1gb' }))
app.use(bodyParser.text({ limit: '1gb' }))
// Cache-friendly HTTP responses for OPDS / RESPECT manifests and their
// resources. Compression must be skipped for these URLs: when active it adds a
// `Vary: Accept-Encoding` header and switches to chunked transfer (removing
// Content-Length), which violates the requirement that every manifest resource
// URL is served byte-for-byte identically, with Content-Length and
// Last-Modified or ETag, and cache validation (If-None-Match /
// If-Modified-Since) support.
app.use(compression({
  filter: function (req, res) {
    const url = req.originalUrl || req.url
    if (CACHE_FRIENDLY_URL_PREFIXES.some(prefix => url.startsWith(prefix))) {
      return false
    }
    return compression.filter(req, res)
  }
}))
// Cache lifetimes for RESPECT/OPDS responses, in seconds. These are the knobs
// trading propagation latency against revalidation traffic and offline
// tolerance:
//   * catalogs are small and are the discovery path, so revalidate often;
//   * form descriptors and release assets are large and must also be playable
//     offline, so allow a short usable window and revalidate beyond it.
const CATALOG_MAX_AGE = 10
const FORM_CONTENT_MAX_AGE = 300

// Manifest responses are explicitly cacheable so proxies/operators store them.
// Validation still happens via the ETag Express generates for res.send, and via
// Last-Modified/ETag for static files; none of these responses set a Vary header.
//
// Deliberately no `must-revalidate` (RFC 9111 5.2.2.2). A response carrying it
// MUST NOT be reused once stale even when the client is willing to accept stale,
// because it overrides the client's `max-stale` request directive. That is
// exactly the behaviour an offline-first launcher needs, and leaving it off is
// what lets a short max-age deliver BOTH a usable copy while disconnected and a
// cheap 304 revalidation when the network is reachable. With `must-revalidate` a
// stale entry was unusable offline and could not be refreshed without clearing
// the app's storage and cache.
app.use(['/opds', '/respect-app-manifest'], function (req, res, next) {
  res.setHeader('Cache-Control', `public, max-age=${CATALOG_MAX_AGE}`)
  next()
})

// Per-form OPDS resources (publication detail + tincan.xml).
//
// These were previously served `max-age=31536000, immutable` to stop the
// launcher revalidating them while offline ("exception validating" -> network
// error). That did make them play offline, but it also made them permanently
// unrefreshable: a client holding an immutable copy never asks again, so a
// re-released form - or a changed declared activity id in tincan.xml - never
// reaches a device that already downloaded the form. The only workaround was to
// clear the app's storage and cache.
//
// A short max-age plus the ETag Express generates for res.send gets both
// properties: the stored copy stays usable for a short offline window, and once
// that window passes a client that is reachable revalidates and picks up the new
// body (304 when unchanged). Note the descriptor is only re-read while the
// network happens to be available; a device offline for longer than the window
// relies on its cache accepting the stale entry, which is why `must-revalidate`
// must stay off here too.
app.use([
  '/opds/groups/:groupId/:formId',
  '/opds/tincan.xml/:groupId/:formId'
], function (req, res, next) {
  res.setHeader('Cache-Control', `public, max-age=${FORM_CONTENT_MAX_AGE}`)
  next()
})



  app.get('/version',
  function (req, res) {
    res.send(process.env.T_VERSION);
  }
)

/*
 * Login and session API
 */

app.post('/login', login);
app.get('/login/validate/:userName', isAuthenticated,
  function (req, res) {
    if (req.user && (req.params.userName === req.user.name)) {
      res.send({ valid: true });
    } else {
      res.send({ valid: false });
    }
  }
);
app.post('/extendSession', isAuthenticated, extendSession);
app.get('/permissionsList', isAuthenticated, getPermissionsList);
app.get('/sitewidePermissionsByUsername/:username', 
          isAuthenticated, permit(['can_manage_users_site_wide_permissions']), getSitewidePermissionsByUsername);
app.post('/permissions/updateUserSitewidePermissions/:username', isAuthenticated, permit(['can_manage_users_site_wide_permissions']), updateUserSiteWidePermissions);

app.get('/custom-login-markup', (request, response) => response.send(process.env.T_CUSTOM_LOGIN_MARKUP || ''));

/*
 * User API
 */

app.get('/users', isAuthenticated, permit(['can_view_users_list']), getAllUsers);
app.get('/users/byUsername/:username', isAuthenticated, getUserByUsername);
app.get('/users/findOneUser/:username', isAuthenticated, findOneUserByUsername);
app.get('/users/findMyUser/', isAuthenticated, findMyUser);
// Returns the current user's RESPECT URL (and token). Works for all users,
// including user1, whose token lives in the server's in-memory cache rather
// than the users DB.
app.get('/users/respectUrl', isAuthenticated, async function (req, res) {
  try {
    const { getOrCreateRespectToken } = require('./respect-token-cache')
    const { findUserByUsername } = require('./auth')
    const { v4: uuidV4 } = require('uuid')
    const username = req.user.name
    let respectToken = null
    const user = await findUserByUsername(username)
    if (user) {
      // Generate respectToken on-the-fly if missing (handles existing users)
      if (!user.respectToken) {
        user.respectToken = uuidV4()
        await USERS_DB.put(user)
      }
      respectToken = user.respectToken
    } else if (username === process.env.T_USER1) {
      respectToken = getOrCreateRespectToken(username)
    }
    const respectUrl = respectToken
      ? `${baseUrl}/respect-app-manifest?respectToken=${respectToken}`
      : null
    res.status(200).send({ data: { respectToken, respectUrl } })
  } catch (error) {
    console.error(error)
    res.status(500).send({ data: 'Could not get RESPECT URL' })
  }
});
app.put('/users/updateMyUser/', isAuthenticated, updateMyUser);
app.get('/users/userExists/:username', isAuthenticated, checkIfUserExistByUsername);
app.post('/users/register-user', isAuthenticated, permit(['can_create_users']), registerUser);
app.get('/users/isSuperAdminUser/:username', isAuthenticated, isUserSuperAdmin);
app.get('/users/isAdminUser/:username', isAuthenticated, isUserAnAdminUser);
app.patch('/users/restore/:username', isAuthenticated, permit(['can_edit_users']), restoreUser);
app.delete('/users/delete/:username', isAuthenticated, permit(['can_edit_users']), deleteUser);
app.put('/users/update/:username', isAuthenticated, permit(['can_edit_users']), updateUser);
app.get('/users/groupPermissionsByGroupName/:groupName', isAuthenticated, getUserGroupPermissionsByGroupName);
/**
 * Get Config value
 */

 app.get('/configuration/archiveToDisk', isAuthenticated, archiveToDiskConfig);
 app.get('/configuration/passwordPolicyConfig', isAuthenticated, passwordPolicyConfig);

/**
 * User Profile API Routes
 */

app.post('/userProfile/createUserProfile/:groupId', isAuthenticated, createUserProfile);

/**
 * Case API Routes
 */

app.get('/case/getCaseDefinitions/:groupId', isAuthenticated, getCaseDefinitions);
app.get('/case/getCaseDefinition/:groupId/:caseDefinitionId', isAuthenticated, getCaseDefinition);
app.post('/case/createCase/:groupId/:caseDefinitionId', isAuthenticated, createCase);
app.post('/case/readCase/:groupId/:caseId', isAuthenticated, readCase);
app.post('/case/createCaseEvent/:groupId/:caseId/:caseEventDefinitionId', isAuthenticated, createCaseEvent);
app.post('/case/createEventForm/:groupId/:caseId/:caseEventId/:caseEventFormDefinitionId', isAuthenticated, createEventForm);
app.post('/case/createParticipant/:groupId/:caseId/:caseDefinitionId/:caseRoleId', isAuthenticated, createParticipant);
app.get('/case/getCaseEventFormSurveyLinks/:groupId/:caseId', isAuthenticated, getCaseEventFormSurveyLinks);

/**
 * Online survey routes
 */

app.post('/onlineSurvey/login/:groupId/:accessCode', surveyLogin);
app.post('/onlineSurvey/publish/:groupId/:formId', isAuthenticated, publishSurvey);
app.put('/onlineSurvey/unpublish/:groupId/:formId', isAuthenticated, unpublishSurvey);
app.post('/onlineSurvey/saveResponse/:groupId/:formId', hasSurveyUploadKey, saveSurveyResponse);
app.get('/onlineSurvey/getOnlineSurveys/:groupId', isAuthenticated, getOnlineSurveys);

/*
 * More API
 */

app.get('/api/modules', isAuthenticated, require('./routes/modules.js'))
app.post('/api/:groupId/upload-check', hasUploadToken, require('./routes/group-upload-check.js'))
  if (process.env.T_UPLOAD_WITHOUT_UPDATING_REV === "false") {
    app.post('/api/:groupId/upload', hasUploadToken, require('./routes/group-upload.js'))
  } else {
    app.post('/api/:groupId/upload', hasUploadToken, require('./routes/group-upload-without-get-rev.js'))
  }
app.get('/api/:groupId/responses/:limit?/:skip?', isAuthenticated, require('./routes/group-responses.js'))
app.get('/app/:groupId/response-variable-value/:responseId/:variableName', isAuthenticated, require('./routes/group-response-variable-value.js'))
app.get('/api/:groupId/responsesByFormId/:formId/:limit?/:skip?', isAuthenticated, require('./routes/group-responses-by-form-id.js'))
app.get('/api/:groupId/responsesByMonthAndFormId/:keys/:limit?/:skip?', isAuthenticated, require('./routes/group-responses-by-month-and-form-id.js'))
app.get('/app/:groupId/docCountByLocationId/:locationId', isAuthenticated, require('./routes/group-doc-count-by-location-id.js'))
app.get('/app/:groupId/downSyncDocCountByLocationId/:locationId', isAuthenticated, require('./routes/group-down-sync-doc-count-by-location-id.js'))
// Support for API working with group pathed cookie :). We should do this for others because our group cookies can't access /api/.
app.get('/app/:groupId/responsesByMonthAndFormId/:keys/:limit?/:skip?', isAuthenticated, require('./routes/group-responses-by-month-and-form-id.js'))

// Note that the lack of security middleware here is intentional. User IDs are UUIDs and thus sufficiently hard to guess.
app.get('/api/:groupId/responsesByUserProfileId/:userProfileId/:limit?/:skip?', require('./routes/group-responses-by-user-profile-id.js'))
app.get('/api/:groupId/responsesByUserProfileShortCode/:userProfileShortCode/:limit?/:skip?', require('./routes/group-responses-by-user-profile-short-code.js'))
// app.get('/api/:groupId/:docId', isAuthenticatedOrHasUploadToken, require('./routes/group-doc-read.js'))
app.get('/api/:groupId/userProfileByShortCode/:userProfileShortCode', require('./routes/group-user-profile-by-short-code.js'))
app.put('/api/:groupId/:docId', isAuthenticated, require('./routes/group-doc-write.js'))
app.post('/api/:groupId/:docId', isAuthenticated, require('./routes/group-doc-write.js'))
app.delete('/api/:groupId/:docId', isAuthenticated, require('./routes/group-doc-delete.js'))
if (process.env.T_LEGACY === "true") {
  app.post('/upload/:groupId', require('./routes/group-upload.js'))
}
app.get('/api/csv/:groupId/:formId', isAuthenticated, generateCSV)
app.get('/api/csv/:groupId/:formId/:year/:month', isAuthenticated, generateCSV)
app.get('/api/csv-sanitized/:groupId/:formId', isAuthenticated, generateCSV)
app.get('/api/csv-sanitized/:groupId/:formId/:year/:month', isAuthenticated, generateCSV)
app.post('/api/create/csvDataSet/:groupId', isAuthenticated, generateCSVDataSet)
app.get('/api/create/csvDataSets/:datasetsId/:sharedCsvTemplateId?', allowIfUser1, generateCSVDataSetsRoute)
app.post('/api/create/csvDataSet-sanitized/:groupId', isAuthenticated, generateCSVDataSet)
app.get('/apis/listCSVDatasets/:groupId/:pageIndex/:pageSize', isAuthenticated, listCSVDataSets)
app.get('/apis/CSVDatasetDetail/:datasetId', isAuthenticated, getDatasetDetail)

app.get('/api/usage', require('./routes/usage'));
// For backwards compatibility for older consumers of this API.
app.get('/usage', require('./routes/usage'));
app.get('/usage/:startdate', require('./routes/usage'));
app.get('/usage/:startdate/:enddate', require('./routes/usage'));

// Static assets.
app.use('/client', express.static('/tangerine/client/dev'));
// Cover images referenced from the publications' images[]. These sit under /opds
// so they must not be `immutable` for the same reason as the release assets: a
// changed cover would never reach a client that had already cached it. Set the
// header explicitly rather than via express.static's options, so the value does
// not depend on whether the blanket /opds middleware above won the header race.
// express.static still supplies ETag/Last-Modified, so revalidation is a 304.
app.use('/opds/images/', function (req, res, next) {
  res.setHeader('Cache-Control', `public, max-age=${FORM_CONTENT_MAX_AGE}`)
  next()
})
app.use('/opds/images/', express.static('/tangerine/client-content-assets'));
// app.use('/', express.static('/tangerine/editor/dist/tangerine-editor'));



app.use('/', function (req, res, next) {
  // console.log("server assets: " + req.url)
  const params = JSON.stringify(req.params)
  console.log("route: / : " + params + " req.url: " + req.url)
  console.dir(req.originalUrl)
  return express.static('/tangerine/editor/dist/tangerine-editor').apply(this, arguments);
});
// app.use('/app/:group/', express.static('/tangerine/editor/dist/tangerine-editor'));
// app.use('/assets/:file', isAuthenticated, function (req, res, next) {
//   // const params = JSON.stringify(req.params)
//   // const argumentsStr = JSON.stringify(arguments)
//   console.log("rule: /assets:file")
//   console.dir(req.originalUrl)
//   let contentPath = `/tangerine/editor/dist/tangerine-editor/assets`
//   return express.static(contentPath).apply(this, arguments);
// });

app.use('/api/:group/media-list', require('./routes/group-media-list.js'));
app.use('/api/:groupId/csv-headers/:formId', require('./routes/group-csv-headers.js'));
app.use('/api/:groupId/csv-templates/list', require('./routes/group-csv-templates-list.js'));
app.use('/api/:groupId/csv-templates/create', require('./routes/group-csv-templates-create.js'));
app.use('/api/:groupId/csv-templates/read/:templateId', require('./routes/group-csv-templates-read.js'));
app.use('/api/:groupId/csv-templates/update', require('./routes/group-csv-templates-update.js'));
app.use('/api/:groupId/csv-templates/delete/:templateId', require('./routes/group-csv-templates-delete.js'));
// @TODO Need isAdminUser middleware.
app.post('/files/:group/media-upload', isUnprotected, upload.any(), require('./routes/group-media-upload.js'));
app.use('/files/:group/client-media-upload', hasDeviceOrUploadToken, upload.any(), require('./routes/group-client-upload.js'));
app.use('/files/:group/media-delete', isUnprotected, require('./routes/group-media-delete.js'));

app.use('/app/:group', function (req, res, next) {
  // console.log("server assets: " + req.url)
  const params = JSON.stringify(req.params)
  console.log("rule: /files/:group : " + params + " req.url: " + req.url)
  console.dir(req.originalUrl)
  let contentPath = `/tangerine/groups/${req.params.group}/editor`
  // let contentPath = '/tangerine/editor/dist/tangerine-editor'
  return express.static(contentPath).apply(this, arguments);
  // return express.static(contentPath);
});

// app.use('/files/:group/assets', isAuthenticated, function (req, res, next) {
app.use('/files/:group/assets', function (req, res, next) {
  // console.log("server assets: " + req.url)
  const params = JSON.stringify(req.params)
  console.log("rule: /files/:group/assets : " + params + " req.url: " + req.url)
  console.dir(req.originalUrl)
  let contentPath = `/tangerine/groups/${req.params.group}/client`
  return express.static(contentPath).apply(this, arguments);
});

app.use('/files/:group/assets/:file', isAuthenticated, function (req, res, next) {
  // console.log("server assets: " + req.url)
  const params = JSON.stringify(req.params)
  console.log("/files/:group/assets/:file : " + params + " req.url: " + req.url)
  let contentPath = `/tangerine/groups/${req.params.group}/client`
  return express.static(contentPath).apply(this, arguments);
});
app.use('/api/:group/assets', isAuthenticated, function (req, res, next) {
  const params = JSON.stringify(req.params)
  // const argumentsStr = JSON.stringify(arguments)
  console.log("rule: /api/:group/assets : " + params)
  console.dir(req.originalUrl)
  let contentPath = `/tangerine/groups/${req.params.group}/client`
  return express.static(contentPath).apply(this, arguments);
});
app.use('/api/:group/assets/:file', isAuthenticated, function (req, res, next) {
  const params = JSON.stringify(req.params)
  console.log("rule: /api/:group/assets/:file : " + params + " arguments: " + arguments)
  let contentPath = `/tangerine/groups/${req.params.group}/client`
  return express.static(contentPath).apply(this, arguments);
});
app.use('/api/:group/files', isAuthenticated, function (req, res, next) {
  let contentPath = `/tangerine/groups/${req.params.group}/`
  return express.static(contentPath).apply(this, arguments);
});


// Location List API 
app.use('/editor/:groupId/location-lists/read', require('./routes/group-location-lists-read.js'));
app.use('/editor/:groupId/location-list/create', require('./routes/group-location-list-create.js'));
app.use('/editor/:groupId/location-list/update', require('./routes/group-location-list-update.js'));
app.use('/editor/:groupId/location-list/delete', require('./routes/group-location-list-delete.js'));

app.use('/csv/', isAuthenticated, express.static('/csv/'));

// Release assets. These must stay cacheable - the launcher's cache and the
// Android WebView cache play forms from here offline - but they must NOT be
// `immutable`: a re-release rewrites the same paths in place
// (release-online-survey-app.sh rm -r's and recreates the release directory), so
// an immutable copy can never be updated. A short max-age lets a reachable
// client revalidate; express.static supplies Last-Modified and ETag, so an
// unchanged file costs a 304, while a changed file is re-fetched. Raising
// FORM_CONTENT_MAX_AGE trades slower propagation for less revalidation traffic
// across the (large) resource list in each manifest.
app.use('/releases/', function (req, res, next) {
  res.setHeader('Cache-Control', `public, max-age=${FORM_CONTENT_MAX_AGE}`)
  res.setHeader('Access-Control-Allow-Origin', '*')
  next()
})
app.use('/releases/', express.static('/tangerine/client/releases', {
  maxAge: '5m'
}))

// Fallback: serve tangy-form library files from /tangerine/tangy-form/ when the
// app requests them at assets/tangy-form/ (needed to render form items offline).
// This must come BEFORE the general assets fallback below.
app.use('/releases/:releaseType/online-survey-apps/:groupId/:formId/assets/tangy-form', function (req, res, next) {
  const tangyFormPath = '/tangerine/tangy-form'
  return express.static(tangyFormPath, { maxAge: '5m' }).apply(this, arguments)
})

// Fallback: serve form HTML files from the group's client/<formId>/ directory
// at the assets/form/ path (matching release-online-survey-app.sh behavior).
app.use('/releases/:releaseType/online-survey-apps/:groupId/:formId/assets/form', function (req, res, next) {
  const groupId = req.params.groupId
  const formId = req.params.formId
  const formPath = `/tangerine/groups/${groupId}/client/${formId}`
  return express.static(formPath, { maxAge: '5m' }).apply(this, arguments)
})

// Fallback: serve online-survey-app assets from the group's client directory
// when the release hasn't been built yet. This allows OPDS-published resources
// to be pre-cached by an HTTP proxy before the online survey is released.
app.use('/releases/:releaseType/online-survey-apps/:groupId/:formId/assets', function (req, res, next) {
  const groupId = req.params.groupId
  const contentPath = `/tangerine/groups/${groupId}/client`
  return express.static(contentPath, { maxAge: '5m' }).apply(this, arguments)
})

// Fallback: serve online-survey-app shell files (runtime.js, main.js, etc.)
// from the dist directory when the release hasn't been built yet.
app.use('/releases/:releaseType/online-survey-apps/:groupId/:formId', function (req, res, next) {
  const distPath = '/tangerine/online-survey-app/dist/online-survey-app'
  return express.static(distPath, { maxAge: '5m' }).apply(this, arguments)
})

app.use('/client/', express.static('/tangerine/client/builds/dev'))

// app.use('/editor/:group/content/assets', isAuthenticated, function (req, res, next) {
//   let contentPath = '/tangerine/client/content/assets'
//   clog("Setting path to " + contentPath)
//   return express.static(contentPath).apply(this, arguments);
// });
app.use('/editor/:group/content', isAuthenticated, function (req, res, next) {
  const params = JSON.stringify(req.params)
  console.log("rule: /editor/:group/content : " + params )
  console.dir(req.originalUrl)
  let contentPath = `/tangerine/groups/${req.params.group}/client`
  return express.static(contentPath).apply(this, arguments);
});

const queueNewGroupMiddleware = function (req, res, next) {
  newGroupQueue.push(req.body.groupName)
  next()
}

app.post('/editor/release-apk/:group', isAuthenticated, releaseAPK)

app.post('/editor/release-pwa/:group/', isAuthenticated, releasePWA)

// TODO @deprice: This route should be removed.
app.use('/editor/release-online-survey-app/:groupId/:formId/:releaseType/:appName/:uploadKey/', isAuthenticated, releaseOnlineSurveyApp)

app.post('/editor/release-online-survey-app/:groupId/:formId/:releaseType/:appName/', isAuthenticated, releaseOnlineSurveyApp)

app.use('/editor/unrelease-online-survey-app/:groupId/:formId/:releaseType/', isAuthenticated, unreleaseOnlineSurveyApp)

app.post('/editor/file/save', isAuthenticated, async function (req, res) {
  const filePath = req.body.filePath
  const groupId = req.body.groupId
  const fileContents = req.body.fileContents
  const actualFilePath = `/tangerine/groups/${groupId}/client/${filePath}`
  await fs.outputFile(actualFilePath, fileContents)
  res.send({status: 'ok'})
  // ok
})

app.delete('/editor/file/save', isAuthenticated, async function (req, res) {
  const filePath = req.query.filePath
  const groupId = req.query.groupId
  if (filePath && groupId) {
    const actualFilePath = `/tangerine/groups/${groupId}/client/${filePath}`
    await fs.remove(actualFilePath)
    res.send({status: 'ok'})
  } else {
    res.sendStatus(500)
  }
})

app.get('/groups', isAuthenticated, async function (req, res) {
  try {
    const groups = await getGroupsByUser(req.user.name);
    const groupsDb = new DB('groups')
    const enrichedGroups = await Promise.all(groups.map(async (group) => {
      try {
        const groupDoc = await groupsDb.get(group.attributes.name)
        group.attributes.label = groupDoc.label || group.attributes.name
      } catch (err) {
        group.attributes.label = group.attributes.name
      }
      return group
    }))
    res.send(enrichedGroups);
  } catch (error) {
    res.sendStatus(500)
  }
})

app.get('/groups/:username', isAuthenticated, async function (req, res) {
  const username = req.params.username;
  try {
    const groups = await getGroupsByUser(username);
    const groupsDb = new DB('groups')
    const enrichedGroups = await Promise.all(groups.map(async (group) => {
      try {
        const groupDoc = await groupsDb.get(group.attributes.name)
        group.attributes.label = groupDoc.label || group.attributes.name
      } catch (err) {
        group.attributes.label = group.attributes.name
      }
      return group
    }))
    res.send(enrichedGroups);
  } catch (error) {
    res.sendStatus(500)
  }
})

app.post('/groups/:groupName/addUserToGroup', isAuthenticated, async (req, res) => {
  const payload = req.body;
  const groupName = req.params.groupName;
  try {
    const user = await findUserByUsername(payload.username)
    /**
     *  If the groups array is existent on the user object,
     * check if the is already in the groups array i.e. it is being updated
     * If it exists, update the roles, otherwise add a new record to the groups array and save.
     * If the groups array is non existent on the user object,
     *  assign the groups array with the corresponding groupname and roles
     * This is needful especially for users created before role management was added.
     */
    if (typeof user.groups !== 'undefined') {
      const index = user.groups.findIndex(group => group.groupName === groupName);
      if (index > -1) {
        user.groups[index] = { ...payload.role }
      } else {
        user.groups.push({ ...payload.role })
      }
    } else {
      user.groups = [{ ...payload.role }];
    }
    const data = await USERS_DB.put(user);
    res.send({ data, statusCode: 200, statusMessage: `User Added to Group ${groupName}` })

  } catch (error) {
    console.error('Could not Add user to Group')
    res.sendStatus(500)
  }
});

app.get('/groups/users/byGroup/:groupName', isAuthenticated, async (req, res) => {
  try {
    const groupName = req.params.groupName;
    // Mango search in Arrays, Documentation in : https://stackoverflow.com/questions/43892556/mango-search-in-arrays-couchdb
    await USERS_DB.createIndex({ index: { fields: ['groups[].groupName'] }, type: 'json' });
    const results = await USERS_DB.find({ selector: { 'groups': { $elemMatch: { groupName } } } });
    const data = results.docs.map(result => {
      return {
        _id: result._id,
        username: result.username,
        email: result.email,
        firstName: result.firstName,
        roles: result.groups.find(group => group.groupName === groupName).roles,
        lastName: result.lastName
      }
    });
    res.send({ data, statusCode: 200, statusMessage: 'ok' })
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
})

app.get('/groups/users/byGroupAndUsername/:groupName/:username', isAuthenticated, async (req, res) => {
  try {
    const groupName = req.params.groupName;
    const username = req.params.username;
    // Mango search in Arrays, Documentation in : https://stackoverflow.com/questions/43892556/mango-search-in-arrays-couchdb
    await USERS_DB.createIndex({ index: { fields: ['groups[].groupName'] }, type: 'json' });

    const results = await USERS_DB.find({
      selector: {
        groups: { $elemMatch: { groupName } },
        username: { '$regex': `(?i)${username}` }
      }
    });
    const data = results.docs.map(result => {
      return {
        _id: result._id,
        username: result.username,
        email: result.email,
        firstName: result.firstName,
        lastName: result.lastName
      }
    });
    res.send({ data, statusCode: 200, statusMessage: 'ok' })
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
})

app.patch('/groups/removeUserFromGroup/:groupName', isAuthenticated, async (req, res) => {
  try {
    const username = req.body.username;
    const groupName = req.params.groupName;
    const user = await findUserByUsername(username);
    if (user && user._id) {
      user.groups = user.groups.filter(group => group.groupName !== groupName);
      const data = await USERS_DB.put(user);
      res.send({ statusCode: 200, data, statusMessage: `User: ${username} removed from Group: ${groupName}` })
    }
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
})

app.post('/permissions/addRoleToGroup/:groupId', 
          isAuthenticated, permitOnGroupIfAll(['can_manage_group_roles']), addRoleToGroup);

app.get('/rolesByGroupId/:groupId/role/:role', isAuthenticated, findRoleByName);
app.get('/rolesByGroupId/:groupId/roles', isAuthenticated, getAllRoles);
app.post('/permissions/updateRoleInGroup/:groupId', isAuthenticated, permitOnGroupIfAll(['can_manage_group_roles']), updateRoleInGroup);

app.use('/mysql-api', isAuthenticated, permitOnGroupIfAll(['can_access_mysql_api']), tangerineMySQLApi);

/**
 * @function`getDirectories` returns an array of strings of the top level directories found in the path supplied
 * @param {string} srcPath The path to the directory
 */
const getDirectories = srcPath => fs.readdirSync(srcPath).filter(file => fs.lstatSync(path.join(srcPath, file)).isDirectory())

/**
 * Gets the list of all the existing groups from the content folder
 * Listens for the changes feed on each of the group's database
 */
function allGroups() {
  const CONTENT_PATH = '/tangerine/groups/'
  const groups = getDirectories(CONTENT_PATH)
  return groups.map(group => group.trim()).filter(groupName => groupName !== '.git')
}

const runPaidWorker = require('./paid-worker.js')
async function keepAlivePaidWorker() {
  let state = {}
  while(true) {
    try {
      state = await runPaidWorker()
      if (state.batchMarkedPaid === 0) {
        //log.info('No responses marked as paid. Sleeping...')
        await sleep(10*1000)
      } else {
        log.info(`Marked ${state.batchMarkedPaid} responses as paid.`)
      }
    } catch (error) {
      log.error(error.message)
      console.log(error)
      await sleep(10*1000)
    }
  }
}
keepAlivePaidWorker()


// --- RESPECT spec helpers (UstadMobile/Respect README_ADD_YOUR_APP.md) ---

// Single language declaration, used by the OPDS metadata below and by the
// tincan.xml lang attributes. Deliberately a constant for now: Tangerine content
// can be translated into many languages and neither forms.json nor config.env
// carries a language, so a real per-deployment setting needs more design than a
// config key. One constant so there is one place to change when that lands.
const RESPECT_LANGUAGE = 'en'

// Served from our own /opds/images/ mount instead of a third-party CDN: that path
// is public, cacheable and revalidatable (see the /opds/images/ handler above),
// and the RESPECT validator requires every link a manifest publishes to carry
// Last-Modified or ETag. The squarespace URL this replaced sent neither.
const TANGERINE_APP_ICON = `${baseUrl}/opds/images/tangerine_icon.png`
const REL_TINCAN_XML = 'https://id.openeel.org/rel/tincanxml'
const REL_LAUNCHABLE_APP = 'https://id.openeel.org/rel/launchable-app'
const REL_APP_LAUNCH_URI = 'https://id.openeel.org/rel/app-launch-uri'
const REL_APPSTORE_ANDROID = 'https://id.openeel.org/rel/appstore-android'
const SCHEMA_LAUNCHABLE_APP = 'https://id.openeel.org/schema/launchable-app'
// OPDS 2.0 section 5.1 requires every publication to carry at least one
// acquisition link (rel starting http://opds-spec.org/acquisition, type one of
// text/html, application/xml, application/html+xml), so this link is not
// optional: dropping it makes RESPECT's validator report "No suitable
// acquisition links" for every form. open-access is accurate here because the
// release assets it points at are served publicly, with no authentication.
//
// KNOWN, ACCEPTED DEVIATION. RESPECT's validator additionally treats the
// acquisition target as a "Learning Resource ID URL" and reports two errors per
// form that this deployment cannot currently satisfy:
//   1. "Learning Resource ID URL (...) contains a #". The unit is a hash-routed
//      Angular SPA (RouterModule.forRoot(routes, { useHash: true }) in
//      online-survey-app/src/app/app-routing.module.ts) with no default route,
//      so the '#/form/<formId>' fragment is what selects the form. A
//      fragment-free URL only works if the app gains a bootstrap redirect that
//      derives groupId/formId from the release path and navigates to that route.
//   2. "Manifest not discovered for learning resource ID URL". The resource, or
//      a Link header on it, must advertise its manifest (Readium discovery) as
//      type application/webpub+json. Every OPDS publication here is gated by
//      hasRespectToken and a per-user token cannot be embedded in shared,
//      cacheable HTML, so this needs a decision to serve published surveys'
//      manifests without a token first.
// Both are recorded in the repo's respect-validator notes; do not "fix" either
// by removing this link (that trades them for a spec violation) or by pointing
// it at a URL that does not resolve server-side.
const REL_ACQUISITION_OPEN_ACCESS = 'http://opds-spec.org/acquisition/open-access'

// The launchable-app manifest links an app store when the app has a native
// version, its terms of service, and its license - see README_ADD_YOUR_APP.md.
// The terms link points at Tangerine's published data security statement, which
// is the closest published equivalent to a terms/privacy page it has.
const TANGERINE_ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=org.tangerinecentral.tangerine'
const TANGERINE_TERMS_URL = 'https://docs.tangerinecentral.org/data-security/'
// LICENSE.txt in this repo is GNU GPL v3 (GitHub reports spdx_id GPL-3.0).
//
// The launcher reads no SPDX id off this link. GetLicenseLabelUseCaseAndroid
// compares the href, as an exact string, against its bundled license table
// (lib-appui-compose/src/androidMain/res/raw/license_label_json) and labels the
// app "Proprietary" when nothing matches. No HTTP request is involved, so a URL
// which merely redirects to a table entry still matches nothing.
//
// The GPL-3.0 entry (id "gpl-3-0") carries exactly two hrefs, either of which
// works:
//   _links.html.href     https://opensource.org/license/gpl-3-0
//   license_steward_url  https://www.gnu.org/licenses/gpl-3.0.en.html
// Mind the hyphen in the OSI form: OSI has since moved to the dotted
// .../license/gpl-3.0 and 301s the hyphenated one to it, so the URL the bundled
// table holds is now the redirecting one and today's "correct" dotted URL is
// exactly the value that matches nothing. That is why pointing at
// opensource.org still showed Proprietary. The gnu.org URL above is the more
// stable alternative - it is the licence text itself, and carries no redirect.
const TANGERINE_LICENSE_URL = 'https://opensource.org/license/gpl-3-0'
const TANGERINE_SITE_URL = 'https://www.tangerinecentral.org/'

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formOnlineSurveyUrl(groupId, formId) {
  return `${baseUrl}/releases/prod/online-survey-apps/${groupId}/${formId}/#/form/${formId}`
}

function formTinCanXmlUrl(groupId, formId, respectToken) {
  return `${baseUrl}/opds/tincan.xml/${groupId}/${formId}?respectToken=${respectToken}`
}

function formLaunchableAppManifestUrl(respectToken) {
  return `${baseUrl}/respect-app-manifest?respectToken=${respectToken}`
}

/**
 * The publication for one form - the same object either way. The group listing
 * feed emits it for every published form (/opds/groups/:groupId) and the
 * publication detail endpoint emits it unchanged as its whole response
 * (/opds/groups/:groupId/:formId), so the two cannot describe the same form
 * differently.
 *
 * `modified` is the one field the two callers disagree on, so it stays a
 * parameter: the listing stamps every form it lists with the group feed's
 * modified value (it advertises them together, as one cacheable document),
 * while the detail stamps the single form with its own content-derived value.
 *
 * Deliberately NOT included: readingOrder and resources. Those say how to fetch
 * and render the unit and only the detail endpoint wants them - building them
 * walks the whole release and tangy-form trees, which a listing feed would then
 * pay once per form on every request. buildFormPublicationDetail() adds them.
 */
function buildFormPublication({ form, groupLabel, groupId, formId, respectToken, modified }) {
  // Images. forms.json may list a full `images` array (with optional
  // width/height), a single `cover` filename, or neither - in which case the
  // generic form.png stands in, because RESPECT expects a publication to carry
  // an image. Hrefs that are already absolute pass through; anything else is
  // resolved against our own /opds/images/ mount, which is public and
  // revalidatable (see the /opds/images/ handler above).
  const images = []
  if (form && Array.isArray(form.images) && form.images.length > 0) {
    for (const img of form.images) {
      const href = img.href.startsWith('http') ? img.href : `${baseUrl}/opds/images/${img.href}`
      images.push({
        href,
        type: img.type || 'image/jpeg',
        ...(img.height ? { height: img.height } : {}),
        ...(img.width ? { width: img.width } : {})
      })
    }
  } else if (form && form.cover) {
    images.push({
      href: `${baseUrl}/opds/images/${form.cover}`,
      type: form.cover.endsWith('.png') ? 'image/png' : 'image/jpeg'
    })
  } else {
    images.push({ href: `${baseUrl}/opds/images/form.png`, type: 'image/png' })
  }

  return {
    metadata: {
      '@type': 'http://schema.org/Game',
      title: (form && form.title) || formId,
      author: groupLabel,
      // Built from the same activityIdBase tincan.xml uses, so the activity the
      // publication advertises is the activity an xAPI statement names.
      identifier: `${activityIdBase}/${groupId}/${formId}`,
      language: RESPECT_LANGUAGE,
      modified
    },
    links: [
      // self is the detail URL the listing advertises: a client resolves it to
      // the full publication.
      { rel: 'self', href: `${baseUrl}/opds/groups/${groupId}/${formId}?respectToken=${respectToken}`, type: 'application/opds-publication+json' },
      { rel: REL_TINCAN_XML, href: formTinCanXmlUrl(groupId, formId, respectToken), type: 'application/xml' },
      { rel: REL_LAUNCHABLE_APP, href: formLaunchableAppManifestUrl(respectToken), type: 'application/opds-publication+json' },
      // OPDS 2.0 section 5.1 requires at least one acquisition link - see
      // REL_ACQUISITION_OPEN_ACCESS for why this one is not optional.
      { rel: REL_ACQUISITION_OPEN_ACCESS, href: formOnlineSurveyUrl(groupId, formId), type: 'text/html' }
    ],
    images
  }
}

/**
 * Launchable-app manifest per the CURRENT RESPECT spec (README_ADD_YOUR_APP.md):
 * a Readium Web Publication Manifest describing the app.
 *
 * The app MAY link a default catalog of learning units via rel=collection
 * (an OPDS feed). This is how the launcher's Add-app flow exposes an app's
 * units for browsing - the launcher only adds apps; units are reached through
 * the app's collection. Each unit (form) is also published as its own OPDS
 * publication with a tincan.xml link so it can be launched directly with xAPI.
 *
 * `identifier` is the app's own stable identity and is NOT the manifest URL
 * (which is the rel=self href). It carries no language tag: the RESPECT
 * reference manifest uses a plain `<origin>/app`, and where an app exists in
 * several languages each variant is a separate manifest joined by `alternate`
 * links, so a tag here would only make the identity move whenever it changed.
 * Unlike the manifest URL it must not carry a respectToken, or the same app
 * would present a different identity to every user.
 *
 * `author` is emitted in the shape the RESPECT reference manifest uses: an
 * array of contributor objects whose `links` is an array of Link objects with
 * just an href. `description` fills the metadata description the launcher
 * reads into its stored publication record.
 */
function buildLaunchableAppManifest({ name, description, identifier, manifestUrl, appLaunchUri, collectionUrl, modified }) {
  const links = [
    { rel: 'self', href: manifestUrl, type: 'application/opds-publication+json' },
    { rel: REL_APP_LAUNCH_URI, href: appLaunchUri }
  ]
  if (collectionUrl) {
    links.push({ rel: 'collection', href: collectionUrl, type: 'application/opds+json' })
  }
  links.push(
    { rel: REL_APPSTORE_ANDROID, href: TANGERINE_ANDROID_STORE_URL, title: 'Get it on Google Play' },
    { rel: 'terms-of-service', href: TANGERINE_TERMS_URL },
    { rel: 'license', href: TANGERINE_LICENSE_URL }
  )
  return {
    metadata: {
      '@type': SCHEMA_LAUNCHABLE_APP,
      title: name,
      description,
      author: [
        {
          name: 'Tangerine',
          links: [
            { href: TANGERINE_SITE_URL }
          ]
        }
      ],
      identifier,
      language: RESPECT_LANGUAGE,
      modified
    },
    links,
    images: [
      { href: TANGERINE_APP_ICON, type: 'image/png' }
    ]
  }
}

/**
 * RESPECT launchable-app manifest per the CURRENT spec
 * (README_ADD_YOUR_APP.md). Describes Tangerine as an app. Its default
 * collection (rel=collection) is the hierarchical groups/forms catalog
 * (/opds/groups), so adding this app in the launcher lets users browse groups
 * and the forms within them; each form publication links its own tincan.xml so
 * tapping one launches it with xAPI.
 *
 * @route GET /respect-app-manifest
 * @returns {object} launchable-app manifest JSON
 */
app.get('/respect-app-manifest', hasRespectToken, async function (req, res) {
  try {
    const appModifiedMs = await getAppModified()
    const manifestUrl = `${baseUrl}/respect-app-manifest?respectToken=${req.query.respectToken}`
    const manifest = buildLaunchableAppManifest({
      name: 'Tangerine',
      description: 'Tangerine data collection and reporting platform',
      identifier: `${baseUrl}/app`,
      manifestUrl,
      appLaunchUri: baseUrl,
      collectionUrl: `${baseUrl}/opds/groups?respectToken=${req.query.respectToken}`,
      modified: new Date(appModifiedMs).toISOString()
    })
    res.set('Last-Modified', new Date(appModifiedMs).toUTCString())
    res.set('Content-Type', 'application/json')
    res.send(manifest)
  } catch (error) {
    console.error('Error generating Respect App Manifest:', error)
    res.status(500).send({ error: 'Failed to generate Respect App Manifest' })
  }
})


/**
 * Serve a form's tincan.xml (Rustici launch method). Each published form is a
 * learning unit; its OPDS publication links (rel=launch-tincanxml) here. The
 * launcher reads the activity id and <launch> URL from this file, then appends
 * xAPI launch params (endpoint/auth/actor/activity_id) to the launch URL so the
 * online-survey-app can send statements back to the LRS.
 * 
 * @route GET /opds/tincan.xml/:groupId/:formId
 * @returns {application/xml} tincan.xml
 */
app.get('/opds/tincan.xml/:groupId/:formId', hasRespectToken, async function (req, res) {
  try {
    const groupId = req.params.groupId
    const formId = req.params.formId

    // If a respectToken is present, verify the user has access to this group
    if (req.respectUser && !req.respectUser.allowedGroupIds.includes(groupId)) {
      return res.status(403).send({ error: 'Access denied to this group' })
    }

    // Read forms.json to find the form definition for a friendly title
    let formTitle = formId
    try {
      const { formsPath } = await getGroupMetadata(groupId)
      const forms = await fs.readJson(formsPath)
      const form = forms.find(f => f.id === formId)
      if (form && form.title) {
        formTitle = form.title
      }
    } catch (err) {
      // forms.json not found; use formId as title
    }

    const activityId = `${activityIdBase}/${groupId}/${formId}`
    const launchUrl = formOnlineSurveyUrl(groupId, formId)
    const tincanXml = `<?xml version="1.0" encoding="UTF-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="${escapeXml(activityId)}" type="http://activitystrea.ms/schema/1.0/game">
      <name>${escapeXml(formTitle)}</name>
      <description lang="${RESPECT_LANGUAGE}">${escapeXml(`Tangerine form: ${formTitle}`)}</description>
      <launch lang="${RESPECT_LANGUAGE}">${escapeXml(launchUrl)}</launch>
    </activity>
  </activities>
</tincan>`
    // No Last-Modified: this XML carries no modified value, so any file-derived
    // header could move while the body stayed identical. The ETag Express
    // generates for res.send is body-exact, so validation is already correct.
    res.set('Content-Type', 'application/xml')
    res.send(tincanXml)
  } catch (error) {
    console.error('Error generating tincan.xml for form:', error)
    res.status(500).send({ error: 'Failed to generate tincan.xml for form' })
  }
})


/**
 * Serve group client content files for OPDS resource downloads.
 * Mirrors the files bundled in PWA and APK releases.
 *
 * @route GET /opds/content/:groupId/*
 */
app.use('/opds/content/:groupId', hasRespectToken, function (req, res, next) {
  const groupId = req.params.groupId
  // If a respectToken is present, verify the user has access to this group
  if (req.respectUser && !req.respectUser.allowedGroupIds.includes(groupId)) {
    return res.status(403).send({ error: 'Access denied to this group' })
  }
  const contentPath = `/tangerine/groups/${groupId}/client`
  // Revalidatable, not immutable: these are the same form content files the
  // release bundle serves, and a re-published form must be able to reach a
  // client that already cached them. max-age keeps them usable offline for a
  // short window; express.static supplies ETag/Last-Modified for the 304.
  return express.static(contentPath, { maxAge: '5m' }).apply(this, arguments)
})

// MIME type lookup for common file extensions used in form content.
const MIME_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.zip': 'application/zip',
}

// Recursively list all files in a directory, skipping ignored patterns.
async function listClientFiles(dirPath, baseDir, ignorePatterns = ['node_modules', '.git', 'client-uploads']) {
  const results = []
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    return results
  }
  for (const entry of entries) {
    if (ignorePatterns.includes(entry.name)) continue
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const subResults = await listClientFiles(fullPath, baseDir, ignorePatterns)
      results.push(...subResults)
    } else if (entry.isFile()) {
      const relativePath = path.relative(baseDir, fullPath)
      const ext = path.extname(entry.name).toLowerCase()
      results.push({
        relativePath,
        mimeType: MIME_TYPES[ext] || 'application/octet-stream'
      })
    }
  }
  return results
}

// Stable modification date for OPDS publication metadata. Derived from the
// mtime of the group's forms.json so the response body — and therefore the ETag
// used for If-None-Match cache validation — stays stable between requests
// instead of changing every second (which would defeat HTTP caching).
//
// This is group-level and only used by the LISTING feeds, which advertise the
// detail URL and nothing else, so forms.json is an adequate sentinel there. The
// per-form descriptor uses getFormModified() below instead.
async function getFormsModified(formsPath) {
  try {
    const stat = await fs.stat(formsPath)
    return stat.mtime.toISOString()
  } catch (err) {
    // forms.json may not exist yet; use a stable epoch value.
    return new Date(0).toISOString()
  }
}

// Newest mtime (ms) across a set of files/directories. Directories are walked
// recursively (skipping heavy/irrelevant trees), and the result is memoised
// briefly so a burst of OPDS requests does not re-walk the tree every time.
const MODIFIED_MTIME_TTL_MS = 5000
const modifiedMtimeCache = new Map()
const MODIFIED_WALK_SKIP = ['node_modules', '.git']

async function newestMtimeMs(paths) {
  let newest = 0
  async function walk(dirPath) {
    let entries
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch (err) {
      return
    }
    for (const entry of entries) {
      if (MODIFIED_WALK_SKIP.includes(entry.name)) continue
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath)
          if (stat.mtimeMs > newest) newest = stat.mtimeMs
        } catch (err) {
          // File vanished mid-walk; ignore.
        }
      }
    }
  }
  for (const p of paths) {
    let stat
    try {
      stat = await fs.stat(p)
    } catch (err) {
      continue
    }
    if (stat.isDirectory()) {
      await walk(p)
    } else if (stat.mtimeMs > newest) {
      newest = stat.mtimeMs
    }
  }
  return newest
}

async function cachedNewestMtimeMs(paths) {
  const key = paths.join('|')
  const now = Date.now()
  const cached = modifiedMtimeCache.get(key)
  if (cached && (now - cached.at) < MODIFIED_MTIME_TTL_MS) return cached.value
  const value = await newestMtimeMs(paths)
  modifiedMtimeCache.set(key, { at: now, value })
  return value
}

/**
 * Content-derived "modified" for a single form.
 *
 * The publication body feeds the ETag Express generates for res.send, so this
 * value MUST change whenever anything the client has to download changes.
 * Deriving it from the group's forms.json alone was not sufficient: re-releasing
 * a form (new form HTML, new translations, a fixed tangy-form library) leaves
 * forms.json untouched, so the body - and therefore the ETag - stayed
 * byte-identical and a client that already had the form kept its stale copy
 * forever via 304.
 *
 * Covers everything the release serves: the form source, the built release
 * bundle, and the shared trees the release copies from or is served out of.
 * The shared trees are cached separately so they are walked once per TTL
 * regardless of how many forms are being requested.
 */
async function getFormModified(groupId, formId, formsPath) {
  const [shared, formSpecific] = await Promise.all([
    cachedNewestMtimeMs([
      '/tangerine/tangy-form',
      '/tangerine/online-survey-app/dist/online-survey-app'
    ]),
    cachedNewestMtimeMs([
      formsPath,
      `/tangerine/groups/${groupId}/client/${formId}`,
      `/tangerine/client/releases/prod/online-survey-apps/${groupId}/${formId}`
    ])
  ])
  const newest = Math.max(shared, formSpecific)
  // Nothing found: keep the stable epoch value so the response stays cacheable.
  return new Date(newest).toISOString()
}

/**
 * Newest onlineSurveys[].updatedOn recorded on a group doc, in ms (0 if none).
 *
 * publishSurvey/unpublishSurvey stamp `updatedOn` whenever a form is published or
 * unpublished. Those changes alter the OPDS listings without touching any file on
 * disk, so they MUST feed into the modified values below: RESPECT's
 * OpdsFeedDataSourceDb.updateLocal only accepts an update whose
 * OpdsFeedMetadata.modified is strictly newer than the value it stored last time,
 * so a modified tracking only filesystem mtimes would make it reject exactly the
 * publish/unpublish updates the launcher needs to see.
 */
function newestOnlineSurveyUpdatedOn(onlineSurveys) {
  return (onlineSurveys || []).reduce((newest, survey) => {
    const updatedOn = survey.updatedOn ? new Date(survey.updatedOn).getTime() : 0
    return Number.isFinite(updatedOn) && updatedOn > newest ? updatedOn : newest
  }, 0)
}

/**
 * Content-derived "modified" for a whole group, in ms: the newest mtime across the
 * group's forms.json, its client content, and its built release directory. The
 * group-level counterpart of getFormModified() above.
 */
async function getGroupModified(groupId, formsPath) {
  const [shared, groupSpecific] = await Promise.all([
    cachedNewestMtimeMs([
      '/tangerine/tangy-form',
      '/tangerine/online-survey-app/dist/online-survey-app'
    ]),
    cachedNewestMtimeMs([
      formsPath,
      `/tangerine/groups/${groupId}/client`,
      `/tangerine/client/releases/prod/online-survey-apps/${groupId}`
    ])
  ])
  return Math.max(shared, groupSpecific)
}

/**
 * Content-derived "modified" for the app itself, in ms: the newest mtime across the
 * shared trees that make up the Tangerine online-survey app (the tangy-form
 * component library and the built online-survey-app). This is the launchable-app
 * manifest's metadata.modified, which the RESPECT spec includes.
 */
async function getAppModified() {
  return cachedNewestMtimeMs([
    '/tangerine/tangy-form',
    '/tangerine/online-survey-app/dist/online-survey-app'
  ])
}

/**
 * OPDS 2.0 Catalog of Groups (RESPECT / UstadMobile format).
 * Returns an OPDS Navigation Feed listing all Tangerine groups.
 * Each group entry links to its Readium Web Publication Manifest.
 *
 * @route GET /opds/groups
 * @returns {object} OPDS 2.0 Navigation Feed JSON
 */
app.get('/opds/groups', hasRespectToken, async function (req, res) {
  try {
    const groupsListLib = require('./groups-list.js')
    const GROUPS_DB = new DB('groups')

    let groupIds = await groupsListLib()

    // If a respectToken is present, filter to user's allowed groups
    if (req.respectUser) {
      groupIds = groupIds.filter(id => req.respectUser.allowedGroupIds.includes(id))
    }

    const navigation = []
    // Feed-level modified: RESPECT's OpdsFeedDataSourceDb.updateLocal only accepts an
    // update whose OpdsFeedMetadata.modified is strictly newer than the value it
    // stored last time, so this has to move whenever the nav feed can change.
    let catalogModifiedMs = 0

    for (const groupId of groupIds) {
      const groupFormsPath = `/tangerine/client/content/groups/${groupId}/forms.json`
      const formsModifiedMs = new Date(await getFormsModified(groupFormsPath)).getTime()
      if (formsModifiedMs > catalogModifiedMs) catalogModifiedMs = formsModifiedMs

      try {
        const groupDoc = await GROUPS_DB.get(groupId)
        const label = groupDoc.label || groupId
        const surveysModifiedMs = newestOnlineSurveyUpdatedOn(groupDoc.onlineSurveys)
        if (surveysModifiedMs > catalogModifiedMs) catalogModifiedMs = surveysModifiedMs
        navigation.push({
          href: `${baseUrl}/opds/groups/${groupId}?respectToken=${req.query.respectToken}`,
          title: label,
          type: 'application/opds+json',
          alternate: [
            {
              href: `${baseUrl}/opds/images/group.png`,
              rel: 'icon',
              type: 'image/png',
              title: `${label} cover`
            }
          ]
        })
      } catch (err) {
        // Group doc may not exist in PouchDB yet; fall back to groupId as label
        navigation.push({
          href: `${baseUrl}/opds/groups/${groupId}?respectToken=${req.query.respectToken}`,
          title: groupId,
          type: 'application/opds+json',
          alternate: [
            {
              href: `${baseUrl}/opds/images/group.png`,
              rel: 'icon',
              type: 'image/png',
              title: `${groupId} cover`
            }
          ]
        })
      }
    }

    navigation.sort((a, b) => a.title.localeCompare(b.title))

    const opdsCatalog = {
      metadata: {
        title: 'Groups',
        modified: new Date(catalogModifiedMs).toISOString()
      },
      links: [
        { rel: 'self', href: `${baseUrl}/opds/groups`, type: 'application/opds+json' }
      ],
      navigation
    }

    res.set('Last-Modified', new Date(catalogModifiedMs).toUTCString())
    res.set('Content-Type', 'application/opds+json')
    res.send(opdsCatalog)
  } catch (error) {
    console.error('Error generating OPDS Groups catalog:', error)
    res.status(500).send({ error: 'Failed to generate OPDS Groups catalog' })
  }
})

/**
 * OPDS 2.0 Publication Listing for a Group.
 * Lists all forms in the group as publications, each with metadata, links,
 * and images pointing to the online-survey-app URL for that form.
 *
 * @route GET /opds/groups/:groupId
 * @returns {object} OPDS 2.0 Publication Listing JSON
 */
app.get('/opds/groups/:groupId', hasRespectToken, async function (req, res) {
  try {
    const groupId = req.params.groupId

    // If a respectToken is present, verify the user has access to this group
    if (req.respectUser && !req.respectUser.allowedGroupIds.includes(groupId)) {
      return res.status(403).send({ error: 'Access denied to this group' })
    }

    const GROUPS_DB = new DB('groups')
    const formsPath = `/tangerine/client/content/groups/${groupId}/forms.json`

    // Get group metadata and published online surveys
    let groupLabel = groupId
    let publishedFormIds = []
    let onlineSurveys = []
    try {
      const groupDoc = await GROUPS_DB.get(groupId)
      groupLabel = groupDoc.label || groupId
      onlineSurveys = groupDoc.onlineSurveys || []
      publishedFormIds = onlineSurveys.filter(s => s.published).map(s => s.formId)
    } catch (err) {
      // Group doc may not exist; continue with groupId as label
    }

    // Read forms.json
    let forms = []
    try {
      forms = await fs.readJson(formsPath)
    } catch (err) {
      forms = []
    }
    // Feed-level modified. Has to move on every change that alters this feed: a
    // form's content being re-released (content mtimes) or a survey being published
    // / unpublished (onlineSurveys[].updatedOn - which touches no file on disk).
    const feedModifiedMs = Math.max(
      await getGroupModified(groupId, formsPath),
      newestOnlineSurveyUpdatedOn(onlineSurveys)
    )
    const feedModified = new Date(feedModifiedMs).toISOString()

    // Filter to non-archived, listed forms that also have published online surveys
    const listedForms = forms
      .filter(f => !f.archived && f.listed !== false && publishedFormIds.includes(f.id))
      .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id))

    // Build publications array
    const publications = []

    for (const form of listedForms) {
      publications.push(buildFormPublication({
        form,
        groupLabel,
        groupId,
        formId: form.id,
        respectToken: req.query.respectToken,
        // Feed-level value here, not this form's own - see buildFormPublication().
        modified: feedModified
      }))
    }

    const opdsCatalog = {
      metadata: {
        title: `${groupLabel} - Forms`,
        modified: feedModified
      },
      links: [
        { rel: 'self', href: `${baseUrl}/opds/groups/${groupId}?respectToken=${req.query.respectToken}`, type: 'application/opds+json' }
      ],
      publications
    }

    res.set('Last-Modified', new Date(feedModifiedMs).toUTCString())
    res.set('Content-Type', 'application/opds+json')
    res.send(opdsCatalog)
  } catch (error) {
    console.error('Error generating OPDS catalog for group:', error)
    res.status(500).send({ error: 'Failed to generate OPDS catalog for group' })
  }
})

/**
 * Shared helper: load group metadata (label, published online-survey form IDs)
 * and the path to the group's forms.json.
 */
async function getGroupMetadata(groupId) {
  const GROUPS_DB = new DB('groups')
  const formsPath = `/tangerine/client/content/groups/${groupId}/forms.json`
  let groupLabel = groupId
  let publishedFormIds = []
  try {
    const groupDoc = await GROUPS_DB.get(groupId)
    groupLabel = groupDoc.label || groupId
    const onlineSurveys = groupDoc.onlineSurveys || []
    publishedFormIds = onlineSurveys.filter(s => s.published).map(s => s.formId)
  } catch (err) {
    // Group doc may not exist; continue with groupId as label
  }
  return { groupLabel, publishedFormIds, formsPath }
}

/**
 * The OPDS publication for a single form at its own URL, which is what the
 * listing feed's rel=self link resolves to: the shared buildFormPublication()
 * shell plus the two fields only a detail response carries, readingOrder (what
 * to open) and resources (every file needed to render it offline). Served by
 * /opds/groups/:groupId/:formId.
 */
async function buildFormPublicationDetail(groupId, formId, respectToken) {
  const { groupLabel, formsPath } = await getGroupMetadata(groupId)

  // forms.json supplies this form's title and images. A form missing from it - or
  // a forms.json that cannot be read - still gets a publication, titled with its
  // formId and falling back to the generic cover.
  let form = null
  try {
    const forms = await fs.readJson(formsPath)
    form = forms.find(f => f.id === formId)
  } catch (err) {
    // forms.json not found; use formId as title
  }
  // Content-derived, NOT forms.json mtime alone: a re-release changes what the
  // client must download without touching forms.json, and if the publication
  // body does not change then its ETag does not change either and the client
  // keeps the old copy indefinitely via 304.
  const formsModified = await getFormModified(groupId, formId, formsPath)

  // Build resources: list all files required to render the online survey form.
  // This includes both the Angular app shell files (from the dist) and the
  // group content files (from the client directory). URLs match what the
  // browser actually requests when loading the online survey, so an HTTP
  // proxy can pre-cache them for offline use.
  const resources = []
  const releaseBaseUrl = `${baseUrl}/releases/prod/online-survey-apps/${groupId}/${formId}`
  const assetsBaseUrl = `${releaseBaseUrl}/assets`
  const clientDir = `/tangerine/groups/${groupId}/client`
  const distDir = '/tangerine/online-survey-app/dist/online-survey-app'

  // Helper: add a resource at the assets/ path.
  function addAssetResource(relativePath, mimeType) {
    resources.push({ href: `${assetsBaseUrl}/${relativePath}`, type: mimeType })
  }
  // Helper: add a resource at the release root path.
  function addRootResource(relativePath, mimeType) {
    resources.push({ href: `${releaseBaseUrl}/${relativePath}`, type: mimeType })
  }

  // 1. App shell files from the online-survey-app dist (runtime.js, main.js, etc.).
  try {
    const distFiles = await listClientFiles(distDir, distDir, [])
    for (const file of distFiles) {
      addRootResource(file.relativePath, file.mimeType)
    }
  } catch (err) {
    console.error(`Error listing dist files:`, err)
  }

  // 2. Group client content files (form HTML, translations, custom scripts, media, etc.).
  //    The release-online-survey-app.sh script maps:
  //      client/<formId>/*.html  →  assets/form/<filename>
  //      everything else         →  assets/<relativePath>
  try {
    const clientFiles = await listClientFiles(clientDir, clientDir)
    for (const file of clientFiles) {
      // Form HTML files go to assets/form/ (matching release-online-survey-app.sh).
      if (file.relativePath.startsWith(`${formId}/`)) {
        const filename = path.basename(file.relativePath)
        addAssetResource(`form/${filename}`, file.mimeType)
      } else {
        addAssetResource(file.relativePath, file.mimeType)
      }
    }
  } catch (err) {
    console.error(`Error listing client files for group ${groupId}:`, err)
  }

  // 3. Tangerine-level translations (copied by release-online-survey-app.sh).
  const tangerineTranslationsDir = '/tangerine/translations'
  try {
    const translationFiles = await listClientFiles(tangerineTranslationsDir, tangerineTranslationsDir, [])
    for (const file of translationFiles) {
      addAssetResource(file.relativePath, file.mimeType)
    }
  } catch (err) {
    // Translations dir may not exist; skip.
  }

  // 4. Tangy-form library files (web components for tangy-form, tangy-input, etc.).
  //    Needed to render form items offline.
  const tangyFormDir = '/tangerine/tangy-form'
  try {
    const dirExists = await fs.pathExists(tangyFormDir)
    if (dirExists) {
      const tangyFormFiles = await listClientFiles(tangyFormDir, tangyFormDir, ['node_modules', 'test', 'demo', 'docs', '.github'])
      console.log(`OPDS: Found ${tangyFormFiles.length} tangy-form files for group ${groupId}`)
      for (const file of tangyFormFiles) {
        addAssetResource(`tangy-form/${file.relativePath}`, file.mimeType)
      }
    } else {
      console.warn(`OPDS: tangy-form dir not found at ${tangyFormDir}`)
    }
  } catch (err) {
    console.error('Error listing tangy-form files:', err)
  }

  return {
    ...buildFormPublication({
      form,
      groupLabel,
      groupId,
      formId,
      respectToken,
      modified: formsModified
    }),
    readingOrder: [
      { href: formOnlineSurveyUrl(groupId, formId), type: 'text/html' }
    ],
    resources
  }
}

/**
 * OPDS 2.0 Publication Detail for a Form. The self link emitted by the group
 * listing (/opds/groups/:groupId) resolves here.
 *
 * @route GET /opds/groups/:groupId/:formId
 * @returns {object} OPDS 2.0 Publication JSON
 */
app.get('/opds/groups/:groupId/:formId', hasRespectToken, async function (req, res) {
  try {
    const groupId = req.params.groupId
    const formId = req.params.formId

    // If a respectToken is present, verify the user has access to this group
    if (req.respectUser && !req.respectUser.allowedGroupIds.includes(groupId)) {
      return res.status(403).send({ error: 'Access denied to this group' })
    }

    const publication = await buildFormPublicationDetail(groupId, formId, req.query.respectToken)

    res.set('Content-Type', 'application/opds-publication+json')
    res.set('Last-Modified', new Date(publication.metadata.modified).toUTCString())
    res.send(publication)
  } catch (error) {
    console.error('Error generating OPDS publication for form:', error)
    res.status(500).send({ error: 'Failed to generate OPDS publication for form' })
  }
})

await tangyModules.hook('declareAppRoutes', {app})

}
