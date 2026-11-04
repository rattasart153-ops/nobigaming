'use strict';

const multer = require('multer');

module.exports = (err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE'
        ? 'ไฟล์ใหญ่เกิน 5 MB'
        : 'อัปโหลดไฟล์ไม่สำเร็จ'
    });
  }
  return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
};
