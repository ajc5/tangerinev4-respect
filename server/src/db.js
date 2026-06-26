const PouchDB = require('pouchdb')
PouchDB.plugin(require('pouchdb-find'));
const dbDefaults = require('./db-defaults.js')
module.exports = PouchDB.defaults(dbDefaults, {timeout: 50000})
