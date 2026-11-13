import { defaultRules } from "./rules";
import type { Channel, ExistingPost } from "./types";

export const API_URL = "https://api.buffer.com";

export class BufferError extends Error {
  constructor(message: string, public code?: string, public retryAfter?: number) {
    super(message);
  }
}

type GqlResponse<T> = { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };

export async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const retryAfter = Number(res.headers.get("retry-after")) || undefined;
  if (res.status === 429) throw new BufferError("Buffer rate limit reached", "RATE_LIMIT_EXCEEDED", retryAfter ?? 60);
  if (res.status === 401) throw new BufferError("Buffer session expired", "UNAUTHORIZED");
  const json = (await res.json().catch(() => null)) as GqlResponse<T> | null;
  if (!json) throw new BufferError(`Buffer API returned ${res.status}`, "UNEXPECTED");
  if (json.errors?.length) {
    const [first] = json.errors;
    const code = first.extensions?.code;
    throw new BufferError(first.message, code, code === "RATE_LIMIT_EXCEEDED" ? (retryAfter ?? 60) : undefined);
  }
  if (!json.data) throw new BufferError("Buffer API returned no data", "UNEXPECTED");
  return json.data;
}

export type Organization = { id: string; name: string };

export type BufferChannel = {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  timezone: string;
  isDisconnected: boolean;
  isLocked: boolean;
  isQueuePaused: boolean;
  postingSchedule: { day: string; paused: boolean; times: string[] }[];
};

export type BufferPost = { id: string; channelId: string; dueAt: string | null; text: string };

export async function getOrganizations(token: string): Promise<Organization[]> {
  const data = await gql<{ account: { organizations: Organization[] } }>(
    token,
    `query Orgs { account { organizations { id name } } }`,
  );
  return data.account.organizations;
}

export async function getChannels(token: string, organizationId: string): Promise<BufferChannel[]> {
  const data = await gql<{ channels: BufferChannel[] }>(
    token,
    `query Channels($input: ChannelsInput!) {
      channels(input: $input) {
        id name displayName service timezone isDisconnected isLocked isQueuePaused
        postingSchedule { day paused times }
      }
    }`,
    { input: { organizationId } },
  );
  return data.channels;
}

export async function getScheduledPosts(
  token: string,
  organizationId: string,
  channelIds: string[],
  start: string,
  end: string,
  maxPages = 3,
): Promise<BufferPost[]> {
  const posts: BufferPost[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: {
      posts: { edges: { node: BufferPost }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await gql(
      token,
      `query Scheduled($input: PostsInput!, $first: Int, $after: String) {
        posts(input: $input, first: $first, after: $after) {
          edges { node { id channelId dueAt text } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      {
        first: 100,
        after,
        input: {
          organizationId,
          filter: { status: ["scheduled"], channelIds, dueAt: { start, end } },
          sort: [{ field: "dueAt", direction: "asc" }],
        },
      },
    );
    posts.push(...data.posts.edges.map((e) => e.node));
    if (!data.posts.pageInfo.hasNextPage) break;
    after = data.posts.pageInfo.endCursor;
  }
  return posts;
}

export async function createScheduledPost(
  token: string,
  input: { channelId: string; text: string; dueAt: string },
): Promise<{ id: string; dueAt: string | null }> {
  const data = await gql<{ createPost: { post?: { id: string; dueAt: string | null }; message?: string } }>(
    token,
    `mutation Create($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id dueAt } }
        ... on MutationError { message }
      }
    }`,
    { input: { ...input, schedulingType: "automatic", mode: "customScheduled", source: "tessera" } },
  );
  if (!data.createPost.post) throw new BufferError(data.createPost.message ?? "Buffer could not create the post", "MUTATION_ERROR");
  return data.createPost.post;
}

export async function deletePost(token: string, id: string): Promise<void> {
  const data = await gql<{ deletePost: { id?: string; message?: string } }>(
    token,
    `mutation Delete($input: DeletePostInput!) {
      deletePost(input: $input) {
        ... on DeletePostSuccess { id }
        ... on MutationError { message }
      }
    }`,
    { input: { id } },
  );
  if (!data.deletePost.id) throw new BufferError(data.deletePost.message ?? "Buffer could not delete the post", "MUTATION_ERROR");
}

/** Most common hour in the channel's Buffer posting schedule, if it has one. */
export function preferredHourFromSchedule(schedule: BufferChannel["postingSchedule"]): number | undefined {
  const counts = new Map<number, number>();
  for (const day of schedule) {
    if (day.paused) continue;
    for (const time of day.times) {
      const hour = Number(time.split(":")[0]);
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) counts.set(hour, (counts.get(hour) ?? 0) + 1);
    }
  }
  let best: number | undefined;
  for (const [hour, n] of counts) {
    if (best === undefined || n > counts.get(best)! || (n === counts.get(best)! && hour < best)) best = hour;
  }
  return best;
}

export function toChannel(c: BufferChannel): Channel {
  return {
    id: c.id,
    name: c.displayName || c.name,
    service: c.service,
    timezone: c.timezone || "Europe/London",
    ...defaultRules(c.service),
    preferredHour: preferredHourFromSchedule(c.postingSchedule ?? []),
  };
}

export function usableChannels(channels: BufferChannel[]): { channels: Channel[]; skipped: { name: string; reason: string }[] } {
  const usable: Channel[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const c of channels) {
    const name = c.displayName || c.name;
    if (c.isDisconnected) skipped.push({ name, reason: "disconnected in Buffer" });
    else if (c.isLocked) skipped.push({ name, reason: "locked by your Buffer plan" });
    else usable.push(toChannel(c));
  }
  return { channels: usable, skipped };
}

export function toExisting(posts: BufferPost[]): ExistingPost[] {
  return posts.filter((p) => p.dueAt).map((p) => ({ channelId: p.channelId, dueAt: p.dueAt! }));
}
