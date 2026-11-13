import { handleRpc } from "@/lib/mcp";

const MAX_BODY = 256 * 1024;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const messages = Array.isArray(body) ? body : [body];
  const responses = messages.map(handleRpc).filter((r) => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? responses : responses[0]);
}

export function GET() {
  return new Response("Tessera MCP endpoint. Use POST (Streamable HTTP, JSON responses).", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
