/*
  Warnings:

  - A unique constraint covering the columns `[invite_code]` on the table `teams` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `team_id` to the `shared_links` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "document_id" INTEGER,
ALTER COLUMN "file_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "file_versions" ADD COLUMN     "yjs_state" BYTEA;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "encryption_iv" VARCHAR(32),
ADD COLUMN     "yjs_last_saved" TIMESTAMP(3),
ADD COLUMN     "yjs_state" BYTEA;

-- AlterTable
ALTER TABLE "shared_links" ADD COLUMN     "document_id" INTEGER,
ADD COLUMN     "folder_id" INTEGER,
ADD COLUMN     "team_id" INTEGER NOT NULL,
ALTER COLUMN "file_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "invite_code" VARCHAR(8),
ADD COLUMN     "invite_code_enabled" BOOLEAN DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_color" VARCHAR(7),
ADD COLUMN     "full_name" VARCHAR(100),
ADD COLUMN     "job_title" VARCHAR(100),
ADD COLUMN     "last_login" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "two_factor_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ai_cache" (
    "id" SERIAL NOT NULL,
    "team_id" INTEGER NOT NULL,
    "feature" VARCHAR(50) NOT NULL,
    "target_id" INTEGER,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "team_id" INTEGER NOT NULL,
    "folder_id" INTEGER,
    "title" TEXT NOT NULL DEFAULT 'Untitled Document',
    "created_by" INTEGER NOT NULL,
    "yjs_state" BYTEA,
    "last_saved" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "lockExpiresAt" TIMESTAMP(3),
    "lockOwnerUserId" INTEGER,
    "lockToken" VARCHAR(36),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "version_name" VARCHAR(255),
    "yjs_state" BYTEA NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_blacklist" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_cache_team_id_feature_idx" ON "ai_cache"("team_id", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "ai_cache_team_id_feature_target_id_key" ON "ai_cache"("team_id", "feature", "target_id");

-- CreateIndex
CREATE INDEX "idx_documents_lock_expiry" ON "documents"("lockExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "token_blacklist_token_key" ON "token_blacklist"("token");

-- CreateIndex
CREATE UNIQUE INDEX "teams_invite_code_key" ON "teams"("invite_code");

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_cache" ADD CONSTRAINT "ai_cache_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_lockOwnerUserId_fkey" FOREIGN KEY ("lockOwnerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
