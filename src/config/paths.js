'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const IS_VERCEL = process.env.VERCEL === '1';
const DATA_DIR = process.env.NOBI_DATA_DIR || (
  IS_VERCEL ? path.join('/tmp', 'nobi-topup') : path.join(ROOT, 'data')
);
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = process.env.NOBI_UPLOAD_DIR || (
  IS_VERCEL ? path.join(DATA_DIR, 'uploads') : path.join(ROOT, 'uploads')
);

module.exports = Object.freeze({
  ROOT,
  PUBLIC,
  DATA_DIR,
  UPLOADS,
  IS_VERCEL
});
