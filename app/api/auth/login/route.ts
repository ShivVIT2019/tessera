import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_URL, OAUTH_COOKIE, SCOPES, b64url, clientId, cookieOptions, isConfigured, redirectUri, seal } from "@/lib/session";

export async function GET(req: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.redirect(new URL("/?auth_error=not_configured", req.url));
  }
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const redirect = redirectUri(req);

  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId()!,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    prompt: "consent",
  }).toString();

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, seal({ verifier, state, redirectUri: redirect }), cookieOptions(req, 600));
  return res;
}
