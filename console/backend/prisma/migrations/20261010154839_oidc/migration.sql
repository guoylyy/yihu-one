-- AlterTable
ALTER TABLE `SsoCode` ADD COLUMN `codeChallenge` VARCHAR(128) NULL,
    ADD COLUMN `codeChallengeMethod` VARCHAR(10) NULL,
    ADD COLUMN `nonce` VARCHAR(255) NULL,
    ADD COLUMN `scope` VARCHAR(500) NULL;
