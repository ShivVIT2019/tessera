export type Channel = {
  id: string; name: string; service: string; timezone: string;
  quietHours: [number, number]; maxPerDay: number; minGapMinutes: number;
};
export type ExistingPost = { channelId: string; dueAt: string };
export type DraftPost = { id: string; text: string; channelIds: string[]; topic?: string; notBefore?: string };
export type Lock = { postId: string; channelId: string; dueAt: string };
export type Placement = { postId: string; channelId: string; dueAt: string; reason: string };
export type Problem = { channels: Channel[]; existing: ExistingPost[]; drafts: DraftPost[]; start: string; days: number };
export type Plan = { placements: Placement[]; unplaced: { postId: string; reason: string }[] };
// lib/solver.ts exports: solve(problem: Problem, locks: Lock[]): Plan
