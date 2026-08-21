-- Bitta telefon raqam bitta tashabbusga faqat bir marta MUVAFFAQIYATLI ovoz bera oladi.
-- Qisman (partial) indeks: muvaffaqiyatsiz urinishlar takrorlanishi mumkin,
-- lekin SUCCESS holatidagi dublikat DB darajasida bloklanadi (race condition'dan himoya).
CREATE UNIQUE INDEX "votes_initiative_phone_success_key"
  ON "votes" ("initiative_uuid", "phone")
  WHERE "status" = 'SUCCESS';
