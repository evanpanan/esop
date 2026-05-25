import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { meUrlWith } from "@/lib/meUrl";

type Currency = "USD" | "HKD" | "CNY";
type UsdtChain = "BNB" | "TRX";

export type ExerciseAllocationItem = {
  grantId: string;
  agreementNo: string;
  shares: number;
  strikePriceBase: number;
  lockupPeriodMonths: number;
};

export type SubmitEmployeeExerciseInput = {
  userId?: string;
  employeeId: string;
  returnTo: string;
  shares: number;
  chain: UsdtChain;
  txHash?: string;
  paymentProofDataUrl?: string;
  amountUsdtRaw?: string;
};

export type SubmitEmployeeExerciseResult = {
  id: string;
  redirectTo: string;
};

function domainError(status: number, code: string) {
  const err = new Error(code) as Error & { status: number };
  err.status = status;
  return err;
}

export function getDomainError(e: unknown): { status: number; code: string } | null {
  if (!e || typeof e !== "object") return null;
  if (!(e instanceof Error)) return null;
  const status = "status" in e ? (e as unknown as { status?: unknown }).status : undefined;
  if (typeof status !== "number" || !Number.isFinite(status) || status <= 0) return null;
  const code = String(e.message ?? "").trim();
  if (!code) return null;
  return { status, code };
}

function currencyRate(currency: Currency) {
  if (currency === "HKD") return 7.8;
  if (currency === "CNY") return 7.2;
  return 1;
}

function convertMoney(amount: Prisma.Decimal, from: Currency, to: Currency) {
  if (from === to) return amount;
  const fromRate = currencyRate(from);
  const usd = from === "USD" ? amount : amount.div(fromRate);
  const toRate = currencyRate(to);
  return to === "USD" ? usd : usd.mul(toRate);
}

function jsonObj(v: unknown) {
  if (!v || typeof v !== "object") return {};
  if (Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function readAllocationFromPaymentRaw(paymentRaw: unknown) {
  const root = jsonObj(paymentRaw);
  const alloc = root["allocation"];
  if (!Array.isArray(alloc)) return [] as Array<{ grantId: string; shares: number }>;
  const out: Array<{ grantId: string; shares: number }> = [];
  for (const it of alloc) {
    const o = jsonObj(it);
    const grantId = String(o["grantId"] ?? o["id"] ?? "").trim();
    const shares = Math.floor(Number(o["shares"]));
    if (!grantId || !Number.isFinite(shares) || shares <= 0) continue;
    out.push({ grantId, shares });
  }
  return out;
}

function assertTxHash(chain: UsdtChain, txHash: string) {
  if (chain === "BNB") {
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw domainError(400, "INVALID_TXHASH");
    return;
  }
  if (!/^[a-fA-F0-9]{64}$/.test(txHash)) throw domainError(400, "INVALID_TXHASH");
}

export async function submitEmployeeExercise(input: SubmitEmployeeExerciseInput): Promise<SubmitEmployeeExerciseResult> {
  const employeeId = String(input.employeeId ?? "").trim();
  if (!employeeId) throw domainError(400, "INVALID_EMPLOYEE");

  const shares = Math.floor(Number(input.shares));
  if (!Number.isFinite(shares) || shares <= 0) throw domainError(400, "INVALID_EXERCISE");

  const chain = input.chain === "TRX" ? "TRX" : "BNB";
  const txHash = String(input.txHash ?? "").trim();
  const paymentProofDataUrl = String(input.paymentProofDataUrl ?? "").trim();
  if (!txHash && !paymentProofDataUrl) throw domainError(400, "MISSING_PAYMENT_PROOF");
  if (txHash) assertTxHash(chain, txHash);

  const settings = await prisma.globalSettings.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      sharePriceCurrency: true,
      usdtBnbAddress: true,
      usdtTrxAddress: true,
    },
  });
  const baseCurrency = (settings?.sharePriceCurrency ?? "USD") as Currency;

  const toAddress =
    chain === "BNB"
      ? String(settings?.usdtBnbAddress ?? "").trim()
      : String(settings?.usdtTrxAddress ?? "").trim();
  if (!toAddress) throw domainError(400, "MISSING_PAYINFO");

  const allGrants = await prisma.grant.findMany({
    where: { employeeId },
    orderBy: { grantDate: "asc" },
    select: { id: true, agreementNo: true, strikePrice: true, lockupPeriodMonths: true, grantDate: true },
  });

  const vestedByGrant = await prisma.vestingRecord.groupBy({
    by: ["grantId"],
    where: { employeeId, status: "VESTED" },
    _sum: { shares: true },
  });
  const vestedMap = new Map<string, number>();
  for (const r of vestedByGrant) {
    vestedMap.set(String(r.grantId), Number(r._sum.shares ?? 0));
  }

  const reservedSelect = {
    grantId: true,
    requestedShares: true,
    paymentRaw: true,
  } satisfies Prisma.ExerciseRequestSelect;
  type ReservedRow = Prisma.ExerciseRequestGetPayload<{
    select: typeof reservedSelect;
  }>;

  const reserved: ReservedRow[] = await prisma.exerciseRequest.findMany({
    where: { employeeId, status: { in: ["PENDING", "FUNDED", "COMPLETED"] }, isBuybackOrCancel: false },
    select: reservedSelect,
  });
  const exercisedMap = new Map<string, number>();
  for (const r of reserved) {
    if (r.grantId) {
      const gid = String(r.grantId);
      exercisedMap.set(gid, (exercisedMap.get(gid) ?? 0) + Number(r.requestedShares ?? 0));
      continue;
    }
    const alloc = readAllocationFromPaymentRaw(r.paymentRaw);
    for (const a of alloc) {
      exercisedMap.set(a.grantId, (exercisedMap.get(a.grantId) ?? 0) + a.shares);
    }
  }

  const remainingByGrant = new Map<string, number>();
  for (const g of allGrants) {
    const vested = vestedMap.get(g.id) ?? 0;
    const exercised = exercisedMap.get(g.id) ?? 0;
    remainingByGrant.set(g.id, Math.max(0, Math.floor(vested) - Math.floor(exercised)));
  }

  let left = shares;
  const allocation: Array<ExerciseAllocationItem> = [];
  for (const g of allGrants) {
    if (left <= 0) break;
    const rem = remainingByGrant.get(g.id) ?? 0;
    if (rem <= 0) continue;
    const take = Math.min(rem, left);
    if (take > 0) {
      allocation.push({
        grantId: g.id,
        agreementNo: g.agreementNo,
        shares: take,
        strikePriceBase: Number(g.strikePrice.toFixed(6)),
        lockupPeriodMonths: Math.max(0, Math.floor(Number(g.lockupPeriodMonths ?? 0))),
      });
    }
    left -= take;
  }
  if (left > 0 || allocation.length === 0) throw domainError(400, "INSUFFICIENT_VESTED");

  let totalCostBase = new Prisma.Decimal(0);
  for (const a of allocation) {
    const g = allGrants.find((x) => x.id === a.grantId);
    if (!g) continue;
    totalCostBase = totalCostBase.add(g.strikePrice.mul(a.shares));
  }
  const totalCostUsdt = convertMoney(totalCostBase, baseCurrency, "USD");

  const amountUsdtRaw = String(input.amountUsdtRaw ?? "").trim();
  if (amountUsdtRaw) {
    let amountUsdt: Prisma.Decimal | null = null;
    try {
      amountUsdt = new Prisma.Decimal(amountUsdtRaw);
    } catch {
      amountUsdt = null;
    }
    if (!amountUsdt || amountUsdt.lte(0)) {
      console.warn("[SECURITY] exercise amount invalid", { uid: input.userId ?? "", eid: employeeId, amountUsdtRaw });
      throw domainError(400, "AMOUNT_TAMPERED");
    }
    const diff = amountUsdt.sub(totalCostUsdt).abs();
    if (diff.gt(new Prisma.Decimal("0.01"))) {
      console.warn("[SECURITY] exercise amount tampered", {
        uid: input.userId ?? "",
        eid: employeeId,
        shares,
        expectedUsdt: totalCostUsdt.toFixed(6),
        providedUsdt: amountUsdt.toFixed(6),
      });
      throw domainError(400, "AMOUNT_TAMPERED");
    }
  }

  let created: { id: string } | null = null;
  try {
    const singleGrantId = allocation.length === 1 ? allocation[0]!.grantId : null;
    created = await prisma.exerciseRequest.create({
      data: {
        employeeId,
        grantId: singleGrantId,
        requestedShares: shares,
        totalCost: totalCostBase,
        paymentChain: chain,
        paymentToAddress: toAddress,
        paymentTxHash: txHash || null,
        paymentProofDataUrl: paymentProofDataUrl || null,
        paymentProofUploadedAt: paymentProofDataUrl ? new Date() : null,
        paymentProofUploadedByRole: paymentProofDataUrl ? "EMPLOYEE" : null,
        paymentAmountUsdt: totalCostUsdt,
        status: "PENDING",
        paymentRaw: { allocation } as unknown as Prisma.JsonObject,
      },
      select: { id: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw domainError(409, "TXHASH_ALREADY_USED");
    }
    throw e;
  }

  return {
    id: created!.id,
    redirectTo: meUrlWith(input.returnTo, { modal: "exercise", rid: created!.id, err: "SUBMITTED" }),
  };
}
