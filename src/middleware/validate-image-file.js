'use strict';

const fs = require('node:fs/promises');

const SIGNATURES = Object.freeze({
  'image/png': bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/webp': bytes => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
});

async function validateImageFile(req, res, next) {
  if (!req.file) return next();

  try {
    const handle = await fs.open(req.file.path, 'r');
    const header = Buffer.alloc(12);
    let bytesRead;
    try {
      ({ bytesRead } = await handle.read(header, 0, header.length, 0));
    } finally {
      await handle.close();
    }

    const signatureMatches = SIGNATURES[req.file.mimetype]?.(header.subarray(0, bytesRead)) === true;
    if (!signatureMatches) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(415).json({ error: 'ชนิดไฟล์ไม่ตรงกับเนื้อหาภาพที่อนุญาต (PNG/JPG/WebP)' });
    }

    return next();
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    return next(error);
  }
}

module.exports = validateImageFile;
