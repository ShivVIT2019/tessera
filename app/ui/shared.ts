import { DateTime } from "luxon";
import type { Channel } from "@/lib/types";

export const GLAZES = ["lapis", "malachite", "garnet", "ochre", "amethyst", "teal", "umber"] as const;
export type Glaze = (typeof GLAZES)[number];

const GLAZE_BG: Record<Glaze, string> = {
  lapis: "bg-lapis",
  malachite: "bg-malachite",
  garnet: "bg-garnet",
  ochre: "bg-ochre",
  amethyst: "bg-amethyst",
  teal: "bg-teal",
  umber: "bg-umber",
};

export function topicGlaze(topic: string | undefined): Glaze {
  const s = topic ?? "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 23 + s.charCodeAt(i)) >>> 0;
  return GLAZES[h % GLAZES.length];
}

/** Background class for a topic's glaze colour. */
export const topicColor = (topic: string | undefined) => GLAZE_BG[topicGlaze(topic)];

const SERVICE_NAMES: Record<string, string> = {
  twitter: "X",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  threads: "Threads",
  instagram: "Instagram",
  facebook: "Facebook",
  substack: "Substack",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  googlebusiness: "Google Business",
};

export const serviceName = (service: string) => SERVICE_NAMES[service] ?? service;

export const localTime = (iso: string, ch: Channel, fmt = "HH:mm") =>
  DateTime.fromISO(iso, { zone: "utc" }).setZone(ch.timezone).toFormat(fmt);

export const tzLabel = (ch: Channel) => DateTime.now().setZone(ch.timezone).toFormat("ZZZZ");

export const placementKey = (postId: string, channelId: string) => `${postId}|${channelId}`;

export type ApplyLogEntry = { key: string; postId: string; channelId: string; dueAt: string; bufferId: string };

export const BTN = {
  primary: "rounded-[4px] bg-ink px-4 py-2 text-sm font-semibold text-gesso hover:bg-[#2c3846] disabled:cursor-not-allowed disabled:opacity-35",
  secondary: "rounded-[4px] border border-grout-dark bg-gesso px-4 py-2 text-sm font-medium text-ink hover:border-ink disabled:opacity-35",
  quiet: "text-sm font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline disabled:opacity-35",
  danger: "rounded-[4px] border border-alarm/50 bg-gesso px-4 py-2 text-sm font-medium text-alarm hover:border-alarm disabled:opacity-35",
};

export const PANEL = "rounded-md border border-grout bg-gesso";
