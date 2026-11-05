# Nobi Topup — Full-Stack starter

เว็บไซต์เติมเกมภาษาไทย พร้อมหน้าร้าน ระบบสมาชิก/คูปอง QR PromptPay การแนบสลิป และ Admin Panel โดย Branch นี้เตรียมสถาปัตยกรรม Vercel + Google Apps Script + Sheets + Drive แล้ว (SQLite เหลือไว้สำหรับ local development/characterization เท่านั้น)

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

**สถานะปัจจุบัน:** หน้า Storefront และ Admin เชื่อมกับ Express REST API แบบ same-origin แล้ว โดย Express production mode ใช้ signed Apps Script HTTP Gateway เพื่อให้ Apps Script จัดการ Business Logic, Google Sheets และ Google Drive; ระบบปฏิเสธการ fallback ไป SQLite เมื่อขาด gateway configuration ส่วน SQLite/ไฟล์ในเครื่องใช้เฉพาะ local development และ characterization เท่านั้น Source integration มี Node/GitHub Actions tests ครอบคลุม แต่ยังไม่ผ่านการทดสอบใน Apps Script runtime จริง, Google permissions, concurrency/quota และ browser/device end-to-end จึงยังไม่พร้อม Deploy หรือรับเงินจริง

## Google Apps Script + Sheets + Drive

โค้ด Backend อยู่ใน `google-apps-script/` และเชื่อมผ่าน Signed HTTP Gateway จาก Express เท่านั้น ดูขั้นตอนและข้อจำกัดที่ [Google Apps Script setup guide](docs/GOOGLE_APPS_SCRIPT_SETUP.md) และ [Vercel + Google setup](docs/VERCEL_GOOGLE_SETUP.md)

- Apps Script ใช้ Schema v1 repository สำหรับ Catalog, Coupon, Order, Admin และ Authentication
- Sheets เก็บข้อมูลถาวร ส่วนสลิปและรูปภาพเก็บใน Drive แบบ Private
- Vercel ส่งสลิปผ่าน Admin-authorized proxy และส่งรูปภาพหน้าร้านผ่าน reference-checked media proxy
- ระบบสมาชิก Guest checkout, coupon eligibility/reservation, order deadline, idempotency, audit และ shared rate-limit ถูก implement ใน source แล้ว
- GitHub Actions ตรวจ Node-side tests; ยังต้องทดสอบ Apps Script runtime จริง, PBKDF2/quota, concurrency, Drive permissions และ browser/device end-to-end ด้วยข้อมูลสังเคราะห์ก่อนใช้งานจริง

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
- สร้างออเดอร์พร้อม UID/Server ID และอัปโหลดสลิป PNG/JPG/WebP ขนาดไม่เกิน 3 MB
- Admin Panel สำหรับตรวจสอบสลิปและเปลี่ยนสถานะ Pending / Completed / Rejected พร้อม CRUD เกม แพ็กเกจ คูปอง และโปรโมชั่น
- SQLite (`data/nobitopup.sqlite`) ใช้เฉพาะ local development/characterization; Vercel production ต้องใช้ Apps Script + Sheets เท่านั้น

## ข้อควรทราบก่อนเปิดให้บริการจริง
- ระบบตรวจสอบสลิปเป็นการตรวจด้วยคนผ่าน Admin Panel ไม่ได้ยืนยันการโอนจากธนาคารโดยอัตโนมัติ
- ยังไม่ได้เชื่อม API ผู้ให้บริการเติมเกมเพื่อส่งคำสั่งเติมโดยอัตโนมัติ สถานะ Completed เป็นการอนุมัติของแอดมิน
- ต้องตั้งค่า `PROMPTPAY_ID` ของร้านเองก่อนแสดง QR สำหรับรับเงิน อย่าใช้ QR หรือบัญชีของบุคคลอื่น
- ใน production สลิปและรูปภาพถูกเก็บใน Drive แบบ Private; สลิปอ่านได้ผ่าน Admin-only API เท่านั้น ส่วนรูปหน้าร้านอ่านผ่าน media proxy หลังตรวจว่ามีการอ้างอิงจาก package/promotion ที่ active
- ใช้ HTTPS, สำรองฐานข้อมูลและไฟล์สลิป, จำกัดสิทธิ์เข้าถึงเซิร์ฟเวอร์ และตรวจสอบนโยบายเก็บข้อมูลส่วนบุคคล
- Admin API ตรวจสอบ Origin สำหรับคำขอเปลี่ยนแปลงข้อมูล และส่ง Content Security Policy แบบ Report-Only เพื่อเก็บผลก่อนบังคับใช้


### เงื่อนไขคูปองแบบกำหนดเอง
หน้าแอดมินรองรับการจำกัดคูปองตามเกม, UID ที่ระบุไว้ และยอดเติมสะสมขั้นต่ำของ UID ในเกมนั้น โดยนับเฉพาะออเดอร์ที่สถานะ Completed (หลังหักส่วนลด) ดูรายละเอียดและข้อจำกัดได้ที่ [คู่มือ Google Apps Script](docs/GOOGLE_APPS_SCRIPT_SETUP.md).
