/** Local-time window a channel performs best in. Hours are 0–24, days are 1 (Mon) – 7 (Sun); omit days for every day. */
export type GoldenWindow = { start: number; end: number; days?: number[] };
export type Channel = {
  id: string; name: string; service: string; timezone: string;
  quietHours: [number, number]; maxPerDay: number; minGapMinutes: number;
  preferredHour?: number; // local hour to aim for when there are no golden windows, default 10
  goldenWindows?: GoldenWindow[];
};
export type ExistingPost = { channelId: string; dueAt: string };
export type DraftPost = { id: string; text: string; channelIds: string[]; topic?: string; notBefore?: string };
export type Lock = { postId: string; channelId: string; dueAt: string };
export type Placement = { postId: string; channelId: string; dueAt: string; reason: string };
/** `now` (default: the real clock is not consulted) is the earliest allowed time; nothing is placed before it. */
export type Problem = { channels: Channel[]; existing: ExistingPost[]; drafts: DraftPost[]; start: string; days: number; now?: string };
export type Costs = { topic: number; stagger: number; spread: number; golden: number };
export type Plan = {
  placements: Placement[];
  unplaced: { postId: string; reason: string }[];
  seed?: number;
  score?: number; // cadence score, 0–100, higher is better
  costs?: Costs;
};
// lib/solver.ts exports: solve(problem: Problem, locks?: Lock[], seed?: number): Plan
