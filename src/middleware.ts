import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect development-only routes in production
  if (pathname.startsWith("/dev") && process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  // Protect /app and /app/* routes on the server
  if (pathname.startsWith("/app")) {
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
  matcher: ["/app/:path*", "/dev/:path*"],
};
