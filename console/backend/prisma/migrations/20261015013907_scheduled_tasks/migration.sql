-- CreateTable
CREATE TABLE `ScheduledTask` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `prompt` TEXT NOT NULL,
    `agentAppId` INTEGER NULL,
    `schedule` JSON NOT NULL,
    `template` VARCHAR(20) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `nextRunAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastStatus` VARCHAR(20) NULL,
    `lastError` VARCHAR(500) NULL,
    `lastConversationId` INTEGER NULL,
    `lastResult` TEXT NULL,
    `failCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `ScheduledTask_userId_idx`(`userId`),
    INDEX `ScheduledTask_enabled_nextRunAt_idx`(`enabled`, `nextRunAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
