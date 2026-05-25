import { defineConfig } from "@playwright/test";

process.env.DATABASE_URL ??= "file:/tmp/esop-e2e.db";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3100",
    browserName: "chromium",
    channel: "chrome",
  },
  webServer: {
    command:
      "DATABASE_URL=file:/tmp/esop-e2e.db npx prisma migrate deploy && DATABASE_URL=file:/tmp/esop-e2e.db npm run build && PORT=3100 DATABASE_URL=file:/tmp/esop-e2e.db npm run start -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
