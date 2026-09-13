import ts from "typescript";
import { dirname, relative, resolve } from "node:path";
import type {
  CodeReference,
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
} from "@agent-manager/shared";
import { contentVersion, isWithin } from "../source";
import type { AnalysisSnapshot } from "./snapshot";
import { dependencyOrder } from "./graph";

type MatchFiles = (
  path: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  sensitive: boolean,
  cwd: string,
  depth: number | undefined,
  entries: (path: string) => { files: string[]; directories: string[] },
  realpath: (path: string) => string,
) => string[];
const matchFiles = Reflect.get(ts, "matchFiles") as MatchFiles;
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/;

function programs(
  root: string,
  files: Record<string, string>,
  limitations: Set<string>,
) {
  const absolute = new Map(
    Object.entries(files).map(([path, text]) => [resolve(root, path), text]),
  );
  const readFile = (path: string) =>
    absolute.get(resolve(path)) ??
    (path.includes("/node_modules/") ? ts.sys.readFile(path) : undefined);
  const fileExists = (path: string) => readFile(path) !== undefined;
  const entries = (directory: string) => {
    const children = [...absolute.keys()].filter(
      (path) => isWithin(directory, path) && path !== directory,
    );
    return {
      files: children
        .filter((path) => dirname(path) === directory)
        .map((path) => relative(directory, path)),
      directories: [
        ...new Set(
          children
            .map((path) => relative(directory, path).split("/"))
            .filter((parts) => parts.length > 1)
            .map((parts) => parts[0]!),
        ),
      ],
    };
  };
  const readDirectory: ts.ParseConfigHost["readDirectory"] = (
    path,
    extensions,
    excludes,
    includes,
    depth,
  ) =>
    matchFiles(
      path,
      extensions,
      excludes,
      includes,
      true,
      root,
      depth,
      entries,
      (path) => path,
    );
  const host = ts.createCompilerHost({});
  host.readFile = readFile;
  host.fileExists = fileExists;
  host.readDirectory = (...args) => [...readDirectory(...args)];
  host.directoryExists = (path) =>
    entries(resolve(path)).files.length > 0 ||
    entries(resolve(path)).directories.length > 0 ||
    (path.includes("/node_modules") && ts.sys.directoryExists(path));
  host.getSourceFile = (path, languageVersion) => {
    const text = readFile(path);
    return text === undefined
      ? undefined
      : ts.createSourceFile(path, text, languageVersion, true);
  };
  const covered = new Set<string>();
  const results: ts.Program[] = [];
  const configs = [...absolute.keys()]
    .filter((path) => /\/(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/.test(path))
    .sort();
  for (const config of configs) {
    const parsed = ts.readConfigFile(config, readFile);
    if (parsed.error) {
      limitations.add(`Could not parse ${relative(root, config)}.`);
      continue;
    }
    const project = ts.parseJsonConfigFileContent(
      parsed.config,
      { useCaseSensitiveFileNames: true, readFile, fileExists, readDirectory },
      dirname(config),
    );
    for (const reference of project.projectReferences ?? []) {
      const configPath = /\.json$/.test(reference.path)
        ? reference.path
        : resolve(reference.path, "tsconfig.json");
      if (absolute.has(configPath) && !configs.includes(configPath))
        configs.push(configPath);
    }
    if (project.errors.length)
      limitations.add(
        `Some configuration options in ${relative(root, config)} could not be resolved.`,
      );
    if (!project.fileNames.length) continue;
    project.fileNames.forEach((path) => covered.add(path));
    results.push(
      ts.createProgram({
        rootNames: project.fileNames,
        options: { ...project.options, noEmit: true },
        host,
      }),
    );
  }
  const loose = [...absolute.keys()].filter(
    (path) => sourceExtension.test(path) && !covered.has(path),
  );
  if (loose.length)
    results.push(
      ts.createProgram({
        rootNames: loose,
        host,
        options: {
          allowJs: true,
          checkJs: true,
          noEmit: true,
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          target: ts.ScriptTarget.ES2022,
        },
      }),
    );
  return results;
}

function declarationName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isVariableDeclaration(node)
  ) {
    return node.name?.getText();
  }
  return undefined;
}

function isDirectCall(
  target: ts.Node | undefined,
  expression: ts.Expression,
): boolean {
  if (!target) return false;
  if (ts.isFunctionDeclaration(target) || ts.isClassDeclaration(target))
    return true;
  if (ts.isVariableDeclaration(target)) {
    return Boolean(
      target.initializer &&
      (ts.isArrowFunction(target.initializer) ||
        ts.isFunctionExpression(target.initializer)),
    );
  }
  if (
    ts.isMethodDeclaration(target) &&
    ts.isPropertyAccessExpression(expression)
  ) {
    return ts.isNewExpression(expression.expression);
  }
  return false;
}

export function analyzeSnapshot(snapshot: AnalysisSnapshot): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const edges = new Map<string, DependencyEdge>();
  const limitations = new Set(snapshot.limitations);
  for (const side of ["old", "new"] as const) {
    const files = side === "old" ? snapshot.before : snapshot.after;
    for (const program of programs(snapshot.root, files, limitations)) {
      const checker = program.getTypeChecker();
      const declarations = new Map<ts.Node, string>();
      const sourceFiles = program
        .getSourceFiles()
        .filter((file) => relative(snapshot.root, file.fileName) in files);
      function reference(node: ts.Node): CodeReference {
        const file = node.getSourceFile();
        const path = relative(snapshot.root, file.fileName);
        return {
          path,
          side,
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          endLine: file.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          version: contentVersion(files[path]!),
        };
      }
      function register(node: ts.Node, name: string) {
        const location = reference(node);
        const id = `${side}:${location.path}:${node.getStart()}:${name}`;
        declarations.set(node, id);
        if (!nodes.has(id))
          nodes.set(id, {
            ...location,
            id,
            name,
            changed: false,
            excerpt: node.getText().slice(0, 6000),
          });
      }
      for (const file of sourceFiles) {
        register(file, relative(snapshot.root, file.fileName));
        function collect(node: ts.Node) {
          const name = declarationName(node);
          if (name) register(node, name);
          ts.forEachChild(node, collect);
        }
        ts.forEachChild(file, collect);
      }
      function owner(node: ts.Node | undefined): string | undefined {
        while (node) {
          const id = declarations.get(node);
          if (id) return id;
          node = node.parent;
        }
      }
      function symbolTarget(node: ts.Node) {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);
        return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      }
      function link(
        target: ts.Node | undefined,
        use: ts.Node,
        kind: DependencyEdge["kind"],
      ) {
        const from = owner(target);
        const to = owner(use);
        if (!from || !to || from === to) return;
        const evidence = reference(use);
        const key = `${from}:${to}:${kind}:${evidence.line}`;
        edges.set(key, { from, to, kind, evidence });
      }
      for (const file of sourceFiles) {
        const path = relative(snapshot.root, file.fileName);
        const diff = snapshot.diffs.find(
          (diff) =>
            (side === "old" ? (diff.oldPath ?? diff.path) : diff.path) === path,
        );
        for (const line of diff?.hunks.flatMap((hunk) => hunk.lines) ?? []) {
          const number =
            side === "old" && line.kind === "del"
              ? line.oldLine
              : side === "new" && line.kind === "add"
                ? line.newLine
                : null;
          if (number === null) continue;
          const candidates = [...declarations.values()]
            .map((id) => nodes.get(id)!)
            .filter(
              (node) =>
                node.path === path &&
                node.line <= number &&
                node.endLine >= number,
            );
          candidates.sort((a, b) => a.endLine - a.line - (b.endLine - b.line));
          if (candidates[0]) candidates[0].changed = true;
        }
        if (diff && !diff.hunks.length && diff.status === "renamed")
          nodes.get(declarations.get(file)!)!.changed = true;
        function trace(node: ts.Node) {
          if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            const target = symbolTarget(node.expression);
            if (isDirectCall(target, node.expression))
              link(target, node, "call");
            else {
              link(target, node, "reference");
              limitations.add(
                "Dynamic calls and callback invocations may not resolve to their runtime targets.",
              );
            }
          } else if (
            ts.isJsxOpeningElement(node) ||
            ts.isJsxSelfClosingElement(node)
          ) {
            link(symbolTarget(node.tagName), node, "jsx");
          } else if (ts.isImportDeclaration(node)) {
            const target = symbolTarget(node.moduleSpecifier);
            link(target, node, "import");
            if (!target)
              limitations.add(
                "Some imports could not be resolved in the captured project configuration.",
              );
          } else if (
            ts.isIdentifier(node) &&
            !(
              node.parent &&
              declarations.has(node.parent) &&
              "name" in node.parent &&
              node.parent.name === node
            )
          ) {
            link(
              symbolTarget(node),
              node,
              ts.isTypeReferenceNode(node.parent) ? "type" : "reference",
            );
          }
          ts.forEachChild(node, trace);
        }
        trace(file);
      }
    }
  }
  for (const diff of snapshot.diffs) {
    if (diff.kind !== "text") continue;
    for (const side of ["old", "new"] as const) {
      const path = side === "old" ? (diff.oldPath ?? diff.path) : diff.path;
      if (sourceExtension.test(path)) continue;
      const text = (side === "old" ? snapshot.before : snapshot.after)[path];
      if (text === undefined) continue;
      const id = `${side}:${path}:file`;
      nodes.set(id, {
        id,
        path,
        side,
        name: path,
        line: 1,
        endLine: text.split("\n").length,
        version: contentVersion(text),
        changed: true,
        excerpt: text.slice(0, 6000),
      });
    }
  }
  const changedNodes = [...nodes.values()]
    .filter((node) => node.changed)
    .sort(
      (a, b) =>
        Number(b.side === "new") - Number(a.side === "new") ||
        a.id.localeCompare(b.id),
    );
  const maxNodes = 200;
  const relevant = new Set(
    changedNodes.slice(0, maxNodes).map((node) => node.id),
  );
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges.values()) {
    for (const [from, to] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      const neighbors = adjacency.get(from!) ?? new Set<string>();
      neighbors.add(to!);
      adjacency.set(from!, neighbors);
    }
  }
  const queue = [...relevant];
  let truncated = changedNodes.length > maxNodes;
  for (let index = 0; index < queue.length; index++) {
    for (const id of [...(adjacency.get(queue[index]!) ?? [])].sort()) {
      if (relevant.has(id)) continue;
      if (relevant.size >= maxNodes) {
        truncated = true;
        continue;
      }
      relevant.add(id);
      queue.push(id);
    }
  }
  if (truncated)
    limitations.add(
      `Dependency traversal reached its ${maxNodes}-node budget; additional relationships may be omitted.`,
    );
  const omittedPaths = [
    ...new Set(
      changedNodes
        .filter((node) => !relevant.has(node.id))
        .map(
          (node) =>
            snapshot.diffs.find(
              (diff) => diff.path === node.path || diff.oldPath === node.path,
            )?.path ?? node.path,
        ),
    ),
  ].sort();
  const resultNodes = [...nodes.values()]
    .filter((node) => relevant.has(node.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const resultEdges = [...edges.values()]
    .filter((edge) => relevant.has(edge.from) && relevant.has(edge.to))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    nodes: resultNodes,
    edges: resultEdges,
    omittedPaths,
    groups: dependencyOrder(
      resultNodes.map((node) => node.id),
      resultEdges,
    ),
    limitations: [...limitations].sort(),
  };
}
