import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect development-only routes in production
  if (pathname.startsWith("/dev") && process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  // Protect /app and /admin on the server (a coarse gate: the APIs check the session, and the
  // admin APIs also check `platform_admins`).
  if (pathname.startsWith("/app") || pathname.startsWith("/admin")) {
    const sessionCookie = request.cookies.get("hesba_session")?.value;

    if (!sessionCookie) {
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/admin", "/dev/:path*"],
};
