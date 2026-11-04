/** Nobi Topup Apps Script 09_Validation module. */

function validateRecord_(tableName,r) {
  const required = {games:['name'],packages:['game_id','name','price'],coupons:['code','discount_type','discount_value'],promotions:['title']}[tableName] || [];
  required.forEach(k=>{if(r[k]===undefined || r[k]===null || String(r[k]).trim()==='') throw new Error('ต้องระบุ '+k);});
  if (tableName==='packages' && (!Number.isFinite(Number(r.price)) || Number(r.price)<0)) throw new Error('ราคาไม่ถูกต้อง');
  if (tableName==='coupons' && (!['fixed','percent'].includes(String(r.discount_type)) || Number(r.discount_value)<=0)) throw new Error('ข้อมูลส่วนลดไม่ถูกต้อง');
  if (tableName==='coupons' && (Number(r.min_player_spend||0)<0 || (Number(r.discount_value)>100 && String(r.discount_type)==='percent'))) throw new Error('เงื่อนไขคูปองไม่ถูกต้อง');
  if (tableName==='coupons' && String(r.allowed_player_ids||'').trim() && !r.game_id) throw new Error('ต้องเลือกเกมเมื่อจำกัด UID เฉพาะ');
}
