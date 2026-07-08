CREATE TABLE "client_assignments" (
  "id"        TEXT NOT NULL,
  "clientId"  TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "client_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_assignments_clientId_userId_key" UNIQUE ("clientId", "userId")
);

ALTER TABLE "client_assignments"
  ADD CONSTRAINT "client_assignments_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_assignments"
  ADD CONSTRAINT "client_assignments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
