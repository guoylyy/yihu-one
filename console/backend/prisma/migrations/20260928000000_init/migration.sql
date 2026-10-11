-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dingDeptId` VARCHAR(64) NULL,
    `name` VARCHAR(100) NOT NULL,
    `parentId` INTEGER NULL,
    `leaderIds` JSON NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Department_dingDeptId_key`(`dingDeptId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NULL,
    `passwordHash` VARCHAR(200) NULL,
    `name` VARCHAR(50) NOT NULL,
    `mobile` VARCHAR(20) NULL,
    `email` VARCHAR(100) NULL,
    `avatar` VARCHAR(500) NULL,
    `jobNumber` VARCHAR(50) NULL,
    `title` VARCHAR(100) NULL,
    `dingUserId` VARCHAR(64) NULL,
    `unionId` VARCHAR(64) NULL,
    `roles` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    UNIQUE INDEX `User_dingUserId_key`(`dingUserId`),
    UNIQUE INDEX `User_unionId_key`(`unionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserDept` (
    `userId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`userId`, `departmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `App` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `icon` VARCHAR(500) NULL,
    `description` VARCHAR(500) NULL,
    `category` VARCHAR(50) NULL,
    `type` VARCHAR(20) NOT NULL,
    `url` VARCHAR(500) NULL,
    `redirectUris` JSON NULL,
    `clientSecretHash` VARCHAR(100) NULL,
    `mcpUrl` VARCHAR(500) NULL,
    `visibility` JSON NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `ownerId` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `managed` BOOLEAN NOT NULL DEFAULT false,
    `source` VARCHAR(500) NULL,
    `branch` VARCHAR(100) NULL,
    `runtime` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `App_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserApp` (
    `userId` INTEGER NOT NULL,
    `appId` INTEGER NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `appId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SsoCode` (
    `code` VARCHAR(64) NOT NULL,
    `appId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `redirectUri` VARCHAR(500) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiKey` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `prefix` VARCHAR(20) NOT NULL,
    `keyHash` VARCHAR(100) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ApiKey_keyHash_key`(`keyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppUsageEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `detail` JSON NULL,
    `source` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AppUsageEvent_appId_createdAt_idx`(`appId`, `createdAt`),
    INDEX `AppUsageEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformOp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(20) NOT NULL,
    `appCode` VARCHAR(50) NOT NULL,
    `params` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `log` MEDIUMTEXT NULL,
    `requestedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `PlatformOp_status_id_idx`(`status`, `id`),
    INDEX `PlatformOp_appCode_id_idx`(`appCode`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeployRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appCode` VARCHAR(50) NOT NULL,
    `result` VARCHAR(20) NOT NULL,
    `version` VARCHAR(40) NULL,
    `author` VARCHAR(100) NULL,
    `subject` VARCHAR(500) NULL,
    `trigger` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeployRecord_appCode_id_idx`(`appCode`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LlmConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(300) NULL,
    `provider` VARCHAR(30) NOT NULL,
    `baseUrl` VARCHAR(300) NULL,
    `model` VARCHAR(100) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `maxTokens` INTEGER NOT NULL DEFAULT 4096,
    `extra` JSON NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `selectable` BOOLEAN NOT NULL DEFAULT true,
    `roles` JSON NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentConversation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `openhexId` VARCHAR(100) NULL,
    `modelId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `AgentConversation_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversationId` INTEGER NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `content` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AgentMessage_conversationId_idx`(`conversationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PendingAction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversationId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `toolName` VARCHAR(100) NOT NULL,
    `args` JSON NOT NULL,
    `summary` VARCHAR(1000) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `result` JSON NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemSetting` (
    `key` VARCHAR(50) NOT NULL,
    `value` JSON NOT NULL,
    `secretEnc` TEXT NULL,
    `updatedBy` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorId` INTEGER NULL,
    `via` VARCHAR(20) NOT NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityType` VARCHAR(50) NULL,
    `entityId` VARCHAR(64) NULL,
    `detail` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_actorId_idx`(`actorId`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDept` ADD CONSTRAINT `UserDept_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDept` ADD CONSTRAINT `UserDept_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserApp` ADD CONSTRAINT `UserApp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserApp` ADD CONSTRAINT `UserApp_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgentMessage` ADD CONSTRAINT `AgentMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AgentConversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

