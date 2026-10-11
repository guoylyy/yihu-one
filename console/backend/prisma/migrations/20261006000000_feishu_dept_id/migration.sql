-- AlterTable
ALTER TABLE `Department` ADD COLUMN `feishuDeptId` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Department_feishuDeptId_key` ON `Department`(`feishuDeptId`);
