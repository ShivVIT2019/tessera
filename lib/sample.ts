import { DateTime } from "luxon";
import { defaultRules } from "./rules";
import type { Problem } from "./types";

export function sampleProblem(now = DateTime.utc()): Problem {
  const start = now.plus({ days: 1 }).startOf("day");
  const at = (day: number, hour: number) => start.plus({ days: day, hours: hour }).toISO()!;

  return {
    start: start.toISO()!,
    days: 7,
    channels: [
      { id: "li", name: "LinkedIn", service: "linkedin", goldenWindows: defaultRules("linkedin").goldenWindows, timezone: "America/New_York", quietHours: [20, 8], maxPerDay: 1, minGapMinutes: 240 },
      { id: "x", name: "X", service: "twitter", goldenWindows: defaultRules("twitter").goldenWindows, timezone: "America/New_York", quietHours: [23, 7], maxPerDay: 3, minGapMinutes: 120 },
      { id: "bsky", name: "Bluesky", service: "bluesky", goldenWindows: defaultRules("bluesky").goldenWindows, timezone: "Europe/London", quietHours: [22, 7], maxPerDay: 2, minGapMinutes: 180 },
    ],
    existing: [
      { channelId: "li", dueAt: at(0, 14) },
      { channelId: "x", dueAt: at(1, 16) },
      { channelId: "bsky", dueAt: at(2, 10) },
    ],
    drafts: [
      { id: "launch", text: "We just shipped Tessera: paste a batch of posts and get a clash-free week across all your channels.", channelIds: ["li", "x", "bsky"], topic: "launch" },
      { id: "solver", text: "How our scheduler works: hard rules first (quiet hours, gaps, daily caps), then the lightest day wins.", channelIds: ["li", "x"], topic: "engineering" },
      { id: "tip-gaps", text: "Tip: give each channel a minimum gap. Two posts an hour apart compete with each other.", channelIds: ["x", "bsky"], topic: "tips" },
      { id: "tip-quiet", text: "Tip: set quiet hours per channel in its own time zone, not yours.", channelIds: ["x"], topic: "tips" },
      { id: "undo", text: "Every plan comes with Undo. Apply a week, change your mind, and remove it in one click.", channelIds: ["li", "bsky"], topic: "launch" },
      { id: "thread", text: "Building in public, day 2: our solver plans 12 posts in under 50 ms.", channelIds: ["x"], topic: "build" },
      { id: "ask", text: "What is the hardest part of scheduling your week of posts? Reply and tell us.", channelIds: ["x", "bsky"], topic: "community" },
      { id: "recap", text: "Weekly recap: 3 channels, 12 posts, zero clashes.", channelIds: ["li"], topic: "recap", notBefore: at(5, 0) },
    ],
  };
}
