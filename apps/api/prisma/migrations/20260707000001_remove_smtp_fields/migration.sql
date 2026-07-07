-- Remove SMTP per-org fields — email is now sent globally via Resend
ALTER TABLE "notification_configs" DROP COLUMN IF EXISTS "smtpHost";
ALTER TABLE "notification_configs" DROP COLUMN IF EXISTS "smtpPort";
ALTER TABLE "notification_configs" DROP COLUMN IF EXISTS "smtpUser";
ALTER TABLE "notification_configs" DROP COLUMN IF EXISTS "smtpPass";
ALTER TABLE "notification_configs" DROP COLUMN IF EXISTS "emailFrom";
