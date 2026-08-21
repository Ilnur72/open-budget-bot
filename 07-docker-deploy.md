# 07 — Docker va Deploy

## Vazifa

Loyihani Docker bilan konteynerlashtir va serverga deploy qil.

## Dockerfile:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/package*.json ./

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

## docker-compose.yml:

```yaml
version: '3.8'

services:
  bot:
    build: .
    container_name: openbudget-bot
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      - bot-network

  postgres:
    image: postgres:16-alpine
    container_name: openbudget-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: openbudget_bot
      POSTGRES_USER: bot_user
      # Default qiymat BERILMAYDI — DB_PASSWORD yo'q bo'lsa compose yiqilsin
      POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD .env da majburiy}
    volumes:
      - pgdata:/var/lib/postgresql/data
    # ports: TASHQARIGA CHIQARILMAYDI — bot bilan bir tarmoqda, host'ga kerak emas.
    # Debug uchun kerak bo'lsa: 127.0.0.1:5432:5432 (0.0.0.0 emas)
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bot_user -d openbudget_bot"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - bot-network

  redis:
    image: redis:7-alpine
    container_name: openbudget-redis
    restart: unless-stopped
    # requirepass — Redis'da gr_token va telefon raqamlar yotadi.
    # allkeys-lru EMAS: u xotira bosimida rate-limit kalitlarini o'chirib,
    # kunlik ovoz cheklovini jimgina bekor qilardi. noeviction'da Redis
    # to'lganda xato beradi va limit fail-closed bo'lib qoladi.
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD .env da majburiy}
      --maxmemory 256mb
      --maxmemory-policy noeviction
    volumes:
      - redisdata:/data
    # ports: TASHQARIGA CHIQARILMAYDI
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - bot-network

volumes:
  pgdata:
  redisdata:

networks:
  bot-network:
    driver: bridge
```

## .env.production:

```env
# Bot
BOT_TOKEN=your_token_here
NODE_ENV=production

# Database (docker-compose ichida)
DATABASE_URL=postgresql://bot_user:strong_password@postgres:5432/openbudget_bot

# Redis
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# OpenBudget
OPENBUDGET_BASE_URL=https://new.openbudget.uz
INITIATIVE_URL=https://new.openbudget.uz/uz/initiative-budget/active-initiatives/55/2f9c2e42-2e3c-46cb-a5af-bc7976cc0dec
DISTRICT_ID=55
INITIATIVE_UUID=2f9c2e42-2e3c-46cb-a5af-bc7976cc0dec

# Admin Telegram IDs
ADMIN_IDS=123456789

# WebApp (HTTPS talab qilinadi!)
WEBAPP_URL=https://your-domain.com/webapp/captcha.html
```

## Nginx config (SSL + WebApp):

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # WebApp va API
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Deploy qadamlari:

```bash
# 1. Serverga ulanish
ssh user@server

# 2. Loyihani klonlash
git clone https://github.com/your/openbudget-bot.git
cd openbudget-bot

# 3. .env sozlash
cp .env.example .env.production
nano .env.production

# 4. SSL sertifikat
sudo certbot certonly --nginx -d your-domain.com

# 5. Docker bilan ishga tushirish
docker-compose --env-file .env.production up -d --build

# 6. Loglarni kuzatish
docker-compose logs -f bot

# 7. Migrate
docker-compose exec bot npx prisma migrate deploy
```

## PM2 bilan alternativ deploy (Docker'siz):

```bash
# O'rnatish
npm ci --production
npx prisma migrate deploy
npm run build

# PM2 bilan ishga tushirish
pm2 start dist/main.js --name openbudget-bot
pm2 save
pm2 startup
```

## Talablar:

1. Multi-stage Docker build (builder + runtime)
2. Health check endpoint: `GET /health`
3. Graceful shutdown: SIGTERM signal'ni to'g'ri handle qilish
4. Loglar: Winston yoki Pino logger bilan fayl + console
5. Bot webhook rejimiga o'tkazish (production'da):
   ```typescript
   // Webhook o'rnatish
   await bot.api.setWebhook(`https://your-domain.com/bot${BOT_TOKEN}`);
   ```
6. `.dockerignore`: node_modules, .git, .env, dist
