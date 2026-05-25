-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Grant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agreementNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "totalShares" INTEGER NOT NULL,
    "grantDate" DATETIME NOT NULL,
    "strikePrice" DECIMAL NOT NULL,
    "lockupPeriodMonths" INTEGER NOT NULL DEFAULT 0,
    "vestingYears" INTEGER NOT NULL DEFAULT 4,
    "cliffMonths" INTEGER NOT NULL DEFAULT 12,
    "cliffPercent" DECIMAL NOT NULL DEFAULT 0.25,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Grant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Grant" ("agreementNo", "cliffMonths", "cliffPercent", "createdAt", "employeeId", "grantDate", "id", "strikePrice", "totalShares", "updatedAt", "vestingYears") SELECT "agreementNo", "cliffMonths", "cliffPercent", "createdAt", "employeeId", "grantDate", "id", "strikePrice", "totalShares", "updatedAt", "vestingYears" FROM "Grant";
DROP TABLE "Grant";
ALTER TABLE "new_Grant" RENAME TO "Grant";
CREATE UNIQUE INDEX "Grant_agreementNo_key" ON "Grant"("agreementNo");
CREATE INDEX "Grant_employeeId_idx" ON "Grant"("employeeId");
CREATE INDEX "Grant_grantDate_idx" ON "Grant"("grantDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
