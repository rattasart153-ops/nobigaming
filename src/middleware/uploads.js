'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { UPLOADS } = require('../config/paths');

module.exports = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(
      null,
      Date.now() + '-' + crypto.randomBytes(6).toString('hex') + path.extname(file.originalname).toLowerCase()
    )
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpeg|webp)$/.test(file.mimetype))
});
