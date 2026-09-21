-- CreateTable
CREATE TABLE "client_users" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "phone" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_users_email_organizationId_key" ON "client_users"("email", "organizationId");

-- CreateTable
CREATE TABLE "client_user_accesses" (
  "id" TEXT NOT NULL,
  "clientUserId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  CONSTRAINT "client_user_accesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_user_accesses_clientUserId_clientId_departmentId_key" ON "client_user_accesses"("clientUserId", "clientId", "departmentId");

-- AddForeignKey
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_user_accesses" ADD CONSTRAINT "client_user_accesses_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "client_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_user_accesses" ADD CONSTRAINT "client_user_accesses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_user_accesses" ADD CONSTRAINT "client_user_accesses_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropColumn: Client nunca teve dado real de login cadastrado (confirmado) —
-- login do portal passa a ser 100% via client_users.
ALTER TABLE "clients" DROP COLUMN "email";
ALTER TABLE "clients" DROP COLUMN "passwordHash";
