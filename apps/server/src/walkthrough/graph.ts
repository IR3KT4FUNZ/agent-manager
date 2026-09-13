export function dependencyOrder(
  ids: string[],
  edges: { from: string; to: string }[],
): string[][] {
  const adjacent = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const { from, to } of edges) {
    if (adjacent.has(to)) adjacent.get(from)?.add(to);
  }
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const groups: string[][] = [];

  function visit(id: string) {
    indices.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    stacked.add(id);
    for (const target of [...adjacent.get(id)!].sort()) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (stacked.has(target)) {
        low.set(id, Math.min(low.get(id)!, indices.get(target)!));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      stacked.delete(member);
      group.push(member);
    } while (member !== id);
    groups.push(group.sort());
  }
  for (const id of [...ids].sort()) if (!indices.has(id)) visit(id);

  const membership = new Map(
    groups.flatMap((group, index) => group.map((id) => [id, index] as const)),
  );
  const incoming = groups.map(() => new Set<number>());
  for (const { from, to } of edges) {
    const source = membership.get(from);
    const target = membership.get(to);
    if (source !== undefined && target !== undefined && source !== target)
      incoming[target]!.add(source);
  }
  const remaining = new Set(groups.map((_, index) => index));
  const result: string[][] = [];
  while (remaining.size) {
    const available = [...remaining].filter(
      (index) => ![...incoming[index]!].some((id) => remaining.has(id)),
    );
    available.sort((a, b) => groups[a]![0]!.localeCompare(groups[b]![0]!));
    for (const index of available) {
      result.push(groups[index]!);
      remaining.delete(index);
    }
  }
  return result;
}
