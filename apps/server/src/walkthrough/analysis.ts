import type { DependencyGraph } from "@agent-manager/shared";
import type { AnalysisSnapshot } from "./snapshot";

export function analyzeDependencies(
  snapshot: AnalysisSnapshot,
  signal?: AbortSignal,
): Promise<DependencyGraph> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
    const finish = (error?: Error, graph?: DependencyGraph) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(graph!);
    };
    const abort = () => finish(new Error("Dependency analysis cancelled."));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Dependency analysis exceeded 60 seconds. Reduce the change size and retry.",
          ),
        ),
      60_000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) =>
      finish(
        event.data.error ? new Error(event.data.error) : undefined,
        event.data.graph,
      );
    worker.onerror = (event) => finish(new Error(event.message));
    worker.postMessage(snapshot);
  });
}
