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

if (process.env.T_AUTO_COMMIT === 'true') {
  setInterval(commitFilesToVersionControl,parseInt(process.env.T_AUTO_COMMIT_FREQUENCY))
}
module.exports = async function expressAppBootstrap(app) {

// Enable CORS
try {
  if (process.env.T_CORS_ALLOWED_ORIGINS) {
    const origin = JSON.parse(process.env.T_CORS_ALLOWED_ORIGINS)
    app.use(cors({
      credentials: true,
      origin
    }))
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
app.use(compression())



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
app.use('/opds/images/', express.static('/tangerine/client/content/assets'));
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

// Set caching headers for all release assets so HTTP caches (including
// Android WebView caching libraries) can store them for offline use.
app.use('/releases/', function (req, res, next) {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.setHeader('Access-Control-Allow-Origin', '*')
  next()
})
app.use('/releases/', express.static('/tangerine/client/releases', {
  maxAge: '1y',
  immutable: true
}))

// Fallback: serve tangy-form library files from /tangerine/tangy-form/ when the
// app requests them at assets/tangy-form/ (needed to render form items offline).
// This must come BEFORE the general assets fallback below.
app.use('/releases/:releaseType/online-survey-apps/:groupId/:formId/assets/tangy-form', function (req, res, next) {
  const tangyFormPath = '/tangerine/tangy-form'
  return express.static(tangyFormPath, { maxAge: '1y', immutable: true }).apply(this, arguments)
})

// Fallback: serve form HTML files from the group's client/<formId>/ directory
// at the assets/form/ path (matching release-online-survey-app.sh behavior).
app.use('/releases/:releaseType/online-survey-apps/:groupId/:formId/assets/form', function (req, res, next) {
  const groupId = req.params.groupId
  const formId = req.params.formId
  const formPath = `/tangerine/groups/${groupId}/client/${formId}`
  return express.static(formPath, { maxAge: '1y', immutable: true }).apply(this, arguments)
})

// Fallback: serve online-survey-app assets from the group's client directory
// when the release hasn't been built yet. This allows OPDS-published resources
// to be pre-cached by an HTTP proxy before the online survey is released.
app.use('/releases/:releaseType/online-survey-apps/:groupId/:formId/assets', function (req, res, next) {
  const groupId = req.params.groupId
  const contentPath = `/tangerine/groups/${groupId}/client`
  return express.static(contentPath, { maxAge: '1y', immutable: true }).apply(this, arguments)
})

// Fallback: serve online-survey-app shell files (runtime.js, main.js, etc.)
// from the dist directory when the release hasn't been built yet.
app.use('/releases/:releaseType/online-survey-apps/:groupId/:formId', function (req, res, next) {
  const distPath = '/tangerine/online-survey-app/dist/online-survey-app'
  return express.static(distPath, { maxAge: '1y', immutable: true }).apply(this, arguments)
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


/**
 * RESPECT App Manifest endpoint.
 * Returns an app manifest describing this Tangerine instance in the format used by 
 * UstadMobile/RESPECT Consumer App Integration Guide.
 * 
 * The manifest provides app metadata (name, description, icon) and links to the
 * OPDS catalog of learning units (forms).
 *
 * @route GET /respect-app-manifest
 * @route GET /respect-app-manifest/:groupId
 * @returns {object} RespectAppManifest JSON
 */
app.get('/respect-app-manifest', hasRespectToken, async function (req, res) {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`
    const manifest = {
      "name": {
          "en-US": "Tangerine"
      },
      "description": {
          "en-US": "Tangerine data collection and reporting platform"
      },
      "license": "AGPL-3.0-or-later",
      "icon": "https://images.squarespace-cdn.com/content/v1/6514416d40a14750441d84ed/1695826315639-WCXQA69ASCFCPS9L91UC/tangerine_icon.png?format=300w",
      "website": "https://www.tangerinecentral.org",
      "learningUnits": `${baseUrl}/opds/groups?respectToken=${req.query.respectToken}`,
      "defaultLaunchUri": `${baseUrl}`,

      "android": {
          "packageId": "org.tangerinecentral.tangerine",
          "stores": ["https://play.google.com/store/apps/details?id=org.tangerinecentral.tangerine"],
          "sourceCode": "https://github.com/Tangerine-Community/Tangerine"
      }
    }
    res.set('Content-Type', 'application/json')
    res.send(manifest)
  } catch (error) {
    console.error('Error generating Respect App Manifest:', error)
    res.status(500).send({ error: 'Failed to generate Respect App Manifest' })
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
  return express.static(contentPath).apply(this, arguments)
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
    const baseUrl = `${req.protocol}://${req.get('host')}`
    const groupsListLib = require('./groups-list.js')
    const GROUPS_DB = new DB('groups')

    let groupIds = await groupsListLib()

    // If a respectToken is present, filter to user's allowed groups
    if (req.respectUser) {
      groupIds = groupIds.filter(id => req.respectUser.allowedGroupIds.includes(id))
    }

    const navigation = []

    for (const groupId of groupIds) {
      try {
        const groupDoc = await GROUPS_DB.get(groupId)
        const label = groupDoc.label || groupId
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
        title: 'Tangerine Groups'
      },
      links: [
        { rel: 'self', href: `${baseUrl}/opds/groups`, type: 'application/opds+json' }
      ],
      navigation
    }

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
    const baseUrl = `${req.protocol}://${req.get('host')}`
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
    try {
      const groupDoc = await GROUPS_DB.get(groupId)
      groupLabel = groupDoc.label || groupId
      const onlineSurveys = groupDoc.onlineSurveys || []
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

    // Filter to non-archived, listed forms that also have published online surveys
    const listedForms = forms
      .filter(f => !f.archived && f.listed !== false && publishedFormIds.includes(f.id))
      .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id))

    // Build publications array
    const publications = []

    for (const form of listedForms) {
      const formId = form.id
      const formTitle = form.title || formId
      const formSrc = form.src || ''
      const onlineSurveyUrl = `${baseUrl}/releases/prod/online-survey-apps/${groupId}/${formId}/#/form/${formId}`

      // Determine a cover image
      const images = []
      if (form.cover) {
        images.push({
          href: `${baseUrl}/opds/images/${form.cover}`,
          type: form.cover.endsWith('.png') ? 'image/png' : 'image/jpeg'
        })
      } else {
        images.push({
          href: `${baseUrl}/opds/images/form.png`,
          type: 'image/png'
        })
      }

      publications.push({
        metadata: {
          '@type': 'http://schema.org/Game',
          title: formTitle,
          author: groupLabel,
          identifier: `${baseUrl}/opds/groups/${groupId}/${formId}?respectToken=${req.query.respectToken}`,
          language: 'en',
          modified: new Date().toISOString()
        },
        links: [
          { rel: 'self', href: `${baseUrl}/opds/groups/${groupId}/${formId}?respectToken=${req.query.respectToken}`, type: 'application/opds-publication+json' },
          { rel: 'http://opds-spec.org/acquisition/open-access', href: onlineSurveyUrl, type: 'text/html' }
        ],
        images
      })
    }

    const opdsCatalog = {
      metadata: {
        title: `${groupLabel} - Forms`
      },
      links: [
        { rel: 'self', href: `${baseUrl}/opds/groups/${groupId}?respectToken=${req.query.respectToken}`, type: 'application/opds+json' }
      ],
      publications
    }

    res.set('Content-Type', 'application/opds+json')
    res.send(opdsCatalog)
  } catch (error) {
    console.error('Error generating OPDS catalog for group:', error)
    res.status(500).send({ error: 'Failed to generate OPDS catalog for group' })
  }
})

/**
 * OPDS 2.0 Publication Detail for a Form.
 * Returns full publication metadata, links, images, and resources
 * for a single form, pointing to the online-survey-app URL.
 *
 * @route GET /opds/groups/:groupId/:formId
 * @returns {object} OPDS 2.0 Publication JSON
 */
app.get('/opds/groups/:groupId/:formId', hasRespectToken, async function (req, res) {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`
    const groupId = req.params.groupId
    const formId = req.params.formId

    // If a respectToken is present, verify the user has access to this group
    if (req.respectUser && !req.respectUser.allowedGroupIds.includes(groupId)) {
      return res.status(403).send({ error: 'Access denied to this group' })
    }

    const GROUPS_DB = new DB('groups')
    const formsPath = `/tangerine/client/content/groups/${groupId}/forms.json`

    // Get group metadata and published online surveys
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

    // Read forms.json to find the form definition
    let form = null
    let formTitle = formId
    try {
      const forms = await fs.readJson(formsPath)
      form = forms.find(f => f.id === formId)
      if (form && form.title) {
        formTitle = form.title
      }
    } catch (err) {
      // forms.json not found; use formId as title
    }

    const onlineSurveyUrl = `${baseUrl}/releases/prod/online-survey-apps/${groupId}/${formId}/#/form/${formId}`

    // Build images from form definition
    const images = []
    if (form && Array.isArray(form.images)) {
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
      images.push({
        href: `${baseUrl}/opds/images/form.png`,
        type: 'image/png'
      })
    }

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

    const publication = {
      metadata: {
        '@type': 'http://schema.org/Game',
        title: formTitle,
        author: groupLabel,
        identifier: `${baseUrl}/opds/groups/${groupId}/${formId}?respectToken=${req.query.respectToken}`,
        language: 'en',
        modified: new Date().toISOString()
      },
      links: [
        { rel: 'self', href: `${baseUrl}/opds/groups/${groupId}/${formId}?respectToken=${req.query.respectToken}`, type: 'application/opds-publication+json' },
        { rel: 'http://opds-spec.org/acquisition/open-access', href: onlineSurveyUrl, type: 'text/html' }
      ],
      images,
      resources
    }

    res.set('Content-Type', 'application/opds-publication+json')
    res.send(publication)
  } catch (error) {
    console.error('Error generating OPDS publication for form:', error)
    res.status(500).send({ error: 'Failed to generate OPDS publication for form' })
  }
})

await tangyModules.hook('declareAppRoutes', {app})

}
