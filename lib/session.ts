import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const AUTH_URL = "https://auth.buffer.com/auth";
export const TOKEN_URL = "https://auth.buffer.com/token";
export const SCOPES = "posts:read posts:write account:read offline_access";
export const SESSION_COOKIE = "tessera_session";
export const OAUTH_COOKIE = "tessera_oauth";

export type Session = { accessToken: string; refreshToken?: string; expiresAt: number };
export type OAuthState = { verifier: string; state: string; redirectUri: string };

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  return createHash("sha256").update(secret).digest();
}

export const b64url = (buf: Buffer) => buf.toString("base64url");

export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return b64url(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

export function unseal<T>(sealed: string | undefined): T | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function clientId(): string | undefined {
  return process.env.BUFFER_CLIENT_ID?.trim() || undefined;
}

export function isConfigured(): boolean {
  return Boolean(clientId() && process.env.SESSION_SECRET);
}

export function redirectUri(req: NextRequest): string {
  return process.env.BUFFER_REDIRECT_URI?.trim() || `${req.nextUrl.origin}/api/auth/callback`;
}

export function cookieOptions(req: NextRequest, maxAge: number) {
  return {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

async function tokenRequest(params: Record<string, string>): Promise<Session> {
  const body = new URLSearchParams({ client_id: clientId() ?? "", ...params });
  const secret = process.env.BUFFER_CLIENT_SECRET?.trim();
  if (secret) body.set("client_secret", secret);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Token request failed (${res.status})`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

export function exchangeCode(code: string, oauth: OAuthState): Promise<Session> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: oauth.redirectUri,
    code_verifier: oauth.verifier,
  });
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function setSession(req: NextRequest, res: NextResponse, session: Session) {
  res.cookies.set(SESSION_COOKIE, seal(session), cookieOptions(req, SESSION_MAX_AGE));
}

/** Returns a usable access token, refreshing it when it is about to expire. */
export async function getSession(req: NextRequest): Promise<{ session: Session; refreshed: boolean } | null> {
  const session = unseal<Session>(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  if (session.expiresAt - 60_000 > Date.now()) return { session, refreshed: false };
  if (!session.refreshToken) return null;
  try {
    const next = await tokenRequest({ grant_type: "refresh_token", refresh_token: session.refreshToken });
    return { session: { ...next, refreshToken: next.refreshToken ?? session.refreshToken }, refreshed: true };
  } catch {
    return null;
  }
}
