-- One VIEWED per person per file version, enforced by the database (was a date comparison in the
-- app, racy with two tabs and flaky in the test suite). Older VIEWED rows keep viewedVersionAt NULL
-- and are not touched by the index (NULLs never conflict).
ALTER TABLE "protocol_events" ADD COLUMN "viewedVersionAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "protocol_events_viewed_once_key"
  ON "protocol_events" ("protocolId", "actorId", "viewedVersionAt")
  WHERE "type" = 'VIEWED';
