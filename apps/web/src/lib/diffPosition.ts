export function diffPositionAtPoint(target: EventTarget | null, x: number, y: number) {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('[data-side="new"][data-line]');
  if (!cell) return null;
  const text = cell.querySelector<HTMLElement>("[data-code-text]");
  if (!text) return null;
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = documentWithCaret.caretPositionFromPoint?.(x, y);
  const range = !caret ? documentWithCaret.caretRangeFromPoint?.(x, y) : null;
  const node = caret?.offsetNode ?? range?.startContainer;
  const offset = caret?.offset ?? range?.startOffset;
  if (!node || offset === undefined || !text.contains(node)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(text);
  prefix.setEnd(node, offset);
  return {
    path: cell.dataset.path!,
    line: Number(cell.dataset.line),
    column: prefix.toString().length + 1,
  };
}
