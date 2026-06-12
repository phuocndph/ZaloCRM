-- Login branding 2026-06-12 — 4 trường hiển thị ngoài trang /login (PRE-AUTH).
-- Đọc qua endpoint công khai /api/v1/public/org-branding. Tất cả nullable (tổ chức
-- cũ chưa cấu hình → login fallback về mặc định hardcode HS Holding).
ALTER TABLE "organizations" ADD COLUMN "logo_url" TEXT;
ALTER TABLE "organizations" ADD COLUMN "slogan" TEXT;
ALTER TABLE "organizations" ADD COLUMN "copyright" TEXT;
ALTER TABLE "organizations" ADD COLUMN "email_domain" TEXT;
