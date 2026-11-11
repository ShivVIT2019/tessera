import { solve } from "../lib/solver";
import { sampleProblem } from "../lib/sample";

const problem = sampleProblem();
const t0 = performance.now();
const plan = solve(problem);
const ms = Math.round(performance.now() - t0);

for (const p of plan.placements) console.log(`${p.dueAt}  ${p.channelId.padEnd(5)} ${p.postId.padEnd(10)} ${p.reason}`);
for (const u of plan.unplaced) console.log(`UNPLACED ${u.postId}: ${u.reason}`);
console.log(`\n${plan.placements.length} placed, ${plan.unplaced.length} unplaced, ${ms} ms`);
