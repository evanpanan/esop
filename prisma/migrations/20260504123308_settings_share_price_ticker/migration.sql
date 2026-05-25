-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GlobalSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companySharePrice" DECIMAL NOT NULL DEFAULT 7.00,
    "sharePriceTicker" TEXT NOT NULL DEFAULT '',
    "totalOptionPoolShares" INTEGER NOT NULL,
    "departmentsCsv" TEXT NOT NULL DEFAULT '',
    "terminationOptionExpiryDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GlobalSettings" ("companySharePrice", "createdAt", "departmentsCsv", "id", "terminationOptionExpiryDays", "totalOptionPoolShares", "updatedAt") SELECT "companySharePrice", "createdAt", "departmentsCsv", "id", "terminationOptionExpiryDays", "totalOptionPoolShares", "updatedAt" FROM "GlobalSettings";
DROP TABLE "GlobalSettings";
ALTER TABLE "new_GlobalSettings" RENAME TO "GlobalSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
