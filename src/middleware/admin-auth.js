'use strict';

function requireAdmin(req, res, next) {
  return req.session && req.session.adminId
    ? next()
    : res.status(401).json({ error: 'กรุณาเข้าสู่ระบบแอดมินก่อน' });
}

module.exports = requireAdmin;
