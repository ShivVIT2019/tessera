import { describe, expect, it } from "vitest";
import { preferredHourFromSchedule, toExisting, usableChannels, type BufferChannel } from "./buffer";

const channel = (over: Partial<BufferChannel>): BufferChannel => ({
  id: "c1", name: "handle", displayName: "Display", service: "twitter", timezone: "America/New_York",
  isDisconnected: false, isLocked: false, isQueuePaused: false, postingSchedule: [], ...over,
});

describe("buffer mapping", () => {
  it("maps channels with per-service rules and skips unusable ones", () => {
    const { channels, skipped } = usableChannels([
      channel({}),
      channel({ id: "c2", service: "linkedin", displayName: null, name: "li" }),
      channel({ id: "c3", isDisconnected: true }),
      channel({ id: "c4", isLocked: true }),
    ]);
    expect(channels.map((c) => [c.id, c.name, c.maxPerDay])).toEqual([["c1", "Display", 3], ["c2", "li", 1]]);
    expect(skipped).toHaveLength(2);
  });

  it("picks the most common unpaused schedule hour", () => {
    expect(preferredHourFromSchedule([
      { day: "mon", paused: false, times: ["09:30", "14:00"] },
      { day: "tue", paused: false, times: ["14:15"] },
      { day: "wed", paused: true, times: ["08:00", "08:30", "08:45"] },
    ])).toBe(14);
    expect(preferredHourFromSchedule([])).toBeUndefined();
  });

  it("drops posts without a due date", () => {
    expect(toExisting([
      { id: "1", channelId: "c1", dueAt: "2026-11-12T10:00:00.000Z", text: "" },
      { id: "2", channelId: "c1", dueAt: null, text: "" },
    ])).toEqual([{ channelId: "c1", dueAt: "2026-11-12T10:00:00.000Z" }]);
  });
});
