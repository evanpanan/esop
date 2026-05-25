import { matureVestingRecords } from "@/lib/esop";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const host = String(request.headers.get("host") ?? "");
  const isLocalHost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (secret) {
    const headerSecret = request.headers.get("x-cron-secret");
    if (headerSecret !== secret) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  } else {
    if (process.env.NODE_ENV !== "development" || !isLocalHost || url.searchParams.get("run") !== "1") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
  }

  const updated = await matureVestingRecords(new Date());
  return NextResponse.json({ updated });
}
