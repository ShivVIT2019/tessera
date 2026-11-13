# Tessera

Tessera plans a week of social posts around the Buffer queue you already have. Paste a batch of posts, and Tessera reads your connected Buffer channels and their scheduled posts, then lays the new posts out across the next 7 or 14 days without breaking any channel's rules. Every placement comes with a reason. You can drag posts around, lock them, re-plan, and send the whole plan to Buffer in one step, with Undo.

Live demo: https://tessera-lovat.vercel.app (opens in sample mode, no login needed)

Built for [Buffer Commit](https://buffer.com/api/commit).

## Features

- **Sign in with Buffer.** OAuth 2.0 Authorization Code with PKCE. The token is kept in an encrypted httpOnly cookie; there is no database.
- **Plans around your real queue.** Existing scheduled posts are treated as obstacles, per channel and in each channel's own time zone.
- **Rules that are never broken.** Quiet hours, a maximum number of posts per day, a minimum gap between posts, not-before dates, locked posts, and nothing in the past.
- **Preferences that shape the plan.** Same-topic posts are spaced apart, posts are spread evenly across the week, golden windows are preferred, and cross-posts are staggered between channels.
- **Explanations.** Each post says why it landed where it did, and any slot on the board can be checked to see which rules allow or block it.
- **Interactive board.** Drag a post to another day; it is locked there and the rest of the week reflows in a Web Worker. "Try another layout" re-rolls with a new seed under the same rules. Each plan gets a cadence score from 0 to 100.
- **Per-channel rules.** Time zone, quiet hours, daily limit, gap, golden windows and preferred hour, with Gentle, Steady and Busy presets. Settings are saved in the browser.
- **Safe apply.** A dry-run summary first, then posts are created in small batches with rate-limit retry. Created post IDs are kept so Undo can delete exactly those posts.
- **MCP tool.** The planner is also available to AI agents as a read-only `plan_week` tool.

## How it works

The planner (`lib/solver.ts`) is deterministic: the same input and seed always produce the same plan.

1. Posts are ordered most-constrained first.
2. Each post is placed greedily in the cheapest valid slot. Hard rules decide which slots are valid; soft costs (topic spacing, spread, golden windows, stagger) rank them, with seeded jitter for re-rolls.
3. If a post doesn't fit, a repair step tries moving one blocking post.
4. A local search pass moves posts to lower the total cost.
5. Posts that still don't fit are reported with the reason.

All time arithmetic uses Luxon with IANA time zones, so plans stay correct across daylight-saving changes.

## Project structure

| Path | Purpose |
|---|---|
| `lib/types.ts` | Shared domain types: `Channel`, `DraftPost`, `Plan`, and so on |
| `lib/solver.ts` | `solve(problem, locks, seed)` and `explainSlot(...)` |
| `lib/rules.ts` | Per-network default rules, golden windows and cadence presets |
| `lib/buffer.ts` | Buffer GraphQL client: organizations, channels, scheduled posts, `createPost`, `deletePost` |
| `lib/session.ts` | PKCE helpers and AES-256-GCM encrypted session cookies |
| `lib/inbox.ts` | Splits pasted text into posts; per-network character limits |
| `lib/mcp.ts` | `plan_week` MCP tool |
| `lib/sample.ts` | Sample channels, existing posts and drafts for sample mode |
| `app/api/auth/*` | `login`, `callback` and `logout` routes |
| `app/api/buffer/*` | `me`, `data`, `apply` and `undo` routes |
| `app/api/mcp` | MCP endpoint (Streamable HTTP, JSON responses) |
| `app/ui/*` | Channels, Posts, Week board and Apply screens; solver Web Worker |

## Run locally

Requires Node.js 20.9 or later.

```bash
npm install
npm run dev                          # http://localhost:3000, sample mode
npx next dev --experimental-https    # https://localhost:3000, needed for Buffer login
```

The app runs in sample mode with no configuration. To connect a real Buffer account:

1. In Buffer, go to **Settings → API → App Clients** and create a **public** (PKCE) client with the `account:read`, `posts:read` and `posts:write` permissions.
2. Register these redirect URIs. Buffer only accepts HTTPS:
   - `https://localhost:3000/api/auth/callback`
   - `https://<your-deployment>/api/auth/callback`
3. Copy `.env.example` to `.env.local` and set:
   - `BUFFER_CLIENT_ID`: the client ID from step 1
   - `SESSION_SECRET`: a random value, for example from `openssl rand -base64 32`
   - `BUFFER_REDIRECT_URI` can stay empty; it defaults to `<origin>/api/auth/callback`.
4. Start the HTTPS dev server and open `https://localhost:3000`.

## Deploy

Deploy to Vercel (or any Next.js host) and set `BUFFER_CLIENT_ID` and `SESSION_SECRET` as environment variables. Leave `BUFFER_REDIRECT_URI` unset so the deployment uses its own origin, and make sure that origin's callback URL is registered on the Buffer client.

## MCP tool

`POST /api/mcp` is a stateless MCP server with one read-only tool, `plan_week`. It takes `channels` and `drafts`, and optionally `existing`, `locks`, `start`, `days` (1 to 14) and `seed`, and returns the plan. It never writes to Buffer. Add it to an MCP client as `https://tessera-lovat.vercel.app/api/mcp`, or call it directly:

```bash
curl -s localhost:3000/api/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_week","arguments":{"channels":[{"id":"x","service":"twitter","timezone":"America/New_York"}],"drafts":[{"id":"a","text":"Hello","channelIds":["x"]}]}}}'
```

## Testing

```bash
npm test         # unit and property-based tests (Vitest + fast-check)
npm run lint
npm run build
```

The property-based tests generate random weeks across several time zones and daylight-saving transitions, and check that hard rules are never broken, every post is placed or reported exactly once, locked posts stay put, and the same seed gives the same plan.

## Notes

- Buffer's free API tier allows roughly 100 requests per day. Loading Buffer data costs about 3 requests; sample mode and the dry run cost none.
- Secrets live only in `.env.local` and the hosting provider's settings. Never commit them.

## Tech stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Luxon, Vitest and fast-check.
