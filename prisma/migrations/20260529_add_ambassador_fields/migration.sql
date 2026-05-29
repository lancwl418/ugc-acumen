-- Add ambassador profile fields to CreatorLink
ALTER TABLE "CreatorLink" ADD COLUMN "isAmbassador" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CreatorLink" ADD COLUMN "role" TEXT;
ALTER TABLE "CreatorLink" ADD COLUMN "quote" TEXT;
ALTER TABLE "CreatorLink" ADD COLUMN "setup" TEXT;
ALTER TABLE "CreatorLink" ADD COLUMN "base" TEXT;
ALTER TABLE "CreatorLink" ADD COLUMN "joinedYear" INTEGER;
ALTER TABLE "CreatorLink" ADD COLUMN "scenarios" TEXT;
