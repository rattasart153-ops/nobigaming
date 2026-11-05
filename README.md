# Nobi Topup — Full-Stack starter

เว็บไซต์เติมเกมภาษาไทย พร้อมหน้าร้าน ระบบสมาชิก/คูปอง QR PromptPay การแนบสลิป และ Admin Panel โดย Branch นี้กำลังปรับสถาปัตยกรรมเป้าหมายเป็น **Vercel + Neon PostgreSQL + Vercel Blob Private** ตามแนวทาง free-first

## สถานะปัจจุบัน

- Branch สำหรับพัฒนา: `vercel-drive-setup` เท่านั้น; ห้ามแก้ไข `main`.
- หน้า Storefront และ Admin ใช้ Express REST API แบบ same-origin แล้ว และต้องรักษา route/response contracts เดิมระหว่างย้ายระบบ
- Source ปัจจุบันยังผูก production runtime กับ Google Apps Script gateway และยังไม่พร้อมใช้งานบน Vercel จนกว่าจะพอร์ต persistence ไป PostgreSQL เสร็จ
- แผนการย้ายระบบฉบับหลัก: [docs/POSTGRES_MIGRATION_PLAN.md](docs/POSTGRES_MIGRATION_PLAN.md)
- สถาปัตยกรรมเป้าหมาย: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- ลำดับงานและสถานะ Phase: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)

## สถาปัตยกรรมเป้าหมาย

- **Vercel + Express:** ให้บริการหน้าเว็บและ same-origin REST API
- **Neon PostgreSQL:** เก็บ Admin, Members, sessions, games, packages, coupons, promotions, orders, audit logs, idempotency และ shared rate limits
- **Vercel Blob Private:** เก็บสลิปและรูปภาพแบบ Private; ทุกการอ่านผ่าน API ที่ตรวจสิทธิ์
- **SQLite:** ใช้ได้เฉพาะ local characterization/test adapter ไม่ใช้เป็น persistence บน Vercel/production
- **Google Apps Script / Sheets / Drive:** เป็นสถาปัตยกรรมเดิมที่ถูกแทนที่ในแผนใหม่ ไม่ต้องสร้างหรือ Deploy API ของ Apps Script

## Free-first และค่าใช้จ่าย

เริ่มต้นโดยประเมิน Neon Free และ Vercel Blob Hobby included usage ก่อน แต่ต้องตรวจสอบ quota, Marketplace billing mode, region และข้อกำหนดจริงในบัญชี Vercel ก่อนสร้าง resource ห้ามเปิด paid plan/add-on หรือยอมรับค่าใช้จ่ายเกิน quota โดยไม่ได้รับอนุญาต

Vercel Hobby มีข้อจำกัดการใช้งานเชิงพาณิชย์ จึงใช้เพื่อพัฒนา/ทดสอบตามเงื่อนไขปัจจุบันเท่านั้น ก่อนเปิดร้านเชิงพาณิชย์ต้องตรวจสอบแผนที่รองรับและขออนุมัติค่าใช้จ่ายที่อาจเกิดขึ้น

## ข้อกำหนดธุรกิจที่ต้องรักษา

- Guest checkout อนุญาต
- Member Login ID เป็น ASCII letters/digits 4–30 ตัว ไม่แยกตัวพิมพ์เล็ก/ใหญ่
- คูปองรองรับ public, member-only และ member-game-spend รวมถึง UID allowlist และยอดเติมสะสมรายเกม
- นับยอดสะสมจากออเดอร์ Completed เท่านั้น และใช้ยอดหลังหักส่วนลด
- Reserve coupon เมื่อ Pending, Consume เมื่อ Completed, Release เมื่อ Rejected/Expired
- ออเดอร์ปกติหรือคูปองที่ไม่มีวันหมดอายุ: ชำระและอัปโหลดสลิปภายใน 15 นาที
- คูปองที่มีวันหมดอายุ: ชำระและอัปโหลดสลิปได้ถึงสิ้นวันหมดอายุในเวลา Asia/Bangkok
- Server เป็นผู้คำนวณ deadline, ราคา, ส่วนลด และยอดชำระ
- สลิปที่รับก่อน deadline สามารถให้ Admin ตรวจและอนุมัติภายหลังได้
- Admin/Member sessions อายุสูงสุด 8 ชั่วโมง, idle timeout 30 นาที; revoke เมื่อ logout/เปลี่ยนรหัสผ่าน/ระงับบัญชี
- Admin ดู Member login/IP history ได้; เก็บ IP history และ Admin audit logs 90 วัน แล้วลบหรือทำให้ไม่สามารถระบุตัวบุคคลได้ถาวร
- สลิปและรูปภาพทั้งหมดต้องเป็น Private; สลิปอ่านได้เฉพาะ Admin และรูปหน้าร้านส่งผ่าน proxy ที่ตรวจ reference
- ตรวจสลิปด้วย Admin ด้วยตนเอง; ยังไม่มีการตรวจยอดโอนจากธนาคารอัตโนมัติหรือระบบเติมเกมอัตโนมัติ

## การพัฒนาและทดสอบ

- Node.js 22.x และ npm ตาม `package.json`
- ใช้ข้อมูลสังเคราะห์และรูปทดสอบเท่านั้น
- ต้องมี PostgreSQL migrations และ isolated test database ก่อนเปลี่ยน production adapter
- ห้าม fallback ไปใช้ SQLite ใน Vercel เมื่อ PostgreSQL ขัดข้อง
- ยังไม่อนุญาต Production deployment, การเปลี่ยนโดเมน, การตั้งค่า PromptPay จริง, การรับออเดอร์จริง หรือการ initialize ข้อมูลจริง

## Legacy documentation

คู่มือ `docs/GOOGLE_APPS_SCRIPT_SETUP.md` และ `docs/VERCEL_GOOGLE_SETUP.md` เป็นข้อมูลอ้างอิงของสถาปัตยกรรมเดิมเท่านั้น ไม่ใช่ขั้นตอนที่ต้องทำต่อสำหรับแนวทางใหม่
