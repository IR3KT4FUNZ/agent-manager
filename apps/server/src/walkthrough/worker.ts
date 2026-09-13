import { analyzeSnapshot } from "./analyze";
import type { AnalysisSnapshot } from "./snapshot";

self.onmessage = (event: MessageEvent<AnalysisSnapshot>) => {
  try {
    self.postMessage({ graph: analyzeSnapshot(event.data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
