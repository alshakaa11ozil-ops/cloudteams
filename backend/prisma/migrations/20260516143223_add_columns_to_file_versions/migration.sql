-- AlterTable
ALTER TABLE "file_versions" ADD COLUMN     "encryption_iv" VARCHAR(32),
ADD COLUMN     "version_name" VARCHAR(255);
