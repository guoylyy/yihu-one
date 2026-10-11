-- AlterTable
ALTER TABLE `App` ADD COLUMN `extraSpaceIds` JSON NULL,
    ADD COLUMN `spaceId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `AppData` ADD COLUMN `spaceId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `Department` ADD COLUMN `spaceId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `KnowledgeBase` ADD COLUMN `spaceId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `spaceId` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `Space` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'INTERNAL',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Space_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 默认空间：老数据（spaceId 默认 1）都归它，一个人都不会成为「孤儿」
INSERT INTO `Space` (`id`, `code`, `name`, `kind`, `sort`, `updatedAt`) VALUES (1, 'default', '默认空间', 'INTERNAL', 0, CURRENT_TIMESTAMP(3));
