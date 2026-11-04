'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

function createOrderService({ db, validateCoupon }) {
  return function createPendingOrder({ game, pack, playerId, serverId = '', couponCode = '', file }) {
    let couponId = null;
    let discount = 0;

    if (String(couponCode).trim()) {
      const validation = validateCoupon(couponCode, game.id, pack.price, playerId);
      if (!validation.ok) {
        fs.unlinkSync(file.path);
        return { ok: false, message: validation.message };
      }
      couponId = validation.coupon.id;
      discount = validation.discount;
    }

    const id = `NBI-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const total = Math.max(0, Math.round((pack.price - discount) * 100) / 100);
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO orders(id,game_id,package_id,player_id,server_id,coupon_id,subtotal,discount,total,slip_path,status) VALUES(?,?,?,?,?,?,?,?,?,?, 'Pending')`)
        .run(id, game.id, pack.id, playerId, String(serverId).trim(), couponId, pack.price, discount, total, `/uploads/${file.filename}`);
      if (couponId) db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=?').run(couponId);
    });

    try {
      transaction();
    } catch (error) {
      fs.unlinkSync(file.path);
      throw error;
    }

    return {
      ok: true,
      order: {
        id,
        game: game.name,
        package: pack.name,
        subtotal: pack.price,
        discount,
        total,
        status: 'Pending'
      }
    };
  };
}

module.exports = createOrderService;
