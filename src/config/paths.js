'use strict';

const path = require('node:path');
const ENV = require('./env');

const ROOT = path.resolve(__dirname, '..', '..');
const IS_VERCEL = ENV.VERCEL === '1';
const DATA_DIR = ENV.NOBI_DATA_DIR || (
  IS_VERCEL ? path.join('/tmp', 'nobi-topup') : path.join(ROOT, 'data')
);
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = ENV.NOBI_UPLOAD_DIR || (
  IS_VERCEL ? path.join(DATA_DIR, 'uploads') : path.join(ROOT, 'uploads')
);
const PUBLIC_UPLOADS = path.join(UPLOADS, 'public');
const PRIVATE_SLIPS = ENV.NOBI_PRIVATE_SLIP_DIR || path.join(DATA_DIR, 'private-slips');

module.exports = Object.freeze({
  ROOT,
  PUBLIC,
  DATA_DIR,
  UPLOADS,
  PUBLIC_UPLOADS,
  PRIVATE_SLIPS,
  IS_VERCEL
});
