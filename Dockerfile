# ---------- 1-bosqich: qurish ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Faqat `schema.prisma` — `postinstall: prisma generate` ga migratsiyalar kerak emas.
# Butun `prisma/` ni ko'chirsak, har yangi migratsiya `npm ci` keshini bekor qilardi.
COPY package*.json ./
COPY prisma/schema.prisma ./prisma/
COPY prisma.config.ts ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build


# ---------- 2-bosqich: ishlash ----------
FROM node:22-alpine AS runtime

# `dumb-init` — PID 1 sifatida signallarni to'g'ri uzatadi.
# Usiz SIGTERM Node'ga yetib bormay, graceful shutdown ishlamas edi.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
# Prisma CLI har startda checkpoint.prisma.io ga chiqadi — konteyner startini sekinlashtiradi.
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=1

WORKDIR /app

# Faqat production bog'liqliklari.
# `prisma` CLI shu yerda qoladi: `migrate` servisi ayni shu image'ni ishlatadi.
COPY package*.json ./
COPY prisma/schema.prisma ./prisma/
COPY prisma.config.ts ./
RUN npm ci --omit=dev && npm cache clean --force

COPY prisma/migrations ./prisma/migrations
COPY --from=builder /app/dist ./dist

# Root'dan ishlamaymiz.
USER node

EXPOSE 3000

# `wget` busybox ichida — har 30 soniyada to'liq Node process ko'tarishdan arzon.
# `start-period` migratsiya + Nest boot uchun yetarli bo'lishi kerak.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
