> **เอกสารเดิม / ถูกแทนที่แล้ว (2026-11-05):** ผู้ใช้เลือก Vercel + Neon PostgreSQL + Vercel Blob Private แล้ว ไม่ต้องทำตามคู่มือนี้ ไม่ต้องสร้าง Apps Script API, Sheets หรือ Drive สำหรับสถาปัตยกรรมใหม่ ไฟล์นี้เก็บไว้เป็นข้อมูลอ้างอิงระหว่างย้ายระบบเท่านั้น ดูแผนปัจจุบันที่ [POSTGRES_MIGRATION_PLAN.md](./POSTGRES_MIGRATION_PLAN.md)

# Nobi Topup — Vercel + Google Apps Script / Sheets / Drive

สถานะเอกสาร: คู่มือสถาปัตยกรรมและการตั้งค่าล่วงหน้า **ยังไม่ใช่คำสั่ง Deploy หรือเปิดใช้ระบบจริง**

## เป้าหมาย

- ใช้ Vercel ให้บริการหน้าเว็บและ REST API
- ใช้ Google Account เดิม ไม่ต้องสมัครบริการใหม่
- ใช้ Google Sheets เป็นแหล่งข้อมูลถาวร
- ใช้ Google Drive เก็บสลิปและรูปภาพแบบ Private
- รักษาหน้าร้านและหน้าแอดมินเดิม พร้อมรองรับ Guest checkout
- ทำงานเฉพาะ Branch vercel-drive-setup; ห้ามแก้ไข main

## สถาปัตยกรรมปัจจุบันของ Branch

1. Vercel ให้บริการไฟล์หน้าเว็บและ Express REST API
2. Express เรียก Apps Script ผ่าน Signed HTTP Gateway ด้วย HMAC-SHA256, timestamp และ nonce
3. Apps Script เป็นเจ้าของ Business Logic และข้อมูลใน Sheets
4. Sheets ใช้ Schema Version 1 พร้อม repository ที่ตรวจ header/field และใช้ ScriptLock สำหรับการเขียน
5. Drive เก็บสลิปในโฟลเดอร์ส่วนตัว และเก็บรูปภาพในโฟลเดอร์ส่วนตัวอีกชุด
6. Vercel ส่งไฟล์ผ่าน API proxy; ไม่เปิด Drive sharing เป็น Public
7. Vercel production จะไม่เริ่ม SQLite fallback หากไม่มี Apps Script gateway configuration

## ข้อมูลที่เก็บใน Sheets

- Admins และ Admin sessions
- Members, Member sessions และ Member login/IP history
- Games และ packages
- Coupons และ coupon redemptions
- Promotions
- Orders
- Admin audit logs
- Idempotency records
- Gateway nonces, HMAC-keyed shared rate-limit buckets และ system metadata

เงินที่เก็บใน Schema v1 ใช้หน่วยสตางค์ (ฟิลด์ที่ลงท้ายด้วย _satang) เพื่อหลีกเลี่ยงปัญหาทศนิยม

## Drive folders และ Script Properties

สร้างโฟลเดอร์ Drive สองโฟลเดอร์ด้วย Google Account เดิม และคงสิทธิ์เป็น Private:

- โฟลเดอร์สลิป: กำหนด ID ใน Script Property ชื่อ NOBI_PRIVATE_DRIVE_FOLDER_ID
- โฟลเดอร์รูปภาพสินค้า/โปรโมชั่น: กำหนด ID ใน Script Property ชื่อ NOBI_PRIVATE_MEDIA_FOLDER_ID

ตั้งค่า Script Properties เพิ่มเติม:

| Property | จุดประสงค์ |
|---|---|
| NOBI_GATEWAY_SECRET | Shared secret อย่างน้อย 32 ตัวอักษร ใช้ร่วมกับ Vercel |
| NOBI_PRIVATE_DRIVE_FOLDER_ID | โฟลเดอร์ Private สำหรับสลิป |
| NOBI_PRIVATE_MEDIA_FOLDER_ID | โฟลเดอร์ Private สำหรับรูปภาพ |
| NOBI_ADMIN_USERNAME | Username สำหรับ bootstrap Admin ครั้งแรก |
| NOBI_ADMIN_PASSWORD | รหัสผ่าน bootstrap อย่างน้อย 14 ตัวอักษร; ระบบลบ property นี้หลังสร้าง Admin สำเร็จ |
| NOBI_PROMPTPAY_ID | PromptPay ID สำหรับสร้าง QR ผ่าน Express เมื่อพร้อมเปิดใช้จริง |

ห้ามใส่ค่า secret, password, PromptPay จริง หรือ Drive ID ลงใน GitHub

## Vercel Environment Variables

กำหนดใน Project Settings → Environment Variables:

| Variable | ค่า |
|---|---|
| APPS_SCRIPT_URL | URL Web App ของ Apps Script ที่ลงท้ายด้วย /exec |
| APPS_SCRIPT_SHARED_SECRET | ค่าเดียวกับ NOBI_GATEWAY_SECRET |
| APPS_SCRIPT_TIMEOUT_MS | ค่าเริ่มต้น 30000 ms |
| PROMPTPAY_ID | PromptPay ID เฉพาะเมื่อได้รับอนุญาตให้ทดสอบการชำระเงินจริง |

ใน Vercel/production ห้ามใช้ SQLite, local session store หรือ local uploads เป็นแหล่งข้อมูลถาวร หากไม่มี Apps Script configuration ระบบจะหยุดทำงานแบบ fail-closed

## Workflow ที่เตรียมไว้ใน Source Code

- Catalog และ Promotions อ่านจาก Schema v1
- Coupon ตรวจสอบวันหมดอายุ, ยอดขั้นต่ำ, เกม, UID allowlist, สมาชิก และยอดเติมสะสมรายเกม
- Order สร้าง Pending ก่อน และส่งสลิปแยกภายหลังด้วย one-time checkout token
- Order ที่ไม่มีคูปองหรือใช้คูปองไม่มีวันหมดอายุมีเวลา 15 นาที
- Order ที่ใช้คูปองมีวันหมดอายุให้เวลาถึงสิ้นวันนั้นตามเวลา Asia/Bangkok
- Coupon capacity ถูก Reserve เมื่อสร้าง Pending, Consume เมื่อ Completed และ Release เมื่อ Rejected/Expired
- Admin และ Member sessions เก็บ token hash, อายุสูงสุด 8 ชั่วโมง, idle timeout 30 นาที และ revoke เมื่อ logout/เปลี่ยนรหัสผ่าน
- Member Login ID เป็น ASCII English letters/digits 4–30 ตัว ไม่แยกตัวพิมพ์เล็ก/ใหญ่
- Admin ดู Member login/IP history ได้; เก็บประวัติและ Admin audit logs 90 วัน
- Shared login IP throttling ใช้ Sheets ledger ที่เก็บ HMAC bucket hash เท่านั้น: login 10 ครั้ง/15 นาที, registration 5 ครั้ง/15 นาที และ account failures 5 ครั้ง/15 นาที
- รหัสผ่านใช้ PBKDF2-SHA256 120,000 iterations; ต้อง benchmark ใน Apps Script runtime จริงก่อนใช้งาน
- สลิปและรูปภาพเก็บใน Drive แบบ Private และส่งผ่าน API proxy ที่ตรวจสิทธิ์; จำกัดไฟล์แต่ละรายการไม่เกิน 3 MB เพื่อเผื่อ Base64/JSON overhead ภายใต้ Vercel Function request/response body limit 4.5 MB

## ข้อจำกัดและ Release Gates

- Google Sheets ไม่มี transaction แบบ SQLite; workflow หลายแถวต้องมี recovery path และทดสอบ concurrency
- Apps Script มี execution/quota limits; ต้อง benchmark PBKDF2, file transfer, row scans และ LockService
- Node tests ยืนยัน API contract, schema behavior และ PBKDF2 reference vector แต่ยังไม่แทนการทดสอบใน Apps Script runtime จริง
- ต้องทดสอบ bad signature, stale timestamp, replay, concurrent nonce/order/coupon claims, quota และ Drive privacy
- ต้องทำ Browser/device end-to-end tests ของ Guest, Member, Admin, coupon, checkout, slip, status และ CRUD
- Vercel Function request/response payload จำกัด 4.5 MB; ห้ามเพิ่ม upload cap เป็น 5 MB โดยไม่ออกแบบ chunked upload/direct upload ใหม่
- ห้ามใช้สลิปจริงหรือเปิดรับออเดอร์จริงในการทดสอบ
- ห้าม Deploy Apps Script Web App หรือ Vercel production จนกว่าจะได้รับอนุญาตแยกต่างหาก

## ลำดับการเปิดใช้ (ยังไม่อนุญาตให้เริ่มขั้นตอน Live)

1. ตรวจ Source Code และ CI ให้ผ่านทั้งหมด
2. ทำ GAS runtime test project ด้วยข้อมูลสังเคราะห์
3. Benchmark PBKDF2 และ Apps Script execution time
4. ตรวจ Drive folder/file permissions และ proxy authorization
5. ตั้ง Script Properties และ Vercel Environment Variables
6. Initialize Schema v1 เฉพาะเมื่อผ่าน runtime gates และได้รับอนุญาต
7. Bootstrap Admin หลัง schema พร้อมและทดสอบแล้ว
8. ทำ end-to-end tests บนข้อมูลสังเคราะห์
9. ขออนุญาต Deploy/เปิดรับชำระเงินแยกต่างหาก

**ห้ามเรียก setupNobiDatabase() หรือ initializeAdmin() บนข้อมูลจริงก่อนผ่าน release gates ข้างต้น**
