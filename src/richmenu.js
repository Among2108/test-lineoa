import axios from 'axios';
import fs from 'fs';

const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

async function createRichMenu() {
  const richMenuData = {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "MaiPaws Main Menu",
   chatBarText: "เมนู MaiPaws",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 1250, height: 843 },
        action: { type: "message", text: "สั่งซื้อสินค้า" } // ปุ่มบนซ้าย
      },
      {
        bounds: { x: 1250, y: 0, width: 1250, height: 843 },
        action: { type: "uri", uri: "https://liff.line.me/2009538837-NFjGJpwi" } // ปุ่มบนขวา (เปิด LIFF)
      },
      {
        bounds: { x: 0, y: 843, width: 1250, height: 843 },
        action: { type: "message", text: "ติดต่อแอดมิน" } // ปุ่มล่างซ้าย
      },
      {
        bounds: { x: 1250, y: 843, width: 1250, height: 843 },
        action: { type: "message", text: "เช็คพัสดุ" } // ปุ่มล่างขวา
      }
    ]
  };

  try {
    // 1. สร้าง Rich Menu ID
    const res = await axios.post('https://api.line.me/v2/bot/richmenu', richMenuData, {
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
    });
    const richMenuId = res.data.richMenuId;
    console.log("✅ Step 1: Rich Menu Created. ID:", richMenuId);

    // 2. อัปโหลดรูปภาพ (ต้องเป็นไฟล์ .png หรือ .jpg ขนาด 2500x1686)
    const imagePath = './public/richmenu-image.png'; // เตรียมรูปไว้ในโฟลเดอร์นี้
    const buffer = fs.readFileSync(imagePath);
    await axios.post(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, buffer, {
      headers: { 
        'Authorization': `Bearer ${TOKEN}`, 
        'Content-Type': 'image/png' 
      }
    });
    console.log("✅ Step 2: Image Uploaded.");

    // 3. สั่งให้เป็น Default สำหรับทุกคน
    await axios.post(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {}, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    console.log("✅ Step 3: Rich Menu Set as Default!");

  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
  }
}

createRichMenu();