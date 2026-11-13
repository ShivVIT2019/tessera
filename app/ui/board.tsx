"use client";

import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { explainSlot } from "@/lib/solver";
import type { Channel, Lock, Placement, Plan, Problem } from "@/lib/types";
import { BTN, PANEL, localTime, placementKey, serviceName, topicColor, tzLabel } from "./shared";

type Props = {
  problem: Problem;
  plan: Plan;
  locks: Lock[];
  stale: boolean;
  busy: boolean;
  moved: Set<string>;
  onReroll: () => void;
  onToggleLock: (p: Placement) => void;
  onMove: (p: Placement, dueAt: string) => void;
  onReplan: () => void;
  onApply: () => void;
};

type Cell = { channelId: string; day: number };
type Item = { kind: "existing"; dueAt: string } | { kind: "planned"; placement: Placement };

export function Board({ problem, plan, locks, stale, busy, moved, onReroll, onToggleLock, onMove, onReplan, onApply }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [drag, setDrag] = useState<{ placement: Placement; targets: Map<number, DropTarget> } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const start = DateTime.fromISO(problem.start, { zone: "utc" });
  const days = Array.from({ length: problem.days }, (_, i) => start.plus({ days: i }));
  const lockedKeys = new Set(locks.map((l) => placementKey(l.postId, l.channelId)));
  const drafts = new Map(problem.drafts.map((d) => [d.id, d]));
  const selectedPlacement = plan.placements.find((p) => placementKey(p.postId, p.channelId) === selected) ?? null;

  const grid = useMemo(() => {
    const first = DateTime.fromISO(problem.start, { zone: "utc" });
    const dayKeys = Array.from({ length: problem.days }, (_, i) => first.plus({ days: i }).toISODate()!);
    const m = new Map<string, Item[]>();
    const put = (ch: Channel, dueAt: string, item: Item) => {
      const local = DateTime.fromISO(dueAt, { zone: "utc" }).setZone(ch.timezone).toISODate()!;
      let day = dayKeys.indexOf(local);
      if (day === -1) day = local < dayKeys[0] ? 0 : dayKeys.length - 1;
      const k = `${ch.id}|${day}`;
      m.set(k, [...(m.get(k) ?? []), item]);
    };
    for (const ch of problem.channels) {
      for (const e of problem.existing.filter((x) => x.channelId === ch.id)) put(ch, e.dueAt, { kind: "existing", dueAt: e.dueAt });
      for (const p of plan.placements.filter((x) => x.channelId === ch.id)) put(ch, p.dueAt, { kind: "planned", placement: p });
    }
    for (const items of m.values()) items.sort((a, b) => itemTime(a).localeCompare(itemTime(b)));
    return m;
  }, [problem, plan]);

  const unplacedByPost = plan.unplaced;

  const startDrag = (placement: Placement) => {
    setNotice(null);
    setDrag({ placement, targets: dropTargets(problem, plan, placement, days) });
  };
  const drop = (day: number) => {
    const target = drag?.targets.get(day);
    if (drag && target?.dueAt) onMove(drag.placement, target.dueAt);
    else if (target) setNotice(target.reason);
    setDrag(null);
  };

  const costs = plan.costs;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <h2 className="text-lg font-semibold">
            {plan.placements.length} placed
            {plan.unplaced.length > 0 && <span className="text-caution">, {plan.unplaced.length} didn&apos;t fit</span>}
            {locks.length > 0 && <span className="font-normal text-ink-soft">, {locks.length} locked</span>}
          </h2>
          <p className="text-sm text-ink-soft">
            {busy ? "Reflowing the week…" : "Drag a tile to another day. It locks there and the rest reflow around it."}
          </p>
        </div>
        {plan.score !== undefined && (
          <div
            className="flex items-baseline gap-1.5 sm:border-l sm:border-grout-dark sm:pl-6"
            title={costs ? `Lower is better. Topic clashes ${costs.topic}, cross-post stagger ${costs.stagger}, crowded days ${costs.spread}, outside golden windows ${costs.golden}` : undefined}
          >
            <span className="text-2xl font-bold tabular-nums">{plan.score}</span>
            <span className="text-sm text-ink-soft">/ 100 cadence</span>
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button className={BTN.secondary} onClick={onReroll} title="A different layout that follows the same rules">
            Try another layout
          </button>
          <button className={stale ? BTN.primary : BTN.secondary} onClick={onReplan}>
            Re-plan
          </button>
          <button className={BTN.primary} disabled={plan.placements.length === 0} onClick={onApply}>
            Review and apply
          </button>
        </div>
      </div>

      {stale && <p className="rounded-r-md border-l-4 border-l-ochre bg-caution-wash px-4 py-2 text-sm text-caution">Your posts or rules changed since this plan. Re-plan to update it.</p>}
      {notice && <p role="alert" className="rounded-r-md border-l-4 border-l-alarm bg-alarm-wash px-4 py-2 text-sm text-alarm">Can&apos;t move there: {notice}</p>}

      <div className="overflow-x-auto rounded-md bg-grout">
        <table className={`w-full table-fixed border-separate border-spacing-[3px] text-xs ${problem.days > 7 ? "min-w-[1500px]" : "min-w-[960px]"}`}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-40 rounded-[2px] bg-plaster px-2.5 py-2 text-left text-sm font-semibold">Channel</th>
              {days.map((d) => (
                <th key={d.toISODate()} className="rounded-[2px] bg-plaster px-2.5 py-2 text-left font-normal">
                  <span className="block text-sm font-semibold">{d.toFormat("cccc")}</span>
                  <span className="text-ink-faint">{d.toFormat("d LLLL")}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {problem.channels.map((ch) => (
              <tr key={ch.id} className="align-top">
                <th scope="row" className="sticky left-0 z-10 rounded-[2px] bg-plaster px-2.5 py-2 text-left font-normal">
                  <span className="block text-sm font-semibold">{ch.name}</span>
                  <span className="block text-ink-soft">
                    {serviceName(ch.service)}, {tzLabel(ch)}
                  </span>
                  <span className="block text-ink-faint">
                    Up to {ch.maxPerDay} a day, {ch.minGapMinutes >= 60 ? `${ch.minGapMinutes / 60} h` : `${ch.minGapMinutes} min`} apart
                  </span>
                </th>
                {days.map((_, day) => {
                  const items = grid.get(`${ch.id}|${day}`) ?? [];
                  const active = cell?.channelId === ch.id && cell.day === day;
                  const target = drag?.placement.channelId === ch.id ? drag.targets.get(day) : undefined;
                  const dragTone = !drag
                    ? ""
                    : !target
                      ? "opacity-40"
                      : target.dueAt
                        ? "bg-white outline-dashed outline-2 -outline-offset-4 outline-lapis"
                        : "hatch-full";
                  return (
                    <td
                      key={day}
                      title={target && !target.dueAt ? target.reason : undefined}
                      onClick={() => setCell({ channelId: ch.id, day })}
                      onDragOver={(e) => {
                        if (target) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        drop(day);
                      }}
                      className={`h-28 cursor-pointer space-y-[3px] rounded-[2px] bg-gesso p-[3px] hover:bg-white ${active && !drag ? "outline-2 -outline-offset-2 outline-ink" : ""} ${dragTone}`}
                    >
                      {items.map((item, i) =>
                        item.kind === "existing" ? (
                          <div key={`e${i}`} className="bisque rounded-[3px] px-2 py-1.5 text-ink-soft" title="Already scheduled in Buffer">
                            <span className="font-semibold tabular-nums">{cellTime(item.dueAt, ch, days[day])}</span> in Buffer
                          </div>
                        ) : (
                          <Tile
                            key={placementKey(item.placement.postId, ch.id)}
                            placement={item.placement}
                            channel={ch}
                            topic={drafts.get(item.placement.postId)?.topic}
                            text={drafts.get(item.placement.postId)?.text ?? item.placement.postId}
                            locked={lockedKeys.has(placementKey(item.placement.postId, ch.id))}
                            selected={selected === placementKey(item.placement.postId, ch.id)}
                            column={days[day]}
                            moved={moved.has(placementKey(item.placement.postId, ch.id))}
                            onDragStart={() => startDrag(item.placement)}
                            onDragEnd={() => setDrag(null)}
                            onSelect={() => {
                              setSelected(placementKey(item.placement.postId, ch.id));
                              setCell({ channelId: ch.id, day });
                            }}
                          />
                        ),
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend />

      <div className="grid gap-4 lg:grid-cols-2">
        <Inspector
          problem={problem}
          plan={plan}
          placement={selectedPlacement}
          text={selectedPlacement ? drafts.get(selectedPlacement.postId)?.text : undefined}
          topic={selectedPlacement ? drafts.get(selectedPlacement.postId)?.topic : undefined}
          locked={selectedPlacement ? lockedKeys.has(placementKey(selectedPlacement.postId, selectedPlacement.channelId)) : false}
          onToggleLock={onToggleLock}
          onClear={() => setSelected(null)}
        />
        <SlotExplainer
          problem={problem}
          plan={plan}
          cell={cell}
          day={cell ? days[cell.day] : undefined}
          placement={selectedPlacement?.channelId === cell?.channelId ? selectedPlacement : null}
          onMove={onMove}
        />
      </div>

      {unplacedByPost.length > 0 && (
        <section className="rounded-r-md border-l-4 border-l-ochre bg-caution-wash px-4 py-3 text-sm text-caution">
          <h3 className="mb-1 font-semibold">Didn&apos;t fit this week</h3>
          <ul className="space-y-0.5">
            {unplacedByPost.map((u, i) => (
              <li key={i}>
                <span className="font-semibold">{drafts.get(u.postId)?.text.slice(0, 48) ?? u.postId}</span>: {u.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-soft">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="tessera size-3 rounded-[2px] bg-lapis" /> Planned post, coloured by topic
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="bisque size-3 rounded-[2px]" /> Already in Buffer
      </span>
      <span className="flex items-center gap-1.5">
        <LockIcon className="size-3" /> Locked
      </span>
    </div>
  );
}

function LockIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className={className} fill="currentColor">
      <path d="M3.5 5V3.75a2.5 2.5 0 0 1 5 0V5H9a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h.5Zm1.25 0h2.5V3.75a1.25 1.25 0 0 0-2.5 0V5Z" />
    </svg>
  );
}

const itemTime = (i: Item) => (i.kind === "existing" ? i.dueAt : i.placement.dueAt);

/** Local time, with the weekday when the channel's local day differs from the column's date. */
function cellTime(iso: string, ch: Channel, column: DateTime) {
  const local = DateTime.fromISO(iso, { zone: "utc" }).setZone(ch.timezone);
  return local.toISODate() === column.toISODate() ? local.toFormat("HH:mm") : local.toFormat("ccc HH:mm");
}

type DropTarget = { dueAt?: string; reason: string };

/** For each day, the free slot closest to the tile's current time of day, or why there is none. */
function dropTargets(problem: Problem, plan: Plan, placement: Placement, days: DateTime[]): Map<number, DropTarget> {
  const ch = problem.channels.find((c) => c.id === placement.channelId)!;
  const current = DateTime.fromISO(placement.dueAt, { zone: "utc" }).setZone(ch.timezone);
  const minutes = current.hour * 60 + current.minute;
  const out = new Map<number, DropTarget>();
  days.forEach((d, i) => {
    const localDay = DateTime.fromObject({ year: d.year, month: d.month, day: d.day }, { zone: ch.timezone });
    let best: { dueAt: string; distance: number } | undefined;
    let sameTimeReasons: string[] = [];
    for (let s = 0; s < 48; s++) {
      const at = localDay.plus({ minutes: s * 30 });
      const dueAt = at.toUTC().toISO()!;
      const check = explainSlot(problem, plan.placements, ch.id, dueAt, placement.postId);
      const distance = Math.abs(s * 30 - minutes);
      if (distance < 30) sameTimeReasons = check.reasons;
      if (check.ok && (!best || distance <= best.distance)) best = { dueAt, distance };
    }
    out.set(i, best ? { dueAt: best.dueAt, reason: "" } : { reason: sameTimeReasons[0] ?? "no free time that day" });
  });
  return out;
}

function Tile(props: {
  placement: Placement; channel: Channel; column: DateTime; topic?: string; text: string; locked: boolean; selected: boolean; moved: boolean;
  onSelect: () => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const { placement, channel, column, topic, text, locked, selected, moved, onSelect, onDragStart, onDragEnd } = props;
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", placement.postId);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      title={placement.reason}
      aria-label={`${cellTime(placement.dueAt, channel, column)}: ${text}${locked ? " (locked)" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`tessera block w-full cursor-grab rounded-[3px] px-2 py-1.5 text-left text-white active:cursor-grabbing ${topicColor(topic)} ${selected ? "outline-2 outline-offset-1 outline-ink" : ""} ${moved ? "tile-reflow" : ""}`}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="font-semibold tabular-nums">{cellTime(placement.dueAt, channel, column)}</span>
        {locked && <LockIcon className="size-3 opacity-90" />}
      </span>
      <span className="line-clamp-2 leading-snug text-white/85">{text}</span>
    </button>
  );
}

function Inspector(props: {
  problem: Problem;
  plan: Plan;
  placement: Placement | null;
  text?: string;
  topic?: string;
  locked: boolean;
  onToggleLock: (p: Placement) => void;
  onClear: () => void;
}) {
  const { problem, placement, text, topic, locked, onToggleLock, onClear } = props;
  if (!placement) {
    return (
      <section className={`${PANEL} p-5 text-sm text-ink-soft`}>
        <h3 className="mb-1 font-semibold text-ink">Why it landed there</h3>
        Select a tile to read the reason for its time and to lock it in place.
      </section>
    );
  }
  const ch = problem.channels.find((c) => c.id === placement.channelId)!;
  return (
    <section className={`${PANEL} space-y-3 p-5 text-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span aria-hidden className={`tessera mt-0.5 size-4 shrink-0 rounded-[2px] ${topicColor(topic)}`} />
          <div>
            <h3 className="font-semibold">
              {ch.name}, {localTime(placement.dueAt, ch, "cccc d LLLL 'at' HH:mm")}
            </h3>
            <p className="text-ink-faint">{tzLabel(ch)}{topic ? `, topic ${topic}` : ""}</p>
          </div>
        </div>
        <button className={BTN.quiet} onClick={onClear}>
          Close
        </button>
      </div>
      <p className="whitespace-pre-wrap rounded-[4px] border border-grout bg-white p-3 leading-relaxed">{text}</p>
      <p className="leading-relaxed">
        <span className="font-semibold">Why here: </span>
        {placement.reason}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button className={locked ? BTN.primary : BTN.secondary} onClick={() => onToggleLock(placement)}>
          {locked ? "Unlock" : "Lock this time"}
        </button>
        <p className="text-xs text-ink-faint">Locked posts stay put when you re-plan.</p>
      </div>
    </section>
  );
}

function SlotExplainer(props: {
  problem: Problem;
  plan: Plan;
  cell: Cell | null;
  day?: DateTime;
  placement: Placement | null;
  onMove: (p: Placement, dueAt: string) => void;
}) {
  const { problem, plan, cell, day, placement, onMove } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const ch = cell ? problem.channels.find((c) => c.id === cell.channelId) : undefined;

  const slots = useMemo(() => {
    if (!ch || !day) return [];
    const localDay = DateTime.fromObject({ year: day.year, month: day.month, day: day.day }, { zone: ch.timezone });
    return Array.from({ length: 48 }, (_, i) => {
      const at = localDay.plus({ minutes: i * 30 });
      const dueAt = at.toUTC().toISO()!;
      return { label: at.toFormat("HH:mm"), dueAt, check: explainSlot(problem, plan.placements, ch.id, dueAt, placement?.postId) };
    });
  }, [ch, day, problem, plan, placement]);

  if (!ch || !day) {
    return (
      <section className={`${PANEL} p-5 text-sm text-ink-soft`}>
        <h3 className="mb-1 font-semibold text-ink">Free times</h3>
        Select a day on the board to see which half-hours are free on that channel, and why the others aren&apos;t.
      </section>
    );
  }

  const current = slots.find((s) => s.dueAt === picked);
  const free = slots.filter((s) => s.check.ok).length;
  return (
    <section className={`${PANEL} space-y-3 p-5 text-sm`}>
      <div>
        <h3 className="font-semibold">
          {ch.name}, {day.toFormat("cccc d LLLL")}
        </h3>
        <p className="text-ink-faint">
          {free} of 48 half-hours free in {tzLabel(ch)}
          {placement ? ` for the selected post` : ""}
        </p>
      </div>
      <div className="grid grid-cols-8 gap-[3px] rounded-[3px] bg-grout p-[3px] sm:grid-cols-12">
        {slots.map((s) => (
          <button
            key={s.dueAt}
            title={s.check.ok ? "Free" : s.check.reasons.join("\n")}
            aria-label={`${s.label}, ${s.check.ok ? "free" : "blocked"}`}
            onClick={() => setPicked(s.dueAt)}
            className={`rounded-[2px] py-1 text-[11px] tabular-nums ${s.check.ok ? "bg-white font-semibold text-malachite hover:bg-malachite hover:text-white" : "hatch-soft bg-plaster text-ink-faint"} ${picked === s.dueAt ? "outline-2 outline-offset-1 outline-ink" : ""}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {current && (
        <div className="space-y-2 rounded-[4px] border border-grout bg-white p-3">
          <p className="font-semibold">
            {current.label} is {current.check.ok ? "free" : "blocked"}
          </p>
          {current.check.ok ? (
            <p className="text-ink-soft">No rule is broken at this time.</p>
          ) : (
            <ul className="list-disc space-y-0.5 pl-5 text-ink-soft">
              {current.check.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {placement && current.check.ok && (
            <button className={BTN.primary} onClick={() => onMove(placement, current.dueAt)}>
              Move the selected post here
            </button>
          )}
        </div>
      )}
    </section>
  );
}
