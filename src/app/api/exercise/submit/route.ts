import { prisma } from "@/lib/prisma";
import { getSessionSecret, verifySession } from "@/lib/auth";
import { getDomainError, submitEmployeeExercise } from "@/lib/exerciseSubmit";
import { fileToImageDataUrl, readImageFileFromFormData } from "@/lib/imageDataUrl";
import { safeMeReturnTo } from "@/lib/meUrl";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function jsonOk(body: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...body });
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  const employeeId = payload?.eid ?? "";
  if (!payload || payload.role !== "EMPLOYEE" || !employeeId) {
    return jsonError(401, "SESSION_EXPIRED");
  }

  const sessionUser = (await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, role: true, sessionVersion: true } as unknown as {
      id: true;
      role: true;
      sessionVersion: true;
    },
  })) as unknown as { id: string; role: string; sessionVersion: number } | null;
  const payloadSv = typeof payload.sv === "number" ? payload.sv : 0;
  if (!sessionUser || sessionUser.role !== "EMPLOYEE" || payloadSv !== sessionUser.sessionVersion) {
    return jsonError(401, "SESSION_EXPIRED");
  }

  const formData = await req.formData();
  const returnTo = safeMeReturnTo(String(formData.get("returnTo") ?? "")) ?? "/me";

  const shares = Math.floor(Number(formData.get("shares")));
  const chainRaw = String(formData.get("chain") ?? "").trim();
  const chain = chainRaw === "BNB" || chainRaw === "TRX" ? chainRaw : ("BNB" as const);
  const txHash = String(formData.get("txHash") ?? "").trim();
  const amountUsdtRaw = String(formData.get("amountUsdt") ?? "").trim();

  try {
    const proofFile = readImageFileFromFormData(formData, "paymentProof");
    const paymentProofDataUrl = proofFile ? await fileToImageDataUrl(proofFile, { maxBytes: 900 * 1024 }) : "";
    const result = await submitEmployeeExercise({
      userId: payload.uid,
      employeeId,
      returnTo,
      shares,
      chain,
      txHash,
      paymentProofDataUrl,
      amountUsdtRaw,
    });
    return jsonOk(result);
  } catch (e) {
    const domain = getDomainError(e);
    if (domain) {
      return jsonError(domain.status, domain.code);
    }
    throw e;
  }
}
