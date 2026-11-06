/** Nobi Topup Apps Script 05_Payments module. */

function promptPayField_(id, value) {
  const text = String(value);
  if (text.length > 99) throw new Error('PROMPTPAY_FIELD_TOO_LONG');
  return id + ('0' + text.length).slice(-2) + text;
}

function promptPayCrc16_(value) {
  let crc = 0xffff;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
}

function promptPayPayload_(promptpayId, amount) {
  const raw = String(promptpayId || '').trim();
  if (!raw || !/^[0-9\\s()+-]+$/.test(raw)) throw new Error('PROMPTPAY_ID_INVALID');
  const digits = raw.replace(/[\\s()+-]/g, '');
  let type;
  let target;
  if (/^0[0-9]{9}$/.test(digits)) {
    type = '01';
    target = '0066' + digits.slice(1);
  } else if (/^[0-9]{13}$/.test(digits)) {
    type = '02';
    target = digits;
  } else if (/^[0-9]{15}$/.test(digits)) {
    type = '03';
    target = digits;
  } else {
    throw new Error('PROMPTPAY_ID_INVALID');
  }

  const input = Number(amount == null || amount === '' ? 0 : amount);
  if (!Number.isFinite(input) || input < 0) throw new Error('PROMPTPAY_AMOUNT_INVALID');
  const rounded = Math.round((input + Number.EPSILON) * 100) / 100;
  if (input > 0 && rounded === 0) throw new Error('PROMPTPAY_AMOUNT_INVALID');
  const parts = [
    promptPayField_('00', '01'),
    promptPayField_('01', rounded > 0 ? '12' : '11'),
    promptPayField_('29', promptPayField_('00', 'A000000677010111') + promptPayField_(type, target)),
    promptPayField_('53', '764')
  ];
  if (rounded > 0) parts.push(promptPayField_('54', rounded.toFixed(2)));
  parts.push(promptPayField_('58', 'TH'));
  const body = parts.join('') + '6304';
  return body + promptPayCrc16_(body);
}

function paymentInfo_(amount) {
  const props = PropertiesService.getScriptProperties();
  const promptpayId = String(props.getProperty('NOBI_PROMPTPAY_ID') || '').trim();
  if (!promptpayId) return {configured:false,message:'ร้านยังไม่ได้ตั้งค่า PromptPay'};
  const value = Number(amount == null || amount === '' ? 0 : amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('PROMPTPAY_AMOUNT_INVALID');
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return {
    configured:true,
    promptpayId:promptpayId,
    amount:rounded,
    payload:promptPayPayload_(promptpayId, rounded)
  };
}
