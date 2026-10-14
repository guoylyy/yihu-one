-- AlterTable
ALTER TABLE `App` ADD COLUMN `iconCustom` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `manifestIcon` TEXT NULL,
    ADD COLUMN `manifestIconColor` VARCHAR(20) NULL;
