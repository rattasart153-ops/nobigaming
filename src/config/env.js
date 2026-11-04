'use strict';

// Load the local environment before any module reads configuration.
require('dotenv').config();

const ENV = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || '3000',
  VERCEL: process.env.VERCEL || '',
  NOBI_DATA_DIR: process.env.NOBI_DATA_DIR || '',
  NOBI_UPLOAD_DIR: process.env.NOBI_UPLOAD_DIR || '',
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  PROMPTPAY_ID: process.env.PROMPTPAY_ID || ''
});

module.exports = ENV;
