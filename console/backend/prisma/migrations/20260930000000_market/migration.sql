-- AlterTable
ALTER TABLE `User` ADD COLUMN `prefs` JSON NULL;

-- AlterTable
ALTER TABLE `App` ADD COLUMN `adminNote` VARCHAR(500) NULL,
    ADD COLUMN `intro` TEXT NULL,
    ADD COLUMN `kind` VARCHAR(20) NOT NULL DEFAULT 'EXTERNAL',
    ADD COLUMN `listed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `liveVersionId` INTEGER NULL,
    ADD COLUMN `permissions` JSON NULL,
    ADD COLUMN `publisherId` INTEGER NULL,
    ADD COLUMN `scope` VARCHAR(20) NOT NULL DEFAULT 'MARKET',
    ADD COLUMN `screenshots` JSON NULL,
    ADD COLUMN `tags` JSON NULL,
    ADD COLUMN `trusted` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `UserApp` ADD COLUMN `config` JSON NULL;

-- AlterTable
ALTER TABLE `AgentConversation` ADD COLUMN `appId` INTEGER NULL,
    ADD COLUMN `versionId` INTEGER NULL;

-- CreateTable
CREATE TABLE `AppVersion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appId` INTEGER NOT NULL,
    `version` VARCHAR(40) NOT NULL,
    `changelog` VARCHAR(1000) NULL,
    `payload` JSON NOT NULL,
    `permissions` JSON NULL,
    `targetScope` VARCHAR(20) NOT NULL,
    `targetVisibility` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `createdBy` INTEGER NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedBy` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AppVersion_appId_id_idx`(`appId`, `id`),
    INDEX `AppVersion_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppRating` (
    `appId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `stars` INTEGER NOT NULL,
    `comment` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`appId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppReport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `handledBy` INTEGER NULL,
    `handledAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AppReport_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppGrant` (
    `userId` INTEGER NOT NULL,
    `appId` INTEGER NOT NULL,
    `permissions` JSON NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `appId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppData` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appId` INTEGER NOT NULL,
    `collection` VARCHAR(50) NOT NULL,
    `ownerId` INTEGER NULL,
    `data` JSON NOT NULL,
    `createdBy` INTEGER NOT NULL,
    `updatedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `AppData_appId_collection_id_idx`(`appId`, `collection`, `id`),
    INDEX `AppData_appId_ownerId_idx`(`appId`, `ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `App_publisherId_idx` ON `App`(`publisherId`);

-- AddForeignKey
ALTER TABLE `AppVersion` ADD CONSTRAINT `AppVersion_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppRating` ADD CONSTRAINT `AppRating_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- 已有应用都是管理员装的或登记的: 标成可信、已上架, 按是否托管区分类型
UPDATE `App` SET `kind` = IF(`managed`, 'HOSTED', 'EXTERNAL'), `trusted` = true, `listed` = true, `scope` = 'MARKET', `publisherId` = `ownerId`;
