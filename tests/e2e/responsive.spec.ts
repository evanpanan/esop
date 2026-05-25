import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { createGrantWithVesting } from "../../src/lib/esop";

const widths = [375, 414, 768, 1024, 1440, 1920] as const;

async function login(page: Page, account: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(account);
  await page.locator('input[name="password"]').fill(password);
  const form = page.locator("form").filter({ has: page.locator('input[name="email"]') }).first();
  await Promise.all([
    page.waitForURL((url: URL) => url.pathname === "/admin" || url.pathname === "/me", { waitUntil: "domcontentloaded" }),
    form.locator("button").first().click(),
  ]);
}

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

function base64UrlEncode(buf: Buffer) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`;
}

function makePrisma() {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: sqliteFilePathFromDatabaseUrl(process.env.DATABASE_URL ?? "file:./dev.db"),
    }),
  });
}

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const prisma = makePrisma();
  const pw = hashPassword("123456");

  try {
    const [grantAgg, forfeitedAgg, buybackAgg] = await Promise.all([
      prisma.grant.aggregate({ _sum: { totalShares: true } }),
      prisma.vestingRecord.aggregate({ where: { status: "FORFEITED" }, _sum: { shares: true } }),
      prisma.exerciseRequest.aggregate({
        where: { status: "COMPLETED", isBuybackOrCancel: true },
        _sum: { requestedShares: true },
      }),
    ]);
    const used = Math.max(
      (grantAgg._sum.totalShares ?? 0) - (forfeitedAgg._sum.shares ?? 0) - (buybackAgg._sum.requestedShares ?? 0),
      0,
    );
    const poolTarget = used + 2_000_000;

    const settings = await prisma.globalSettings.findFirst({ orderBy: { createdAt: "desc" } });
    if (!settings) {
      await prisma.globalSettings.create({
        data: {
          companyName: "ESOP",
          sharePriceTicker: "TEST",
          sharePriceCurrency: "USD",
          companySharePrice: new Prisma.Decimal(8.46),
          totalOptionPoolShares: Math.max(2_000_000, poolTarget),
          departmentsCsv: "Engineering,Finance,Product,QA",
          usdtBnbAddress: "0x1111111111111111111111111111111111111111",
          usdtTrxAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
          terminationOptionExpiryDays: 90,
        } as never,
      });
    } else {
      const next = {
        sharePriceTicker: settings.sharePriceTicker || "TEST",
        sharePriceCurrency: settings.sharePriceCurrency || ("USD" as never),
        companySharePrice: settings.companySharePrice ?? new Prisma.Decimal(8.46),
        totalOptionPoolShares: Math.max(settings.totalOptionPoolShares ?? 0, Math.max(2_000_000, poolTarget)),
        departmentsCsv: settings.departmentsCsv || "Engineering,Finance,Product,QA",
        usdtBnbAddress: settings.usdtBnbAddress || "0x1111111111111111111111111111111111111111",
        usdtTrxAddress: settings.usdtTrxAddress || "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
        terminationOptionExpiryDays: settings.terminationOptionExpiryDays ?? 90,
      };
      await prisma.globalSettings.update({
        where: { id: settings.id },
        data: next as never,
      });
    }

    await prisma.user.upsert({
      where: { account: "admin" },
      update: { email: "admin@esop.test", passwordHash: pw, role: "SUPER_ADMIN" } as never,
      create: { account: "admin", email: "admin@esop.test", passwordHash: pw, role: "SUPER_ADMIN" } as never,
      select: { id: true },
    });

    await prisma.user.upsert({
      where: { account: "evan" },
      update: { email: "evan@esop.test", passwordHash: pw, role: "SUPER_ADMIN" } as never,
      create: { account: "evan", email: "evan@esop.test", passwordHash: pw, role: "SUPER_ADMIN" } as never,
      select: { id: true },
    });

    async function upsertQaEmployee(input: {
      account: string;
      email: string;
      name: string;
      department: string;
    }) {
      const user = await prisma.user.upsert({
        where: { account: input.account },
        update: {},
        create: { account: input.account, email: input.email, passwordHash: pw, role: "EMPLOYEE" } as never,
        select: { id: true },
      });
      const existing = await prisma.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
      if (existing) return existing.id;
      const emp = await prisma.employee.create({
        data: {
          userId: user.id,
          name: input.name,
          department: input.department,
          startDate: new Date("2026-05-14T00:00:00.000Z"),
          status: "ACTIVE",
        } as never,
        select: { id: true },
      });
      return emp.id;
    }

    const [qaAliceId, qaMeId, qaPoolId, qaPrecId] = await Promise.all([
      upsertQaEmployee({ account: "qa_alice", email: "qa_alice@esop.test", name: "Alice Smith", department: "Finance" }),
      upsertQaEmployee({ account: "qa_me", email: "qa_me@esop.test", name: "QA User", department: "QA" }),
      upsertQaEmployee({ account: "qa_pool", email: "qa_pool@esop.test", name: "Pool Stress", department: "Finance" }),
      upsertQaEmployee({ account: "qa_precision", email: "qa_precision@esop.test", name: "Precision QA", department: "Engineering" }),
    ]);
    const qaCliffId = await upsertQaEmployee({
      account: "qa_cliff",
      email: "qa_cliff@esop.test",
      name: "Cliff QA",
      department: "QA",
    });

    const existingQaMeGrants = await prisma.grant.count({ where: { employeeId: qaMeId } });
    if (existingQaMeGrants === 0) {
      await createGrantWithVesting({
        employeeId: qaMeId,
        totalShares: 30300,
        grantDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 150),
        strikePrice: 2.0,
        lockupPeriodMonths: 0,
        vestingType: "CUSTOM_INSTALLMENTS",
        totalVestingDurationMonths: 12,
        vestingInstallments: 12,
      });
    }
    await prisma.exerciseRequest.deleteMany({ where: { employeeId: qaMeId, isBuybackOrCancel: false } });

    const existingAliceGrants = await prisma.grant.count({ where: { employeeId: qaAliceId } });
    if (existingAliceGrants === 0) {
      await createGrantWithVesting({
        employeeId: qaAliceId,
        totalShares: 100,
        grantDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
        strikePrice: 1.0,
        lockupPeriodMonths: 0,
        vestingType: "CUSTOM_INSTALLMENTS",
        totalVestingDurationMonths: 4,
        vestingInstallments: 4,
      });
    }

    const existingCliffGrants = await prisma.grant.count({ where: { employeeId: qaCliffId } });
    if (existingCliffGrants === 0) {
      await createGrantWithVesting({
        employeeId: qaCliffId,
        totalShares: 1200,
        grantDate: new Date("2026-05-14T00:00:00.000Z"),
        strikePrice: 1.5,
        lockupPeriodMonths: 0,
        vestingType: "CUSTOM_INSTALLMENTS",
        totalVestingDurationMonths: 12,
        vestingInstallments: 12,
      });
    }

    await request.get("/", { failOnStatusCode: false });
  } finally {
    await prisma.$disconnect();
  }
});

test("Admin: 375px→1920px 响应式无溢出 + 菜单不挤标题 + 搜索框居中", async ({ page }: { page: Page }) => {
  await login(page, "admin", "123456");
  await page.goto("/admin?focus=ledger", { waitUntil: "domcontentloaded" });

  await page.setViewportSize({ width: 375, height: 860 });
  const searchInput = page.locator('div.md\\:hidden.sticky.top-16 input[name="q"]').first();
  await expect(searchInput).toBeVisible();
  await searchInput.fill("Alice");
  const searchSubmit = page.locator('div.md\\:hidden.sticky.top-16 button[type="submit"]').first();
  await expect(searchSubmit).toBeVisible();
  await searchSubmit.click();
  await page.waitForURL((url: URL) => url.searchParams.get("q") === "Alice", { waitUntil: "domcontentloaded" });
  const backBtn = page.locator('[aria-label="返回上一页"],[aria-label="Back"]').first();
  await expect(backBtn).toBeVisible();
  await backBtn.click();
  await page.waitForURL((url: URL) => !url.searchParams.has("q"), { waitUntil: "domcontentloaded" });

  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 860 });
    await page.waitForTimeout(80);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    if (w <= 767) {
      const title = page.locator('text=ESOP 管理后台').first();
      const menu = page.locator('a[aria-label="菜单"],a[aria-label="選單"],a[aria-label="Menu"]').first();
      await expect(title).toBeVisible();
      await expect(menu).toBeVisible();

      const titleBox = await title.boundingBox();
      const menuBox = await menu.boundingBox();
      expect(titleBox).not.toBeNull();
      expect(menuBox).not.toBeNull();
      if (titleBox && menuBox) {
        expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(menuBox.x - 2);
      }

      const searchForm = page.locator('div.md\\:hidden.sticky.top-16 form').first();
      await expect(searchForm).toBeVisible();
      const searchBox = await searchForm.boundingBox();
      expect(searchBox).not.toBeNull();
      if (searchBox) {
        const center = searchBox.x + searchBox.width / 2;
        expect(Math.abs(center - w / 2)).toBeLessThanOrEqual(3);
      }
    }
  }
});

test("Me: 375px→1920px 进度条有填充 + 滑块联动【当前已绑定资产】 + 无横向溢出", async ({ page }: { page: Page }) => {
  await login(page, "qa_me", "123456");

  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/me?lang=zh-CN", { waitUntil: "domcontentloaded" });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    const progressFill = page.locator(".ui-progress-bar").first();
    await page.waitForTimeout(900);

    const progressMeta = await page
      .locator("text=期权成熟进度")
      .first()
      .locator("..")
      .evaluate((el: HTMLElement) => el.textContent ?? "");
    const m = progressMeta.match(/([0-9][0-9,]*)\s*\/\s*([0-9][0-9,]*)/);
    const vested = m ? Number(m[1].replaceAll(",", "")) : 0;
    const total = m ? Number(m[2].replaceAll(",", "")) : 0;
    const pct = total > 0 ? vested / total : 0;

    const fillInfo = await progressFill.evaluate((el: HTMLElement) => {
      const s = getComputedStyle(el);
      const t = s.transform || "";
      const inlineT = (el.style && typeof el.style.transform === "string" ? el.style.transform : "") || "";
      const bgImg = s.backgroundImage;
      const bgColor = s.backgroundColor;
      const src = t && t !== "none" ? t : inlineT || t;
      let scaleX = 0;
      try {
        const ctor = (globalThis as unknown as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly;
        if (typeof ctor === "function") {
          const m = new (ctor as new (t?: string) => { a: number })(src === "none" ? undefined : src);
          if (Number.isFinite(m.a)) scaleX = m.a;
        }
      } catch {
        // ignore
      }
      if (!Number.isFinite(scaleX) || scaleX === 0) {
        const sx = src.match(/scaleX\(([^)]+)\)/);
        if (sx) {
          const v = Number(sx[1].trim());
          if (Number.isFinite(v)) scaleX = v;
        }
      }
      return { scaleX, bgImg, bgColor };
    });
    if (pct > 0.01) expect(fillInfo.scaleX).toBeGreaterThan(0.01);
    const hasFillStyle =
      (fillInfo.bgImg && fillInfo.bgImg !== "none") ||
      (fillInfo.bgColor && fillInfo.bgColor !== "transparent" && fillInfo.bgColor !== "rgba(0, 0, 0, 0)");
    expect(hasFillStyle).toBeTruthy();

    if (w <= 767) {
      const bound = page.locator("#ui-bound-asset-usd").first();
      const range = page.locator('input[type="range"][id^="vision-range-"]').first();
      const reset = page.locator('button:has-text("回到实时")').first();
      const priceText = page.locator('span[id^="vision-price-"]').first();
      const hasBound = await bound.count();
      if (hasBound) {
        await expect(range).toBeVisible();
        await expect(reset).toBeVisible();
        const initialPrice = (await priceText.textContent()) ?? "";
        const before = (await bound.textContent()) ?? "";
        await range.evaluate((el: Element) => {
          const input = el as HTMLInputElement;
          const min = Number(input.min || "0");
          const max = Number(input.max || "0");
          const next = min + (max - min) * 0.6;
          input.value = String(next);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await page.waitForTimeout(80);
        const after = (await bound.textContent()) ?? "";
        expect(after).not.toBe(before);
        const movedPrice = (await priceText.textContent()) ?? "";
        expect(movedPrice).not.toBe(initialPrice);
        await reset.click();
        await page.waitForTimeout(120);
        const finalPrice = (await priceText.textContent()) ?? "";
        expect(finalPrice).toBe(initialPrice);
      }
    }
  }
});

test("Backend: 期权池容量不足精准拦截（无脏写）", async () => {
  const prisma = makePrisma();
  const settings = await prisma.globalSettings.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, totalOptionPoolShares: true } });
  expect(settings).not.toBeNull();
  const beforePool = settings?.totalOptionPoolShares ?? 0;
  try {
    const qaPool = await prisma.employee.findFirst({ where: { name: "Pool Stress" }, select: { id: true } });
    expect(qaPool).not.toBeNull();

    await prisma.grant.deleteMany({ where: { employeeId: qaPool!.id } });

    const [grantAgg, forfeitedAgg, buybackAgg] = await Promise.all([
      prisma.grant.aggregate({ _sum: { totalShares: true } }),
      prisma.vestingRecord.aggregate({ where: { status: "FORFEITED" }, _sum: { shares: true } }),
      prisma.exerciseRequest.aggregate({ where: { status: "COMPLETED", isBuybackOrCancel: true }, _sum: { requestedShares: true } }),
    ]);
    const used =
      Math.max(
        (grantAgg._sum.totalShares ?? 0) -
          (forfeitedAgg._sum.shares ?? 0) -
          (buybackAgg._sum.requestedShares ?? 0),
        0,
      );
    await prisma.globalSettings.update({
      where: { id: settings!.id },
      data: { totalOptionPoolShares: used + 50000 } as never,
    });

    await createGrantWithVesting({
      employeeId: qaPool!.id,
      totalShares: 40000,
      grantDate: new Date("2026-05-01T00:00:00.000Z"),
      strikePrice: 1.2,
      lockupPeriodMonths: 0,
      vestingType: "CUSTOM_INSTALLMENTS",
      totalVestingDurationMonths: 4,
      vestingInstallments: 4,
    });

    let failed = false;
    try {
      await createGrantWithVesting({
        employeeId: qaPool!.id,
        totalShares: 20000,
        grantDate: new Date("2026-05-02T00:00:00.000Z"),
        strikePrice: 1.2,
        lockupPeriodMonths: 0,
        vestingType: "CUSTOM_INSTALLMENTS",
        totalVestingDurationMonths: 4,
        vestingInstallments: 4,
      });
    } catch (e) {
      failed = String((e as Error)?.message ?? "").includes("POOL_EXCEEDED");
    }
    expect(failed).toBeTruthy();

    const sum = await prisma.grant.aggregate({ where: { employeeId: qaPool!.id }, _sum: { totalShares: true } });
    expect(sum._sum.totalShares ?? 0).toBe(40000);
  } finally {
    if (settings) {
      await prisma.globalSettings.update({
        where: { id: settings.id },
        data: { totalOptionPoolShares: beforePool } as never,
      });
    }
    await prisma.$disconnect();
  }
});

test("Backend: 33,333 股 / 3 期成熟精度一致（总和严格匹配）", async () => {
  const prisma = makePrisma();
  const settings = await prisma.globalSettings.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, totalOptionPoolShares: true } });
  expect(settings).not.toBeNull();
  const beforePool = settings?.totalOptionPoolShares ?? 0;
  try {
    const emp = await prisma.employee.findFirst({ where: { name: "Precision QA" }, select: { id: true } });
    expect(emp).not.toBeNull();

    const [grantAgg, forfeitedAgg, buybackAgg] = await Promise.all([
      prisma.grant.aggregate({ _sum: { totalShares: true } }),
      prisma.vestingRecord.aggregate({ where: { status: "FORFEITED" }, _sum: { shares: true } }),
      prisma.exerciseRequest.aggregate({ where: { status: "COMPLETED", isBuybackOrCancel: true }, _sum: { requestedShares: true } }),
    ]);
    const used = Math.max(
      (grantAgg._sum.totalShares ?? 0) - (forfeitedAgg._sum.shares ?? 0) - (buybackAgg._sum.requestedShares ?? 0),
      0,
    );
    await prisma.globalSettings.update({
      where: { id: settings!.id },
      data: { totalOptionPoolShares: Math.max(beforePool, used + 1_000_000) } as never,
    });

    const created = await createGrantWithVesting({
      employeeId: emp!.id,
      totalShares: 33333,
      grantDate: new Date("2026-05-14T00:00:00.000Z"),
      strikePrice: 0.333333,
      lockupPeriodMonths: 0,
      vestingType: "CUSTOM_INSTALLMENTS",
      totalVestingDurationMonths: 3,
      vestingInstallments: 3,
    });

    const agg = await prisma.vestingRecord.aggregate({
      where: { grantId: created.id },
      _sum: { shares: true },
      _count: { shares: true },
    });
    expect(agg._sum.shares ?? 0).toBe(33333);
    expect(agg._count.shares).toBe(3);
  } finally {
    if (settings) {
      await prisma.globalSettings.update({ where: { id: settings.id }, data: { totalOptionPoolShares: beforePool } as never });
    }
    await prisma.$disconnect();
  }
});

test("E2E: 中途入职（2026-05-14）+ 1 个月 Cliff（首期 2026-06-14）时间轴正确", async ({ page }: { page: Page }) => {
  await login(page, "qa_cliff", "123456");
  await page.setViewportSize({ width: 375, height: 920 });
  await page.goto("/me?lang=zh-CN", { waitUntil: "domcontentloaded" });

  const expected = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date("2026-06-14T00:00:00.000Z"),
  );
  await expect(page.locator(`text=下次成熟 ${expected}`).first()).toBeVisible();
});

test("Security: 绕过前端直接 POST 行权超额，后端必须 100% 拦截", async ({ page }: { page: Page }) => {
  const prisma = makePrisma();
  await login(page, "qa_me", "123456");
  await page.goto("/me?lang=zh-CN", { waitUntil: "domcontentloaded" });

  const txHash = "0x" + randomBytes(32).toString("hex");
  try {
    const user = await prisma.user.findUnique({ where: { account: "qa_me" }, select: { id: true } });
    const emp = await prisma.employee.findFirst({ where: { userId: user!.id }, select: { id: true } });
    expect(emp).not.toBeNull();

    const before = await prisma.exerciseRequest.count({ where: { employeeId: emp!.id, paymentTxHash: txHash } });
    expect(before).toBe(0);

    const res = await page.evaluate(async (input: { txHash: string }) => {
      const fd = new FormData();
      fd.set("shares", "999999");
      fd.set("chain", "BNB");
      fd.set("txHash", input.txHash);
      const r = await fetch("/api/exercise/submit", { method: "POST", body: fd });
      const j = await r.json();
      return { status: r.status, body: j as unknown };
    }, { txHash });
    expect(res.status).toBe(400);

    const after = await prisma.exerciseRequest.count({ where: { employeeId: emp!.id, paymentTxHash: txHash } });
    expect(after).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

test("E2E: 员工发起行权 -> 管理员完成 -> 员工侧状态更新", async ({ page }: { page: Page }) => {
  const prisma = makePrisma();
  const txHash = "0x" + randomBytes(32).toString("hex");
  try {
    const user = await prisma.user.findUnique({ where: { account: "qa_me" }, select: { id: true } });
    const emp = await prisma.employee.findFirst({ where: { userId: user!.id }, select: { id: true } });
    const settings = await prisma.globalSettings.findFirst({ orderBy: { createdAt: "desc" }, select: { usdtBnbAddress: true, sharePriceCurrency: true } });
    const grant = await prisma.grant.findFirst({ where: { employeeId: emp!.id }, orderBy: { grantDate: "asc" }, select: { id: true, strikePrice: true } });

    await prisma.exerciseRequest.deleteMany({ where: { employeeId: emp!.id, isBuybackOrCancel: false } });

    const shares = 10;
    const totalCost = (grant!.strikePrice as Prisma.Decimal).mul(shares);
    await prisma.exerciseRequest.create({
      data: {
        employeeId: emp!.id,
        grantId: grant!.id,
        requestedShares: shares,
        totalCost,
        paymentChain: "BNB",
        paymentToAddress: settings?.usdtBnbAddress ?? "0x1111111111111111111111111111111111111111",
        paymentTxHash: txHash,
        status: "FUNDED",
        paymentCheckedAt: new Date(),
        paymentVerifiedAt: new Date(),
        paymentCheckError: null,
        paymentRaw: { allocation: [{ grantId: grant!.id, shares }] } as never,
      } as never,
    });
  } finally {
    await prisma.$disconnect();
  }

  await login(page, "admin", "123456");
  await page.goto("/admin?focus=workbench", { waitUntil: "domcontentloaded" });

  const workbench = page.locator("#workbench").first();
  await expect(workbench).toBeVisible();
  const txShortAdmin = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
  const txLink = workbench.locator("a").filter({ hasText: txShortAdmin }).first();
  await expect(txLink).toBeVisible();
  const card = workbench.locator(`div.relative.rounded-2xl:has(a:has-text("${txShortAdmin}"))`).first();
  const completeBtn = card.locator("button").filter({ hasText: "检查到账并完成行权" }).first();
  await expect(completeBtn).toBeVisible();
  await expect(completeBtn).toBeEnabled();
  await Promise.all([
    page.waitForURL((url: URL) => url.searchParams.get("ok") === "EXERCISE_STATUS_UPDATED" && url.searchParams.get("nst") === "COMPLETED", {
      waitUntil: "domcontentloaded",
    }),
    completeBtn.click(),
  ]);
  await expect(workbench.locator("a").filter({ hasText: txShortAdmin })).toHaveCount(0);

  await login(page, "qa_me", "123456");
  await page.goto("/me?lang=zh-CN", { waitUntil: "domcontentloaded" });
  const txShort = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
  const tableRow = page.locator("table").locator("tr").filter({ hasText: txShort }).first();
  if (await tableRow.count()) {
    await expect(tableRow).toContainText("已行权完成");
  } else {
    const mobileCard = page.locator("div.sm\\:hidden").locator(`div:has-text("${txShort}")`).first();
    await expect(mobileCard).toContainText("已行权完成");
  }
});

test("Security: /api/admin/ledger/export 未登录返回 401", async ({ page }: { page: Page }) => {
  await page.context().clearCookies();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/admin/ledger/export", { method: "GET" });
    let j: unknown = null;
    try {
      j = await r.json();
    } catch {
      j = null;
    }
    return { status: r.status, body: j };
  });
  expect(res.status).toBe(401);
});

test("Security: 员工访问 /api/admin/ledger/export 返回 403", async ({ page }: { page: Page }) => {
  await login(page, "qa_me", "123456");
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/admin/ledger/export", { method: "GET" });
    let j: unknown = null;
    try {
      j = await r.json();
    } catch {
      j = null;
    }
    return { status: r.status, body: j };
  });
  expect(res.status).toBe(403);
});

test("Security: 行权金额篡改返回 400 + AMOUNT_TAMPERED", async ({ page }: { page: Page }) => {
  await login(page, "qa_me", "123456");
  await page.goto("/me?lang=zh-CN", { waitUntil: "domcontentloaded" });
  const txHash = `0x${"a".repeat(64)}`;
  const res = await page.evaluate(async (input: { txHash: string }) => {
    const fd = new FormData();
    fd.set("shares", "1000");
    fd.set("chain", "BNB");
    fd.set("txHash", input.txHash);
    fd.set("amountUsdt", "0.01");
    const r = await fetch("/api/exercise/submit", { method: "POST", body: fd });
    const j = await r.json();
    return { status: r.status, body: j as unknown };
  }, { txHash });
  expect(res.status).toBe(400);
  const body = res.body as { ok?: unknown; error?: unknown } | null;
  expect(body?.ok).toBe(false);
  expect(body?.error).toBe("AMOUNT_TAMPERED");
});

test("Security: 重复 TxHash 返回 409 + TXHASH_ALREADY_USED", async ({ page }: { page: Page }) => {
  await login(page, "qa_me", "123456");
  await page.goto("/me?lang=zh-CN", { waitUntil: "domcontentloaded" });
  const txHash = `0x${"b".repeat(64)}`;
  const r1 = await page.evaluate(async (input: { txHash: string }) => {
    const fd = new FormData();
    fd.set("shares", "1");
    fd.set("chain", "BNB");
    fd.set("txHash", input.txHash);
    const r = await fetch("/api/exercise/submit", { method: "POST", body: fd });
    const j = await r.json();
    return { status: r.status, body: j as unknown };
  }, { txHash });
  expect(r1.status).toBe(200);
  const r2 = await page.evaluate(async (input: { txHash: string }) => {
    const fd = new FormData();
    fd.set("shares", "1");
    fd.set("chain", "BNB");
    fd.set("txHash", input.txHash);
    const r = await fetch("/api/exercise/submit", { method: "POST", body: fd });
    const j = await r.json();
    return { status: r.status, body: j as unknown };
  }, { txHash });
  expect(r2.status).toBe(409);
  const body = r2.body as { ok?: unknown; error?: unknown } | null;
  expect(body?.ok).toBe(false);
  expect(body?.error).toBe("TXHASH_ALREADY_USED");
});

test("E2E: 退出登录后不可再访问 /me", async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1024, height: 860 });
  await login(page, "qa_me", "123456");
  await page.goto("/me?lang=zh-CN", { waitUntil: "domcontentloaded" });
  const logoutBtn = page.getByRole("link", { name: /退出/ }).first();
  await expect(logoutBtn).toBeVisible();
  await Promise.all([
    page.waitForURL((u: URL) => u.pathname === "/" || u.pathname === "/logout", { waitUntil: "domcontentloaded" }),
    logoutBtn.click(),
  ]);

  await page.goto("/me?lang=zh-CN", { waitUntil: "domcontentloaded" });
  await page.waitForURL((u: URL) => u.pathname === "/", { waitUntil: "domcontentloaded" });
});

test("Resiliency: 行权提交防重复 + 网络异常提示", async ({ page }: { page: Page }) => {
  await login(page, "qa_me", "123456");
  await page.goto("/me?lang=zh-CN&modal=exercise", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1");

  const exerciseModal = page.locator("#ui-exercise-modal").first();
  await expect(exerciseModal).toBeVisible();

  const notReadyToast = page.locator("div").filter({ hasText: "页面交互未就绪" }).first();
  if (await notReadyToast.count()) {
    const close = notReadyToast.getByRole("button", { name: "关闭" }).first();
    if (await close.count()) await close.click();
  }

  await exerciseModal.locator('input[name="shares"]').fill("1");
  await exerciseModal.locator("button:visible").filter({ hasText: "下一步" }).first().click();
  const txHash = "0x" + randomBytes(32).toString("hex");
  await exerciseModal.locator('input[name="txHash"]').fill(txHash);

  let hit = 0;
  await page.route("**/api/exercise/submit", async (route) => {
    hit += 1;
    await route.abort();
  });

  const submitBtn = exerciseModal.locator("button:visible").filter({ hasText: "提交" }).first();
  await page.evaluate(() => {
    const root = document.getElementById("ui-exercise-modal");
    const tx = root?.querySelector('input[name="txHash"]') as HTMLInputElement | null;
    const form = tx?.closest("form") as HTMLFormElement | null;
    if (!form) return;
    form.requestSubmit();
    form.requestSubmit();
    form.requestSubmit();
  });

  await expect(exerciseModal.locator("div").filter({ hasText: "准备提交" }).first()).toBeVisible();
  await page.waitForTimeout(3300);
  expect(hit).toBe(1);
  await expect(exerciseModal.locator("div").filter({ hasText: "网络异常" }).first()).toBeVisible();
  await expect(submitBtn).toBeEnabled();
  await page.unroute("**/api/exercise/submit");
});
