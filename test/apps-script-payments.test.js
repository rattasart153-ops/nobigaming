'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const generatePayload = require('promptpay-qr');

function makePaymentHarness(promptpayId = '081-234-5678') {
  const context = vm.createContext({
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => key === 'NOBI_PROMPTPAY_ID' ? promptpayId : ''
      })
    }
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', '05_Payments.gs'), 'utf8'),
    context,
    {filename:'05_Payments.gs'}
  );
  return context;
}

test('PromptPay payload matches the existing promptpay-qr implementation for phone, citizen ID and e-wallet IDs', () => {
  const cases = [
    ['081-234-5678', 12.34],
    ['081 234 5678', 15.5],
    ['+66-81-234-5678', 10],
    ['1234567890123', 199.99],
    ['123456789012345', 1]
  ];
  for (const [id, amount] of cases) {
    const context = makePaymentHarness(id);
    const result = context.paymentInfo_(amount);
    assert.equal(result.configured, true);
    assert.equal(result.payload, generatePayload(id, {amount}));
    assert.equal(result.amount, amount);
    assert.equal(result.payload.slice(-4), context.promptPayCrc16_(result.payload.slice(0, -4)));
  }
});

test('PromptPay payload is static without an amount and dynamic with a positive amount', () => {
  const context = makePaymentHarness();
  const staticResult = context.paymentInfo_(0);
  const dynamicResult = context.paymentInfo_(25);
  assert.equal(staticResult.payload.slice(6, 12), '010211');
  assert.equal(dynamicResult.payload.slice(6, 12), '010212');
  assert.equal(staticResult.payload.includes('540'), false);
  assert.equal(dynamicResult.payload.includes('540525.00'), true);
});

test('PromptPay ID validation rejects unsupported or malformed identifiers', () => {
  const context = makePaymentHarness();
  for (const id of ['', '12345', '1812345678', '123456789012', '12345678901234', '081ABC5678']) {
    assert.throws(() => context.promptPayPayload_(id, 10), /PROMPTPAY_ID_INVALID/);
  }
});

test('PromptPay amount validation rejects negative, non-finite and sub-satang positive amounts', () => {
  const context = makePaymentHarness();
  for (const amount of [-1, Infinity, NaN, 'not-a-number', 0.001]) {
    assert.throws(() => context.paymentInfo_(amount), /PROMPTPAY_AMOUNT_INVALID/);
  }
});

test('PromptPay payment information remains explicitly unconfigured without a merchant ID', () => {
  const context = makePaymentHarness('');
  assert.deepEqual(JSON.parse(JSON.stringify(context.paymentInfo_(50))), {
    configured:false,
    message:'ร้านยังไม่ได้ตั้งค่า PromptPay'
  });
});
