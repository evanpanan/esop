/*
  Warnings:

  - A unique constraint covering the columns `[clientRequestId]` on the table `ExerciseRequest` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ExerciseRequest" ADD COLUMN "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseRequest_clientRequestId_key" ON "ExerciseRequest"("clientRequestId");
