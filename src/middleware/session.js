'use strict';

const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { DATA_DIR } = require('../config/paths');
const ENV = require('../config/env');

const sessionSecret = ENV.SESSION_SECRET || (
  ENV.NODE_ENV === 'production'
    ? ''
    : 'dev-only-change-this-session-secret-before-deploying'
);
if (!sessionSecret) {
  throw new Error('SESSION_SECRET must be configured in production.');
}

module.exports = session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: ENV.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
});
