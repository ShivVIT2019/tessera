import type { Channel, GoldenWindow } from "./types";

export type Rules = Pick<Channel, "quietHours" | "maxPerDay" | "minGapMinutes" | "goldenWindows">;

const WEEKDAYS = [1, 2, 3, 4, 5];

export const GOLDEN_PRESETS: { id: string; label: string; windows: GoldenWindow[] }[] = [
  { id: "weekday-mornings", label: "Weekday mornings", windows: [{ start: 8, end: 10, days: WEEKDAYS }, { start: 12, end: 13, days: WEEKDAYS }] },
  { id: "morning-evening", label: "Morning + evening", windows: [{ start: 9, end: 11 }, { start: 17, end: 19 }] },
  { id: "midday-night", label: "Midday + night", windows: [{ start: 11, end: 13 }, { start: 19, end: 21 }] },
  { id: "business-hours", label: "Business hours", windows: [{ start: 9, end: 17, days: WEEKDAYS }] },
  { id: "none", label: "None (aim for preferred hour)", windows: [] },
];

const golden = (id: string) => GOLDEN_PRESETS.find((p) => p.id === id)!.windows;

const BY_SERVICE: Record<string, Rules> = {
  twitter: { quietHours: [23, 7], maxPerDay: 3, minGapMinutes: 120, goldenWindows: golden("morning-evening") },
  bluesky: { quietHours: [23, 7], maxPerDay: 3, minGapMinutes: 120, goldenWindows: golden("morning-evening") },
  threads: { quietHours: [23, 7], maxPerDay: 2, minGapMinutes: 180, goldenWindows: golden("morning-evening") },
  mastodon: { quietHours: [23, 7], maxPerDay: 3, minGapMinutes: 120, goldenWindows: golden("morning-evening") },
  linkedin: { quietHours: [20, 8], maxPerDay: 1, minGapMinutes: 240, goldenWindows: golden("weekday-mornings") },
  facebook: { quietHours: [22, 8], maxPerDay: 1, minGapMinutes: 240, goldenWindows: golden("midday-night") },
  instagram: { quietHours: [22, 8], maxPerDay: 1, minGapMinutes: 240, goldenWindows: golden("midday-night") },
  googlebusiness: { quietHours: [19, 8], maxPerDay: 1, minGapMinutes: 240, goldenWindows: golden("business-hours") },
};
const DEFAULT_RULES: Rules = { quietHours: [22, 7], maxPerDay: 2, minGapMinutes: 180, goldenWindows: golden("morning-evening") };

export function defaultRules(service: string): Rules {
  return structuredClone(BY_SERVICE[service] ?? DEFAULT_RULES);
}

export const CADENCE_PRESETS: { id: string; label: string; rules: Omit<Rules, "goldenWindows"> }[] = [
  { id: "gentle", label: "Gentle: 1/day, 6 h gap", rules: { quietHours: [20, 8], maxPerDay: 1, minGapMinutes: 360 } },
  { id: "steady", label: "Steady: 2/day, 3 h gap", rules: { quietHours: [22, 7], maxPerDay: 2, minGapMinutes: 180 } },
  { id: "busy", label: "Busy: 4/day, 90 min gap", rules: { quietHours: [23, 6], maxPerDay: 4, minGapMinutes: 90 } },
];

export type ChannelSettings = { enabled: boolean; overrides: Partial<Channel> };

/** Channels with the user's saved rules applied, minus the ones they switched off. */
export function applySettings(channels: Channel[], settings: Record<string, ChannelSettings>): Channel[] {
  return channels.filter((c) => settings[c.id]?.enabled !== false).map((c) => ({ ...c, ...settings[c.id]?.overrides, id: c.id }));
}
