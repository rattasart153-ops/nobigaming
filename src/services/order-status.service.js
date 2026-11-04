'use strict';

function createOrderStatusService(db) {
  return function setOrderStatus(orderId, nextStatus) {
    const transaction = db.transaction(() => {
      const order = db.prepare('SELECT status FROM orders WHERE id=?').get(String(orderId));
      if (!order) return { ok: false, reason: 'not_found' };
      if (order.status === nextStatus) return { ok: true, status: nextStatus, unchanged: true };
      if (order.status !== 'Pending') return { ok: false, reason: 'invalid_transition' };

      db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(nextStatus, String(orderId));
      return { ok: true, status: nextStatus, unchanged: false };
    });

    return transaction();
  };
}

module.exports = createOrderStatusService;
