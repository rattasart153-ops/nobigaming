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
  if (err && err.name === 'AppsScriptGatewayError') {
    const status = Number(err.status);
    return res.status(status >= 400 && status <= 599 ? status : 502).json({
      error: String(err.message || 'ไม่สามารถติดต่อระบบจัดเก็บข้อมูลได้'),
      code: String(err.code || 'APPS_SCRIPT_GATEWAY_ERROR')
    });
  }
  return res.status(500).json({error:'เกิดข้อผิดพลาดภายในระบบ'});
};
