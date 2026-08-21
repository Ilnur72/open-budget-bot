# 00-GLOBAL-AGENTS — Loyihani qurishda mavjud agentlarni ishlatish

## Vazifa

Quyidagi subagentlar mavjud. Loyihani qurishda har bir bosqichda kerakli agentni chaqirib ishlat. Agent nomini to'g'ri yoz — ular `~/.claude/agents/` papkasida (global) sozlangan, ya'ni barcha loyihalarda ishlaydi.

---

## Custom agentlar (loyihaga sozlangan):

| Agent | Qachon chaqirish |
|-------|------------------|
| `architect` | Katta feature rejalashtirish, modul chegaralari, design pattern tanlash |
| `backend-engineer` | NestJS/Node.js endpoint, servis, modul yozish — ASOSIY ISHCHI |
| `frontend-engineer` | React/TypeScript komponent, sahifa, UI xatolari (Captcha WebApp uchun) |
| `db-migrator` | Prisma schema, migratsiya, query optimizatsiya |
| `devops-engineer` | Dockerfile, CI/CD, deploy, container muammolari |
| `security-auditor` | Auth, IDOR, injection, secret, CORS — faqat tekshiradi |
| `performance-engineer` | Sekin endpoint, N+1, indeks, caching, xotira |
| `test-writer` | Jest unit va e2e testlar |
| `code-reviewer` | Kod sifati va best practice tekshiruvi |
| `debugger` | Stack trace, yiqilgan testlar, "ishlamayapti" holatlari |
| `orchestrator` | Ko'p yo'nalishli ishni bo'lib, agentlarga taqsimlaydi |

## Tizim agentlari:

| Agent | Qachon chaqirish |
|-------|------------------|
| `general-purpose` | Umumiy ko'p bosqichli vazifalar, qidiruv |
| `Explore` | Faqat o'qiydigan keng qamrovli fayl qidiruvi |
| `Plan` | Implementatsiya rejasini tuzish |
| `claude` | Boshqasiga to'g'ri kelmagan har qanday vazifa |
| `claude-code-guide` | Claude Code, Agent SDK, Claude API bo'yicha savollar |

---

## Har bir prompt bosqichida agentlarni chaqirish tartibi:

### 01-project-init (Loyiha yaratish):
```
1. architect       → modul tuzilmasi va papka strukturasini rejalashtir
2. backend-engineer → NestJS loyiha skeleti, paketlar, konfiguratsiya
3. code-reviewer   → yaratilgan strukturani tekshir
```

### 02-database-schema (Database):
```
1. db-migrator      → Prisma schema yoz, migrate qil, index qo'sh
2. backend-engineer → PrismaService, UserService, VoteService yoz
3. test-writer      → servislar uchun unit testlar
```

### 03-openbudget-service (API integratsiya):
```
1. backend-engineer → OpenBudgetService — API so'rovlar, retry, error handling
2. security-auditor → token saqlash, input validatsiya, rate limiting tekshir
3. test-writer      → API mock bilan unit testlar
4. code-reviewer    → kod sifatini tekshir
```

### 04-bot-module (Telegram bot):
```
1. architect        → BotModule tuzilmasi, conversation flow rejasi
2. backend-engineer → grammY bot, commands, conversation handlers
3. security-auditor → flood control, user input sanitize tekshir
4. test-writer      → conversation flow testlari
```

### 05-captcha-webapp (Telegram Mini App):
```
1. frontend-engineer → captcha.html — Telegram WebApp UI, rasm ko'rsatish, click handling
2. backend-engineer  → CaptchaController — /api/captcha endpoint
3. security-auditor  → WebApp initData verification, CORS tekshir
```

### 06-admin-commands (Admin panel):
```
1. backend-engineer → AdminService, admin handlers, broadcast, export
2. security-auditor → admin middleware, ID tekshiruv
3. test-writer      → admin funksiyalari testlari
```

### 07-docker-deploy (Deploy):
```
1. devops-engineer  → Dockerfile, docker-compose, nginx, SSL,
                     health check, graceful shutdown, log rotation
2. security-auditor → .env himoyasi, production sozlamalar
3. performance-engineer → (ixtiyoriy) yuklama ostida sekin joylarni o'lchash
```

---

## Xatolik bo'lganda:

```
debugger → xatolik sababini top, stack trace tahlil qil
```

Agar muammo murakkab va bir nechta joyga tegishli bo'lsa:

```
orchestrator → ishni bo'lib, kerakli agentlarga taqsimla
```

---

## Misol — 03-openbudget-service bosqichida:

```
@backend-engineer: OpenBudgetService yarat:
  - getCaptchaPage() — captcha rasmlarini olish
  - submitCaptcha(phone, points) — telefon + captcha yuborish
  - verifyOtp(code, token) — SMS kodni tasdiqlash
  Axios bilan, retry 3 marta, timeout 30s.

@security-auditor: OpenBudgetService tekshir:
  - gr_token Redis'da 5 min TTL bilan saqlansinmi?
  - telefon raqam validatsiyasi yetarlimi?
  - API kalitlar logga tushmasinmi?

@test-writer: OpenBudgetService uchun test yoz:
  - formatPhone() edge case'lar
  - submitCaptcha() muvaffaqiyatli va xato holatlar (axios mock)
  - verifyOtp() timeout holati

@code-reviewer: natijani review qil:
  - any tip yo'qmi?
  - error handling to'g'rimi?
  - DRY buzilmaganmi?
  ```
