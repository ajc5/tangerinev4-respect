/**
 * In-memory cache for RESPECT tokens belonging to users who are not stored in
 * the users DB — currently only user1 (the superadmin). Regular users persist
 * their respectToken in the users DB, so they do not use this cache.
 *
 * Note: Because this cache lives in the server process, cached tokens are lost
 * on server restart. A user whose token is cached would need to log in again to
 * obtain a fresh RESPECT URL.
 */
const { v4: uuidV4 } = require('uuid');

// Token lifetime in milliseconds (30 days).
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// username -> { token, expiresAt }
const cache = new Map();

/**
 * Return the cached respectToken for `username`, generating and caching a new
 * one on first use (or after expiry). Reusing the cached token keeps the
 * RESPECT URL stable across logins while the server is running.
 */
function getOrCreateRespectToken(username) {
  const now = Date.now();
  const entry = cache.get(username);
  if (entry && entry.expiresAt > now) {
    return entry.token;
  }
  const token = uuidV4();
  cache.set(username, { token, expiresAt: now + TOKEN_TTL_MS });
  return token;
}

/**
 * Return the username owning `token` if it is a valid, unexpired cached token;
 * otherwise return false.
 */
function isValidRespectToken(token) {
  if (!token) {
    return false;
  }
  const now = Date.now();
  for (const [username, entry] of cache.entries()) {
    if (entry.token === token) {
      if (entry.expiresAt > now) {
        return username;
      }
      cache.delete(username); // Drop expired entry.
      return false;
    }
  }
  return false;
}

module.exports = { getOrCreateRespectToken, isValidRespectToken };
