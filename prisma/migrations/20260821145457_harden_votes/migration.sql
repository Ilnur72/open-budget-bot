-- DropForeignKey
ALTER TABLE "vote_logs" DROP CONSTRAINT "vote_logs_user_id_fkey";

-- DropIndex
DROP INDEX "votes_created_at_idx";

-- DropIndex
DROP INDEX "votes_initiative_uuid_phone_idx";

-- DropIndex
DROP INDEX "votes_user_id_idx";

-- AlterTable
ALTER TABLE "users"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "vote_logs"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "votes"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- CreateIndex
CREATE INDEX "votes_user_id_created_at_idx" ON "votes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "votes_created_at_status_idx" ON "votes"("created_at", "status");

-- AddForeignKey
ALTER TABLE "vote_logs" ADD CONSTRAINT "vote_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Telefon formati DB darajasida majburlanadi.
-- Dublikat ovozni to'sadigan unikal indeks matn tenglikka tayanadi, shuning uchun
-- `998...` va `+998...` kabi turli yozuvlar unga yetib bormasligi kerak.
ALTER TABLE "votes"
  ADD CONSTRAINT "votes_phone_format_chk" CHECK ("phone" ~ '^\+998[0-9]{9}$');

ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_format_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+998[0-9]{9}$');
