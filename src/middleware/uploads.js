'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const EXTENSIONS = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
});

function createUpload(destination) {
  return multer({
    storage: multer.diskStorage({
      destination,
      filename: (req, file, cb) => cb(
        null,
        Date.now() + '-' + crypto.randomBytes(8).toString('hex') + EXTENSIONS[file.mimetype]
      )
    }),
    limits: {
      fileSize: 3 * 1024 * 1024,
      files: 1,
      fields: 10,
      parts: 12,
      fieldNestingDepth: 1
    },
    fileFilter: (req, file, cb) => {
      if (!Object.hasOwn(EXTENSIONS, file.mimetype)) {
        return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      }
      return cb(null, true);
    }
  });
}

module.exports = createUpload;
