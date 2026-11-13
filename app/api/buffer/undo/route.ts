import type { NextRequest } from "next/server";
import { withBuffer } from "@/lib/api-route";
import { BufferError, deletePost } from "@/lib/buffer";

const MAX_IDS = 20;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { ids?: string[] } | null;
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
    return Response.json({ error: `Send between 1 and ${MAX_IDS} ids` }, { status: 400 });
  }

  return withBuffer(req, async (token) => {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await deletePost(token, id);
        results.push({ id, ok: true });
      } catch (e) {
        if (e instanceof BufferError && e.code === "RATE_LIMIT_EXCEEDED") return { results, retryAfter: e.retryAfter ?? 60 };
        if (e instanceof BufferError && e.code === "UNAUTHORIZED") throw e;
        const notFound = e instanceof BufferError && e.code === "NOT_FOUND";
        results.push({ id, ok: notFound, error: notFound ? undefined : e instanceof Error ? e.message : "Failed" });
      }
    }
    return { results };
  });
}
