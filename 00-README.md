# OpenBudget Ovoz Berish Telegram Bot

`new.openbudget.uz` platformasidagi "Tashabbusli Byudjet" loyihalariga Telegram
orqali ovoz berishni osonlashtiruvchi bot.

**Mahalla:** Tuman ID: 55, Tashabbus UUID: `2f9c2e42-2e3c-46cb-a5af-bc7976cc0dec`

---

## ⚠️ Ishga tushirishdan oldin

Loyiha **kod jihatidan tayyor**, lekin bitta blocker bor:

`src/openbudget/openbudget.endpoints.ts` dagi API yo'llari **tasdiqlanmagan**.
Brauzerda DevTools → Network (Fetch/XHR) bilan ovoz berish oqimini bosib o'ting
va o'sha fayldagi qiymatlarni haqiqiylariga almashtiring. Kodning boshqa
hech qayerini o'zgartirish kerak emas.

Tasdiqlagandan keyin `.env` ga `OPENBUDGET_ENDPOINTS_VERIFIED=true` qo'ying —
usiz ilova production rejimida **ataylab ishga tushmaydi**.

---

## Tech Stack

| Qatlam | Texnologiya |
|---|---|
| Runtime | Node.js 22 |
| Framework | NestJS 11 |
| Bot | grammY 1.45 + conversations 2.x |
| Database | PostgreSQL 16 + Prisma 7 (driver adapter) |
| Cache | Redis 7 (sessiya, limitlar, throttle) |
| Captcha UI | Telegram Mini App |
| Deploy | Docker + nginx |

## Ovoz berish oqimi

```
/vote → tasdiqlash → captcha (Mini App) → telefon → SMS kod → ovoz
```

Har bir bosqichda 5 daqiqa vaqt; javob kelmasa oqim bekor bo'ladi.

## Loyiha tuzilmasi

```
src/
├── bot/              Telegram qatlami (buyruqlar, conversation, admin, webhook)
├── openbudget/       openbudget.uz API, sessiya holati, ovoz limitlari
├── vote/             Ovoz yozuvlari, statistika, tashlab ketilganlarni tozalash
├── user/             Foydalanuvchilar
├── admin/            Admin uchun ma'lumot (bot bilan ishlamaydi)
├── webapp/           Captcha Mini App + initData verifikatsiyasi
├── health/           /health va /health/ready
├── common/           Prisma, Redis, throttle, logger, utillar
└── config/           Tiplangan konfiguratsiya (env validatsiyasi bilan)
```

## Ishga tushirish (development)

```bash
# Talab: Node 22+, PostgreSQL, Redis
npm ci
cp .env.example .env        # BOT_TOKEN va DATABASE_URL ni to'ldiring
npx prisma migrate dev
npm run start:dev
```

## Buyruqlar

```bash
npm run start:dev     # watch rejimida
npm run build         # production build
npm test              # unit testlar
npm run test:e2e      # PostgreSQL va Redis talab qiladi
npm run typecheck     # tsc --noEmit
npm run lint          # eslint --fix
```

## Deploy

[deploy/README.md](deploy/README.md) ga qarang — Docker, nginx, SSL va
yangilash tartibi o'sha yerda.

## Bot buyruqlari

| Buyruq | Kim uchun |
|---|---|
| `/start`, `/vote`, `/status`, `/help`, `/cancel` | hamma |
| `/admin`, `/stats`, `/today`, `/users`, `/recent`, `/broadcast`, `/export` | faqat `ADMIN_IDS` |

Admin buyruqlari oddiy foydalanuvchilarga *"Noma'lum buyruq"* deb javob beradi —
ularning mavjudligi oshkor bo'lmaydi.

## Muhim qarorlar

Loyiha davomida spetsifikatsiyadan ataylab chekinilgan joylar — sabablari bilan
kod izohlarida yozilgan. Eng muhimlari:

- **`sendCode` da qayta urinish yo'q** — 5xx/timeout'da takrorlash foydalanuvchiga
  bir necha SMS yuborardi.
- **Xatoliklar `conversation.external()` chegarasidan obyekt sifatida o'tadi** —
  `structuredClone` `Error` merosxo'rlarini yo'q qiladi.
- **`session()` middleware ishlatilmaydi** — u conversations bilan bir xil Redis
  kalitiga yozib, har chatning ikkinchi buyrug'idan keyin holatni buzardi.
- **Captcha reply keyboard orqali ochiladi** — inline tugmadan `web_app_data`
  umuman kelmaydi.
- **Eksportda telefon raqamlar maskalangan** — fayl Telegram serverida qoladi.
- **Loglar faylga emas, stdout'ga JSON** — konteynerda fayl anti-pattern.

## Hujjatlar

`01`–`07` raqamli fayllar — loyiha qurilgan bosqichlar spetsifikatsiyasi.
`GLOBAL-AGENTS.md` — kod yozishda ishlatiladigan agentlar va qoidalar.
`API-DISCOVERY.md` — endpointlarni aniqlash bo'yicha ko'rsatma.
