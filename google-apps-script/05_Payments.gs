/** Nobi Topup Apps Script 05_Payments module. */

function paymentInfo_(amount) {
  const props = PropertiesService.getScriptProperties();
  const promptpayId = String(props.getProperty('NOBI_PROMPTPAY_ID') || '').trim();
  if (!promptpayId) return {configured:false,message:'ร้านยังไม่ได้ตั้งค่า PromptPay'};
  // QR generation must be supplied by a vetted compatible library/service before launch.
  return {configured:false,message:'ยังไม่ได้เปิดใช้ตัวสร้าง PromptPay QR ใน Apps Script'};
}
