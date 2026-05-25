import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const rawHost = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").trim().toLowerCase();
  const host = rawHost.split(",")[0]?.trim().split(":")[0] ?? "";
  if (host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
    const url = request.nextUrl.clone();
    url.hostname = "localhost";
    return NextResponse.redirect(url);
  }

  const session = request.cookies.get("esop_session")?.value;

  if (request.nextUrl.pathname.startsWith("/admin")) {
    if (!session) {
      const url = new URL("/", request.url);
      return NextResponse.redirect(url);
    }
  }

  if (request.nextUrl.pathname.startsWith("/me")) {
    if (!session) {
      const url = new URL("/", request.url);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/admin/:path*", "/me/:path*"],
};
