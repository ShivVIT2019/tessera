import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE, exchangeCode, setSession, unseal, type OAuthState } from "@/lib/session";

function fail(req: NextRequest, reason: string) {
  const res = NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(reason)}`, req.url));
  res.cookies.delete(OAUTH_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const oauth = unseal<OAuthState>(req.cookies.get(OAUTH_COOKIE)?.value);
  if (!oauth || params.get("state") !== oauth.state) return fail(req, "state_mismatch");
  const error = params.get("error");
  if (error) return fail(req, error);
  const code = params.get("code");
  if (!code) return fail(req, "missing_code");

  try {
    const session = await exchangeCode(code, oauth);
    const res = NextResponse.redirect(new URL("/?connected=1", req.url));
    res.cookies.delete(OAUTH_COOKIE);
    setSession(req, res, session);
    return res;
  } catch (e) {
    console.error("Buffer token exchange failed:", e);
    return fail(req, "token_exchange_failed");
  }
}
