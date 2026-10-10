-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEvent" ADD VALUE 'REQUEST_NEEDS_INFO';
ALTER TYPE "NotificationEvent" ADD VALUE 'REQUEST_COMMENT_ADDED';
ALTER TYPE "NotificationEvent" ADD VALUE 'REQUEST_CANCELLED';

-- AlterEnum
ALTER TYPE "RequestStatus" ADD VALUE 'NEEDS_INFO';

-- AlterTable
ALTER TABLE "notification_configs" ADD COLUMN     "requestCancelled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requestCommentAdded" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requestNeedsInfo" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "cancelledByType" "CommentAuthorType";

-- CreateTable
CREATE TABLE "request_comments" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorType" "CommentAuthorType" NOT NULL,
    "userId" TEXT,
    "clientId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deletedByType" "DeletedByType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_comments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

