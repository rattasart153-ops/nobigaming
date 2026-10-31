Vercel + Google Apps Script / Sheets / Drive

เป้าหมาย

- ใช้ Vercel เป็นโฮสต์เว็บไซต์
- ใช้ Google Account เดิม ไม่สมัครบริการใหม่
- ใช้ Google Sheets เป็นฐานข้อมูล
- ใช้ Google Drive เก็บไฟล์สลิปและรูปภาพแบบส่วนตัว
- รักษาหน้าร้านและหน้าแอดมินเดิมให้มากที่สุด
- ไม่แก้ไข Branch main

สถาปัตยกรรม

1. Vercel ให้บริการหน้าเว็บและ API
2. Google Apps Script ทำหน้าที่เป็น API สำหรับจัดการข้อมูล
3. Google Sheets เก็บข้อมูล admins, games, packages, coupons, promotions, orders และ sessions
4. Google Drive เก็บไฟล์ภาพและสลิป โดยไม่เปิดสิทธิ์สาธารณะ
5. ใช้ LockService ควบคุมการเขียนข้อมูลพร้อมกัน
6. Express API บน Vercel ทำหน้าที่เชื่อมต่อกับ Apps Script และรักษา API เดิม

ข้อจำกัด

- Google Sheets ไม่ใช่ฐานข้อมูล SQL และไม่มี transaction แบบ SQLite
- Apps Script มีโควตาและเวลาประมวลผลจำกัด
- ต้องทดสอบการสร้างออเดอร์ การใช้คูปอง และการเปลี่ยนสถานะก่อนใช้งานจริง
- ห้ามใช้ไฟล์ SQLite บน Vercel เป็นฐานข้อมูลถาวร
- ห้ามเปิดไฟล์สลิปให้บุคคลทั่วไปเข้าถึง
- ห้ามนำ OAuth secrets หรือ token ไปเก็บใน GitHub

ลำดับการพัฒนา

1. สร้าง Apps Script API และโครงสร้าง Google Sheets
2. สร้างระบบเชื่อมต่อจาก Express บน Vercel
3. ย้ายระบบอัปโหลดภาพไป Google Drive
4. เพิ่มการตั้งค่า Vercel และ Environment Variables
5. ทดสอบระบบร้านค้าและระบบแอดมินทั้งหมด
6. Deploy เมื่อผ่านการทดสอบแล้วเท่านั้น

ความปลอดภัย

- เปลี่ยนรหัสผ่านแอดมินเริ่มต้น
- ตั้ง SESSION_SECRET ใหม่
- ใช้ HTTPS
- เก็บสลิปเป็นไฟล์ส่วนตัว
- ตรวจสอบสิทธิ์ทุก API ที่เกี่ยวข้องกับแอดมิน
