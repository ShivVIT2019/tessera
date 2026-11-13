import { NextResponse, type NextRequest } from "next/server";
import { BufferError } from "./buffer";
import { SESSION_COOKIE, getSession, setSession } from "./session";

/** Runs a Buffer-backed handler with a valid access token and keeps the session cookie fresh. */
export async function withBuffer(
  req: NextRequest,
  handler: (token: string) => Promise<unknown>,
): Promise<NextResponse> {
  const current = await getSession(req);
  if (!current) {
    const res = NextResponse.json({ error: "Not connected to Buffer" }, { status: 401 });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  let res: NextResponse;
  try {
    res = NextResponse.json(await handler(current.session.accessToken));
  } catch (e) {
    if (e instanceof BufferError && e.code === "UNAUTHORIZED") {
      res = NextResponse.json({ error: "Buffer session expired, please log in again" }, { status: 401 });
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    const retryAfter = e instanceof BufferError ? e.retryAfter : undefined;
    const message = e instanceof Error ? e.message : "Unexpected error";
    res = NextResponse.json({ error: message, retryAfter }, { status: retryAfter ? 429 : 502 });
  }
  if (current.refreshed) setSession(req, res, current.session);
  return res;
}
