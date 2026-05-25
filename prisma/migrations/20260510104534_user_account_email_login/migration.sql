/*
  Warnings:

  - A unique constraint covering the columns `[paymentChain,paymentTxHash]` on the table `ExerciseRequest` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `account` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ExerciseRequest" ADD COLUMN "completedAt" DATETIME;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentAmountUsdt" DECIMAL;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentChain" TEXT;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentCheckError" TEXT;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentCheckedAt" DATETIME;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentRaw" JSONB;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentReceivedUsdt" DECIMAL;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentToAddress" TEXT;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentTxHash" TEXT;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentVerifiedAt" DATETIME;

-- CreateTable
CREATE TABLE "SharePriceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticker" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "close" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GlobalSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandLogoDataUrl" TEXT NOT NULL DEFAULT '',
    "companySharePrice" DECIMAL NOT NULL DEFAULT 7.00,
    "useManualCompanySharePrice" BOOLEAN NOT NULL DEFAULT false,
    "manualCompanySharePrice" DECIMAL,
    "manualCompanySharePriceUpdatedAt" DATETIME,
    "sharePriceAutoRefreshedAt" DATETIME,
    "sharePriceTicker" TEXT NOT NULL DEFAULT '',
    "sharePriceCurrency" TEXT NOT NULL DEFAULT 'USD',
    "sharePriceAvg30Usd" DECIMAL,
    "usdtBnbAddress" TEXT NOT NULL DEFAULT '',
    "usdtTrxAddress" TEXT NOT NULL DEFAULT '',
    "totalOptionPoolShares" INTEGER NOT NULL,
    "departmentsCsv" TEXT NOT NULL DEFAULT '',
    "terminationOptionExpiryDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GlobalSettings" ("companySharePrice", "createdAt", "departmentsCsv", "id", "sharePriceAvg30Usd", "sharePriceCurrency", "sharePriceTicker", "terminationOptionExpiryDays", "totalOptionPoolShares", "updatedAt") SELECT "companySharePrice", "createdAt", "departmentsCsv", "id", "sharePriceAvg30Usd", "sharePriceCurrency", "sharePriceTicker", "terminationOptionExpiryDays", "totalOptionPoolShares", "updatedAt" FROM "GlobalSettings";
DROP TABLE "GlobalSettings";
ALTER TABLE "new_GlobalSettings" RENAME TO "GlobalSettings";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "id", "passwordHash", "role", "updatedAt") SELECT "createdAt", "email", "id", "passwordHash", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_account_key" ON "User"("account");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SharePriceHistory_ticker_date_idx" ON "SharePriceHistory"("ticker", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SharePriceHistory_ticker_date_key" ON "SharePriceHistory"("ticker", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseRequest_paymentChain_paymentTxHash_key" ON "ExerciseRequest"("paymentChain", "paymentTxHash");
