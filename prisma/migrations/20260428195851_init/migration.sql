-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GlobalSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companySharePrice" DECIMAL NOT NULL DEFAULT 7.00,
    "totalOptionPoolShares" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Grant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agreementNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "totalShares" INTEGER NOT NULL,
    "grantDate" DATETIME NOT NULL,
    "strikePrice" DECIMAL NOT NULL,
    "vestingYears" INTEGER NOT NULL DEFAULT 4,
    "cliffMonths" INTEGER NOT NULL DEFAULT 12,
    "cliffPercent" DECIMAL NOT NULL DEFAULT 0.25,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Grant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VestingRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "vestDate" DATETIME NOT NULL,
    "shares" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVESTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VestingRecord_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VestingRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExerciseRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "requestedShares" INTEGER NOT NULL,
    "totalCost" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isBuybackOrCancel" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExerciseRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_department_idx" ON "Employee"("department");

-- CreateIndex
CREATE INDEX "Employee_name_idx" ON "Employee"("name");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Grant_agreementNo_key" ON "Grant"("agreementNo");

-- CreateIndex
CREATE INDEX "Grant_employeeId_idx" ON "Grant"("employeeId");

-- CreateIndex
CREATE INDEX "Grant_grantDate_idx" ON "Grant"("grantDate");

-- CreateIndex
CREATE INDEX "VestingRecord_employeeId_vestDate_idx" ON "VestingRecord"("employeeId", "vestDate");

-- CreateIndex
CREATE INDEX "VestingRecord_status_vestDate_idx" ON "VestingRecord"("status", "vestDate");

-- CreateIndex
CREATE UNIQUE INDEX "VestingRecord_grantId_vestDate_key" ON "VestingRecord"("grantId", "vestDate");

-- CreateIndex
CREATE INDEX "ExerciseRequest_status_createdAt_idx" ON "ExerciseRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ExerciseRequest_employeeId_createdAt_idx" ON "ExerciseRequest"("employeeId", "createdAt");
