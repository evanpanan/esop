import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function sqliteFilePathFromDatabaseUrl(databaseUrl: string) {
  if (!databaseUrl) return "./dev.db";
  if (databaseUrl === "file:./dev.db") return "./dev.db";
  if (databaseUrl.startsWith("file:")) {
    const p = databaseUrl.slice("file:".length);
    if (p.startsWith("/")) return p;
    if (p.startsWith("./") || p.startsWith("../")) return p;
    return `./${p}`;
  }
  return "./dev.db";
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: sqliteFilePathFromDatabaseUrl(process.env.DATABASE_URL ?? "file:./dev.db"),
    }),
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
