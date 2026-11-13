import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

function logout(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const GET = logout;
export const POST = logout;
