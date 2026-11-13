import { solve } from "@/lib/solver";
import type { Lock, Problem } from "@/lib/types";

type Request = { id: number; problem: Problem; locks: Lock[]; seed: number };

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, problem, locks, seed } = e.data;
  self.postMessage({ id, plan: solve(problem, locks, seed) });
};
