# API Endpointlarini Aniqlash — Qadamma-qadam

## Nega bu kerak?

`new.openbudget.uz` — SPA (Single Page Application). Barcha ma'lumotlar API orqali yuklanadi.
Hozirgi promptlardagi endpoint nomlar TAXMINIY — haqiqiy nomlarni siz aniqlashingiz kerak.

## Qadamlar:

### 1. Chrome DevTools ochish

```
1. Chrome brauzerda oching: 
   https://new.openbudget.uz/uz/initiative-budget/active-initiatives/55/2f9c2e42-2e3c-46cb-a5af-bc7976cc0dec

2. F12 yoki Ctrl+Shift+I bosing (DevTools ochiladi)

3. "Network" tab'ini tanlang

4. "Fetch/XHR" filtrni bosing (faqat API so'rovlarni ko'rish uchun)

5. Sahifani yangilang (F5)
```

### 2. Sahifa yuklanishidagi so'rovlarni yozib olish

Sahifa yuklanganda ko'rinadigan API so'rovlar:
- Loyiha ma'lumotlari (nomi, tavsifi, ovozlar soni)
- Viloyat/tuman ma'lumotlari
- Captcha konfiguratsiyasi

**Har bir so'rov uchun yozib oling:**
- URL (masalan: `/api/v2/initiative/get?uuid=...`)
- Method (GET/POST)
- Request Headers (ayniqsa Authorization, Cookie, X-Token)
- Response body (JSON tuzilmasi)

### 3. Ovoz berish oqimini kuzatish

```
1. "Ovoz berish" tugmasini bosing
2. Network tab'da yangi so'rovlarni kuzating:
   
   So'rov #1 — Captcha olish:
   - URL: ???
   - Method: GET/POST
   - Response: { imageA: "...", imageB: "...", session: "..." }
   
3. Captchani yeching (rasmda to'g'ri joyni bosing)

4. Telefon raqam kiriting va "Yuborish" bosing:
   
   So'rov #2 — Kod yuborish:
   - URL: ???
   - Method: POST
   - Body: { phone: "+998...", captcha: {...}, initiative: "..." }
   - Response: { token: "...", gr_token: "..." }

5. SMS kodni kiriting va tasdiqlang:
   
   So'rov #3 — OTP tasdiqlash:
   - URL: ???
   - Method: POST
   - Body: { code: "1234", token: "..." }
   - Response: { success: true, message: "..." }
```

### 4. cURL bilan test qilish

Har bir topilgan endpointni cURL bilan sinab ko'ring:

```bash
# Captcha olish
curl -X GET "https://new.openbudget.uz/api/v2/..." \
  -H "Accept: application/json" \
  -H "User-Agent: Mozilla/5.0" \
  -v

# Kod yuborish
curl -X POST "https://new.openbudget.uz/api/v2/..." \
  -H "Content-Type: application/json" \
  -d '{"phone":"+998901234567","captcha":{...}}' \
  -v

# OTP tasdiqlash
curl -X POST "https://new.openbudget.uz/api/v2/..." \
  -H "Content-Type: application/json" \
  -d '{"code":"1234","token":"..."}' \
  -v
```

### 5. OpenBudgetAPI PyPI kutubxonasidan o'rganish

Mavjud Python kutubxona (`pip install OpenBudgetAPI`) ichidagi kodni o'qib, 
haqiqiy endpoint va parametrlarni aniqlash mumkin:

```bash
pip install OpenBudgetAPI
python -c "import openbudget; import inspect; print(inspect.getsource(openbudget))"
```

Yoki GitHub'da: https://github.com/bultakov/openbudget

### 6. Topilgan endpointlarni `openbudget.service.ts` ga kiritish

Haqiqiy endpointlarni topganingizdan keyin, `03-openbudget-service.md` dagi 
taxminiy URL'larni haqiqiylariga almashtiring.

## Ehtimoliy endpoint tuzilmasi:

```
Eski sayt (openbudget.uz):
  POST /api/v2/initiative/send-code
  POST /api/v2/initiative/verify

Yangi sayt (new.openbudget.uz):
  GET  /api/initiatives/{uuid}/captcha
  POST /api/initiatives/{uuid}/send-otp
  POST /api/initiatives/{uuid}/verify-otp
  
  yoki
  
  GET  /api/v3/captcha?initiative_uuid=...
  POST /api/v3/vote/send-code
  POST /api/v3/vote/verify
```

## Maslahat:

- Saytning JavaScript bundle'ini ham tekshiring (`Sources` tab → `webpack://` → `api` qidiruv)
- `XHR Breakpoint` qo'yib, har bir API chaqiruvda to'xtash mumkin
- Agar CORS xatolik bo'lsa, proxy server ishlatish kerak
