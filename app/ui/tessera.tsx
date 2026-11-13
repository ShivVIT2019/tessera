"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { sampleProblem } from "@/lib/sample";
import { applySettings, type ChannelSettings } from "@/lib/rules";
import type { Channel, DraftPost, ExistingPost, Lock, Placement, Plan, Problem } from "@/lib/types";
import { ApplyPanel } from "./apply";
import { Board } from "./board";
import { Channels } from "./channels";
import { Inbox } from "./inbox";
import { BTN, placementKey, type ApplyLogEntry } from "./shared";
import { useSolver } from "./use-solver";

type Me = { configured: boolean; connected: boolean };
type BufferData = {
  organizations: { id: string; name: string }[];
  organizationId?: string;
  channels: Channel[];
  skipped: { name: string; reason: string }[];
  existing: ExistingPost[];
};

const LOG_KEY = "tessera:applied";
const SETTINGS_KEY = "tessera:channels";
const AUTH_ERRORS: Record<string, string> = {
  not_configured: "Buffer login isn't configured on this server yet (BUFFER_CLIENT_ID / SESSION_SECRET).",
  state_mismatch: "Login expired or was started in another tab. Please try again.",
  access_denied: "You cancelled the Buffer login.",
  token_exchange_failed: "Buffer didn't accept the login. Please try again.",
};

function windowStart(): string {
  const now = DateTime.utc();
  return now.plus({ minutes: 30 - (now.minute % 30) + 30 }).startOf("minute").toISO()!;
}

export function Tessera() {
  const [authError, setAuthError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<BufferData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [base, setBase] = useState<Problem | null>(null);
  const [settings, setSettingsState] = useState<Record<string, ChannelSettings>>({});
  const [seed, setSeed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const [planned, setPlanned] = useState<Problem | null>(null);
  const solveAsync = useSolver();
  const [drafts, setDrafts] = useState<DraftPost[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [stale, setStale] = useState(false);
  const [tab, setTab] = useState<"channels" | "inbox" | "board">("inbox");
  const [applying, setApplying] = useState(false);
  const [log, setLogState] = useState<ApplyLogEntry[]>([]);

  const live = Boolean(me?.connected && data);

  const problem = useMemo(() => base && { ...base, channels: applySettings(base.channels, settings) }, [base, settings]);

  const setSettings = (next: Record<string, ChannelSettings>) => {
    setSettingsState(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    if (plan) setStale(true);
  };

  const setLog = (next: ApplyLogEntry[]) => {
    setLogState(next);
    if (next.length) localStorage.setItem(LOG_KEY, JSON.stringify(next));
    else localStorage.removeItem(LOG_KEY);
  };

  const loadBuffer = useCallback(async (org?: string, span = 7) => {
    setLoading(true);
    setLoadError(null);
    const start = windowStart();
    const end = DateTime.fromISO(start).plus({ days: span }).toISO()!;
    const qs = new URLSearchParams({ start, end, ...(org ? { org } : {}) });
    try {
      const res = await fetch(`/api/buffer/data?${qs}`);
      const json = await res.json();
      if (res.status === 401) {
        setMe((m) => (m ? { ...m, connected: false } : m));
        setLoadError(json.error ?? "Please connect Buffer again.");
        return;
      }
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setData(json);
      setBase({ channels: json.channels, existing: json.existing, drafts: [], start, days: span });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load Buffer data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Hydrate client-only state after mount; reading localStorage during render would mismatch SSR.
    /* eslint-disable react-hooks/set-state-in-effect */
    const params = new URLSearchParams(window.location.search);
    if (params.has("auth_error") || params.has("connected")) {
      setAuthError(params.get("auth_error"));
      window.history.replaceState(null, "", window.location.pathname);
    }
    const saved = localStorage.getItem(LOG_KEY);
    if (saved) setLogState(JSON.parse(saved));
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) setSettingsState(JSON.parse(savedSettings));
    const sample = sampleProblem();
    setBase(sample);
    setDrafts(sample.drafts);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetch("/api/buffer/me")
      .then((r) => r.json())
      .then((m: Me) => {
        setMe(m);
        if (m.connected) {
          setDrafts([]);
          loadBuffer();
        }
      })
      .catch(() => setMe({ configured: false, connected: false }));
  }, [loadBuffer]);

  const runPlan = async (nextLocks = locks, nextSeed = seed) => {
    if (!problem) return;
    const known = new Set(problem.channels.map((c) => c.id));
    const cleaned = drafts
      .map((d) => ({ ...d, channelIds: d.channelIds.filter((id) => known.has(id)) }))
      .filter((d) => d.text.trim() && d.channelIds.length);
    const draftIds = new Set(cleaned.map((d) => d.id));
    const validLocks = nextLocks.filter((l) => draftIds.has(l.postId) && known.has(l.channelId));
    const next: Problem = { ...problem, drafts: cleaned, now: DateTime.utc().toISO()! };
    setLocks(validLocks);
    setSeed(nextSeed);
    setBusy(true);
    const result = await solveAsync(next, validLocks, nextSeed);
    setBusy(false);
    const before = new Map((plan?.placements ?? []).map((p) => [placementKey(p.postId, p.channelId), p.dueAt]));
    setMoved(new Set(result.placements.filter((p) => before.has(placementKey(p.postId, p.channelId)) && before.get(placementKey(p.postId, p.channelId)) !== p.dueAt).map((p) => placementKey(p.postId, p.channelId))));
    setPlanned(next);
    setPlan(result);
    setStale(false);
    setTab("board");
  };

  const toggleLock = (p: Placement) => {
    const k = placementKey(p.postId, p.channelId);
    setLocks((ls) =>
      ls.some((l) => placementKey(l.postId, l.channelId) === k)
        ? ls.filter((l) => placementKey(l.postId, l.channelId) !== k)
        : [...ls, { postId: p.postId, channelId: p.channelId, dueAt: p.dueAt }],
    );
  };

  const move = (p: Placement, dueAt: string) => {
    const k = placementKey(p.postId, p.channelId);
    runPlan([...locks.filter((l) => placementKey(l.postId, l.channelId) !== k), { postId: p.postId, channelId: p.channelId, dueAt }]);
  };

  const changeDays = (span: number) => {
    setDays(span);
    setPlan(null);
    setTab("inbox");
    if (live) loadBuffer(data?.organizationId, span);
    else setBase((p) => p && { ...p, days: span });
  };

  const error = authError ? (AUTH_ERRORS[authError] ?? `Login failed: ${authError}`) : null;

  const steps = [
    { id: "channels", label: "Channels", disabled: false },
    { id: "inbox", label: "Posts", disabled: false },
    { id: "board", label: "Week", disabled: !plan },
  ] as const;

  return (
    <div className="min-h-screen">
      <header className="border-b border-grout bg-gesso">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <Mark />
            <div>
              <h1 className="text-xl font-bold leading-none tracking-tight">Tessera</h1>
              <p className="mt-1 text-xs text-ink-faint">A clash-free week of Buffer posts</p>
            </div>
          </div>
          <nav aria-label="Steps" className="flex items-end gap-6 self-stretch text-sm">
            {steps.map((t) => (
              <button
                key={t.id}
                disabled={t.disabled}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => setTab(t.id)}
                className={`-mb-3 border-b-2 pb-3 pt-1 font-medium disabled:cursor-not-allowed disabled:opacity-35 ${tab === t.id ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            Plan the next
            <select className="rounded-[4px] border border-grout-dark bg-gesso px-1.5 py-1 text-ink" value={days} onChange={(e) => changeDays(Number(e.target.value))}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
            </select>
          </label>
          <div className="ml-auto flex items-center gap-4 text-sm">
            {live && data && data.organizations.length > 1 && (
              <select
                aria-label="Buffer organization"
                className="rounded-[4px] border border-grout-dark bg-gesso px-1.5 py-1"
                value={data.organizationId}
                onChange={(e) => {
                  setPlan(null);
                  setDrafts([]);
                  setTab("inbox");
                  loadBuffer(e.target.value, days);
                }}
              >
                {data.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <span className="flex items-center gap-2 text-ink-soft">
              <span aria-hidden className={`size-2.5 rounded-[2px] ${live ? "tessera bg-malachite" : "bisque"}`} />
              {live ? "Connected to Buffer" : me?.connected ? "Loading Buffer" : "Sample data"}
            </span>
            {me?.connected ? (
              <>
                <button className={BTN.quiet} disabled={loading} onClick={() => loadBuffer(data?.organizationId, days)}>
                  Refresh
                </button>
                <form action="/api/auth/logout" method="post">
                  <button className={BTN.quiet}>Log out</button>
                </form>
              </>
            ) : (
              <a
                href="/api/auth/login"
                aria-disabled={me ? !me.configured : true}
                className={`${BTN.primary} ${me?.configured ? "" : "pointer-events-none opacity-35"}`}
                title={me?.configured ? "" : "Buffer login isn't configured on this server"}
              >
                Connect Buffer
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-6 py-7">
        {error && <Banner tone="alarm">{error}</Banner>}
        {loadError && <Banner tone="alarm">{loadError}</Banner>}
        {!me?.connected && (
          <Banner tone="caution">
            These are sample channels and posts, and nothing is sent anywhere. Connect Buffer to plan around your real queue.
          </Banner>
        )}
        {live && data && data.skipped.length > 0 && (
          <Banner tone="caution">Skipped {data.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.</Banner>
        )}
        {live && data && data.channels.length === 0 && (
          <Banner tone="caution">This Buffer organization has no connected channels. Connect one in Buffer, then press Refresh.</Banner>
        )}
        {log.length > 0 && !applying && (
          <Banner tone="plain">
            Tessera created {log.length} post{log.length === 1 ? "" : "s"} in Buffer.{" "}
            {me?.connected ? (
              <button className="font-semibold underline underline-offset-4" onClick={() => setApplying(true)}>
                Review or undo
              </button>
            ) : (
              "Connect Buffer to undo them."
            )}
          </Banner>
        )}

        {!problem || (me?.connected && loading && !data) ? (
          <p className="text-sm text-ink-faint">Loading your channels…</p>
        ) : tab === "channels" ? (
          <Channels channels={base?.channels ?? []} settings={settings} onChange={setSettings} onDone={() => setTab("inbox")} />
        ) : tab === "inbox" || !plan || !planned ? (
          <Inbox
            key={problem.channels.map((c) => c.id).join()}
            channels={problem.channels}
            drafts={drafts}
            onChange={(d) => {
              setDrafts(d);
              if (plan) setStale(true);
            }}
            onPlan={() => runPlan()}
          />
        ) : (
          <Board
            problem={planned}
            plan={plan}
            locks={locks}
            stale={stale}
            busy={busy}
            moved={moved}
            onReroll={() => runPlan(locks, seed + 1)}
            onToggleLock={toggleLock}
            onMove={move}
            onReplan={() => runPlan()}
            onApply={() => setApplying(true)}
          />
        )}
      </main>

      {applying && (planned ?? problem) && (
        <ApplyPanel
          problem={(planned ?? problem)!}
          placements={plan?.placements ?? []}
          connected={Boolean(me?.connected)}
          log={log}
          onLog={setLog}
          onClose={() => setApplying(false)}
          onApplied={() => loadBuffer(data?.organizationId, days).then(() => setPlan(null))}
        />
      )}
    </div>
  );
}

/** Four tesserae: the wordmark's glyph. */
function Mark() {
  return (
    <span aria-hidden className="grid size-8 grid-cols-2 gap-[3px] rounded-[3px] bg-grout p-[3px]">
      <span className="tessera rounded-[2px] bg-lapis" />
      <span className="tessera rounded-[2px] bg-ochre" />
      <span className="tessera rounded-[2px] bg-malachite" />
      <span className="tessera rounded-[2px] bg-garnet" />
    </span>
  );
}

function Banner({ tone, children }: { tone: "alarm" | "caution" | "plain"; children: React.ReactNode }) {
  const cls = {
    alarm: "border-l-alarm bg-alarm-wash text-alarm",
    caution: "border-l-ochre bg-caution-wash text-caution",
    plain: "border-l-ink bg-gesso text-ink",
  }[tone];
  return (
    <div role={tone === "alarm" ? "alert" : undefined} className={`rounded-r-md border-l-4 px-4 py-2.5 text-sm ${cls}`}>
      {children}
    </div>
  );
}
