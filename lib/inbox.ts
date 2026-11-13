import type { DraftPost } from "./types";

const LIMITS: Record<string, number> = {
  twitter: 280,
  bluesky: 300,
  threads: 500,
  mastodon: 500,
  pinterest: 500,
  linkedin: 3000,
  instagram: 2196,
  facebook: 5000,
  tiktok: 4000,
  googlebusiness: 4000,
  youtube: 5000,
  substack: 10000,
};

/** Buffer counts post length in UTF-16 code units, so `String.length` matches. */
export function charLimit(service: string): number | undefined {
  return LIMITS[service];
}

export function splitPosts(text: string): string[] {
  return text
    .split(/\n\s*(?:-{3,}\s*)?\n|\n-{3,}\n/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join("-") || "post"
  );
}

export function uniqueId(text: string, taken: Set<string>): string {
  const base = slug(text);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export function toDrafts(text: string, channelIds: string[], existing: DraftPost[] = []): DraftPost[] {
  const taken = new Set(existing.map((d) => d.id));
  return splitPosts(text).map((t) => ({ id: uniqueId(t, taken), text: t, channelIds: [...channelIds] }));
}
