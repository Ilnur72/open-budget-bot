# 05 — Telegram Mini App: Captcha Yechish UI

## Vazifa

Telegram WebApp (Mini App) orqali captcha rasmini foydalanuvchiga ko'rsatish va yechimini qaytarish.

OpenBudget captchasi: 2 ta rasm ko'rsatiladi (A va B). Foydalanuvchi A rasmdagi ob'ektni B rasmda topib, ustiga bosishi kerak. Natija — `points` (koordinatalar).

## Fayl: `src/webapp/captcha.html`

```html
<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Captcha</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--tg-theme-bg-color, #fff);
      color: var(--tg-theme-text-color, #000);
      padding: 16px;
      min-height: 100vh;
    }
    
    h2 {
      font-size: 18px;
      font-weight: 500;
      margin-bottom: 8px;
      text-align: center;
    }
    
    p {
      font-size: 14px;
      color: var(--tg-theme-hint-color, #999);
      text-align: center;
      margin-bottom: 16px;
    }
    
    .captcha-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
    }
    
    .image-wrapper {
      position: relative;
      width: 100%;
      max-width: 340px;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid var(--tg-theme-hint-color, #ddd);
    }
    
    .image-wrapper.active {
      border-color: var(--tg-theme-button-color, #007aff);
    }
    
    .image-wrapper img {
      width: 100%;
      display: block;
      user-select: none;
      -webkit-user-drag: none;
    }
    
    .label {
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(0,0,0,0.6);
      color: #fff;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
    }
    
    .marker {
      position: absolute;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 3px solid #ff3b30;
      background: rgba(255,59,48,0.3);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    
    .status {
      text-align: center;
      font-size: 14px;
      padding: 8px;
      border-radius: 8px;
      margin-top: 8px;
    }
    
    .status.success {
      background: rgba(52,199,89,0.15);
      color: #34c759;
    }
    
    .status.error {
      background: rgba(255,59,48,0.15);
      color: #ff3b30;
    }
    
    .loading {
      text-align: center;
      padding: 40px;
    }
    
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--tg-theme-hint-color, #ddd);
      border-top-color: var(--tg-theme-button-color, #007aff);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 12px;
    }
    
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

<div id="loading" class="loading">
  <div class="spinner"></div>
  <p>Captcha yuklanmoqda...</p>
</div>

<div id="captcha" style="display:none">
  <h2>Captchani yeching</h2>
  <p id="instruction">A rasmdagi ob'ektni B rasmda toping va ustiga bosing</p>
  
  <div class="captcha-container">
    <div class="image-wrapper">
      <span class="label">A rasm (namuna)</span>
      <img id="imageA" alt="Captcha A" crossorigin="anonymous">
    </div>
    
    <div class="image-wrapper active" id="imageBWrapper">
      <span class="label">B rasm (ustiga bosing)</span>
      <img id="imageB" alt="Captcha B" crossorigin="anonymous">
    </div>
  </div>
  
  <div id="statusMsg"></div>
</div>

<script>
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();

  // URL params dan initiative ID olish
  const params = new URLSearchParams(window.location.search);
  const initiativeUuid = params.get('initiative');

  const points = [];
  let sessionData = null;

  // Captchani yuklash
  async function loadCaptcha() {
    try {
      // Serverdan captcha olish
      // Backend endpoint: GET /api/captcha?initiative=UUID
      const response = await fetch(`/api/captcha?initiative=${initiativeUuid}`);
      const data = await response.json();

      document.getElementById('imageA').src = data.imageA;
      document.getElementById('imageB').src = data.imageB;
      sessionData = data.sessionData;

      if (data.instruction) {
        document.getElementById('instruction').textContent = data.instruction;
      }

      document.getElementById('loading').style.display = 'none';
      document.getElementById('captcha').style.display = 'block';

      // MainButton sozlash
      tg.MainButton.setText('✅ Tasdiqlash');
      tg.MainButton.hide();
    } catch (error) {
      document.getElementById('loading').innerHTML =
        '<p class="status error">Captcha yuklanmadi. Qaytadan urinib ko\'ring.</p>';
    }
  }

  // B rasmda bosish
  document.getElementById('imageBWrapper').addEventListener('click', function(e) {
    const img = document.getElementById('imageB');
    const rect = img.getBoundingClientRect();

    // Nisbiy koordinatalar (0-1 oralig'ida)
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Oldingi markerlarni tozalash (faqat 1 nuqta kerak)
    const oldMarkers = this.querySelectorAll('.marker');
    oldMarkers.forEach(m => m.remove());
    points.length = 0;

    // Yangi marker qo'yish
    const marker = document.createElement('div');
    marker.className = 'marker';
    marker.style.left = `${x * 100}%`;
    marker.style.top = `${y * 100}%`;
    this.appendChild(marker);

    points.push({ x: Math.round(x * img.naturalWidth), y: Math.round(y * img.naturalHeight) });

    // MainButton ko'rsatish
    tg.MainButton.show();

    const statusMsg = document.getElementById('statusMsg');
    statusMsg.className = 'status success';
    statusMsg.textContent = '✅ Nuqta belgilandi. "Tasdiqlash" tugmasini bosing.';
  });

  // Tasdiqlash
  tg.MainButton.onClick(function() {
    if (points.length === 0) {
      tg.showAlert('B rasmda nuqtani belgilang!');
      return;
    }

    // Natijani botga qaytarish
    const result = {
      points: points,
      sessionData: sessionData,
    };

    tg.sendData(JSON.stringify(result));
  });

  // Boshlash
  loadCaptcha();
</script>

</body>
</html>
```

## Backend endpoint captcha uchun:

```typescript
// src/bot/bot.controller.ts (yoki alohida controller)
import { Controller, Get, Query } from '@nestjs/common';
import { OpenBudgetService } from '../openbudget/openbudget.service';

@Controller('api')
export class CaptchaController {
  constructor(private openBudgetService: OpenBudgetService) {}

  @Get('captcha')
  async getCaptcha(@Query('initiative') initiative: string) {
    const captcha = await this.openBudgetService.getCaptchaPage();
    return {
      imageA: captcha.imageA,   // base64 yoki URL
      imageB: captcha.imageB,
      sessionData: captcha.sessionData,
    };
  }
}
```

## Talablar:

1. WebApp Telegram SDK (`telegram-web-app.js`) dan to'g'ri foydalanish
2. `tg.sendData()` orqali captcha yechimini botga qaytarish
3. Responsive design — har qanday telefonda to'g'ri ko'rinishi
4. Foydalanuvchi nechta nuqta bosish kerakligini tushunishi uchun aniq ko'rsatma
5. Kuzatish: ba'zi captchalar 1 nuqta, ba'zilari bir nechta nuqta talab qiladi
6. HTTPS talab qilinadi — ngrok yoki certbot bilan SSL o'rnatish
7. `MainButton` va `BackButton` to'g'ri boshqarish
