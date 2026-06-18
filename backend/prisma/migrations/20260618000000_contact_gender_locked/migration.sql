-- Khoá giới tính: true khi sale chỉnh tay → sync SDK (zinstant/cron) không đè ngược (anh chốt 2026-06-18).
ALTER TABLE "contacts" ADD COLUMN "gender_locked" BOOLEAN NOT NULL DEFAULT false;
