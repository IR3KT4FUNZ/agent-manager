import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/features/contextmenu/register.js";
import "monaco-editor/features/find/register.js";
import "monaco-editor/languages/definitions/typescript/register.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type { NavigationRequest, SourceDocument } from "@agent-manager/shared";
import type { CodeView } from "../lib/codeHistory";
import { supportsNavigation } from "../lib/codeHistory";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export default function SourceEditor({
  sessionId,
  source,
  view,
  onNavigate,
  onSave,
}: {
  sessionId: string;
  source: SourceDocument;
  view: CodeView;
  onNavigate: (request: NavigationRequest) => void;
  onSave: (view: Partial<CodeView>) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef({ source, onNavigate, onSave });
  latest.current = { source, onNavigate, onSave };

  useEffect(() => {
    const uri = monaco.Uri.from({
      scheme: "session",
      authority: sessionId,
      path: "/" + source.path,
    });
    const model = monaco.editor.createModel(source.content, source.language, uri);
    const editor = monaco.editor.create(container.current!, {
      model,
      readOnly: true,
      domReadOnly: true,
      theme: "vs-dark",
      automaticLayout: false,
      minimap: { enabled: false },
      fontSize: 12,
      scrollBeyondLastLine: false,
      ariaLabel: `Source: ${source.path}`,
      fixedOverflowWidgets: true,
    });
    editorRef.current = editor;
    let layoutFrame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        if (container.current) {
          editor.layout({
            width: container.current.clientWidth,
            height: container.current.clientHeight,
          });
        }
      });
    });
    resize.observe(container.current!);
    const validLocation = !view.version || view.version === source.version;
    if (validLocation && view.line) {
      editor.setSelection({
        startLineNumber: view.line,
        startColumn: view.column ?? 1,
        endLineNumber: view.endLine ?? view.line,
        endColumn: view.endColumn ?? (view.walkthrough ? (source.content.split("\n")[(view.endLine ?? view.line) - 1]?.length ?? 0) + 1 : view.column ?? 1),
      });
      editor.revealLineInCenter(view.line);
    }
    if (view.scrollTop !== undefined)
      editor.setScrollPosition({
        scrollTop: view.scrollTop,
        scrollLeft: view.scrollLeft ?? 0,
      });
    const navigate = (action: NavigationRequest["action"], position = editor.getPosition()) => {
      if (position)
        latest.current.onNavigate({
          action,
          path: source.path,
          line: position.lineNumber,
          column: position.column,
          version: latest.current.source.version,
        });
    };
    const disposables: monaco.IDisposable[] = [];
    if (supportsNavigation(source.path) && view.walkthrough?.side !== "old") {
      for (const action of ["definition", "references"] as const) {
        disposables.push(
          editor.addAction({
            id: `session.${action}`,
            label: action === "definition" ? "Go to definition" : "Find references",
            contextMenuGroupId: "navigation",
            contextMenuOrder: action === "definition" ? 1 : 2,
            keybindings: [
              action === "definition"
                ? monaco.KeyCode.F12
                : monaco.KeyMod.Shift | monaco.KeyCode.F12,
            ],
            run: () => navigate(action),
          }),
        );
      }
      disposables.push(
        editor.onMouseDown((event) => {
          if ((event.event.metaKey || event.event.ctrlKey) && event.target.position) {
            event.event.preventDefault();
            navigate("definition", event.target.position);
          }
        }),
      );
    }
    disposables.push(
      editor.onDidScrollChange(() =>
        latest.current.onSave({
          scrollTop: editor.getScrollTop(),
          scrollLeft: editor.getScrollLeft(),
        }),
      ),
    );
    disposables.push(
      editor.onDidChangeCursorSelection(() => {
        const selection = editor.getSelection();
        if (selection)
          latest.current.onSave({
            line: selection.startLineNumber,
            column: selection.startColumn,
            endLine: selection.endLineNumber,
            endColumn: selection.endColumn,
            version: latest.current.source.version,
          });
      }),
    );
    return () => {
      resize.disconnect();
      cancelAnimationFrame(layoutFrame);
      disposables.forEach((item) => item.dispose());
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
  }, [sessionId, source.path]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === source.content) return;
    const state = editor.saveViewState();
    editor.setValue(source.content);
    if (state) editor.restoreViewState(state);
  }, [source.content]);

  return <div ref={container} className="h-full min-h-0" />;
}
