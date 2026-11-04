# Nobi Topup — Full-Stack starter

เว็บไซต์เติมเกมภาษาไทย พร้อมหน้าร้าน, ระบบคูปอง, QR PromptPay, การแนบสลิป, Admin Panel และ SQLite

## ความต้องการ
- Node.js 20 ขึ้นไป
- npm

## เริ่มใช้งานในเครื่อง
1. แตกไฟล์ ZIP แล้วเข้าโฟลเดอร์ `nobitopup-project`
2. คัดลอก `.env.example` เป็น `.env`
3. ตั้งค่า `SESSION_SECRET` ให้เป็นค่าสุ่มยาว และใส่ `PROMPTPAY_ID` ของร้านเพื่อเปิด QR PromptPay
4. กำหนด `ADMIN_USERNAME`, `ADMIN_PASSWORD` และ `SESSION_SECRET` ใน `.env` ให้ครบก่อน
5. ติดตั้งแพ็กเกจและเริ่มเซิร์ฟเวอร์:
   ```bash
   npm install
   npm start
   ```
6. API health check อยู่ที่ `http://localhost:3000/api/health`.

**สถานะปัจจุบัน:** หน้า Storefront และ Admin ใน Branch นี้เชื่อมกับ Express REST API แล้ว (ไม่เรียก Google Apps Script RPC โดยตรง) โดย Checkout สร้าง Pending ก่อนและส่งสลิปผ่าน endpoint แยก ส่วน Admin ใช้ HttpOnly cookie และ endpoint ดูสลิปแบบ private; Checkout ใช้ HttpOnly cookie แบบจำกัด path และ Idempotency-Key ป้องกันคำขอซ้ำ อย่างไรก็ตาม Express ยังใช้ SQLite/ไฟล์ในเครื่องเป็นฐานชั่วคราว ยังไม่ได้เชื่อม Sheets/Drive และยังไม่พร้อม Deploy หรือรับเงินจริง

## Google Apps Script migration (in progress)

The zero-budget migration foundation is in `google-apps-script/`. Setup notes: [Google Apps Script setup guide](docs/GOOGLE_APPS_SCRIPT_SETUP.md).

**Important:** the repository HTML pages currently target the Express REST API. The Apps Script RPC implementation remains a separate legacy path and is not the active frontend adapter. The signed version-1 Apps Script HTTP gateway and matching Node client are now present, with HMAC authentication, timestamp checks and a ScriptLock-protected nonce ledger. The client is not yet wired into Express. The Google Sheets repository adapter, private Drive media proxy, durable sessions/storage, approved member/coupon features, GAS runtime tests and full browser/device end-to-end tests are still incomplete. Do not use this for real customer payments.

## การตั้งค่าบัญชีแอดมินและ Session
- ต้องกำหนด `ADMIN_USERNAME`, `ADMIN_PASSWORD` และ `SESSION_SECRET` ในไฟล์ `.env` ก่อนเริ่มระบบทุกสภาพแวดล้อม
- ใช้รหัสผ่านที่ไม่ซ้ำกับบริการอื่น และสร้าง `SESSION_SECRET` แบบสุ่มยาวอย่างน้อย 32 bytes
- ระบบจะไม่สร้างบัญชีด้วยรหัสผ่านเริ่มต้นที่ฝังใน Source Code อีกต่อไป
- การเปลี่ยนค่า Admin ใน `.env` หลังสร้างฐานข้อมูลแล้วจะไม่เปลี่ยนรหัสผ่านของบัญชีเดิมโดยอัตโนมัติ

## ฟีเจอร์
- หน้าแรกธีม Slate / Neon Cyan / Purple accent และรองรับมือถือ
- แบนเนอร์โปรโมชั่นดึงจากข้อมูลโปรโมชั่นที่เปิดใช้งาน
- แค็ตตาล็อกเกมและแพ็กเกจ, ป้าย Popular Package, รูปแพ็กเกจผ่าน URL
- คูปองแบบลดจำนวนเงินหรือเปอร์เซ็นต์, ยอดขั้นต่ำ, เกมที่ใช้ได้, วันหมดอายุ และจำนวนครั้ง
- ระบบตรวจสอบและแนะนำคูปองที่ประหยัดที่สุดตามเกมและยอดที่เลือก
- QR PromptPay ตามยอดสุทธิ เมื่อกำหนด `PROMPTPAY_ID`
- สร้างออเดอร์พร้อม UID/Server ID และอัปโหลดสลิป PNG/JPG/WebP ขนาดไม่เกิน 5 MB
- Admin Panel สำหรับตรวจสอบสลิปและเปลี่ยนสถานะ Pending / Completed / Rejected พร้อม CRUD เกม แพ็กเกจ คูปอง และโปรโมชั่น
- SQLite เก็บข้อมูลใน `data/nobitopup.sqlite`

## ข้อควรทราบก่อนเปิดให้บริการจริง
- ระบบตรวจสอบสลิปเป็นการตรวจด้วยคนผ่าน Admin Panel ไม่ได้ยืนยันการโอนจากธนาคารโดยอัตโนมัติ
- ยังไม่ได้เชื่อม API ผู้ให้บริการเติมเกมเพื่อส่งคำสั่งเติมโดยอัตโนมัติ สถานะ Completed เป็นการอนุมัติของแอดมิน
- ต้องตั้งค่า `PROMPTPAY_ID` ของร้านเองก่อนแสดง QR สำหรับรับเงิน อย่าใช้ QR หรือบัญชีของบุคคลอื่น
- ไฟล์สลิปที่รับผ่าน Express จะถูกเก็บแยกจากไฟล์ภาพสาธารณะ และอ่านได้ผ่าน Admin-only API เท่านั้น
- ใช้ HTTPS, สำรองฐานข้อมูลและไฟล์สลิป, จำกัดสิทธิ์เข้าถึงเซิร์ฟเวอร์ และตรวจสอบนโยบายเก็บข้อมูลส่วนบุคคล
- Admin API ตรวจสอบ Origin สำหรับคำขอเปลี่ยนแปลงข้อมูล และส่ง Content Security Policy แบบ Report-Only เพื่อเก็บผลก่อนบังคับใช้


### เงื่อนไขคูปองแบบกำหนดเอง
หน้าแอดมินรองรับการจำกัดคูปองตามเกม, UID ที่ระบุไว้ และยอดเติมสะสมขั้นต่ำของ UID ในเกมนั้น โดยนับเฉพาะออเดอร์ที่สถานะ Completed (หลังหักส่วนลด) ดูรายละเอียดและข้อจำกัดได้ที่ [คู่มือ Google Apps Script](docs/GOOGLE_APPS_SCRIPT_SETUP.md).
