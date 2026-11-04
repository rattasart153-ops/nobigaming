'use strict';

const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');

function createPaymentInfoService(promptpayId) {
  const merchantId = String(promptpayId || '').trim();

  return async function getPaymentInfo(amountInput = 0) {
    const amount = Math.max(0, Number(amountInput || 0));
    if (!merchantId) {
      return { configured: false, message: 'ผู้ดูแลระบบยังไม่ได้ตั้งค่า PromptPay ID' };
    }

    const payload = generatePayload(merchantId, { amount: amount || undefined });
    return {
      configured: true,
      promptpayId: merchantId,
      amount,
      qrDataUrl: await QRCode.toDataURL(payload, { margin: 1, width: 260 })
    };
  };
}

module.exports = createPaymentInfoService;
