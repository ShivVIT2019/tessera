import { DateTime } from "luxon";
import type { Channel, Costs, DraftPost, GoldenWindow, Lock, Placement, Plan, Problem } from "./types";

const SLOT_MINUTES = 30;
const SLOT_MS = SLOT_MINUTES * 60_000;
const TOPIC_SPACING_MIN = 48 * 60;
const STAGGER_MIN = 120;
const MAX_PASSES = 8;
/** Weights of the soft costs. Hard constraints are never traded against these. */
export const WEIGHTS = { topic: 8, stagger: 5, spread: 1, globalSpread: 0.3, golden: 3 };

type Busy = { channelId: string; ms: number; label: string; day: string; gDay: number };

const utc = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

function isQuiet(ch: Channel, local: DateTime): boolean {
  const [start, end] = ch.quietHours;
  const h = local.hour;
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

function ceilToSlot(t: DateTime): DateTime {
  const base = t.set({ second: 0, millisecond: 0 });
  const rem = base.minute % SLOT_MINUTES;
  const exact = rem === 0 && t.second === 0 && t.millisecond === 0;
  return exact ? base : base.plus({ minutes: SLOT_MINUTES - rem });
}

function hours(minutes: number): string {
  return minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} h` : `${Math.round(minutes)} min`;
}

const pad = (h: number) => String(h).padStart(2, "0");
const fmtHour = (h: number) => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;

/** Hours from `local` to the nearest golden window that applies on that weekday; 0 inside one, Infinity if none apply. */
function goldenDistance(windows: GoldenWindow[], local: DateTime): { distance: number; window?: GoldenWindow } {
  const h = local.hour + local.minute / 60;
  let best: { distance: number; window?: GoldenWindow } = { distance: Infinity };
  for (const w of windows) {
    if (w.days && !w.days.includes(local.weekday)) continue;
    const d = h < w.start ? w.start - h : h >= w.end ? h - w.end + SLOT_MINUTES / 60 : 0;
    if (d < best.distance) best = { distance: d, window: w };
  }
  return best;
}

/** 0 (ideal) – 1 (worst) for posting on `ch` at `local`. */
function goldenCost(ch: Channel, local: DateTime): number {
  if (ch.goldenWindows?.length) return Math.min(goldenDistance(ch.goldenWindows, local).distance, 3) / 3;
  const preferred = ch.preferredHour ?? 10;
  return Math.min(Math.abs(local.hour + local.minute / 60 - preferred), 6) / 6;
}

/** Small deterministic pseudo-random number in [0, 1) for re-rolls. */
function noise(seed: number, key: string, slot: number): number {
  let h = (seed * 0x9e3779b1) ^ (slot * 0x85ebca6b);
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x5bd1e995);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

type Task = { key: string; draft: DraftPost; ch: Channel; minSlot: number };
type Grid = { quiet: boolean[]; day: string[]; golden: number[]; local: DateTime[] };
type Item = { key: string; postId: string; channelId: string; topic?: string; ms: number; label: string; day: string; gDay: number; locked?: boolean };

export function solve(problem: Problem, locks: Lock[] = [], seed = 0): Plan {
  const channels = new Map(problem.channels.map((c) => [c.id, c]));
  const windowStart = DateTime.max(utc(problem.start), problem.now ? utc(problem.now) : utc(problem.start));
  const windowEnd = utc(problem.start).plus({ days: problem.days });
  const gridStart = ceilToSlot(windowStart);
  const startMs = gridStart.toMillis();
  const slotCount = Math.max(0, Math.ceil((windowEnd.toMillis() - startMs) / SLOT_MS));
  const drafts = new Map(problem.drafts.map((d) => [d.id, d]));
  const problemStartMs = utc(problem.start).toMillis();
  const dayIndex = (ms: number) => Math.floor((ms - problemStartMs) / 86_400_000);

  const grids = new Map<string, Grid>();
  for (const ch of problem.channels) {
    const g: Grid = { quiet: [], day: [], golden: [], local: [] };
    for (let i = 0; i < slotCount; i++) {
      const local = DateTime.fromMillis(startMs + i * SLOT_MS, { zone: ch.timezone });
      g.local.push(local);
      g.quiet.push(isQuiet(ch, local));
      g.day.push(local.toISODate()!);
      g.golden.push(goldenCost(ch, local));
    }
    grids.set(ch.id, g);
  }

  const localDay = (ch: Channel, ms: number) => DateTime.fromMillis(ms, { zone: ch.timezone }).toISODate()!;
  const existing: Busy[] = problem.existing
    .filter((p) => channels.has(p.channelId))
    .map((p) => {
      const ms = utc(p.dueAt).toMillis();
      return { channelId: p.channelId, ms, label: "an existing Buffer post", day: localDay(channels.get(p.channelId)!, ms), gDay: dayIndex(ms) };
    });

  const lockedItems: Item[] = [];
  const lockedKeys = new Set<string>();
  for (const lock of locks) {
    const ch = channels.get(lock.channelId);
    const key = `${lock.postId}|${lock.channelId}`;
    lockedKeys.add(key);
    const ms = utc(lock.dueAt).toMillis();
    const day = ch ? localDay(ch, ms) : "";
    lockedItems.push({ key, postId: lock.postId, channelId: lock.channelId, topic: drafts.get(lock.postId)?.topic, ms, label: "a locked post", day, gDay: dayIndex(ms), locked: true });
  }

  const unplaced: Plan["unplaced"] = [];
  const tasks: Task[] = [];
  for (const draft of [...problem.drafts].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const channelId of [...new Set(draft.channelIds)].sort()) {
      const key = `${draft.id}|${channelId}`;
      if (lockedKeys.has(key)) continue;
      const ch = channels.get(channelId);
      if (!ch) {
        unplaced.push({ postId: draft.id, reason: `Unknown channel ${channelId}` });
        continue;
      }
      const notBefore = draft.notBefore ? DateTime.max(windowStart, utc(draft.notBefore)) : windowStart;
      const minSlot = Math.max(0, Math.ceil((notBefore.toMillis() - startMs) / SLOT_MS));
      tasks.push({ key, draft, ch, minSlot });
    }
  }

  // State: slot index per placed task.
  const slotOf = new Map<string, number>();
  const taskByKey = new Map(tasks.map((t) => [t.key, t]));
  const msOf = (slot: number) => startMs + slot * SLOT_MS;

  function placedItems(exclude?: string): Item[] {
    const items: Item[] = lockedItems.filter((i) => i.key !== exclude);
    for (const [key, slot] of slotOf) {
      if (key === exclude) continue;
      const t = taskByKey.get(key)!;
      const g = grids.get(t.ch.id)!;
      items.push({ key, postId: t.draft.id, channelId: t.ch.id, topic: t.draft.topic, ms: msOf(slot), label: `post "${t.draft.id}"`, day: g.day[slot], gDay: dayIndex(msOf(slot)) });
    }
    return items;
  }

  const existingOn = new Map(problem.channels.map((c) => [c.id, existing.filter((b) => b.channelId === c.id)]));
  function channelBusy(ch: Channel, others: Item[]): Busy[] {
    const busy = [...existingOn.get(ch.id)!];
    for (const o of others) if (o.channelId === ch.id) busy.push(o);
    return busy;
  }

  function feasibleSlots(task: Task, others: Item[]): number[] {
    const g = grids.get(task.ch.id)!;
    const busy = channelBusy(task.ch, others);
    const perDay = new Map<string, number>();
    for (const b of busy) perDay.set(b.day, (perDay.get(b.day) ?? 0) + 1);
    const gap = task.ch.minGapMinutes * 60_000;
    const out: number[] = [];
    for (let i = task.minSlot; i < slotCount; i++) {
      if (g.quiet[i] || (perDay.get(g.day[i]) ?? 0) >= task.ch.maxPerDay) continue;
      const ms = msOf(i);
      let clash = false;
      for (const b of busy) if (Math.abs(b.ms - ms) < gap) { clash = true; break; }
      if (clash) continue;
      out.push(i);
    }
    return out;
  }

  /** Soft cost of putting `task` at `slot`, given every other placed post. */
  function costParts(task: Task, slot: number, others: Item[]): Costs {
    const g = grids.get(task.ch.id)!;
    const ms = msOf(slot);
    const day = g.day[slot];
    const gDay = dayIndex(ms);
    let topic = 0, stagger = 0, sameDay = 0, sameGlobalDay = 0;
    for (const b of existing) {
      if (b.channelId === task.ch.id && b.day === day) sameDay++;
      if (b.gDay === gDay) sameGlobalDay++;
    }
    for (const o of others) {
      if (o.channelId === task.ch.id && o.day === day) sameDay++;
      if (o.gDay === gDay) sameGlobalDay++;
      const d = Math.abs(o.ms - ms) / 60_000;
      if (o.postId === task.draft.id) {
        if (d < STAGGER_MIN) stagger += (STAGGER_MIN - d) / STAGGER_MIN;
      } else if (task.draft.topic && o.topic === task.draft.topic && d < TOPIC_SPACING_MIN) {
        topic += (TOPIC_SPACING_MIN - d) / TOPIC_SPACING_MIN;
      }
    }
    return {
      topic: WEIGHTS.topic * topic,
      stagger: WEIGHTS.stagger * stagger,
      spread: WEIGHTS.spread * sameDay + WEIGHTS.globalSpread * sameGlobalDay,
      golden: WEIGHTS.golden * g.golden[slot],
    };
  }

  const total = (c: Costs) => c.topic + c.stagger + c.spread + c.golden;
  const jitter = (task: Task, slot: number) => (seed ? 0.6 * noise(seed, task.key, slot) : 0);

  function bestSlot(task: Task, others: Item[]): number | undefined {
    let best: number | undefined;
    let bestCost = Infinity;
    for (const i of feasibleSlots(task, others)) {
      const c = total(costParts(task, i, others)) + jitter(task, i);
      if (c < bestCost - 1e-9) { bestCost = c; best = i; }
    }
    return best;
  }

  // Most-constrained first: fewest feasible slots given only fixed obstacles.
  const freedom = new Map(tasks.map((t) => [t.key, feasibleSlots(t, lockedItems).length]));
  const order = [...tasks].sort(
    (a, b) => freedom.get(a.key)! - freedom.get(b.key)! || a.draft.channelIds.length - b.draft.channelIds.length || a.key.localeCompare(b.key),
  );

  for (const task of order) {
    const others = placedItems();
    const slot = bestSlot(task, others);
    if (slot !== undefined) {
      slotOf.set(task.key, slot);
      continue;
    }
    // Backtrack one level: move a post already on this channel to make room.
    let repaired = false;
    const rivals = [...slotOf.keys()].filter((k) => taskByKey.get(k)!.ch.id === task.ch.id).sort();
    for (const rivalKey of rivals) {
      const rivalSlot = slotOf.get(rivalKey)!;
      slotOf.delete(rivalKey);
      const mine = bestSlot(task, placedItems());
      if (mine !== undefined) {
        slotOf.set(task.key, mine);
        const theirs = bestSlot(taskByKey.get(rivalKey)!, placedItems(rivalKey));
        if (theirs !== undefined) {
          slotOf.set(rivalKey, theirs);
          repaired = true;
          break;
        }
        slotOf.delete(task.key);
      }
      slotOf.set(rivalKey, rivalSlot);
    }
    if (!repaired) {
      const ch = task.ch;
      unplaced.push({
        postId: task.draft.id,
        reason: `No room on ${ch.name}: quiet hours, the ${ch.maxPerDay}/day cap, or the ${hours(ch.minGapMinutes)} gap leave no free slot in ${problem.days} days`,
      });
    }
  }

  // Local search: move one post at a time to its cheapest feasible slot until nothing improves.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (const task of order) {
      const current = slotOf.get(task.key);
      if (current === undefined) continue;
      const others = placedItems(task.key);
      const currentCost = total(costParts(task, current, others)) + jitter(task, current);
      const next = bestSlot(task, others);
      if (next !== undefined && next !== current) {
        const nextCost = total(costParts(task, next, others)) + jitter(task, next);
        if (nextCost < currentCost - 1e-6) {
          slotOf.set(task.key, next);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // Final costs, reasons and score.
  const costs: Costs = { topic: 0, stagger: 0, spread: 0, golden: 0 };
  const placements: Placement[] = locks.map((l) => ({ ...l, reason: "Locked by you" }));
  for (const task of order) {
    const slot = slotOf.get(task.key);
    if (slot === undefined) continue;
    const others = placedItems(task.key);
    const parts = costParts(task, slot, others);
    // Pairwise costs are seen from both posts, so count half from each side.
    costs.topic += parts.topic / 2;
    costs.stagger += parts.stagger / 2;
    costs.spread += parts.spread / 2;
    costs.golden += parts.golden;
    placements.push({
      postId: task.draft.id, channelId: task.ch.id, dueAt: DateTime.fromMillis(msOf(slot), { zone: "utc" }).toISO()!,
      reason: explainPlacement(task, slot, others),
    });
  }

  function explainPlacement(task: Task, slot: number, others: Item[]): string {
    const ch = task.ch;
    const g = grids.get(ch.id)!;
    const local = g.local[slot];
    const ms = msOf(slot);
    const out = [`${local.toFormat("ccc HH:mm")} ${ch.name} time`];

    const busy = channelBusy(ch, others);
    const sameDay = busy.filter((b) => b.day === g.day[slot]).length;
    out.push(sameDay === 0 ? "the only post that day" : `${sameDay} other post${sameDay === 1 ? "" : "s"} that day (limit ${ch.maxPerDay})`);

    let nearest: Busy | undefined;
    for (const b of busy) if (!nearest || Math.abs(b.ms - ms) < Math.abs(nearest.ms - ms)) nearest = b;
    if (nearest) out.push(`kept ${hours(Math.abs(nearest.ms - ms) / 60_000)} from ${nearest.label}`);

    if (ch.goldenWindows?.length) {
      const { distance, window } = goldenDistance(ch.goldenWindows, local);
      if (distance === 0 && window) out.push(`inside a golden window (${fmtHour(window.start)}–${fmtHour(window.end)})`);
      else if (Number.isFinite(distance)) out.push(`${hours(distance * 60)} from the nearest golden window`);
      else out.push("no golden window that day");
    } else {
      const preferred = ch.preferredHour ?? 10;
      if (local.hour + local.minute / 60 !== preferred) out.push(`closest free time to ${pad(preferred)}:00`);
    }

    const topic = task.draft.topic;
    if (topic) {
      const same = others.filter((o) => o.topic === topic && o.postId !== task.draft.id);
      if (same.length) {
        const d = Math.min(...same.map((o) => Math.abs(o.ms - ms))) / 60_000;
        out.push(d >= TOPIC_SPACING_MIN ? `next "${topic}" post is ${hours(d)} away` : `only ${hours(d)} from another "${topic}" post (no better slot)`);
      }
    }
    const twins = others.filter((o) => o.postId === task.draft.id);
    if (twins.length) {
      const d = Math.min(...twins.map((o) => Math.abs(o.ms - ms))) / 60_000;
      out.push(`${hours(d)} apart from the same post on another channel`);
    }
    return out.join("; ");
  }

  const placedCount = Math.max(1, placements.length);
  const sum = costs.topic + costs.stagger + costs.spread + costs.golden;
  const score = Math.round(100 / (1 + sum / placedCount / 2));
  const round = (n: number) => Math.round(n * 100) / 100;
  placements.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.channelId.localeCompare(b.channelId) || a.postId.localeCompare(b.postId));
  return {
    placements,
    unplaced,
    seed,
    score,
    costs: { topic: round(costs.topic), stagger: round(costs.stagger), spread: round(costs.spread), golden: round(costs.golden) },
  };
}

export type SlotCheck = { ok: boolean; reasons: string[] };

export function explainSlot(
  problem: Problem,
  placements: Placement[],
  channelId: string,
  dueAt: string,
  postId?: string,
): SlotCheck {
  const ch = problem.channels.find((c) => c.id === channelId);
  if (!ch) return { ok: false, reasons: [`Unknown channel ${channelId}`] };

  const t = utc(dueAt);
  const local = t.setZone(ch.timezone);
  const reasons: string[] = [];

  const windowStart = utc(problem.start);
  if (t < windowStart || t >= windowStart.plus({ days: problem.days })) {
    reasons.push("Outside the planning window");
  } else if (problem.now && t < utc(problem.now)) {
    reasons.push("That time has already passed");
  }

  const draft = postId ? problem.drafts.find((d) => d.id === postId) : undefined;
  if (draft && !draft.channelIds.includes(ch.id)) {
    reasons.push(`"${draft.id}" isn't meant for ${ch.name}`);
  }
  if (draft?.notBefore && t < utc(draft.notBefore)) {
    reasons.push(`"${draft.id}" can't go out before ${utc(draft.notBefore).setZone(ch.timezone).toFormat("ccc HH:mm")}`);
  }

  if (isQuiet(ch, local)) {
    const [s, e] = ch.quietHours;
    reasons.push(`${local.toFormat("HH:mm")} is in ${ch.name}'s quiet hours (${pad(s)}:00–${pad(e)}:00)`);
  }

  const others: { at: DateTime; label: string }[] = [
    ...problem.existing
      .filter((p) => p.channelId === ch.id)
      .map((p) => ({ at: utc(p.dueAt), label: "an existing Buffer post" })),
    ...placements
      .filter((p) => p.channelId === ch.id && p.postId !== postId)
      .map((p) => ({ at: utc(p.dueAt), label: `post "${p.postId}"` })),
  ];

  const day = local.toISODate();
  const sameDay = others.filter((b) => b.at.setZone(ch.timezone).toISODate() === day).length;
  if (sameDay >= ch.maxPerDay) {
    reasons.push(`${ch.name} already has ${sameDay} post${sameDay === 1 ? "" : "s"} on ${local.toFormat("cccc")} (limit ${ch.maxPerDay})`);
  }

  for (const b of others) {
    const d = Math.abs(b.at.diff(t, "minutes").minutes);
    if (d < ch.minGapMinutes) reasons.push(`Only ${hours(d)} from ${b.label} (needs ${hours(ch.minGapMinutes)})`);
  }

  return { ok: reasons.length === 0, reasons };
}
