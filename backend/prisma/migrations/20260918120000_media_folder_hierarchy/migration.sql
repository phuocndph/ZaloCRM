-- Preserve folder hierarchy for uploads from a local computer directory.
ALTER TABLE "media_albums" ADD COLUMN "parent_id" TEXT;

CREATE INDEX "media_albums_org_id_parent_id_idx"
  ON "media_albums"("org_id", "parent_id");

ALTER TABLE "media_albums"
  ADD CONSTRAINT "media_albums_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "media_albums"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
