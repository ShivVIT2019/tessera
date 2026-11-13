"use client";

import { useMemo } from "react";
import { CADENCE_PRESETS, GOLDEN_PRESETS, defaultRules, type ChannelSettings } from "@/lib/rules";
import type { Channel } from "@/lib/types";
import { BTN, PANEL, serviceName } from "./shared";

type Props = {
  channels: Channel[];
  settings: Record<string, ChannelSettings>;
  onChange: (settings: Record<string, ChannelSettings>) => void;
  onDone: () => void;
};

const GAPS = [30, 60, 90, 120, 180, 240, 360, 480, 720];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
const gapLabel = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);

export function Channels({ channels, settings, onChange, onDone }: Props) {
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);

  const get = (id: string): ChannelSettings => settings[id] ?? { enabled: true, overrides: {} };
  const set = (id: string, next: Partial<ChannelSettings>) => onChange({ ...settings, [id]: { ...get(id), ...next } });
  const override = (id: string, patch: Partial<Channel>) => set(id, { overrides: { ...get(id).overrides, ...patch } });
  const enabledCount = channels.filter((c) => get(c.id).enabled).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">Channels and their rules</h2>
          <p className="text-sm text-ink-soft">
            Quiet hours, the daily limit and the gap between posts are never broken. Golden windows are the times Tessera prefers when there&apos;s room.
          </p>
        </div>
        <button className={`${BTN.primary} ml-auto`} disabled={enabledCount === 0} onClick={onDone}>
          Continue to posts
        </button>
      </div>

      {channels.length === 0 && (
        <div className={`${PANEL} px-5 py-10 text-center text-sm text-ink-soft`}>No channels yet. Connect one in Buffer, then press Refresh.</div>
      )}

      <div className="space-y-3">
        {channels.map((base) => {
          const s = get(base.id);
          const ch = { ...base, ...s.overrides };
          const windows = ch.goldenWindows ?? [];
          const goldenId = GOLDEN_PRESETS.find((p) => JSON.stringify(p.windows) === JSON.stringify(windows))?.id ?? "custom";
          const field = "rounded-[4px] border border-grout-dark bg-white px-2 py-1.5 text-sm text-ink";
          return (
            <section key={base.id} className={`${PANEL} p-5 ${s.enabled ? "" : "border-dashed opacity-60"}`}>
              <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-4 accent-ink"
                    checked={s.enabled}
                    onChange={(e) => set(base.id, { enabled: e.target.checked })}
                  />
                  <span>
                    <span className="block font-semibold">{ch.name}</span>
                    <span className="block text-xs text-ink-faint">
                      {serviceName(ch.service)}, {s.enabled ? "included in plans" : "left out of plans"}
                    </span>
                  </span>
                </label>
                <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-ink-soft">Pace</span>
                  {CADENCE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className="rounded-[3px] border border-grout-dark px-2.5 py-1 font-medium hover:border-ink"
                      onClick={() => override(base.id, structuredClone(p.rules))}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    className={`${BTN.quiet} ml-2 text-xs`}
                    onClick={() => set(base.id, { overrides: { ...defaultRules(base.service), preferredHour: base.preferredHour } })}
                  >
                    Reset to {serviceName(base.service)} defaults
                  </button>
                </div>
              </header>

              <DayStrip channel={ch} />

              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-ink-soft sm:grid-cols-3 lg:grid-cols-6">
                <label className="col-span-2 flex flex-col gap-1">
                  Time zone
                  <select className={field} value={ch.timezone} onChange={(e) => override(base.id, { timezone: e.target.value })}>
                    {(zones.includes(ch.timezone) ? zones : [ch.timezone, ...zones]).map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Quiet from
                  <select className={field} value={ch.quietHours[0]} onChange={(e) => override(base.id, { quietHours: [Number(e.target.value), ch.quietHours[1]] })}>
                    {HOURS.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Quiet until
                  <select className={field} value={ch.quietHours[1]} onChange={(e) => override(base.id, { quietHours: [ch.quietHours[0], Number(e.target.value)] })}>
                    {HOURS.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Posts per day, at most
                  <input
                    type="number" min={1} max={10} className={field} value={ch.maxPerDay}
                    onChange={(e) => override(base.id, { maxPerDay: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Gap between posts
                  <select className={field} value={ch.minGapMinutes} onChange={(e) => override(base.id, { minGapMinutes: Number(e.target.value) })}>
                    {(GAPS.includes(ch.minGapMinutes) ? GAPS : [...GAPS, ch.minGapMinutes].sort((a, b) => a - b)).map((m) => (
                      <option key={m} value={m}>{gapLabel(m)}</option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 flex flex-col gap-1">
                  Golden windows
                  <select
                    className={field}
                    value={goldenId}
                    onChange={(e) => override(base.id, { goldenWindows: structuredClone(GOLDEN_PRESETS.find((p) => p.id === e.target.value)!.windows) })}
                  >
                    {GOLDEN_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    {goldenId === "custom" && <option value="custom">Custom</option>}
                  </select>
                </label>
                {windows.length === 0 && (
                  <label className="flex flex-col gap-1">
                    Preferred hour
                    <select className={field} value={ch.preferredHour ?? 10} onChange={(e) => override(base.id, { preferredHour: Number(e.target.value) })}>
                      {HOURS.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const inQuiet = (h: number, [from, until]: [number, number]) => (from === until ? false : from < until ? h >= from && h < until : h >= from || h < until);

/** The channel's day as 24 tiles: hatched while quiet, glazed inside golden windows. */
function DayStrip({ channel }: { channel: Channel }) {
  const windows = channel.goldenWindows ?? [];
  const golden = (h: number) => windows.some((w) => h >= w.start && h < w.end);
  const weekdaysOnly = windows.length > 0 && windows.every((w) => w.days);
  return (
    <figure className="mt-4">
      <div className="grid grid-cols-24 gap-[3px] rounded-[3px] bg-grout p-[3px]" role="img" aria-label={`Quiet ${pad(channel.quietHours[0])} to ${pad(channel.quietHours[1])}${windows.length ? `, golden windows ${windows.map((w) => `${pad(w.start)} to ${pad(w.end)}`).join(", ")}` : ""}`}>
        {HOURS.map((h) => {
          const quiet = inQuiet(h, channel.quietHours);
          const tone = quiet
            ? "hatch-quiet bg-plaster"
            : golden(h)
              ? "tessera bg-ochre"
              : windows.length === 0 && channel.preferredHour === h
                ? "tessera bg-lapis"
                : "bg-white";
          return <span key={h} title={`${pad(h)}${quiet ? " quiet" : golden(h) ? " golden window" : ""}`} className={`h-6 rounded-[2px] ${tone}`} />;
        })}
      </div>
      <figcaption className="mt-1.5 flex justify-between text-[11px] tabular-nums text-ink-faint">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </figcaption>
      <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5"><span aria-hidden className="hatch-quiet size-3 rounded-[2px] bg-plaster" /> Quiet</span>
        {windows.length > 0 ? (
          <span className="flex items-center gap-1.5"><span aria-hidden className="tessera size-3 rounded-[2px] bg-ochre" /> Golden window{weekdaysOnly ? ", weekdays" : ""}</span>
        ) : (
          <span className="flex items-center gap-1.5"><span aria-hidden className="tessera size-3 rounded-[2px] bg-lapis" /> Preferred hour</span>
        )}
        <span>Hours in {channel.timezone}</span>
      </p>
    </figure>
  );
}
