# Nobi Topup — Zero-Cost Architecture

เว็บไซต์เติมเกมภาษาไทย พร้อมหน้าร้าน ระบบสมาชิก/คูปอง การแนบสลิป และ Admin Panel

## สถาปัตยกรรมเป้าหมาย

**Google Apps Script + Google Sheets + Google Drive จากบัญชีเดิมเท่านั้น**

- Apps Script เป็น application runtime, backend และ web host ผ่าน HtmlService
- Sheets เป็นฐานข้อมูล
- Drive เก็บสลิปและรูปภาพแบบ Restricted / Private
- Frontend จะเปลี่ยนจาก Vercel REST calls เป็น `google.script.run` ผ่าน facade ที่เปิดเฉพาะฟังก์ชันที่อนุญาต
- GitHub เป็น source control; ทำงานเฉพาะ `vercel-drive-setup`; ห้ามแก้ `main`
- ไม่ใช้ Vercel runtime, Neon, hosted PostgreSQL, Vercel Blob หรือบริการที่ต้องเปิด billing

`google.script.run` เป็น built-in bridge สำหรับเรียก server-side Apps Script ไม่ใช่ API provider ภายนอกที่ต้องสมัครหรือจ่ายแยกต่างหาก

## เงื่อนไข Zero Cost

- ห้ามสมัครบริการใหม่ เพิ่มบัตร เปิด billing หรือสร้างทรัพยากรที่มีค่าใช้จ่าย
- ใช้เฉพาะโควตา Apps Script และพื้นที่ Drive ที่มีอยู่ในบัญชีเดิม
- หาก quota/พื้นที่เต็ม ให้หยุดหรือปฏิเสธงานอย่างปลอดภัย ห้าม fallback ไปบริการเสียเงิน
- ไม่สามารถรับประกันว่า Google จะคงโควตาฟรีหรือเงื่อนไขเดิมตลอดไป
- ยังไม่มีการสร้าง Apps Script project, Spreadsheet, Drive folder, deploy, initialize schema หรือสร้าง Admin

## สถานะปัจจุบัน

Source มี GAS Schema v1, repositories, business handlers, private Drive helpers และ signed gateway แต่ยังไม่ผ่านการทดสอบใน Apps Script runtime จริง ส่วนหน้าร้าน/Admin ยังเรียก Vercel REST API จึงต้องทำ compatibility port ก่อนทดสอบจริง ไม่มีการเปลี่ยน Production หรือรับชำระเงินจริง

## Business rules ที่ต้องรักษา

- Guest checkout อนุญาต; Member Login ID เป็น ASCII alphanumeric 4–30 ตัว ไม่แยกตัวพิมพ์เล็ก/ใหญ่
- Coupons: public, member-only, member-game-spend; UID allowlist และยอดสะสมรายเกมเป็นเงื่อนไขแยกกัน
- นับยอดสะสมเฉพาะ Completed หลังหักส่วนลด; Pending/Rejected/Expired/Guest ไม่นับ
- Reserve coupon เมื่อ Pending, Consume เมื่อ Completed, Release เมื่อ Rejected/Expired
- ออเดอร์ปกติหรือคูปองไม่มีวันหมดอายุ: 15 นาที; คูปองมีวันหมดอายุ: ถึงสิ้นวันหมดอายุ Asia/Bangkok
- Server คำนวณราคา ส่วนลด ยอดชำระ และ deadline; สลิปที่ส่งทันเวลาตรวจภายหลังได้
- Sessions สูงสุด 8 ชั่วโมง, idle timeout 30 นาที; revoke เมื่อ logout/password change/suspension
- Admin-only IP history; retention 90 วันแล้วลบหรือ anonymize
- สลิปและรูปภาพเป็น Private; สลิปอ่านได้เฉพาะ Admin; ตรวจสลิปด้วยคน

## ข้อจำกัด

Apps Script มี execution/daily quotas, Sheets ไม่มี relational transactions และ Drive มีพื้นที่จำกัด ต้องทดสอบ concurrency, recovery, PBKDF2, file transfer และ quota ก่อนใช้งานจริง ใช้ข้อมูลสังเคราะห์เท่านั้น

## เอกสารหลัก

- [Architecture](docs/ARCHITECTURE.md)
- [Zero-Cost Migration Plan](docs/ZERO_COST_MIGRATION_PLAN.md)
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)
- [Apps Script Setup](docs/GOOGLE_APPS_SCRIPT_SETUP.md)
- [Sheets / Drive Data Model](docs/DATA_MODEL.md)
