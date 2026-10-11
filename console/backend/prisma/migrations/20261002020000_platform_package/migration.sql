-- CreateTable
CREATE TABLE `PlatformPackage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `version` VARCHAR(20) NOT NULL,
    `filename` VARCHAR(200) NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `sig` TEXT NULL,
    `data` LONGBLOB NOT NULL,
    `uploadedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
