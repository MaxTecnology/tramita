-- Add constraint to ensure at least one uploader is identified
ALTER TABLE "attachments"
ADD CONSTRAINT "check_uploader_identified"
CHECK (("uploadedBy" IS NOT NULL) OR ("uploadedByClient" IS NOT NULL));
