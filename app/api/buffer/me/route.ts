import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isConfigured, unseal, type Session } from "@/lib/session";

export async function GET() {
  const store = await cookies();
  const configured = isConfigured();
  const session = configured ? unseal<Session>(store.get(SESSION_COOKIE)?.value) : null;
  return NextResponse.json({ configured, connected: Boolean(session) });
}
