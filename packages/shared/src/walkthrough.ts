export interface CodeReference {
  path: string;
  side: "old" | "new";
  line: number;
  endLine: number;
  version: string;
}

export interface DependencyNode extends CodeReference {
  id: string;
  name: string;
  changed: boolean;
  excerpt: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "call" | "reference" | "type" | "import" | "jsx";
  evidence: CodeReference;
}

export interface DependencyGraph {
  omittedPaths?: string[];
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  groups: string[][];
  limitations: string[];
}

export interface WalkthroughReference extends CodeReference {
  nodeId: string;
  diffPath?: string;
  diffLine?: number;
  diffEndLine?: number;
  currentVersion?: string;
  baseVersion?: string;
}
export interface WalkthroughStep {
  id: string;
  title: string;
  explanation: string;
  details: string;
  example: string;
  reviewConsiderations: string;
  nodeIds: string[];
  prerequisites: string[];
  references: WalkthroughReference[];
}
export interface Walkthrough {
  version: string;
  snapshotVersion: string;
  base: string;
  head: string;
  steps: WalkthroughStep[];
  uncoveredFiles: string[];
  limitations: string[];
}
export interface WalkthroughState {
  walkthrough: Walkthrough | null;
  phase: "idle" | "capturing" | "analyzing" | "explaining";
  staleSteps: string[];
  stale: boolean;
}
