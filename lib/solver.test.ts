import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { solve } from "./solver";
import type { Problem } from "./types";

const problem: Problem = {
  start: "2026-11-16T00:00:00Z",
  days: 7,
  channels: [
    { id: "li", name: "LinkedIn", service: "linkedin", timezone: "America/New_York", quietHours: [21, 8], maxPerDay: 2, minGapMinutes: 180 },
    { id: "x", name: "X", service: "twitter", timezone: "Asia/Kolkata", quietHours: [23, 7], maxPerDay: 3, minGapMinutes: 120 },
  ],
  existing: [{ channelId: "li", dueAt: "2026-11-16T14:00:00Z" }],
  drafts: Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`, text: `Post ${i}`, channelIds: i % 2 ? ["li", "x"] : ["x"],
  })),
};

const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

describe("solve", () => {
  const plan = solve(problem);

  it("places every post on every requested channel", () => {
    expect(plan.unplaced).toEqual([]);
    expect(plan.placements).toHaveLength(12);
  });

  it("never schedules in quiet hours", () => {
    for (const p of plan.placements) {
      const ch = problem.channels.find((c) => c.id === p.channelId)!;
      const h = at(p.dueAt).setZone(ch.timezone).hour;
      const [s, e] = ch.quietHours;
      expect(s <= e ? h >= s && h < e : h >= s || h < e).toBe(false);
    }
  });

  it("respects the minimum gap, including existing posts", () => {
    for (const ch of problem.channels) {
      const times = [
        ...plan.placements.filter((p) => p.channelId === ch.id).map((p) => at(p.dueAt)),
        ...problem.existing.filter((p) => p.channelId === ch.id).map((p) => at(p.dueAt)),
      ].sort((a, b) => a.toMillis() - b.toMillis());
      for (let i = 1; i < times.length; i++) {
        expect(times[i].diff(times[i - 1], "minutes").minutes).toBeGreaterThanOrEqual(ch.minGapMinutes);
      }
    }
  });

  it("respects the daily cap in each channel's time zone", () => {
    for (const ch of problem.channels) {
      const counts = new Map<string, number>();
      for (const p of plan.placements.filter((p) => p.channelId === ch.id)) {
        const day = at(p.dueAt).setZone(ch.timezone).toISODate()!;
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      for (const n of counts.values()) expect(n).toBeLessThanOrEqual(ch.maxPerDay);
    }
  });

  it("is deterministic", () => {
    expect(solve(problem)).toEqual(solve(problem));
  });

  it("keeps locked posts exactly where they are", () => {
    const lock = { postId: "p0", channelId: "x", dueAt: "2026-11-18T06:30:00.000Z" };
    const locked = solve(problem, [lock]);
    const p0 = locked.placements.filter((p) => p.postId === "p0");
    expect(p0).toEqual([{ ...lock, reason: "Locked by you" }]);
  });

  it("respects notBefore", () => {
    const later = { ...problem, drafts: [{ id: "late", text: "x", channelIds: ["x"], notBefore: "2026-11-20T00:00:00Z" }] };
    const [p] = solve(later).placements;
    expect(at(p.dueAt) >= at("2026-11-20T00:00:00Z")).toBe(true);
  });

  it("reports posts that cannot fit", () => {
    const full = { ...problem, channels: problem.channels.map((c) => ({ ...c, maxPerDay: 0 })) };
    const result = solve(full);
    expect(result.placements).toEqual([]);
    expect(result.unplaced.length).toBeGreaterThan(0);
  });
});
