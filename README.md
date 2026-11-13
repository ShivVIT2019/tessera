# Tessera

**Plan a whole week of Buffer posts in one paste.**

Buffer schedules posts one at a time. Tessera plans a whole batch at once: it reads your Buffer channels and the posts already in your queue, places every new post under rules that are never broken, explains why each post landed where it did, and sends the plan to Buffer. One click undoes it.

- **Live app:** https://tessera-adet.vercel.app
- **Demo video:** https://youtu.be/G55kUkGdvuI
- Built for [Buffer Commit](https://buffer.com/api/commit) by Sivasai Atchyut Akella and Balaji

A *tessera* is one tile in a mosaic. Your week is the mosaic, and every post is a tile.

## How it works

1. **Connect Buffer** with Buffer OAuth.
2. **Set rules per channel:** quiet hours, posts per day, the gap between posts, and golden windows, all in the channel's own time zone. Presets: Gentle, Steady, Busy.
3. **Paste a batch** of posts. Each paragraph becomes one post, optionally tagged with a topic.
4. **Plan the week.** Every post is placed on the board with a reason.
5. **Adjust:** drag a post to lock it and the rest replan, or try another layout under the same rules.
6. **Review and apply:** posts are created in Buffer at their exact planned times.
7. **Undo** deletes exactly the posts Tessera created.

## The planning engine

**Hard rules (never broken)**
- No posts during a channel's quiet hours
- A daily limit per channel
- A minimum gap between posts on the same channel
- Posts already in Buffer are fixed obstacles
- Locked posts stay where you put them
- Nothing before a post's "not before" time, and nothing in the past

**Preferences (optimized when there's room):** golden windows, an evenly spread week, and space between posts on the same topic. The cadence score shows how well a plan meets them.

**Explainable:** every post shows why it landed there, and selecting a day shows which times are free and why the others aren't.

**Deterministic and tested:** the same input gives the same plan. 24 tests, including property-based tests (fast-check) that run the planner on random weeks and check that no rule is broken.

## How Tessera uses the Buffer API

- **OAuth 2.0 with PKCE** for sign-in. No database: the token stays in an encrypted, httpOnly cookie.
- **GraphQL reads:** organizations, channels, and scheduled posts, so plans work around your real queue.
- **`createPost`** with an exact `dueAt` time, sent in small batches with retry when Buffer's rate limit is reached. Posts already created are never sent twice.
- **`deletePost`** for Undo.
- **Extra:** the planner is also available as a read-only MCP tool (`plan_week` at `/api/mcp`), so AI agents can plan a week.

## Built during the contest window (Nov 11–13, 2026)

Everything in this repository was built during Buffer Commit:
- **Nov 11:** project setup, shared types, the first planning engine with explanations, sample data, and tests
- **Nov 12:** Buffer OAuth, the Buffer API client, Apply and Undo, planning engine v2, and the board design
- **Nov 13:** end-to-end testing on a real Buffer account (plan, apply, check the queue, undo), the demo, and this README

**Team**
- **Sivasai Atchyut Akella:** the planning engine (rules, placement, explanations), project setup, tests, deployment setup, demo, and submission
- **Balaji (Vbj1808):** Buffer OAuth and API integration, the interface (Channels, Posts, Week board), Apply and Undo, planning engine v2, and the MCP tool

Built with the help of AI coding tools.

## Known limitations

- Verified end to end on a Substack channel. Other Buffer channels use the same API but weren't tested.
- Buffer's free tier allows about 100 API requests per day per app, so heavy use can hit the limit.
- Undo works only before posts are published, and only in the browser that ran Apply.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your Buffer client ID
npm test
npm run dev                  # http://localhost:3000
```

Stack: Next.js, React, TypeScript, Tailwind, Luxon (time zones and daylight saving), Vitest, fast-check.
