# 03 — OpenBudget API Integratsiya Servisi

## Vazifa

`openbudget.service.ts` — `new.openbudget.uz` API bilan ishlash uchun servis yarat.

## Muhim: API oqimi

OpenBudget.uz yangi versiyasida ovoz berish 3 bosqichdan iborat:

### 1-bosqich: Captcha olish
Saytdagi ovoz berish sahifasiga so'rov yuborilganda, 2 ta rasm (A va B) qaytariladi.
Foydalanuvchi A rasmdagi nuqtaga mos keluvchi B rasmdagi nuqtani topishi kerak.
Captcha natijasi — `points` (koordinatalar massivi).

### 2-bosqich: Telefon + Captcha yuborish
Telefon raqam va captcha yechimi yuboriladi → javobda `gr_token` qaytadi.
Shu paytda foydalanuvchi telefoniga SMS kod keladi.

### 3-bosqich: OTP tasdiqlash
SMS kod + `gr_token` yuboriladi → ovoz qabul qilinadi.

## Servis kodi:

```typescript
// src/openbudget/openbudget.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface CaptchaPage {
  imageA: string;       // base64 encoded image
  imageB: string;       // base64 encoded image
  sessionData: any;     // saytdan qaytgan session ma'lumotlari
  html?: string;        // to'liq captcha HTML (WebApp uchun)
}

export interface CaptchaSubmitResult {
  success: boolean;
  grToken: string;      // OTP tasdiqlash uchun kerak
  message?: string;
}

export interface OtpVerifyResult {
  success: boolean;
  message: string;
}

@Injectable()
export class OpenBudgetService {
  private readonly logger = new Logger(OpenBudgetService.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly initiativeUrl: string;

  constructor(private config: ConfigService) {
    this.baseUrl = this.config.get('OPENBUDGET_BASE_URL');
    this.initiativeUrl = this.config.get('INITIATIVE_URL');

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
        'Accept': 'application/json, text/html',
        'Accept-Language': 'uz,ru;q=0.9',
        'Referer': this.initiativeUrl,
      },
    });
  }

  /**
   * 1-bosqich: Captcha sahifasini olish
   * 
   * Saytning network tab'idan aniq endpointni topish kerak.
   * Taxminiy endpoint: /api/v2/initiative/captcha yoki /api/captcha
   * 
   * MUHIM: Bu endpointni saytda DevTools > Network tab orqali aniqlash kerak!
   * Quyidagi kod taxminiy — haqiqiy endpointga moslashtirilishi shart.
   */
  async getCaptchaPage(): Promise<CaptchaPage> {
    try {
      // Variant 1: Agar sayt alohida captcha endpoint bersa
      const response = await this.client.get('/api/v2/initiative/captcha', {
        params: {
          url: this.initiativeUrl,
        },
      });

      return {
        imageA: response.data.imageA || response.data.image_a,
        imageB: response.data.imageB || response.data.image_b,
        sessionData: response.data.session || response.data,
      };
    } catch (error) {
      this.logger.error('Captcha olishda xatolik', error.message);
      
      // Variant 2: To'liq sahifani parse qilish
      const pageResponse = await this.client.get(
        `/uz/initiative-budget/active-initiatives/${this.config.get('DISTRICT_ID')}/${this.config.get('INITIATIVE_UUID')}`
      );
      
      // HTML dan captcha rasmlarini ajratib olish logikasi
      // Bu yerda cheerio ishlatish mumkin
      throw new Error('Captcha endpoint aniqlanmagan — DevTools bilan tekshiring');
    }
  }

  /**
   * 2-bosqich: Telefon raqam + captcha yechimini yuborish
   */
  async submitCaptcha(
    phoneNumber: string,
    points: { x: number; y: number }[],
    sessionData?: any,
  ): Promise<CaptchaSubmitResult> {
    try {
      const formattedPhone = this.formatPhone(phoneNumber);
      
      const response = await this.client.post('/api/v2/initiative/send-code', {
        phone: formattedPhone,
        points: points,
        initiative_uuid: this.config.get('INITIATIVE_UUID'),
        district_id: this.config.get('DISTRICT_ID'),
        ...sessionData,
      });

      return {
        success: true,
        grToken: response.data.gr_token || response.data.token,
        message: response.data.message,
      };
    } catch (error) {
      this.logger.error('Captcha yuborishda xatolik', error.response?.data);
      return {
        success: false,
        grToken: '',
        message: error.response?.data?.message || 'Xatolik yuz berdi',
      };
    }
  }

  /**
   * 3-bosqich: OTP kodni tasdiqlash
   */
  async verifyOtp(otpCode: string, grToken: string): Promise<OtpVerifyResult> {
    try {
      const response = await this.client.post('/api/v2/initiative/verify-otp', {
        otp_code: otpCode,
        gr_token: grToken,
      });

      return {
        success: true,
        message: response.data.message || 'Ovoz muvaffaqiyatli berildi!',
      };
    } catch (error) {
      this.logger.error('OTP tasdiqlashda xatolik', error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || 'Kod noto\'g\'ri yoki muddati o\'tgan',
      };
    }
  }

  /**
   * Telefon raqamni formatlash: +998XXXXXXXXX
   */
  private formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('998')) return `+${cleaned}`;
    if (cleaned.startsWith('8') && cleaned.length === 10) return `+998${cleaned.slice(1)}`;
    if (cleaned.length === 9) return `+998${cleaned}`;
    return `+${cleaned}`;
  }
}
```

## Talablar:

1. API endpointlarini `new.openbudget.uz` saytidan DevTools Network tab orqali aniqla
2. Saytda brauzer ochib, ovoz berish tugmasini bos, va qaysi API endpoint chaqirilishini kuzat
3. Har bir so'rov uchun retry logikasi qo'sh (3 marta)
4. Rate limiting: bir raqamdan kuniga 1 marta ovoz (sayt cheklovi)
5. Request/response loglarni saqla

## API endpointlarini aniqlash bo'yicha ko'rsatma:

```
1. Chrome DevTools → Network tab → Fetch/XHR filtrini tanlang
2. new.openbudget.uz/uz/initiative-budget/active-initiatives/55/... sahifasini oching
3. "Ovoz berish" tugmasini bosing
4. Network tab'da ko'ringan so'rovlarni kuzating:
   - Captcha olish so'rovi (GET yoki POST)
   - Telefon yuborish so'rovi (POST)
   - OTP tasdiqlash so'rovi (POST)
5. Har bir so'rovning URL, headers, body, response'ini yozib oling
6. Shu ma'lumotlarni yuqoridagi servisga moslang
```
