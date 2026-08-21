# Deploy

## Talablar

- Docker va Docker Compose **v2** (`env_file`/`${...}` interpolatsiyasi v2 xususiyati)
- Domen va unga yo'naltirilgan A-yozuv
- nginx (host'da) + certbot
- Git repozitoriysi (rollback shunga tayanadi)

## 1. Konfiguratsiya

```bash
cp .env.production.example .env.production
chmod 600 .env.production          # faylda 3 ta secret bor
nano .env.production
```

Parollarni yaratish:

```bash
openssl rand -hex 32               # WEBHOOK_SECRET, DB_PASSWORD, REDIS_PASSWORD
```

⚠️ **`base64` ishlatmang.** `openssl rand -base64` natijasida `/` chiqishi
mumkin, u esa `DATABASE_URL` va `REDIS_URL` ni buzadi (`Invalid URL` bilan
konteyner startda yiqiladi, sabab esa logda ko'rinmaydi — parol yozilmaydi).
Parolda `$` ham bo'lmasin: Compose `${...}` ni kengaytiradi.

Har bir compose buyrug'i interpolatsiyadan o'tadi, shuning uchun bir marta:

```bash
export COMPOSE_ENV_FILES=.env.production
```

Aks holda har bir buyruqqa `--env-file .env.production` qo'shish kerak.

## 2. nginx va SSL

Tartib muhim: sertifikat yo'q bo'lsa `nginx -t` yiqiladi, 80-portli blok
bo'lmasa certbot challenge'ni bajara olmaydi.

```bash
export DOMAIN=example.uz

sudo cp deploy/nginx.conf /etc/nginx/sites-available/openbudget-bot
sudo sed -i "s/your-domain.com/$DOMAIN/g" /etc/nginx/sites-available/openbudget-bot
sudo mkdir -p /var/www/certbot

# 443 blokini VAQTINCHA kommentga oling (sertifikat hali yo'q)
sudo ln -s /etc/nginx/sites-available/openbudget-bot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/certbot -d $DOMAIN

# endi 443 blokini oching
sudo nginx -t && sudo systemctl reload nginx
```

`.env.production` dagi `WEBHOOK_URL` va `WEBAPP_URL` da ham domenni almashtiring.

## 3. Ishga tushirish

```bash
export IMAGE_TAG=$(git rev-parse --short HEAD)
docker compose build
docker compose up -d
```

Migratsiyalar alohida `migrate` servisida qo'llanadi. U yiqilsa bot **umuman
ishga tushmaydi** (`service_completed_successfully`) va qayta urinmaydi
(`restart: no`) — cheksiz sikl bo'lmaydi.

## 4. Tekshirish

```bash
docker compose ps                                  # uchala servis healthy
curl -fsS localhost:3000/health                    # {"status":"ok",...}
curl -fsS localhost:3000/health/ready              # degraded bo'lsa exit≠0
docker compose logs --tail=50 bot                  # "Webhook o'rnatildi" qatori
curl -s -o /dev/null -w '%{http_code}\n' https://$DOMAIN/telegram/webhook   # 401 kutiladi
```

So'ng Telegram'da bitta to'liq oqim: `/start` → `/vote` → captcha → telefon → SMS.

⚠️ Endpointlar tasdiqlanmagan bo'lsa real foydalanuvchiga SMS ketishi mumkin —
`OPENBUDGET_ENDPOINTS_VERIFIED=true` ni faqat DevTools bilan tekshirgandan
keyin qo'ying. Usiz ilova production rejimida ataylab ko'tarilmaydi.

## Yangilash

```bash
docker compose exec postgres pg_dump -U bot_user openbudget_bot | gzip > backup-$(date +%F).sql.gz
git pull
export IMAGE_TAG=$(git rev-parse --short HEAD)
docker compose build && docker compose up -d
```

## Rollback

Image teglangani uchun qayta build kerak emas:

```bash
IMAGE_TAG=<oldingi-sha> docker compose up -d --no-build     # ~10 soniya
```

**Migratsiyalar avtomatik qaytmaydi.** Shuning uchun har bir schema o'zgarishi
expand/contract bo'lsin: avval ustun qo'shish (nullable) → keyin kod → ustun
o'chirish **keyingi** deployda. Ustun o'chirish va kod bir deployda bo'lsa,
rollback ishlamaydi.

Migratsiya yarim yiqilgan bo'lsa Prisma uni "failed" deb belgilaydi va keyingi
har bir start `P3009` bilan to'xtaydi. Tiklash:

```bash
docker compose logs --tail=100 migrate
docker compose run --rm --entrypoint sh migrate \
  -c "node_modules/.bin/prisma migrate resolve --rolled-back <migratsiya_nomi>"
IMAGE_TAG=<oldingi-sha> docker compose up -d --no-build
```

Eng yomon holat — `pg_dump` dan tiklash. Bu ma'lumot yo'qotish, faqat oxirgi chora.

⚠️ `docker compose down -v` ni **hech qachon** ishlatmang — `pgdata` va
`redisdata` o'chadi.

## Zaxira nusxa

```bash
docker compose exec postgres pg_dump -U bot_user openbudget_bot | gzip > backup-$(date +%F).sql.gz
```

## Bilib qo'yish kerak

**Healthcheck avtomatik tiklamaydi.** Docker `unhealthy` konteynerni qayta ishga
tushirmaydi — `restart` siyosati faqat process chiqqanda ishlaydi. Healthcheck
faqat `docker compose ps` uchun ko'rsatkich. Avtomatik tiklanish kerak bo'lsa
tashqi watchdog qo'shing.

**Deploy paytida downtime bor** — bot konteyneri to'xtab qayta ko'tariladi
(webhook rejimida 20–60 soniya). Telegram update'larni qayta yuboradi, shuning
uchun yo'qotish minimal.

**Broadcast ketayotganda deploy qilmang.** `stop_grace_period: 120s` va
sikl ichidagi abort tekshiruvi tufayli u toza to'xtaydi, lekin yarimda qolgan
broadcast avtomatik davom etmaydi.

**Alert yo'q.** Servis o'lganini yoki xato darajasi oshganini hech nima
xabar qilmaydi. Kamida `docker compose ps` ni tekshiradigan cron + Telegram
xabari qo'shishni rejalashtiring.

**`PORT` 3000 bo'lib qolsin** — Dockerfile'dagi `EXPOSE` va healthcheck unga
qattiq bog'langan.

## Miqyoslash haqida

Bot **bitta nusxada** ishlaydi va buni o'zgartirish mumkin emas:

- **polling** rejimida Telegram ikkinchi nusxaga `409 Conflict` beradi;
- **webhook** rejimida broadcast qulfi process ichida saqlanadi — bir nechta
  nusxa bo'lsa har biri o'z broadcast'ini yuborib, foydalanuvchilar xabarni
  bir necha marta olardi.

Miqyoslash kerak bo'lsa avval `BroadcastService` ga Redis'ga tayangan
taqsimlangan qulf (heartbeat bilan TTL uzaytirish) qo'shilishi shart.

## Loglar

Konteyner ichida faylga yozilmaydi — Docker `json-file` drayveri stdout'ni
yig'adi va `max-size: 10m`, `max-file: 5` bilan rotatsiya qiladi.
Production'da loglar bir qatorli JSON:

```bash
docker compose logs bot | jq -r 'select(.level=="error")'
```

Loglar maxfiy qiymatlarni yozmaydi: bot tokeni, telefon raqamlar va SMS kodlar
serializerda `[redacted]` bilan almashtiriladi yoki butunlay tashlanadi.
