import { DateTime, IANAZone } from "luxon";
import { defaultRules } from "./rules";
import { solve } from "./solver";
import type { Channel, DraftPost, ExistingPost, Lock, Problem } from "./types";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const channelSchema = {
  type: "object",
  required: ["id", "timezone"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    service: { type: "string", description: "Buffer service, e.g. twitter, linkedin. Picks default rules." },
    timezone: { type: "string", description: "IANA time zone, e.g. America/New_York" },
    quietHours: { type: "array", items: { type: "integer", minimum: 0, maximum: 23 }, minItems: 2, maxItems: 2 },
    maxPerDay: { type: "integer", minimum: 1, maximum: 10 },
    minGapMinutes: { type: "integer", minimum: 0, maximum: 1440 },
    preferredHour: { type: "integer", minimum: 0, maximum: 23 },
    goldenWindows: {
      type: "array",
      items: {
        type: "object",
        required: ["start", "end"],
        properties: { start: { type: "number" }, end: { type: "number" }, days: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 } } },
      },
    },
  },
};

export const PLAN_WEEK_TOOL = {
  name: "plan_week",
  title: "Plan a week of social posts",
  description:
    "Lays out draft social posts across channels for the next 1–14 days without clashes. Hard rules (allowed channels, quiet hours in each channel's time zone, daily cap, minimum gap, existing scheduled posts, locks, not-before) are never broken; then it spaces same-topic posts, spreads the week, prefers golden windows and staggers cross-posts. Deterministic for a given seed. Returns placements with a reason each, posts that could not fit, and a 0–100 cadence score. Does not post anything.",
  inputSchema: {
    type: "object",
    required: ["channels", "drafts"],
    properties: {
      channels: { type: "array", items: channelSchema, minItems: 1, maxItems: 20 },
      drafts: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          required: ["id", "text", "channelIds"],
          properties: {
            id: { type: "string" },
            text: { type: "string" },
            channelIds: { type: "array", items: { type: "string" }, minItems: 1 },
            topic: { type: "string" },
            notBefore: { type: "string", description: "ISO-8601 time" },
          },
        },
      },
      existing: {
        type: "array",
        description: "Posts already scheduled; treated as obstacles",
        items: { type: "object", required: ["channelId", "dueAt"], properties: { channelId: { type: "string" }, dueAt: { type: "string" } } },
      },
      locks: {
        type: "array",
        items: { type: "object", required: ["postId", "channelId", "dueAt"], properties: { postId: { type: "string" }, channelId: { type: "string" }, dueAt: { type: "string" } } },
      },
      start: { type: "string", description: "ISO-8601 start of the window. Default: now." },
      days: { type: "integer", minimum: 1, maximum: 14, default: 7 },
      seed: { type: "integer", minimum: 0, description: "Change to re-roll an equally valid plan" },
    },
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

class InvalidParams extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !v) throw new InvalidParams(`${what} must be a non-empty string`);
  return v;
};
const iso = (v: unknown, what: string): string => {
  const t = DateTime.fromISO(str(v, what), { zone: "utc" });
  if (!t.isValid) throw new InvalidParams(`${what} must be an ISO-8601 time`);
  return t.toISO()!;
};
const int = (v: unknown, what: string, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new InvalidParams(`${what} must be an integer from ${min} to ${max}`);
  return v;
};
const list = (v: unknown, what: string, max: number): unknown[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) throw new InvalidParams(`${what} must be an array of at most ${max} items`);
  return v;
};

export function toProblem(args: unknown, now = DateTime.utc()): { problem: Problem; locks: Lock[]; seed: number } {
  if (!isObj(args)) throw new InvalidParams("arguments must be an object");
  const channels: Channel[] = list(args.channels, "channels", 20).map((raw, i) => {
    if (!isObj(raw)) throw new InvalidParams(`channels[${i}] must be an object`);
    const id = str(raw.id, `channels[${i}].id`);
    const timezone = str(raw.timezone, `channels[${i}].timezone`);
    if (!IANAZone.isValidZone(timezone)) throw new InvalidParams(`channels[${i}].timezone is not a valid IANA zone`);
    const service = typeof raw.service === "string" ? raw.service : "other";
    const rules = defaultRules(service);
    const q = raw.quietHours;
    return {
      id, timezone, service,
      name: typeof raw.name === "string" ? raw.name : id,
      quietHours: Array.isArray(q) && q.length === 2 ? [int(q[0], "quietHours[0]", 0, 23), int(q[1], "quietHours[1]", 0, 23)] : rules.quietHours,
      maxPerDay: raw.maxPerDay === undefined ? rules.maxPerDay : int(raw.maxPerDay, `channels[${i}].maxPerDay`, 1, 10),
      minGapMinutes: raw.minGapMinutes === undefined ? rules.minGapMinutes : int(raw.minGapMinutes, `channels[${i}].minGapMinutes`, 0, 1440),
      preferredHour: raw.preferredHour === undefined ? undefined : int(raw.preferredHour, `channels[${i}].preferredHour`, 0, 23),
      goldenWindows: raw.goldenWindows === undefined
        ? rules.goldenWindows
        : list(raw.goldenWindows, "goldenWindows", 20).map((w) => {
            if (!isObj(w) || typeof w.start !== "number" || typeof w.end !== "number") throw new InvalidParams("goldenWindows need numeric start and end");
            return { start: w.start, end: w.end, days: Array.isArray(w.days) ? w.days.map((d) => int(d, "goldenWindows.days", 1, 7)) : undefined };
          }),
    };
  });
  if (!channels.length) throw new InvalidParams("channels must not be empty");

  const drafts: DraftPost[] = list(args.drafts, "drafts", 50).map((raw, i) => {
    if (!isObj(raw)) throw new InvalidParams(`drafts[${i}] must be an object`);
    const channelIds = list(raw.channelIds, `drafts[${i}].channelIds`, 20).map((c) => str(c, `drafts[${i}].channelIds[]`));
    if (!channelIds.length) throw new InvalidParams(`drafts[${i}].channelIds must not be empty`);
    return {
      id: str(raw.id, `drafts[${i}].id`),
      text: typeof raw.text === "string" ? raw.text : "",
      channelIds,
      topic: typeof raw.topic === "string" && raw.topic ? raw.topic : undefined,
      notBefore: raw.notBefore === undefined ? undefined : iso(raw.notBefore, `drafts[${i}].notBefore`),
    };
  });
  if (!drafts.length) throw new InvalidParams("drafts must not be empty");

  const existing: ExistingPost[] = list(args.existing, "existing", 500).map((raw, i) => {
    if (!isObj(raw)) throw new InvalidParams(`existing[${i}] must be an object`);
    return { channelId: str(raw.channelId, `existing[${i}].channelId`), dueAt: iso(raw.dueAt, `existing[${i}].dueAt`) };
  });
  const locks: Lock[] = list(args.locks, "locks", 100).map((raw, i) => {
    if (!isObj(raw)) throw new InvalidParams(`locks[${i}] must be an object`);
    return { postId: str(raw.postId, `locks[${i}].postId`), channelId: str(raw.channelId, `locks[${i}].channelId`), dueAt: iso(raw.dueAt, `locks[${i}].dueAt`) };
  });

  const start = args.start === undefined ? now.toISO()! : iso(args.start, "start");
  const days = args.days === undefined ? 7 : int(args.days, "days", 1, 14);
  const seed = args.seed === undefined ? 0 : int(args.seed, "seed", 0, 2 ** 31 - 1);
  return { problem: { channels, drafts, existing, start, days, now: now.toISO()! }, locks, seed };
}

export function handleRpc(msg: unknown): JsonRpcResponse | null {
  if (!isObj(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  }
  const req = msg as JsonRpcRequest;
  if (req.id === undefined) return null; // notification
  const id = req.id;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (req.method) {
    case "initialize": {
      const asked = typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : "";
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tessera", title: "Tessera", version: "0.1.0" },
        instructions: "Call plan_week with channels and draft posts to get a clash-free schedule. It never posts anything.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: [PLAN_WEEK_TOOL] });
    case "tools/call": {
      if (req.params?.name !== PLAN_WEEK_TOOL.name) return fail(-32602, `Unknown tool: ${String(req.params?.name)}`);
      try {
        const { problem, locks, seed } = toProblem(req.params?.arguments);
        const plan = solve(problem, locks, seed);
        const lines = plan.placements.map((p) => {
          const ch = problem.channels.find((c) => c.id === p.channelId)!;
          return `- ${p.postId} → ${ch.name} at ${DateTime.fromISO(p.dueAt, { zone: "utc" }).setZone(ch.timezone).toFormat("ccc d LLL HH:mm ZZZZ")} (${p.reason})`;
        });
        for (const u of plan.unplaced) lines.push(`- ${u.postId}: not placed. ${u.reason}`);
        const text = `Cadence score ${plan.score}/100. ${plan.placements.length} placed, ${plan.unplaced.length} not placed.\n${lines.join("\n")}`;
        return ok({ content: [{ type: "text", text }], structuredContent: plan, isError: false });
      } catch (e) {
        if (e instanceof InvalidParams) return ok({ content: [{ type: "text", text: `Invalid arguments: ${e.message}` }], isError: true });
        throw e;
      }
    }
    default:
      return fail(-32601, `Method not found: ${req.method}`);
  }
}
