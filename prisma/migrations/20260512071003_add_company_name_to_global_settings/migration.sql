-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GlobalSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandLogoDataUrl" TEXT NOT NULL DEFAULT '',
    "companyName" TEXT NOT NULL DEFAULT '',
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
INSERT INTO "new_GlobalSettings" ("brandLogoDataUrl", "companySharePrice", "createdAt", "departmentsCsv", "id", "manualCompanySharePrice", "manualCompanySharePriceUpdatedAt", "sharePriceAutoRefreshedAt", "sharePriceAvg30Usd", "sharePriceCurrency", "sharePriceTicker", "terminationOptionExpiryDays", "totalOptionPoolShares", "updatedAt", "usdtBnbAddress", "usdtTrxAddress", "useManualCompanySharePrice") SELECT "brandLogoDataUrl", "companySharePrice", "createdAt", "departmentsCsv", "id", "manualCompanySharePrice", "manualCompanySharePriceUpdatedAt", "sharePriceAutoRefreshedAt", "sharePriceAvg30Usd", "sharePriceCurrency", "sharePriceTicker", "terminationOptionExpiryDays", "totalOptionPoolShares", "updatedAt", "usdtBnbAddress", "usdtTrxAddress", "useManualCompanySharePrice" FROM "GlobalSettings";
DROP TABLE "GlobalSettings";
ALTER TABLE "new_GlobalSettings" RENAME TO "GlobalSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
