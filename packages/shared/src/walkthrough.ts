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

