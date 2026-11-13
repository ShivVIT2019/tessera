import type { NextRequest } from "next/server";
import { withBuffer } from "@/lib/api-route";
import { BufferError, createScheduledPost } from "@/lib/buffer";

type Item = { key: string; channelId: string; dueAt: string; text: string };
type Result = { key: string; ok: boolean; bufferId?: string; error?: string };

const MAX_ITEMS = 10;
const MAX_INLINE_WAIT_S = 5;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { items?: Item[] } | null;
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    return Response.json({ error: `Send between 1 and ${MAX_ITEMS} items` }, { status: 400 });
  }

  return withBuffer(req, async (token) => {
    const results: Result[] = [];
    for (const item of items) {
      if (Date.parse(item.dueAt) <= Date.now()) {
        results.push({ key: item.key, ok: false, error: "This time is already in the past. Re-plan first." });
        continue;
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const post = await createScheduledPost(token, { channelId: item.channelId, text: item.text, dueAt: item.dueAt });
          results.push({ key: item.key, ok: true, bufferId: post.id });
          break;
        } catch (e) {
          if (e instanceof BufferError && e.code === "RATE_LIMIT_EXCEEDED") {
            const wait = e.retryAfter ?? 60;
            if (attempt === 0 && wait <= MAX_INLINE_WAIT_S) {
              await sleep(wait);
              continue;
            }
            return { results, retryAfter: wait };
          }
          if (e instanceof BufferError && e.code === "UNAUTHORIZED") throw e;
          results.push({ key: item.key, ok: false, error: e instanceof Error ? e.message : "Failed" });
          break;
        }
      }
    }
    return { results };
  });
}
