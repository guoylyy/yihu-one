-- 应用大模型开放接口: 每应用配额字段 + 用量事件表
ALTER TABLE `App` ADD COLUMN `llmDailyTokenLimit` INTEGER NULL;

CREATE TABLE `LlmUsageEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appId` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `model` VARCHAR(100) NOT NULL,
    `promptTokens` INTEGER NOT NULL DEFAULT 0,
    `completionTokens` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `latencyMs` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OK',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `LlmUsageEvent_appId_createdAt_idx` ON `LlmUsageEvent`(`appId`, `createdAt`);
CREATE INDEX `LlmUsageEvent_userId_createdAt_idx` ON `LlmUsageEvent`(`userId`, `createdAt`);
CREATE INDEX `LlmUsageEvent_model_createdAt_idx` ON `LlmUsageEvent`(`model`, `createdAt`);
