"use client";

import { useState } from "react";
import { DateTime } from "luxon";
import { charLimit, toDrafts } from "@/lib/inbox";
import type { Channel, DraftPost } from "@/lib/types";
import { BTN, PANEL, topicColor } from "./shared";

type Props = {
  channels: Channel[];
  drafts: DraftPost[];
  onChange: (drafts: DraftPost[]) => void;
  onPlan: () => void;
};

export function Inbox({ channels, drafts, onChange, onPlan }: Props) {
  const [paste, setPaste] = useState("");
  const [defaults, setDefaults] = useState<string[]>(() => channels.map((c) => c.id));
  const activeDefaults = defaults.filter((id) => channels.some((c) => c.id === id));

  const update = (id: string, patch: Partial<DraftPost>) =>
    onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const add = () => {
    const fresh = toDrafts(paste, activeDefaults, drafts);
    if (fresh.length === 0) return;
    onChange([...drafts, ...fresh]);
    setPaste("");
  };

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const problems = drafts.filter((d) => d.channelIds.length === 0 || overLimit(d, channels).length > 0).length;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Paste a batch</h2>
          <p className="text-sm text-ink-soft">One post per paragraph. Separate posts with a blank line or ---.</p>
        </div>
        <textarea
          aria-label="Posts to add"
          className="h-56 w-full rounded-md border border-grout-dark bg-gesso p-3 text-[15px] leading-relaxed placeholder:text-ink-faint focus:border-ink focus:outline-none"
          placeholder={"Shipping the new board today.\n\nTip: set quiet hours in each channel's own time zone."}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
        />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-soft">Send new posts to</legend>
          <div className="flex flex-wrap gap-2">
            {channels.map((c) => (
              <Chip key={c.id} on={activeDefaults.includes(c.id)} onClick={() => setDefaults(toggle(activeDefaults, c.id))}>
                {c.name}
              </Chip>
            ))}
          </div>
        </fieldset>
        <button className={BTN.secondary} disabled={!paste.trim()} onClick={add}>
          Add posts
        </button>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {drafts.length} post{drafts.length === 1 ? "" : "s"} to plan
            </h2>
            {problems > 0 ? (
              <p className="text-sm text-caution">
                {problems} post{problems === 1 ? " needs" : "s need"} a channel or a shorter text.
              </p>
            ) : (
              <p className="text-sm text-ink-soft">Tiles on the week board take their colour from the topic.</p>
            )}
          </div>
          <button className={BTN.primary} disabled={drafts.length === 0} onClick={onPlan}>
            Plan the week
          </button>
        </div>
        {drafts.length === 0 ? (
          <div className={`${PANEL} px-5 py-10 text-center text-sm text-ink-soft`}>
            Paste a few posts on the left and they&apos;ll appear here, ready to plan.
          </div>
        ) : (
          <ul className={`${PANEL} divide-y divide-grout overflow-hidden`}>
            {drafts.map((d) => (
              <li key={d.id} className="relative py-3 pl-6 pr-4">
                <span aria-hidden className={`tessera absolute inset-y-3 left-2 w-1.5 rounded-[2px] ${topicColor(d.topic)}`} />
                <textarea
                  aria-label={`Text of ${d.id}`}
                  className="w-full resize-y rounded-[4px] border border-transparent bg-transparent p-1.5 text-[15px] leading-relaxed hover:border-grout focus:border-ink focus:bg-white focus:outline-none"
                  rows={Math.min(6, Math.max(2, Math.ceil(d.text.length / 80)))}
                  value={d.text}
                  onChange={(e) => update(d.id, { text: e.target.value })}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-1.5">
                  {channels.map((c) => {
                    const limit = charLimit(c.service);
                    const over = limit !== undefined && d.text.length > limit;
                    return (
                      <Chip
                        key={c.id}
                        on={d.channelIds.includes(c.id)}
                        warn={over && d.channelIds.includes(c.id)}
                        onClick={() => update(d.id, { channelIds: toggle(d.channelIds, c.id) })}
                      >
                        {c.name}
                        {limit !== undefined && (
                          <span className="ml-1.5 tabular-nums opacity-70">
                            {d.text.length}/{limit}
                          </span>
                        )}
                      </Chip>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 pl-1.5 text-xs text-ink-soft">
                  <label className="flex items-center gap-1.5">
                    Topic
                    <input
                      className="w-28 rounded-[4px] border border-grout-dark bg-white px-1.5 py-1 text-ink"
                      value={d.topic ?? ""}
                      placeholder="optional"
                      onChange={(e) => update(d.id, { topic: e.target.value || undefined })}
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Not before
                    <input
                      type="datetime-local"
                      className="rounded-[4px] border border-grout-dark bg-white px-1.5 py-1 text-ink"
                      value={d.notBefore ? DateTime.fromISO(d.notBefore).toLocal().toFormat("yyyy-MM-dd'T'HH:mm") : ""}
                      onChange={(e) =>
                        update(d.id, { notBefore: e.target.value ? DateTime.fromISO(e.target.value).toUTC().toISO()! : undefined })
                      }
                    />
                  </label>
                  <button className="ml-auto hover:text-alarm" onClick={() => onChange(drafts.filter((x) => x.id !== d.id))}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function overLimit(d: DraftPost, channels: Channel[]): Channel[] {
  return channels.filter((c) => {
    const limit = charLimit(c.service);
    return d.channelIds.includes(c.id) && limit !== undefined && d.text.length > limit;
  });
}

function Chip({ on, warn, onClick, children }: { on: boolean; warn?: boolean; onClick: () => void; children: React.ReactNode }) {
  const tone = warn
    ? "border-alarm bg-alarm-wash text-alarm"
    : on
      ? "border-ink bg-ink text-gesso"
      : "border-grout-dark bg-transparent text-ink-soft hover:border-ink";
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-[3px] border px-2.5 py-1 text-xs font-medium ${tone}`}>
      {children}
    </button>
  );
}
