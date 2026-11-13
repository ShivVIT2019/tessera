"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { charLimit } from "@/lib/inbox";
import type { Placement, Problem } from "@/lib/types";
import { BTN, localTime, placementKey, tzLabel, type ApplyLogEntry } from "./shared";

const APPLY_BATCH = 5;
const UNDO_BATCH = 10;

type Row = Placement & { key: string; text: string; channelName: string; when: string; problem?: string };
type Status = { kind: "idle" } | { kind: "running"; done: number; total: number; waiting?: number } | { kind: "done"; message: string };

type Props = {
  problem: Problem;
  placements: Placement[];
  connected: boolean;
  log: ApplyLogEntry[];
  onLog: (log: ApplyLogEntry[]) => void;
  onClose: () => void;
  onApplied: () => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(url: string, body: unknown): Promise<T & { error?: string; retryAfter?: number }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ error: `Request failed (${res.status})` }));
}

export function ApplyPanel({ problem, placements, connected, log, onLog, onClose, onApplied }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const appliedKeys = new Set(log.map((l) => l.key));

  const rows: Row[] = placements.map((p) => {
    const ch = problem.channels.find((c) => c.id === p.channelId)!;
    const text = problem.drafts.find((d) => d.id === p.postId)?.text ?? "";
    const limit = charLimit(ch.service);
    const key = placementKey(p.postId, p.channelId) + "|" + p.dueAt;
    let issue: string | undefined;
    if (!text.trim()) issue = "Empty post";
    else if (limit !== undefined && text.length > limit) issue = `${text.length}/${limit} characters, too long for ${ch.service}`;
    else if (DateTime.fromISO(p.dueAt) <= DateTime.now()) issue = "Time is in the past. Re-plan first.";
    else if (appliedKeys.has(key)) issue = "Already created in Buffer";
    return { ...p, key, text, channelName: ch.name, when: `${localTime(p.dueAt, ch, "ccc d LLL HH:mm")} ${tzLabel(ch)}`, problem: issue };
  });
  const ready = rows.filter((r) => !r.problem);
  const running = status.kind === "running";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onClose]);
  const perChannel = new Map<string, number>();
  for (const r of ready) perChannel.set(r.channelName, (perChannel.get(r.channelName) ?? 0) + 1);
  const summary = [...perChannel].map(([name, n]) => `${n} on ${name}`).join(", ");

  async function apply() {
    const created: ApplyLogEntry[] = [...log];
    const errs: Record<string, string> = {};
    let done = 0;
    setStatus({ kind: "running", done, total: ready.length });
    for (let i = 0; i < ready.length; ) {
      const batch = ready.slice(i, i + APPLY_BATCH);
      const res = await post<{ results?: { key: string; ok: boolean; bufferId?: string; error?: string }[] }>("/api/buffer/apply", {
        items: batch.map((r) => ({ key: r.key, channelId: r.channelId, dueAt: r.dueAt, text: r.text })),
      });
      for (const r of res.results ?? []) {
        const row = batch.find((b) => b.key === r.key)!;
        if (r.ok && r.bufferId) created.push({ key: r.key, postId: row.postId, channelId: row.channelId, dueAt: row.dueAt, bufferId: r.bufferId });
        else errs[r.key] = r.error ?? "Failed";
      }
      onLog([...created]);
      setErrors({ ...errs });
      const handled = res.results?.length ?? 0;
      done += handled;
      i += handled;
      if (res.retryAfter) {
        for (let s = Math.ceil(res.retryAfter); s > 0; s--) {
          setStatus({ kind: "running", done, total: ready.length, waiting: s });
          await sleep(1000);
        }
      } else if (res.error) {
        setStatus({ kind: "done", message: `Stopped: ${res.error}` });
        onApplied();
        return;
      }
      setStatus({ kind: "running", done, total: ready.length });
    }
    const ok = created.length - log.length;
    setStatus({ kind: "done", message: `Created ${ok} post${ok === 1 ? "" : "s"} in Buffer${Object.keys(errs).length ? `, ${Object.keys(errs).length} failed` : ""}.` });
    onApplied();
  }

  async function undo() {
    let remaining = [...log];
    const total = remaining.length;
    setStatus({ kind: "running", done: 0, total });
    while (remaining.length > 0) {
      const batch = remaining.slice(0, UNDO_BATCH);
      const res = await post<{ results?: { id: string; ok: boolean; error?: string }[] }>("/api/buffer/undo", {
        ids: batch.map((b) => b.bufferId),
      });
      const deleted = new Set((res.results ?? []).filter((r) => r.ok).map((r) => r.id));
      const handled = new Set((res.results ?? []).map((r) => r.id));
      remaining = remaining.filter((r) => !deleted.has(r.bufferId));
      onLog(remaining);
      if (res.retryAfter) {
        for (let s = Math.ceil(res.retryAfter); s > 0; s--) {
          setStatus({ kind: "running", done: total - remaining.length, total, waiting: s });
          await sleep(1000);
        }
        continue;
      }
      if (res.error || batch.some((b) => handled.has(b.bufferId) && !deleted.has(b.bufferId))) {
        setStatus({ kind: "done", message: `Undo stopped: ${res.error ?? "some posts could not be deleted"}. ${remaining.length} left.` });
        onApplied();
        return;
      }
      setStatus({ kind: "running", done: total - remaining.length, total });
    }
    setStatus({ kind: "done", message: `Deleted ${total} post${total === 1 ? "" : "s"} from Buffer.` });
    onApplied();
  }

  const doneCount = status.kind === "running" ? status.done : 0;
  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-ink/45 p-6" onClick={() => !running && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-title"
        className="w-full max-w-3xl space-y-5 rounded-md border border-grout bg-gesso p-6 shadow-[0_24px_48px_rgb(29_39_51/0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="apply-title" className="text-lg font-semibold">
              Create {ready.length} post{ready.length === 1 ? "" : "s"} across {perChannel.size} channel{perChannel.size === 1 ? "" : "s"}
            </h2>
            <p className="text-sm text-ink-soft">
              {summary ? `${summary}. ` : ""}Nothing has been sent yet.
              {rows.length - ready.length > 0 ? ` ${rows.length - ready.length} will be skipped, see the status column.` : ""} Posts already created are never sent twice.
            </p>
          </div>
          <button className={BTN.quiet} disabled={running} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-[4px] border border-grout bg-white">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-plaster text-xs text-ink-soft">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">Post</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-grout align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.when}</td>
                  <td className="px-3 py-2">{r.channelName}</td>
                  <td className="px-3 py-2">
                    <div className="line-clamp-2">{r.text}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {appliedKeys.has(r.key) ? (
                      <span className="font-medium text-malachite">Created</span>
                    ) : errors[r.key] ? (
                      <span className="text-alarm">{errors[r.key]}</span>
                    ) : r.problem ? (
                      <span className="text-caution">{r.problem}</span>
                    ) : (
                      <span className="text-ink-faint">Ready</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {status.kind === "running" && (
          <div className="space-y-2" role="status">
            <div className="flex flex-wrap gap-[3px] rounded-[3px] bg-grout p-[3px]" aria-hidden>
              {Array.from({ length: status.total }, (_, n) => (
                <span key={n} className={`size-4 rounded-[2px] ${n < doneCount ? "tessera tile-set-in bg-malachite" : "bg-white"}`} />
              ))}
            </div>
            <p className="text-sm">
              {status.done} of {status.total} done
              {status.waiting ? `. Buffer's rate limit was reached, trying again in ${status.waiting}s` : ""}
            </p>
          </div>
        )}
        {status.kind === "done" && <p className="text-sm font-semibold" role="status">{status.message}</p>}

        <div className="flex flex-wrap items-center gap-3 border-t border-grout pt-4">
          {connected ? (
            <button className={BTN.primary} disabled={running || ready.length === 0} onClick={apply}>
              Create {ready.length} post{ready.length === 1 ? "" : "s"} in Buffer
            </button>
          ) : (
            <p className="text-sm text-ink-soft">This is sample data. Connect Buffer to create real posts.</p>
          )}
          {connected && log.length > 0 && (
            <button className={`${BTN.danger} ml-auto`} disabled={running} onClick={undo}>
              Undo: delete the {log.length} post{log.length === 1 ? "" : "s"} Tessera created
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
