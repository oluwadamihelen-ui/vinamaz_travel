import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

// Optimistic route gate only. Every page, action and service re-checks authorization
// on the server against the database; this just avoids rendering shells for visitors.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;

  if (!user) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/admin") && user.role === "CLIENT") {
    return NextResponse.redirect(new URL("/client/dashboard", req.nextUrl));
  }
  if (pathname.startsWith("/client") && user.role && user.role !== "CLIENT") {
    return NextResponse.redirect(new URL("/admin", req.nextUrl));
  }
});

export const config = { matcher: ["/client/:path*", "/admin/:path*"] };
