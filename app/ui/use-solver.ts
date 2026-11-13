"use client";

import { useCallback, useEffect, useRef } from "react";
import { solve } from "@/lib/solver";
import type { Lock, Plan, Problem } from "@/lib/types";

/** Runs the solver in a Web Worker so the board stays responsive; falls back to the main thread. */
export function useSolver() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (plan: Plan) => void>());
  const nextId = useRef(0);

  useEffect(() => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL("./solver.worker.ts", import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; plan: Plan }>) => {
        pending.current.get(e.data.id)?.(e.data.plan);
        pending.current.delete(e.data.id);
      };
      w.onerror = () => {
        worker.current = null;
      };
      worker.current = w;
    } catch {
      worker.current = null;
    }
    return () => w?.terminate();
  }, []);

  return useCallback((problem: Problem, locks: Lock[], seed: number): Promise<Plan> => {
    const w = worker.current;
    if (!w) return Promise.resolve(solve(problem, locks, seed));
    const id = ++nextId.current;
    return new Promise((resolve) => {
      pending.current.set(id, resolve);
      w.postMessage({ id, problem, locks, seed });
    });
  }, []);
}
