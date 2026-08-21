import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// dotenv devDependency — `npm ci --omit=dev` qilingan image ichida mavjud bo'lmaydi.
// Node 20.6+ dagi o'rnatilgan yuklovchidan foydalanamiz.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * Prisma 7 konfiguratsiyasi.
 * Ulanish manzili schema.prisma da emas, shu yerda (migrate/introspect uchun).
 * Runtime'da esa PrismaService `@prisma/adapter-pg` orqali ulanadi.
 */
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // `datasource` SHARTLI berilyapti.
  //
  // `prisma/config` ning `env()` yordamchisi lazy EMAS — modul yuklanganda
  // darhol xatolik tashlaydi. Docker build paytida `DATABASE_URL` bo'lmaydi
  // (`.env` `.dockerignore` da), shuning uchun `postinstall: prisma generate`
  // va butun `npm ci` yiqilardi. `generate` ga ulanish manzili kerak emas;
  // `migrate deploy` da yo'q bo'lsa Prisma o'zi tushunarli xato beradi.
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
});
