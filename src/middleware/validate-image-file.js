'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;
const MAX_IMAGE_EDGE = 8192;

const SIGNATURES = Object.freeze({
  'image/png': bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/webp': bytes => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
});

const FORMATS = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp'
});

async function removeFile(filePath) {
  if (filePath) await fs.unlink(filePath).catch(() => {});
}

async function validateImageFile(req, res, next) {
  if (!req.file) return next();

  const originalPath = req.file.path;
  const temporaryPath = path.join(
    path.dirname(originalPath),
    '.nobi-image-' + crypto.randomBytes(12).toString('hex') + '.tmp'
  );

  try {
    const handle = await fs.open(originalPath, 'r');
    const header = Buffer.alloc(12);
    let bytesRead;
    try {
      ({ bytesRead } = await handle.read(header, 0, header.length, 0));
    } finally {
      await handle.close();
    }

    const mimeType = req.file.mimetype;
    const signatureMatches = SIGNATURES[mimeType]?.(header.subarray(0, bytesRead)) === true;
    if (!signatureMatches) {
      await removeFile(originalPath);
      return res.status(415).json({ error: 'ชนิดไฟล์ไม่ตรงกับเนื้อหาภาพที่อนุญาต (PNG/JPG/WebP)' });
    }

    const image = sharp(originalPath, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
      pages: 1
    });
    const metadata = await image.metadata().catch(() => null);
    if (!metadata) {
      await removeFile(originalPath);
      return res.status(415).json({ error: 'ไฟล์ภาพเสียหายหรือไม่ใช่ภาพที่รองรับ' });
    }
    const expectedFormat = FORMATS[mimeType];
    if (
      metadata.format !== expectedFormat ||
      !Number.isInteger(metadata.width) ||
      !Number.isInteger(metadata.height) ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width > MAX_IMAGE_EDGE ||
      metadata.height > MAX_IMAGE_EDGE ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
      (metadata.pages || 1) !== 1
    ) {
      await removeFile(originalPath);
      return res.status(415).json({ error: 'ไฟล์ภาพไม่สมบูรณ์หรือมีขนาด/จำนวนพิกเซลเกินกำหนด' });
    }

    let pipeline = sharp(originalPath, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
      pages: 1
    }).rotate();

    if (expectedFormat === 'png') pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
    else if (expectedFormat === 'jpeg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true });
    else pipeline = pipeline.webp({ quality: 88, effort: 4 });

    const decoded = await pipeline.toFile(temporaryPath).then(() => true).catch(() => false);
    if (!decoded) {
      await removeFile(temporaryPath);
      await removeFile(originalPath);
      return res.status(415).json({ error: 'ไฟล์ภาพเสียหายหรือไม่สามารถถอดรหัสได้' });
    }
    const outputStat = await fs.stat(temporaryPath);
    if (outputStat.size < 1 || outputStat.size > MAX_FILE_BYTES) {
      await removeFile(temporaryPath);
      await removeFile(originalPath);
      return res.status(415).json({ error: 'ขนาดไฟล์ภาพหลังประมวลผลเกิน 3 MB' });
    }

    await fs.rename(temporaryPath, originalPath);
    req.file.size = outputStat.size;
    req.file.mimetype = mimeType;
    return next();
  } catch (error) {
    await removeFile(temporaryPath);
    await removeFile(originalPath);
    if (error && (error.code === 'ERR_SHARP_INPUT' || error.code === 'VIPS_ERROR' || error.code === 'Input file has corrupt header')) {
      return res.status(415).json({ error: 'ไฟล์ภาพเสียหายหรือไม่ใช่ภาพที่รองรับ' });
    }
    return next(error);
  }
}

module.exports = validateImageFile;
