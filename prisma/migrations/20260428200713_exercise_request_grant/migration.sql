-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExerciseRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "grantId" TEXT,
    "requestedShares" INTEGER NOT NULL,
    "totalCost" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isBuybackOrCancel" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExerciseRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExerciseRequest_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ExerciseRequest" ("createdAt", "employeeId", "id", "isBuybackOrCancel", "requestedShares", "status", "totalCost", "updatedAt") SELECT "createdAt", "employeeId", "id", "isBuybackOrCancel", "requestedShares", "status", "totalCost", "updatedAt" FROM "ExerciseRequest";
DROP TABLE "ExerciseRequest";
ALTER TABLE "new_ExerciseRequest" RENAME TO "ExerciseRequest";
CREATE INDEX "ExerciseRequest_status_createdAt_idx" ON "ExerciseRequest"("status", "createdAt");
CREATE INDEX "ExerciseRequest_employeeId_createdAt_idx" ON "ExerciseRequest"("employeeId", "createdAt");
CREATE INDEX "ExerciseRequest_grantId_createdAt_idx" ON "ExerciseRequest"("grantId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
