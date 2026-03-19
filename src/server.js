import express from 'express';
import * as line from '@line/bot-sdk';
import path from 'path';
import { fileURLToPath } from 'url';

// --- 1. SETUP พื้นฐาน ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express(); // สร้าง app ก่อนเสมอ

// บอกให้ Express รู้จักโฟลเดอร์ public สำหรับหน้าเว็บ LIFF
app.use(express.static('public'));

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

// --- 2. ฟังก์ชัน AI (เหมือนเดิม) ---
async function analyzeOrderWithAI(userText) {
  const apiKey = process.env.GEMINI_API_KEY;
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  
  try {
    const listRes = await fetch(listUrl);
    const listData = await listRes.json();
    const availableModel = listData.models?.find(m => m.supportedGenerationMethods.includes("generateContent"))?.name;

    if (!availableModel) return null;

    const runUrl = `https://generativelanguage.googleapis.com/v1beta/${availableModel}:generateContent?key=${apiKey}`;
    const response = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `วิเคราะห์ข้อความสั่งซื้อ: "${userText}" 
                  ตอบเป็น JSON เท่านั้น ห้ามมีคำบรรยาย: 
                  {"itemName": "ชื่อสินค้า", "quantity": 1, "totalPrice": 100}
                  ถ้าไม่ใช่การสั่งซื้อให้ตอบ null`
          }]
        }]
      })
    });

    const data = await response.json();
    const aiText = data.candidates[0].content.parts[0].text;
    const cleanJson = aiText.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("❌ AI Error:", error.message);
    return null;
  }
}

async function analyzeSlipWithAI(messageId) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  try {
    // 1. ดึงไฟล์รูปภาพจาก LINE Server
    const responseStream = await client.getMessageContent(messageId);
    const chunks = [];
    for await (const chunk of responseStream) { chunks.push(chunk); }
    const buffer = Buffer.concat(chunks);
    const base64Image = buffer.toString('base64');

    // 2. ส่งรูปไปให้ Gemini วิเคราะห์ (OCR)
    const runUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "นี่คือสลิปโอนเงินใช่ไหม? ถ้าใช่ ช่วยสรุป: ธนาคาร, วันที่เวลา, จำนวนเงิน (บาท), และชื่อผู้รับโอน มาเป็น JSON เท่านั้น ถ้าไม่ใช่สลิปตอบ null" },
            { inline_data: { mime_type: "image/png", data: base64Image } }
          ]
        }]
      })
    });

    const data = await response.json();
    const aiText = data.candidates[0].content.parts[0].text;
    const cleanJson = aiText.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanJson);

  } catch (error) {
    console.error("❌ OCR Error:", error.message);
    return null;
  }
}

// --- 3. หน้าตาบิล (Flex Message) ---
function createFlexBill(order) {
  return {
    type: 'flex',
    altText: `บิลค่าสินค้า: ${order.itemName}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: 'MAIPAWS SHOP', weight: 'bold', color: '#1DB446', size: 'sm' },
          { type: 'text', text: 'ใบเสนอราคา', weight: 'bold', size: 'xl', margin: 'md' },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm', contents: [
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'สินค้า', color: '#555555', flex: 2 },
                  { type: 'text', text: `${order.itemName} x${order.quantity}`, align: 'end', flex: 4 }
                ]
              },
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'ยอดรวม', color: '#555555' },
                  { type: 'text', text: `฿${order.totalPrice}`, align: 'end', weight: 'bold' }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', contents: [
          {
            type: 'button', style: 'primary', color: '#1DB446',
            action: { 
                type: 'uri', 
                label: 'ชำระเงิน', 
                // ตรงนี้อย่าลืมแก้เป็นลิงก์ LIFF ของคุณ (https://liff.line.me/xxxx)
                uri: 'https://liff.line.me/2009538837-NFjGJpwi' 
            }
          }
        ]
      }
    }
  };
}

// --- 4. ROUTES ---

// หน้าสำหรับทดสอบ LIFF ผ่าน Browser
app.get('/liff', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/checkout.html'));
});

// Webhook สำหรับ LINE
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  console.log(`📩 ข้อความเข้า: ${event.message.text}`);

  const orderData = await analyzeOrderWithAI(event.message.text);

  if (orderData) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [createFlexBill(orderData)]
    });
  } else {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'รับทราบครับ มีอะไรให้ MaiPaws ช่วยเพิ่มเติมไหมครับ?' }]
    });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server พร้อมรันที่พอร์ต ${PORT}`);
});