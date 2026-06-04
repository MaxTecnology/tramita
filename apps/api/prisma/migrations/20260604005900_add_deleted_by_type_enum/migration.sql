/*
  Warnings:

  - The `deletedByType` column on the `comments` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "DeletedByType" AS ENUM ('USER', 'CLIENT');

-- AlterTable
ALTER TABLE "comments" DROP COLUMN "deletedByType",
ADD COLUMN     "deletedByType" "DeletedByType";

-- AddConstraint
ALTER TABLE "comments" ADD CONSTRAINT comments_deleted_consistency
CHECK (
  ("deletedAt" IS NULL AND "deletedBy" IS NULL AND "deletedByType" IS NULL) OR
  ("deletedAt" IS NOT NULL AND "deletedBy" IS NOT NULL AND "deletedByType" IS NOT NULL)
);
