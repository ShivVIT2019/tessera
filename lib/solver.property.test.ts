import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DateTime } from "luxon";
import { explainSlot, solve } from "./solver";
import type { Channel, Lock, Problem } from "./types";

const ZONES = ["America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Sydney", "America/Los_Angeles", "UTC"];
const TOPICS = ["launch", "tips", "build", undefined];
// Windows that cross DST changes: US (Nov 1 2026), EU (Oct 25 2026), Australia (Oct 4 2026), US spring (Mar 8 2026).
const STARTS = ["2026-10-29T00:00:00Z", "2026-10-22T00:00:00Z", "2026-10-01T00:00:00Z", "2026-03-05T00:00:00Z", "2026-11-16T00:00:00Z"];

const channelArb = (id: string) =>
  fc.record({
    timezone: fc.constantFrom(...ZONES),
    quietStart: fc.integer({ min: 18, max: 23 }),
    quietEnd: fc.integer({ min: 5, max: 10 }),
    maxPerDay: fc.integer({ min: 1, max: 4 }),
    minGapMinutes: fc.constantFrom(60, 90, 120, 180, 240),
    golden: fc.boolean(),
  }).map((c): Channel => ({
    id, name: id.toUpperCase(), service: "twitter", timezone: c.timezone,
    quietHours: [c.quietStart, c.quietEnd], maxPerDay: c.maxPerDay, minGapMinutes: c.minGapMinutes,
    goldenWindows: c.golden ? [{ start: 9, end: 11, days: [1, 2, 3, 4, 5] }, { start: 17, end: 19 }] : undefined,
  }));

const problemArb: fc.Arbitrary<Problem> = fc
  .record({
    channels: fc.tuple(channelArb("a"), channelArb("b"), channelArb("c")),
    start: fc.constantFrom(...STARTS),
    days: fc.constantFrom(7, 14),
    nowOffsetH: fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined }),
    existing: fc.array(fc.record({ ch: fc.constantFrom("a", "b", "c"), h: fc.integer({ min: 0, max: 24 * 14 - 1 }) }), { maxLength: 8 }),
    drafts: fc.array(
      fc.record({
        chans: fc.subarray(["a", "b", "c"], { minLength: 1 }),
        topic: fc.constantFrom(...TOPICS),
        notBeforeH: fc.option(fc.integer({ min: 0, max: 24 * 10 }), { nil: undefined }),
      }),
      { minLength: 1, maxLength: 10 },
    ),
  })
  .map((r) => {
    const start = DateTime.fromISO(r.start, { zone: "utc" });
    return {
      start: r.start,
      days: r.days,
      now: r.nowOffsetH === undefined ? undefined : start.plus({ hours: r.nowOffsetH, minutes: 17 }).toISO()!,
      channels: [...r.channels],
      existing: r.existing.map((e) => ({ channelId: e.ch, dueAt: start.plus({ hours: e.h, minutes: 15 }).toISO()! })),
      drafts: r.drafts.map((d, i) => ({
        id: `p${i}`, text: `Post ${i}`, channelIds: d.chans, topic: d.topic,
        notBefore: d.notBeforeH === undefined ? undefined : start.plus({ hours: d.notBeforeH }).toISO()!,
      })),
    };
  });

const utc = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
const RUNS = { numRuns: 150 };

describe("solver properties", () => {
  it("never breaks a hard rule", () => {
    fc.assert(
      fc.property(problemArb, fc.integer({ min: 0, max: 5 }), (problem, seed) => {
        const plan = solve(problem, [], seed);
        const windowEnd = utc(problem.start).plus({ days: problem.days });
        const floor = problem.now ? utc(problem.now) : utc(problem.start);
        for (const p of plan.placements) {
          const ch = problem.channels.find((c) => c.id === p.channelId)!;
          const draft = problem.drafts.find((d) => d.id === p.postId)!;
          const t = utc(p.dueAt);
          expect(draft.channelIds).toContain(p.channelId);
          expect(t >= floor && t < windowEnd).toBe(true);
          if (draft.notBefore) expect(t >= utc(draft.notBefore)).toBe(true);
          const h = t.setZone(ch.timezone).hour;
          const [s, e] = ch.quietHours;
          expect(s <= e ? h >= s && h < e : h >= s || h < e).toBe(false);
          // explainSlot is the same rulebook seen from the UI.
          expect(explainSlot(problem, plan.placements, p.channelId, p.dueAt, p.postId).reasons).toEqual([]);
        }
        for (const ch of problem.channels) {
          const times = [
            ...plan.placements.filter((p) => p.channelId === ch.id).map((p) => utc(p.dueAt)),
            ...problem.existing.filter((p) => p.channelId === ch.id).map((p) => utc(p.dueAt)),
          ].sort((a, b) => a.toMillis() - b.toMillis());
          for (let i = 1; i < times.length; i++) {
            const isNew = (t: DateTime) => plan.placements.some((p) => p.channelId === ch.id && utc(p.dueAt).equals(t));
            if (isNew(times[i]) || isNew(times[i - 1])) {
              expect(times[i].diff(times[i - 1], "minutes").minutes).toBeGreaterThanOrEqual(ch.minGapMinutes);
            }
          }
          const perDay = new Map<string, number>();
          for (const p of plan.placements.filter((p) => p.channelId === ch.id)) {
            const day = utc(p.dueAt).setZone(ch.timezone).toISODate()!;
            perDay.set(day, (perDay.get(day) ?? 0) + 1);
          }
          for (const [day, n] of perDay) {
            const before = problem.existing.filter((e) => e.channelId === ch.id && utc(e.dueAt).setZone(ch.timezone).toISODate() === day).length;
            expect(n + before).toBeLessThanOrEqual(Math.max(ch.maxPerDay, before));
          }
        }
      }),
      RUNS,
    );
  });

  it("accounts for every requested placement exactly once", () => {
    fc.assert(
      fc.property(problemArb, (problem) => {
        const plan = solve(problem);
        const keys = plan.placements.map((p) => `${p.postId}|${p.channelId}`);
        expect(new Set(keys).size).toBe(keys.length);
        const requested = problem.drafts.reduce((n, d) => n + d.channelIds.length, 0);
        expect(plan.placements.length + plan.unplaced.length).toBe(requested);
      }),
      RUNS,
    );
  });

  it("gives the same output for the same seed", () => {
    fc.assert(
      fc.property(problemArb, fc.integer({ min: 0, max: 1000 }), (problem, seed) => {
        expect(solve(problem, [], seed)).toEqual(solve(structuredClone(problem), [], seed));
      }),
      { numRuns: 60 },
    );
  });

  it("keeps locks exactly where they are and plans around them", () => {
    fc.assert(
      fc.property(problemArb, fc.integer({ min: 0, max: 3 }), (problem, seed) => {
        const first = solve(problem, [], seed);
        const locks: Lock[] = first.placements.filter((_, i) => i % 2 === 0).map(({ postId, channelId, dueAt }) => ({ postId, channelId, dueAt }));
        const second = solve(problem, locks, seed + 1);
        for (const lock of locks) {
          expect(second.placements).toContainEqual({ ...lock, reason: "Locked by you" });
        }
        for (const p of second.placements) {
          expect(explainSlot(problem, second.placements, p.channelId, p.dueAt, p.postId).reasons).toEqual([]);
        }
      }),
      { numRuns: 80 },
    );
  });

  it("reports a cadence score between 0 and 100", () => {
    fc.assert(
      fc.property(problemArb, (problem) => {
        const { score } = solve(problem);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }),
      { numRuns: 50 },
    );
  });
});

describe("soft costs", () => {
  const base: Problem = {
    start: "2026-11-16T00:00:00Z",
    days: 7,
    channels: [{ id: "x", name: "X", service: "twitter", timezone: "UTC", quietHours: [23, 7], maxPerDay: 3, minGapMinutes: 60 }],
    existing: [],
    drafts: [],
  };

  it("spaces same-topic posts at least 48 h apart when there is room", () => {
    const problem = { ...base, drafts: ["a", "b", "c"].map((id) => ({ id, text: id, channelIds: ["x"], topic: "tips" })) };
    const times = solve(problem).placements.map((p) => utc(p.dueAt).toMillis()).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(48 * 3_600_000);
  });

  it("spreads posts across the week instead of stacking a day", () => {
    const problem = { ...base, drafts: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, text: "t", channelIds: ["x"] })) };
    const days = new Set(solve(problem).placements.map((p) => utc(p.dueAt).toISODate()));
    expect(days.size).toBe(7);
  });

  it("prefers golden windows", () => {
    const channels = [{ ...base.channels[0], goldenWindows: [{ start: 17, end: 18 }] }];
    const problem = { ...base, channels, drafts: [{ id: "a", text: "a", channelIds: ["x"] }] };
    const [p] = solve(problem).placements;
    expect(utc(p.dueAt).hour).toBe(17);
    expect(p.reason).toMatch(/golden window/);
  });

  it("staggers cross-posts by at least 2 h", () => {
    const channels = [base.channels[0], { ...base.channels[0], id: "y", name: "Y" }];
    const problem = { ...base, days: 1, channels, drafts: [{ id: "a", text: "a", channelIds: ["x", "y"] }] };
    const [p, q] = solve(problem).placements;
    expect(Math.abs(utc(p.dueAt).diff(utc(q.dueAt), "minutes").minutes)).toBeGreaterThanOrEqual(120);
  });

  it("re-rolls to a different but still valid plan with another seed", () => {
    const problem = { ...base, drafts: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, text: "t", channelIds: ["x"] })) };
    const plans = [1, 2, 3, 4].map((seed) => JSON.stringify(solve(problem, [], seed).placements.map((p) => p.dueAt)));
    expect(new Set(plans).size).toBeGreaterThan(1);
  });

  it("never schedules before now", () => {
    const problem = { ...base, now: "2026-11-18T12:10:00Z", drafts: [{ id: "a", text: "a", channelIds: ["x"] }] };
    const [p] = solve(problem).placements;
    expect(utc(p.dueAt) >= utc("2026-11-18T12:10:00Z")).toBe(true);
  });
});
