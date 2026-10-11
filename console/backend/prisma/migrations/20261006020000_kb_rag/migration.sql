-- AlterTable
ALTER TABLE `LlmConfig` ADD COLUMN `kind` VARCHAR(12) NOT NULL DEFAULT 'CHAT';

-- CreateTable
CREATE TABLE `KnowledgeBase` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `scope` VARCHAR(12) NOT NULL DEFAULT 'ALL',
    `deptIds` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KbDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kbId` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `fileType` VARCHAR(10) NOT NULL,
    `size` INTEGER NOT NULL DEFAULT 0,
    `content` LONGBLOB NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `error` VARCHAR(500) NULL,
    `chunkCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KbDocument_kbId_idx`(`kbId`),
    INDEX `KbDocument_kbId_status_idx`(`kbId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KbChunk` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `documentId` INTEGER NOT NULL,
    `kbId` INTEGER NOT NULL,
    `ord` INTEGER NOT NULL DEFAULT 0,
    `content` TEXT NOT NULL,
    `embedding` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KbChunk_documentId_idx`(`documentId`),
    INDEX `KbChunk_kbId_idx`(`kbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `KbDocument` ADD CONSTRAINT `KbDocument_kbId_fkey` FOREIGN KEY (`kbId`) REFERENCES `KnowledgeBase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KbChunk` ADD CONSTRAINT `KbChunk_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `KbDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
