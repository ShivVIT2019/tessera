import type { NextRequest } from "next/server";
import { withBuffer } from "@/lib/api-route";
import { getChannels, getOrganizations, getScheduledPosts, toExisting, usableChannels } from "@/lib/buffer";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const start = params.get("start");
  const end = params.get("end");
  if (!start || !end) return Response.json({ error: "start and end are required" }, { status: 400 });

  return withBuffer(req, async (token) => {
    const organizations = await getOrganizations(token);
    const organization = organizations.find((o) => o.id === params.get("org")) ?? organizations[0];
    if (!organization) return { organizations, channels: [], skipped: [], existing: [] };
    const { channels, skipped } = usableChannels(await getChannels(token, organization.id));
    const posts = channels.length
      ? await getScheduledPosts(token, organization.id, channels.map((c) => c.id), start, end)
      : [];
    return { organizations, organizationId: organization.id, channels, skipped, existing: toExisting(posts) };
  });
}
