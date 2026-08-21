const log = require('tangy-log').log;
const DB = require('../db.js');
const GROUPS_DB = new DB('groups');
module.exports = async (req, res, next) => {
  const errorMessage = `Permission denied at ${req.url}`;
  try {
    const { groupId, formId } = req.params;
    const formUploadToken = req.headers['formuploadtoken'] || req.headers['formUploadToken'];
    const data =  (await GROUPS_DB.get(groupId)).onlineSurveys || [];
    const formData = data.find(e => e.formId === formId);
    next();
    
  } catch (error) {
    log.warn(errorMessage);
    res.status(401).send(errorMessage);
  }
};
