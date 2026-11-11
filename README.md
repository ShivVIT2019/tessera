# Tessera

Paste a batch of posts. Tessera reads your Buffer channels and the posts already scheduled there, then plans them across the week without clashes. Every placement comes with a reason, you can lock any post and re-plan, and one click sends the plan to Buffer, with Undo.

Built for [Buffer Commit](https://buffer.com/api/commit). **Submit by Fri Nov 13, 12:00 PM PT (3:00 PM ET).** Hard deadline: 11:59 PM PT.

## How it fits together

| File | What it does | Owner |
|---|---|---|
| `lib/types.ts` | Shared interface. Change only after agreeing. | Both |
| `lib/solver.ts` | `solve(problem, locks)` places posts with reasons; `explainSlot(...)` says why a slot is allowed or not | Atchu |
| `lib/sample.ts` | `sampleProblem()`: 3 channels, existing posts, 8 drafts | Atchu |
| `lib/solver.test.ts` | Solver tests (`npm test`) | Atchu |
| `app/api/auth/*` | Login with Buffer (OAuth + PKCE) | Balaji |
| `lib/buffer.ts` | Buffer GraphQL client | Balaji |
| `app/*` | Inbox, Board, Apply/Undo screens | Balaji |

## Tasks

### Atchu
- [x] Next.js app, shared types, repo
- [x] Solver: quiet hours, daily cap, minimum gap, existing posts, locks, not-before, preferred hour
- [x] `explainSlot` for click-to-explain
- [x] Sample data and 13 tests
- [x] Deployed: https://tessera-lovat.vercel.app (OAuth redirect: /api/auth/callback)
- [ ] Final README for judges, with a "Built during the contest window" section
- [ ] Write-up and demo video
- [ ] Submit as team captain, listing both members

### Balaji
- [ ] Register at buffer.com/api/commit/register with your own Buffer account
- [ ] Create the OAuth app client (Buffer → Settings → API → App Clients, PKCE)
- [ ] Ask on Discord whether judges can log in to our app without extra approval
- [ ] Login with Buffer: `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`; token in an encrypted httpOnly cookie; no database
- [ ] Read channels and scheduled posts; map them to `Channel` and `ExistingPost`
- [ ] Inbox: paste posts, pick channels, optional topic and not-before → `DraftPost[]`
- [ ] Board: day grid per channel, existing posts in grey, tiles with reasons, lock, Re-plan, click a slot → `explainSlot`
- [ ] Apply: dry run first, then `createPost` (`customScheduled` + `dueAt`) in small batches with rate-limit retry; keep created IDs
- [ ] Undo: delete the posts Apply created
- [ ] Sample mode by default: open with `sampleProblem()`, call Buffer only after login

## Schedule

| When | Goal |
|---|---|
| **Wed** | Login works, channels listed, one post created and deleted, public URL live |
| **Thu** | Inbox, Board, Apply, Undo, sample mode working end to end; ask questions at Buffer office hours |
| **Fri by noon PT** | Final README, write-up, video, submission |

## Rules

- About **100 Buffer API requests per day** on the free tier. Use sample mode and dry run while building; create real posts only for the video.
- Never commit secrets. Keep tokens and client settings in `.env.local` and in Vercel settings.
- Only work done during the contest window (Oct 28 – Nov 13) is judged, so keep commits small and clear.

## Run locally

```bash
npm install
npm test        # solver tests
npm run dev     # http://localhost:3000
```
