import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  generateCustomInstallmentsVestingSchedule,
  generateImmediateVestingSchedule,
} from "@/lib/vesting";

export async function matureVestingRecords(now = new Date()) {
  const result = await prisma.vestingRecord.updateMany({
    where: {
      status: "UNVESTED",
      vestDate: { lte: now },
    },
    data: {
      status: "VESTED",
    },
  });

  return result.count;
}

export async function handleEmployeeTermination(input: {
  employeeId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  const forfeited = await prisma.vestingRecord.updateMany({
    where: {
      employeeId: input.employeeId,
      status: "UNVESTED",
      vestDate: { gt: now },
    },
    data: {
      status: "FORFEITED",
    },
  });

  const existingPendingBuyback = await prisma.exerciseRequest.findFirst({
    where: {
      employeeId: input.employeeId,
      isBuybackOrCancel: true,
      status: { in: ["PENDING", "FUNDED"] },
    },
    select: { id: true },
  });

  const completedExercises = await prisma.exerciseRequest.aggregate({
    where: {
      employeeId: input.employeeId,
      status: "COMPLETED",
      isBuybackOrCancel: false,
    },
    _sum: {
      requestedShares: true,
      totalCost: true,
    },
  });

  const exercisedShares = completedExercises._sum.requestedShares ?? 0;
  const buybackTotalCost = completedExercises._sum.totalCost ?? new Prisma.Decimal(0);

  if (exercisedShares > 0 && !existingPendingBuyback) {
    try {
      await prisma.exerciseRequest.create({
        data: {
          clientRequestId: `buyback:${input.employeeId}`,
          employeeId: input.employeeId,
          requestedShares: exercisedShares,
          totalCost: buybackTotalCost,
          status: "PENDING",
          isBuybackOrCancel: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // ignore duplicate
      } else {
        throw e;
      }
    }
  }

  return {
    forfeitedUnvestedCount: forfeited.count,
    exercisedShares,
    buybackTotalCost,
  };
}

export async function setEmployeeStatus(input: {
  employeeId: string;
  status: "ACTIVE" | "TERMINATED";
}) {
  const existing = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { status: true, terminatedAt: true, user: { select: { role: true } } },
  });
  if (!existing) {
    return null;
  }
  const userRole = (existing.user?.role ?? "") as string;
  if (userRole === "SUPER_ADMIN" || userRole === "FINANCE") {
    return existing;
  }

  const terminatedAt =
    input.status === "TERMINATED"
      ? existing?.terminatedAt ?? new Date()
      : null;

  const updated = await prisma.employee.update({
    where: { id: input.employeeId },
    data: { status: input.status, terminatedAt },
  });

  if (existing.status !== "TERMINATED" && input.status === "TERMINATED") {
    await handleEmployeeTermination({ employeeId: input.employeeId });
  }

  return updated;
}

export async function upsertGlobalSettings(input: {
  companySharePrice: number;
  totalOptionPoolShares: number;
  terminationOptionExpiryDays?: number;
}) {
  const existing = await prisma.globalSettings.findFirst({ select: { id: true } });
  const companySharePrice = new Prisma.Decimal(input.companySharePrice);
  const terminationOptionExpiryDays = Math.max(
    0,
    Math.floor(Number(input.terminationOptionExpiryDays ?? 90)),
  );

  if (!existing) {
    return prisma.globalSettings.create({
      data: {
        companySharePrice,
        totalOptionPoolShares: Math.floor(input.totalOptionPoolShares),
        terminationOptionExpiryDays,
      },
    });
  }

  return prisma.globalSettings.update({
    where: { id: existing.id },
    data: {
      companySharePrice,
      totalOptionPoolShares: Math.floor(input.totalOptionPoolShares),
      terminationOptionExpiryDays,
    },
  });
}

export async function createGrantWithVesting(input: {
  agreementNo?: string;
  employeeId: string;
  totalShares: number;
  grantDate: Date;
  strikePrice: number;
  lockupPeriodMonths?: number;
  vestingType?: "IMMEDIATE" | "CUSTOM_INSTALLMENTS";
  totalVestingDurationMonths?: number;
  vestingInstallments?: number;
}) {
  const totalShares = Math.floor(input.totalShares);
  const vestingType = input.vestingType ?? "CUSTOM_INSTALLMENTS";
  const totalVestingDurationMonths = Math.max(
    0,
    Math.floor(Number(input.totalVestingDurationMonths ?? 0)),
  );
  const vestingInstallments = Math.max(
    0,
    Math.floor(Number(input.vestingInstallments ?? 0)),
  );

  const schedule =
    vestingType === "IMMEDIATE"
      ? generateImmediateVestingSchedule({
          totalShares,
          grantDate: input.grantDate,
        })
      : generateCustomInstallmentsVestingSchedule({
          totalShares,
          grantDate: input.grantDate,
          totalVestingDurationMonths,
          vestingInstallments,
        });

  if (schedule.length === 0) {
    const invalid = new Error("INVALID_VESTING_CONFIG") as Error & { status?: number };
    invalid.status = 400;
    throw invalid;
  }

  const scheduleSum = schedule.reduce((sum, x) => sum + Math.floor(x.shares), 0);
  if (scheduleSum !== totalShares) {
    const invalid = new Error("VESTING_SUM_MISMATCH") as Error & { status?: number };
    invalid.status = 400;
    throw invalid;
  }

  const lockupPeriodMonths = Math.max(0, Math.floor(Number(input.lockupPeriodMonths ?? 0)));

  for (let attempt = 0; attempt < 3; attempt++) {
    const agreementNo =
      (input.agreementNo ?? "").trim() || (await generateNextAgreementNo(input.grantDate));

    try {
      const data = {
        agreementNo,
        employeeId: input.employeeId,
        totalShares,
        grantDate: input.grantDate,
        strikePrice: new Prisma.Decimal(input.strikePrice),
        lockupPeriodMonths,
        vestingType:
          vestingType === "IMMEDIATE" ? "IMMEDIATE" : "CUSTOM_INSTALLMENTS",
        totalVestingDurationMonths:
          vestingType === "CUSTOM_INSTALLMENTS" ? totalVestingDurationMonths : null,
        vestingInstallments:
          vestingType === "CUSTOM_INSTALLMENTS" ? vestingInstallments : null,
        vestingRecords: {
          create: schedule.map((v) => ({
            employeeId: input.employeeId,
            vestDate: v.vestDate,
            shares: v.shares,
            status: v.vestDate <= new Date() ? "VESTED" : "UNVESTED",
          })),
        },
      } as unknown as Prisma.GrantUncheckedCreateInput;

      return await prisma.$transaction(async (tx) => {
        const [settings, grantAgg, forfeitedAgg, buybackCompletedAgg] = await Promise.all([
          tx.globalSettings.findFirst({
            orderBy: { createdAt: "desc" },
            select: { totalOptionPoolShares: true } as never,
          }),
          tx.grant.aggregate({ _sum: { totalShares: true } }),
          tx.vestingRecord.aggregate({
            where: { status: "FORFEITED" },
            _sum: { shares: true },
          }),
          tx.exerciseRequest.aggregate({
            where: { status: "COMPLETED", isBuybackOrCancel: true },
            _sum: { requestedShares: true },
          }),
        ]);
        const totalPool = (settings as unknown as { totalOptionPoolShares?: number | null } | null)
          ?.totalOptionPoolShares ?? 0;
        const granted = grantAgg._sum.totalShares ?? 0;
        const forfeited = forfeitedAgg._sum.shares ?? 0;
        const buybackReturned = buybackCompletedAgg._sum.requestedShares ?? 0;
        const used = Math.max(granted - forfeited - buybackReturned, 0);
        const remaining = Math.max(totalPool - used, 0);
        if (remaining < totalShares) {
          const invalid = new Error("POOL_EXCEEDED") as Error & { status?: number };
          invalid.status = 400;
          throw invalid;
        }

        return tx.grant.create({
          data,
          include: {
            vestingRecords: true,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        continue;
      }
      throw e;
    }
  }

  throw new Error("AGREEMENT_NO_GENERATION_FAILED");
}

export async function generateNextAgreementNo(grantDate: Date) {
  const year = grantDate.getFullYear();
  const prefix = `GRANT-${year}-`;

  const recent = await prisma.grant.findMany({
    where: { agreementNo: { startsWith: prefix } },
    orderBy: { agreementNo: "desc" },
    select: { agreementNo: true },
    take: 50,
  });

  const re = new RegExp(`^GRANT-${year}-(\\d{3})$`);
  const lastNo = recent.map((x) => x.agreementNo).find((x) => re.test(x)) ?? "";
  const m = re.exec(lastNo);
  const next = m ? Number(m[1]) + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export async function createExerciseRequest(_input: {
  employeeId: string;
  grantId: string;
  requestedShares: number;
  clientRequestId?: string;
}) {
  void _input;
  const forbidden = new Error("FORBIDDEN") as Error & { status: number };
  forbidden.status = 403;
  throw forbidden;
}

function decimalToMinorUnits(input: Prisma.Decimal, decimals: number) {
  const s = input.toFixed(decimals);
  const [whole, fracRaw] = s.split(".");
  const frac = (fracRaw ?? "").padEnd(decimals, "0").slice(0, decimals);
  const sign = whole.startsWith("-") ? BigInt(-1) : BigInt(1);
  const w = BigInt(whole.replace("-", "") || "0");
  const f = BigInt(frac || "0");
  return sign * (w * BigInt(10) ** BigInt(decimals) + f);
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

function getString(obj: Record<string, unknown>, key: string) {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function getBoolean(obj: Record<string, unknown>, key: string) {
  return Boolean(obj[key]);
}

export async function verifyUsdtPaymentByTxHash(input: {
  chain: "BNB" | "TRX";
  txHash: string;
  toAddress: string;
  expectedUsdt: Prisma.Decimal;
}) {
  const { chain, txHash, toAddress, expectedUsdt } = input;
  const checkedAt = new Date();

  if (chain === "TRX") {
    const url = `https://apilist.tronscan.org/api/transaction-info?hash=${encodeURIComponent(txHash)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false as const, checkedAt, error: `TRON_API_${res.status}` };
    }
    const jsonUnknown = (await res.json()) as unknown;
    const raw = jsonUnknown as Prisma.InputJsonValue;

    const json = asRecord(jsonUnknown);
    const confirmed = getBoolean(json, "confirmed");
    const contractRet = getString(json, "contractRet") || getString(json, "contract_ret");
    const trigger = asRecord((json["trigger_info"] ?? json["triggerInfo"]) as unknown);
    const contractAddress = getString(trigger, "contract_address") || getString(trigger, "contractAddress");
    const methodName = getString(trigger, "methodName");
    const params = asRecord((trigger["parameter"] ?? trigger["params"]) as unknown);
    const to = getString(params, "_to") || getString(params, "to");
    const valueRaw = getString(params, "_value") || getString(params, "value");
    const value = valueRaw && /^[0-9]+$/.test(valueRaw) ? BigInt(valueRaw) : BigInt(0);

    const usdtContract = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const expectedMinor = decimalToMinorUnits(expectedUsdt, 6);

    const ok =
      confirmed &&
      contractRet === "SUCCESS" &&
      methodName === "transfer" &&
      contractAddress === usdtContract &&
      to === toAddress &&
      value >= expectedMinor;

    return ok
      ? { ok: true as const, checkedAt, raw }
      : { ok: false as const, checkedAt, error: "PAYMENT_NOT_FOUND", raw };
  }

  const rpcUrl = "https://bsc.publicnode.com";
  const receiptRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }),
    cache: "no-store",
  });
  if (!receiptRes.ok) {
    return { ok: false as const, checkedAt, error: `BSC_RPC_${receiptRes.status}` };
  }
  const receiptJsonUnknown = (await receiptRes.json()) as unknown;
  const raw = receiptJsonUnknown as Prisma.InputJsonValue;
  const receiptJson = asRecord(receiptJsonUnknown);
  const receipt = receiptJson["result"] as unknown;
  if (!receipt) {
    return { ok: false as const, checkedAt, error: "TX_NOT_FOUND", raw };
  }
  const receiptObj = asRecord(receipt);
  if (getString(receiptObj, "status").toLowerCase() !== "0x1") {
    return { ok: false as const, checkedAt, error: "TX_FAILED", raw };
  }

  const usdtContract = "0x55d398326f99059ff775485246999027b3197955";
  const transferSig = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const expectedMinor = decimalToMinorUnits(expectedUsdt, 18);
  const toNorm = toAddress.toLowerCase().replace(/^0x/, "");

  const logsUnknown = receiptObj["logs"];
  const logs = Array.isArray(logsUnknown) ? logsUnknown : [];
  let matched = false;
  for (const lUnknown of logs) {
    const l = asRecord(lUnknown);
    const addr = getString(l, "address").toLowerCase();
    if (addr !== usdtContract) continue;
    const topicsUnknown = l["topics"];
    const topics = Array.isArray(topicsUnknown) ? topicsUnknown : [];
    const topic0 = typeof topics[0] === "string" ? String(topics[0]).toLowerCase() : "";
    if (!topic0 || topic0 !== transferSig) continue;
    const topic2 = typeof topics[2] === "string" ? String(topics[2]).toLowerCase() : "";
    const toTopic = topic2.replace(/^0x/, "");
    const toHex = toTopic.slice(toTopic.length - 40);
    if (toHex !== toNorm) continue;
    const dataHex = getString(l, "data") || "0x0";
    const amount = BigInt(dataHex);
    if (amount >= expectedMinor) {
      matched = true;
      break;
    }
  }

  return matched
    ? { ok: true as const, checkedAt, raw }
    : { ok: false as const, checkedAt, error: "PAYMENT_NOT_FOUND", raw };
}
