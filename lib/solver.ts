import { DateTime } from "luxon";
import type { Channel, Lock, Placement, Plan, Problem } from "./types";

const SLOT_MINUTES = 30;
type Busy = { channelId: string; at: DateTime; label: string; day?: string };

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

export function solve(problem: Problem, locks: Lock[] = []): Plan {
  const channels = new Map(problem.channels.map((c) => [c.id, c]));
  const windowStart = utc(problem.start);
  const windowEnd = windowStart.plus({ days: problem.days });
  const busy: Busy[] = problem.existing.map((p) => ({
    channelId: p.channelId, at: utc(p.dueAt), label: "an existing Buffer post",
  }));
  const placements: Placement[] = [];
  const unplaced: Plan["unplaced"] = [];
  const locked = new Set<string>();

  for (const lock of locks) {
    placements.push({ ...lock, reason: "Locked by you" });
    busy.push({ channelId: lock.channelId, at: utc(lock.dueAt), label: "a locked post" });
    locked.add(`${lock.postId}|${lock.channelId}`);
  }

  const drafts = [...problem.drafts].sort(
    (a, b) => a.channelIds.length - b.channelIds.length || a.id.localeCompare(b.id),
  );

  for (const draft of drafts) {
    for (const channelId of [...draft.channelIds].sort()) {
      if (locked.has(`${draft.id}|${channelId}`)) continue;
      const ch = channels.get(channelId);
      if (!ch) {
        unplaced.push({ postId: draft.id, reason: `Unknown channel ${channelId}` });
        continue;
      }

      const notBefore = draft.notBefore ? DateTime.max(windowStart, utc(draft.notBefore)) : windowStart;
      const sameChannel = busy.filter((b) => b.channelId === ch.id);
      const dayOf = (b: Busy) => (b.day ??= b.at.setZone(ch.timezone).toISODate()!);
      let best: { at: DateTime; dayCount: number; offset: number; nearest?: Busy; gap: number } | undefined;
      const preferred = ch.preferredHour ?? 10;

      for (let t = ceilToSlot(notBefore); t < windowEnd; t = t.plus({ minutes: SLOT_MINUTES })) {
        const local = t.setZone(ch.timezone);
        if (isQuiet(ch, local)) continue;

        const localDay = local.toISODate()!;
        const dayCount = sameChannel.filter((b) => dayOf(b) === localDay).length;
        if (dayCount >= ch.maxPerDay) continue;

        let nearest: Busy | undefined;
        let gap = Infinity;
        for (const b of sameChannel) {
          const d = Math.abs(b.at.diff(t, "minutes").minutes);
          if (d < gap) { gap = d; nearest = b; }
        }
        if (gap < ch.minGapMinutes) continue;

        const offset = Math.abs(local.hour + local.minute / 60 - preferred);
        if (!best || dayCount < best.dayCount || (dayCount === best.dayCount && offset < best.offset)) {
          best = { at: t, dayCount, offset, nearest, gap };
        }
      }

      if (!best) {
        unplaced.push({
          postId: draft.id,
          reason: `No room on ${ch.name}: quiet hours, the ${ch.maxPerDay}/day cap, or the ${hours(ch.minGapMinutes)} gap leave no free slot in ${problem.days} days`,
        });
        continue;
      }

      const local = best.at.setZone(ch.timezone);
      const parts = [`${local.toFormat("ccc HH:mm")} ${ch.name} time`, `lightest day (${best.dayCount} other posts)`];
      if (best.nearest) parts.push(`kept ${hours(best.gap)} from ${best.nearest.label}`);
      if (best.offset > 0) parts.push(`closest free time to ${String(preferred).padStart(2, "0")}:00`);
      placements.push({ postId: draft.id, channelId: ch.id, dueAt: best.at.toISO()!, reason: parts.join("; ") });
      busy.push({ channelId: ch.id, at: best.at, label: `post "${draft.id}"` });
    }
  }

  placements.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.channelId.localeCompare(b.channelId));
  return { placements, unplaced };
}
