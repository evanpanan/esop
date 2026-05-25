-- AlterTable
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentProofConfirmedAt" DATETIME;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentProofConfirmedByRole" TEXT;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentProofDataUrl" TEXT;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentProofUploadedAt" DATETIME;
ALTER TABLE "ExerciseRequest" ADD COLUMN "paymentProofUploadedByRole" TEXT;
