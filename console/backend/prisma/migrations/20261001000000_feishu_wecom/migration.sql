-- AlterTable
ALTER TABLE `User` ADD COLUMN `feishuOpenId` VARCHAR(64) NULL,
    ADD COLUMN `feishuUnionId` VARCHAR(64) NULL,
    ADD COLUMN `wecomUserId` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_feishuOpenId_key` ON `User`(`feishuOpenId`);

-- CreateIndex
CREATE UNIQUE INDEX `User_feishuUnionId_key` ON `User`(`feishuUnionId`);

-- CreateIndex
CREATE UNIQUE INDEX `User_wecomUserId_key` ON `User`(`wecomUserId`);

