'use strict';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Modern browsers mark cross-site fetches even when Origin is absent.
  if (req.get('sec-fetch-site') === 'cross-site') {
    return res.status(403).json({ error: 'คำขอข้ามเว็บไซต์ถูกปฏิเสธ' });
  }

  const origin = req.get('origin');
  if (origin) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return res.status(403).json({ error: 'Origin ไม่ถูกต้อง' });
    }

    const expectedOrigin = `${req.protocol}://${req.get('host')}`;
    if (parsed.origin !== expectedOrigin) {
      return res.status(403).json({ error: 'ไม่อนุญาตคำขอจากเว็บไซต์อื่น' });
    }
  }

  return next();
}

module.exports = requireSameOrigin;
