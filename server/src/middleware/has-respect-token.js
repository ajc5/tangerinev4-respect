const log = require('tangy-log').log;
const DB = require('../db.js');
const USERS_DB = new DB('users');

module.exports = async (req, res, next) => {
  const respectToken = req.query.respectToken;
  
  // Token is required — deny access if not provided
  if (!respectToken) {
    const errorMessage = `respectToken is required at ${req.url}`;
    log.warn(errorMessage);
    return res.status(401).send(errorMessage);
  }

  const errorMessage = `Permission denied at ${req.url}`;
  try {
    await USERS_DB.createIndex({ index: { fields: ['respectToken'] } });
    const results = await USERS_DB.find({ selector: { respectToken } });
    
    if (results.docs.length === 0) {
      log.warn(`Invalid respectToken: ${respectToken}`);
      return res.status(401).send(errorMessage);
    }

    const user = results.docs[0];
    const username = user.username;

    // Resolve allowed groups using existing getGroupsByUser
    const { getGroupsByUser } = require('../users.js');
    const groups = await getGroupsByUser(username);
    const allowedGroupIds = groups.map(g => g.attributes.name);

    req.respectUser = { username, allowedGroupIds };
    next();
  } catch (error) {
    log.warn(errorMessage);
    res.status(401).send(errorMessage);
  }
};
