import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHash(pw: string) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

function forbid() {
  return new NextResponse("Forbidden", { status: 403 });
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("run") !== "1") {
    return NextResponse.json({
      ok: false,
      hint: "Add ?run=1 to execute seeding.",
    });
  }

  const host = String(req.headers.get("host") ?? "");
  const isLocalHost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const envKey = String(process.env.SEED_KEY ?? "").trim();
  const key = String(url.searchParams.get("key") ?? "").trim();
  if (envKey) {
    if (key !== envKey) return forbid();
  } else {
    if (!isLocalHost) return forbid();
  }

  const pw = hashPassword("123456");

  const ensureUser = (input: {
    account: string;
    email: string;
    role?: "SUPER_ADMIN" | "FINANCE" | "EMPLOYEE";
  }) =>
    prisma.user.upsert({
      where: { account: input.account } as never,
      update: { email: input.email, role: (input.role ?? "EMPLOYEE") as never, passwordHash: pw } as never,
      create: { account: input.account, email: input.email, passwordHash: pw, role: (input.role ?? "EMPLOYEE") } as never,
    });

  // Create Users
  const admin = await ensureUser({ account: "admin", email: "admin@esop.test", role: "SUPER_ADMIN" });
  const finance = await ensureUser({ account: "finance", email: "finance@esop.test", role: "FINANCE" });
  const u1 = await ensureUser({ account: "alice", email: "alice@test.com" });
  const u2 = await ensureUser({ account: "bob", email: "bob@test.com" });
  const u3 = await ensureUser({ account: "charlie", email: "charlie@test.com" });
  const u4 = await ensureUser({ account: "diana", email: "diana@test.com" });
  const u5 = await ensureUser({ account: "eve", email: "eve@test.com" });
  const u6 = await ensureUser({ account: "frank", email: "frank@test.com" });
  const uPan = await ensureUser({ account: "panhaixiang", email: "panhaixiang@test.com" });
  const uEarly = await ensureUser({ account: "early2017", email: "early2017@test.com" });
  const cUsers: Array<{ account: string; userId: string; name: string }> = [];
  for (let i = 0; i < 10; i++) {
    const account = `stress${String(i + 1).padStart(2, "0")}`;
    const u = await ensureUser({
      account,
      email: `${account}@test.com`,
    });
    cUsers.push({ account, userId: u.id, name: `审批压力测试 ${String(i + 1).padStart(2, "0")}` });
  }

  // Create Departments
  await prisma.department.upsert({ where: { name: "Engineering" }, update: {}, create: { name: "Engineering" } });
  await prisma.department.upsert({ where: { name: "Sales" }, update: {}, create: { name: "Sales" } });
  await prisma.department.upsert({ where: { name: "Finance" }, update: {}, create: { name: "Finance" } });
  await prisma.department.upsert({ where: { name: "品牌部" }, update: {}, create: { name: "品牌部" } });

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);

  await prisma.globalSettings.upsert({
    where: { id: "seed-global-settings" },
    update: {
      companyName: "XMax Inc",
      totalOptionPoolShares: 1_000_000,
      sharePriceTicker: "xwin",
      sharePriceCurrency: "USD",
      usdtBnbAddress: "0x000000000000000000000000000000000000dEaD",
      usdtTrxAddress: "TQJqvQduyVx1k8oUGm7K4aY7wCwCwCwCwC",
      terminationOptionExpiryDays: 90,
    } as never,
    create: {
      id: "seed-global-settings",
      companyName: "XMax Inc",
      totalOptionPoolShares: 1_000_000,
      sharePriceTicker: "xwin",
      sharePriceCurrency: "USD",
      usdtBnbAddress: "0x000000000000000000000000000000000000dEaD",
      usdtTrxAddress: "TQJqvQduyVx1k8oUGm7K4aY7wCwCwCwCwC",
      terminationOptionExpiryDays: 90,
    } as never,
  });

  const ensureSharePriceHistory = async (input: {
    ticker: string;
    currency: "USD" | "HKD" | "CNY";
    fromIso: string;
    toIso: string;
  }) => {
    const ticker = input.ticker.trim();
    if (!ticker) return;
    const from = new Date(`${input.fromIso}T00:00:00.000Z`);
    const to = new Date(`${input.toIso}T00:00:00.000Z`);
    if (!(from.getTime() <= to.getTime())) return;

    const rows: Array<{ date: string; close: number }> = [];
    const start = from.getTime();
    const end = to.getTime();
    const stepDays = 7;
    const steps = Math.max(1, Math.floor((end - start) / (stepDays * 24 * 60 * 60 * 1000)));
    let d = new Date(from);
    d.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i <= steps; i++) {
      const iso = d.toISOString().slice(0, 10);
      const t = Math.min(1, Math.max(0, (d.getTime() - start) / (end - start)));
      const base = 0.8 + t * 7.5;
      const wobble = Math.sin(i * 0.9) * 0.15;
      rows.push({ date: iso, close: Math.max(0.01, Number((base + wobble).toFixed(4))) });
      d = new Date(d.getTime() + stepDays * 24 * 60 * 60 * 1000);
    }
    if (!rows.some((r) => r.date === todayIso)) {
      rows.push({ date: todayIso, close: Math.max(0.01, Number((8.45 + Math.sin(steps) * 0.1).toFixed(4))) });
    }

    const existing = await prisma.sharePriceHistory.findMany({
      where: { ticker, date: { in: rows.map((r) => r.date) } } as never,
      select: { date: true } as never,
    });
    const existingRows = existing as unknown as Array<{ date: string }>;
    const have = new Set(existingRows.map((r) => String(r.date)));
    const toCreate = rows.filter((r) => !have.has(r.date));
    for (let i = 0; i < toCreate.length; i += 200) {
      const chunk = toCreate.slice(i, i + 200);
      if (chunk.length === 0) continue;
      await prisma.sharePriceHistory.createMany({
        data: chunk.map((r) => ({
          ticker,
          currency: input.currency,
          date: r.date,
          close: r.close,
        })) as never,
      });
    }
  };

  await ensureSharePriceHistory({ ticker: "xwin", currency: "USD", fromIso: "2017-01-01", toIso: todayIso });

  const ensureVestingRecords = async (input: {
    grantId: string;
    employeeId: string;
    rows: Array<{ vestDate: Date; shares: number; status: "UNVESTED" | "VESTED" | "FORFEITED" }>;
  }) => {
    const existing = (await prisma.vestingRecord.findMany({
      where: { grantId: input.grantId } as never,
      select: { vestDate: true } as never,
    })) as unknown as Array<{ vestDate: Date }>;
    const have = new Set(existing.map((x) => x.vestDate.toISOString()));
    for (const r of input.rows) {
      const key = r.vestDate.toISOString();
      if (have.has(key)) continue;
      await prisma.vestingRecord.create({
        data: { grantId: input.grantId, employeeId: input.employeeId, ...r } as never,
      });
    }
  };

  // Create Employees
  await prisma.employee.upsert({
    where: { userId: admin.id },
    update: {},
    create: { name: "总管理员", department: "品牌部", startDate: new Date("2020-01-01"), status: "ACTIVE", userId: admin.id } as never,
  });
  await prisma.employee.upsert({
    where: { userId: finance.id },
    update: {},
    create: { name: "财务管理员", department: "Finance", startDate: new Date("2021-01-01"), status: "ACTIVE", userId: finance.id } as never,
  });

  const e1 = await prisma.employee.upsert({
    where: { userId: u1.id },
    update: {},
    create: { name: "Alice Smith", department: "Engineering", startDate: new Date("2022-01-01"), status: "ACTIVE", userId: u1.id },
  });
  const e2 = await prisma.employee.upsert({
    where: { userId: u2.id },
    update: {},
    create: {
      name: "Bob Jones",
      department: "Sales",
      startDate: new Date("2021-06-01"),
      status: "TERMINATED",
      terminatedAt: new Date("2023-12-01"),
      userId: u2.id,
    },
  });
  const e3 = await prisma.employee.upsert({
    where: { userId: u3.id },
    update: {},
    create: { name: "Charlie Brown", department: "Engineering", startDate: new Date("2024-01-01"), status: "ACTIVE", userId: u3.id },
  });
  const e4 = await prisma.employee.upsert({
    where: { userId: u4.id },
    update: {},
    create: { name: "Diana Prince", department: "Sales", startDate: new Date("2020-01-01"), status: "ACTIVE", userId: u4.id },
  });
  const e5 = await prisma.employee.upsert({
    where: { userId: u5.id },
    update: {},
    create: { name: "Eve Zhang", department: "Finance", startDate: new Date("2025-03-01"), status: "ACTIVE", userId: u5.id },
  });
  const e6 = await prisma.employee.upsert({
    where: { userId: u6.id },
    update: {},
    create: { name: "Frank Li", department: "Engineering", startDate: new Date("2019-06-01"), status: "ACTIVE", userId: u6.id },
  });

  // Scenario B: Pan HaiXiang with 3 grants
  const ePan = await prisma.employee.upsert({
    where: { userId: uPan.id },
    update: {},
    create: { name: "潘海祥", department: "品牌部", startDate: new Date("2020-03-01"), status: "ACTIVE", userId: uPan.id } as never,
  });

  // Scenario A: early employee (2017)
  const eEarly = await prisma.employee.upsert({
    where: { userId: uEarly.id },
    update: {},
    create: { name: "早期员工·2017", department: "Engineering", startDate: new Date("2017-01-10"), status: "ACTIVE", userId: uEarly.id } as never,
  });

  // Scenario C: approval pressure employees
  const cEmployees: Array<{ employee: Awaited<ReturnType<typeof prisma.employee.upsert>>; name: string }> = [];
  for (const cu of cUsers) {
    const e = await prisma.employee.upsert({
      where: { userId: cu.userId },
      update: {},
      create: { name: cu.name, department: "Engineering", startDate: new Date("2024-01-01"), status: "ACTIVE", userId: cu.userId } as never,
    });
    cEmployees.push({ employee: e, name: cu.name });
  }

  // Alice: 1 grant, standard 4 year
  const gAlice = await prisma.grant.upsert({
    where: { agreementNo: "G-ALICE-1" },
    update: {},
    create: {
      agreementNo: "G-ALICE-1",
      employeeId: e1.id,
      totalShares: 40000,
      grantDate: new Date("2022-01-01"),
      strikePrice: 0.1,
      vestingType: "STANDARD_FOUR_YEAR_ONE_YEAR_CLIFF",
      vestingYears: 4,
      cliffMonths: 12,
      cliffPercent: 0.25,
    },
  });
  await ensureVestingRecords({
    grantId: gAlice.id,
    employeeId: e1.id,
    rows: [
      { vestDate: new Date("2023-01-01"), shares: 10000, status: "VESTED" },
      { vestDate: new Date("2024-01-01"), shares: 10000, status: "VESTED" },
      { vestDate: new Date("2025-01-01"), shares: 10000, status: "UNVESTED" },
      { vestDate: new Date("2026-01-01"), shares: 10000, status: "UNVESTED" },
    ],
  });

  // Bob: Terminated, forfeited some
  const gBob = await prisma.grant.upsert({
    where: { agreementNo: "G-BOB-1" },
    update: {},
    create: {
      agreementNo: "G-BOB-1",
      employeeId: e2.id,
      totalShares: 20000,
      grantDate: new Date("2021-06-01"),
      strikePrice: 0.5,
      vestingType: "STANDARD_FOUR_YEAR_ONE_YEAR_CLIFF",
      vestingYears: 4,
      cliffMonths: 12,
      cliffPercent: 0.25,
    },
  });
  await ensureVestingRecords({
    grantId: gBob.id,
    employeeId: e2.id,
    rows: [
      { vestDate: new Date("2022-06-01"), shares: 5000, status: "VESTED" },
      { vestDate: new Date("2023-06-01"), shares: 5000, status: "VESTED" },
      { vestDate: new Date("2024-06-01"), shares: 5000, status: "FORFEITED" },
      { vestDate: new Date("2025-06-01"), shares: 5000, status: "FORFEITED" },
    ],
  });

  // Diana: Exercised some
  const dGrant = await prisma.grant.upsert({
    where: { agreementNo: "G-DIANA-1" },
    update: {},
    create: {
      agreementNo: "G-DIANA-1",
      employeeId: e4.id,
      totalShares: 100000,
      grantDate: new Date("2020-01-01"),
      strikePrice: 0.01,
      vestingType: "STANDARD_FOUR_YEAR_ONE_YEAR_CLIFF",
      vestingYears: 4,
      cliffMonths: 12,
      cliffPercent: 0.25,
    },
  });
  await ensureVestingRecords({
    grantId: dGrant.id,
    employeeId: e4.id,
    rows: [
      { vestDate: new Date("2021-01-01"), shares: 25000, status: "VESTED" },
      { vestDate: new Date("2022-01-01"), shares: 25000, status: "VESTED" },
      { vestDate: new Date("2023-01-01"), shares: 25000, status: "VESTED" },
      { vestDate: new Date("2024-01-01"), shares: 25000, status: "VESTED" },
    ],
  });

  const gFrank = await prisma.grant.upsert({
    where: { agreementNo: "G-FRANK-1" },
    update: {},
    create: {
      agreementNo: "G-FRANK-1",
      employeeId: e6.id,
      totalShares: 300000,
      grantDate: new Date("2019-06-01"),
      strikePrice: 0.2,
      vestingType: "IMMEDIATE",
      vestingYears: 1,
      cliffMonths: 0,
      cliffPercent: 1,
    },
  });
  await ensureVestingRecords({
    grantId: gFrank.id,
    employeeId: e6.id,
    rows: [{ vestDate: new Date("2019-06-01"), shares: 300000, status: "VESTED" }],
  });

  // Scenario A: Early employee grant (500,000 @ $0.1)
  const gEarly = await prisma.grant.upsert({
    where: { agreementNo: "G-EARLY-2017" },
    update: {},
    create: {
      agreementNo: "G-EARLY-2017",
      employeeId: eEarly.id,
      totalShares: 500000,
      grantDate: new Date("2017-01-10"),
      strikePrice: 0.1,
      vestingType: "STANDARD_FOUR_YEAR_ONE_YEAR_CLIFF",
      vestingYears: 4,
      cliffMonths: 12,
      cliffPercent: 0.25,
    } as never,
  });
  await ensureVestingRecords({
    grantId: gEarly.id,
    employeeId: eEarly.id,
    rows: [
      { vestDate: new Date("2018-01-10"), shares: 125000, status: "VESTED" },
      { vestDate: new Date("2019-01-10"), shares: 125000, status: "VESTED" },
      { vestDate: new Date("2020-01-10"), shares: 125000, status: "VESTED" },
      { vestDate: new Date("2021-01-10"), shares: 125000, status: "VESTED" },
    ],
  });

  // Scenario B: Pan HaiXiang 3 grants (different vesting stages)
  const gP1 = await prisma.grant.upsert({
    where: { agreementNo: "GRANT-2025-001" },
    update: {},
    create: {
      agreementNo: "GRANT-2025-001",
      employeeId: ePan.id,
      totalShares: 100000,
      grantDate: new Date("2025-01-01"),
      strikePrice: 1.0,
      vestingType: "STANDARD_FOUR_YEAR_ONE_YEAR_CLIFF",
      vestingYears: 4,
      cliffMonths: 12,
      cliffPercent: 0.25,
    } as never,
  });
  await ensureVestingRecords({
    grantId: gP1.id,
    employeeId: ePan.id,
    rows: [
      { vestDate: new Date("2026-01-01"), shares: 25000, status: "UNVESTED" },
      { vestDate: new Date("2027-01-01"), shares: 25000, status: "UNVESTED" },
      { vestDate: new Date("2028-01-01"), shares: 25000, status: "UNVESTED" },
      { vestDate: new Date("2029-01-01"), shares: 25000, status: "UNVESTED" },
    ],
  });

  const gP2 = await prisma.grant.upsert({
    where: { agreementNo: "GRANT-2025-002" },
    update: {},
    create: {
      agreementNo: "GRANT-2025-002",
      employeeId: ePan.id,
      totalShares: 80000,
      grantDate: new Date("2024-01-01"),
      strikePrice: 0.5,
      vestingType: "STANDARD_FOUR_YEAR_ONE_YEAR_CLIFF",
      vestingYears: 4,
      cliffMonths: 12,
      cliffPercent: 0.25,
    } as never,
  });
  await ensureVestingRecords({
    grantId: gP2.id,
    employeeId: ePan.id,
    rows: [
      { vestDate: new Date("2025-01-01"), shares: 20000, status: "VESTED" },
      { vestDate: new Date("2026-01-01"), shares: 20000, status: "UNVESTED" },
      { vestDate: new Date("2027-01-01"), shares: 20000, status: "UNVESTED" },
      { vestDate: new Date("2028-01-01"), shares: 20000, status: "UNVESTED" },
    ],
  });

  const gP3 = await prisma.grant.upsert({
    where: { agreementNo: "GRANT-2025-003" },
    update: {},
    create: {
      agreementNo: "GRANT-2025-003",
      employeeId: ePan.id,
      totalShares: 60000,
      grantDate: new Date("2022-06-01"),
      strikePrice: 0.2,
      vestingType: "STANDARD_FOUR_YEAR_ONE_YEAR_CLIFF",
      vestingYears: 4,
      cliffMonths: 12,
      cliffPercent: 0.25,
    } as never,
  });
  await ensureVestingRecords({
    grantId: gP3.id,
    employeeId: ePan.id,
    rows: [
      { vestDate: new Date("2023-06-01"), shares: 15000, status: "VESTED" },
      { vestDate: new Date("2024-06-01"), shares: 15000, status: "VESTED" },
      { vestDate: new Date("2025-06-01"), shares: 15000, status: "UNVESTED" },
      { vestDate: new Date("2026-06-01"), shares: 15000, status: "UNVESTED" },
    ],
  });

  const ensureExercise = async (idempotencyKey: string, data: Parameters<typeof prisma.exerciseRequest.create>[0]["data"]) => {
    const existing = await prisma.exerciseRequest.findFirst({ where: { clientRequestId: idempotencyKey } });
    if (existing) return existing;
    return prisma.exerciseRequest.create({ data: { ...data, clientRequestId: idempotencyKey } });
  };

  await ensureExercise("seed-diana-pending", {
    employeeId: e4.id,
    grantId: dGrant.id,
    requestedShares: 20000,
    totalCost: 200,
    status: "PENDING",
    paymentChain: "BNB",
    paymentToAddress: "0x123",
    paymentTxHash: "0xseed_diana_pending",
  });
  await ensureExercise("seed-alice-funded", {
    employeeId: e1.id,
    grantId: gAlice.id,
    requestedShares: 5000,
    totalCost: 500,
    status: "FUNDED",
    paymentChain: "TRX",
    paymentToAddress: "TSeedAddress123",
    paymentTxHash: "seed_trx_alice_funded",
    paymentCheckedAt: new Date("2026-05-10T10:00:00.000Z"),
  });
  await ensureExercise("seed-frank-completed", {
    employeeId: e6.id,
    grantId: gFrank.id,
    requestedShares: 10000,
    totalCost: 2000,
    status: "COMPLETED",
    paymentChain: "BNB",
    paymentToAddress: "0xSeedFrankAddress",
    paymentTxHash: "0xseed_frank_completed",
    paymentCheckedAt: new Date("2026-05-09T10:00:00.000Z"),
    paymentVerifiedAt: new Date("2026-05-09T10:05:00.000Z"),
    completedAt: new Date("2026-05-09T10:10:00.000Z"),
  });
  await ensureExercise("seed-bob-buyback", {
    employeeId: e2.id,
    grantId: gBob.id,
    requestedShares: 5000,
    totalCost: 0,
    status: "PENDING",
    isBuybackOrCancel: true,
  });

  // Scenario C: 10 pending exercise requests (workbench pressure)
  for (let i = 0; i < cEmployees.length; i++) {
    const e = cEmployees[i]!.employee;
    const g = await prisma.grant.upsert({
      where: { agreementNo: `G-STRESS-${String(i + 1).padStart(2, "0")}` },
      update: {},
      create: {
        agreementNo: `G-STRESS-${String(i + 1).padStart(2, "0")}`,
        employeeId: e.id,
        totalShares: 10000,
        grantDate: new Date("2024-01-01"),
        strikePrice: 0.3,
        vestingType: "IMMEDIATE",
        vestingYears: 1,
        cliffMonths: 0,
        cliffPercent: 1,
      } as never,
    });
    await ensureVestingRecords({
      grantId: g.id,
      employeeId: e.id,
      rows: [{ vestDate: new Date("2024-01-01"), shares: 10000, status: "VESTED" }],
    });

    await ensureExercise(`seed-stress-pending-${String(i + 1).padStart(2, "0")}`, {
      employeeId: e.id,
      grantId: g.id,
      requestedShares: 5000,
      totalCost: 1500,
      status: "PENDING",
      paymentChain: "TRX",
      paymentToAddress: "TStressAddress",
      paymentTxHash: `seed_trx_stress_${String(i + 1).padStart(2, "0")}`,
    });
  }

  // Scenario D: terminated employee with expiry 2 days left + pending buyback
  const uTerm = await ensureUser({ account: "leavingSoon", email: "leavingSoon@test.com" });
  const terminatedAt = new Date(now.getTime() - (90 - 2) * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
  const eTerm = await prisma.employee.upsert({
    where: { userId: uTerm.id },
    update: { status: "TERMINATED" as never, terminatedAt: terminatedAt as never },
    create: {
      name: "离职员工·剩余2天",
      department: "Sales",
      startDate: new Date("2022-01-01"),
      status: "TERMINATED",
      terminatedAt,
      userId: uTerm.id,
    } as never,
  });
  const gTerm = await prisma.grant.upsert({
    where: { agreementNo: "G-TERM-EXPIRY" },
    update: {},
    create: {
      agreementNo: "G-TERM-EXPIRY",
      employeeId: eTerm.id,
      totalShares: 20000,
      grantDate: new Date("2022-01-01"),
      strikePrice: 0.4,
      vestingType: "STANDARD_FOUR_YEAR_ONE_YEAR_CLIFF",
      vestingYears: 4,
      cliffMonths: 12,
      cliffPercent: 0.25,
    } as never,
  });
  await ensureVestingRecords({
    grantId: gTerm.id,
    employeeId: eTerm.id,
    rows: [
      { vestDate: new Date("2023-01-01"), shares: 5000, status: "VESTED" },
      { vestDate: new Date("2024-01-01"), shares: 5000, status: "VESTED" },
      { vestDate: new Date("2025-01-01"), shares: 5000, status: "UNVESTED" },
      { vestDate: new Date("2026-01-01"), shares: 5000, status: "UNVESTED" },
    ],
  });
  await ensureExercise("seed-term-buyback", {
    employeeId: eTerm.id,
    grantId: gTerm.id,
    requestedShares: 5000,
    totalCost: 0,
    status: "PENDING",
    isBuybackOrCancel: true,
  });

  return NextResponse.json({
    ok: true,
    accounts: [
      { account: "admin", password: "123456" },
      { account: "finance", password: "123456" },
      { account: "alice", password: "123456" },
      { account: "bob", password: "123456" },
      { account: "charlie", password: "123456" },
      { account: "diana", password: "123456" },
      { account: "eve", password: "123456" },
      { account: "frank", password: "123456" },
      { account: "panhaixiang", password: "123456" },
      { account: "early2017", password: "123456" },
      { account: "leavingSoon", password: "123456" },
      ...cUsers.map((x) => ({ account: x.account, password: "123456" })),
    ],
  });
}
