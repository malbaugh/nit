import type { FileDiffEditCompleteEvent, FileDiffMetadata } from "@pierre/diffs";
import { Editor, type EditorFactory } from "@pierre/diffs/edit";
import * as st from "./state";

/**
 * Suggestions are typed into the diff itself with Pierre's editor: the commented lines on the
 * new side become editable in place, highlighted, with undo. Ending the session always
 * rejects the edit, so the review's diff never changes; the edited lines become the draft's
 * suggestion and the comment reopens.
 */

let decision: "save" | "cancel" = "cancel";

const lineText = (file: FileDiffMetadata, n: number) => (file.additionLines[n - 1] ?? "").replace(/\r?\n$/, "");

/** ⌘⇧S on a draft (or "Suggest a change"): edit its lines in the diff. */
export async function start(draftId: string) {
  const s = st.get();
  const d = s.drafts.find((x) => x.id === draftId);
  if (!d || d.side !== "additions" || d.start === 0 || d.replyTo) return;
  const index = s.files.findIndex((f) => f.name === d.path);
  if (index === -1) return;
  st.openFile(index);
  await st.hydrate(index); // the editor needs the whole new file
  if (st.get().files[index]?.isPartial) return st.fail("Couldn't load the file to edit it.");
  decision = "cancel";
  st.set({
    editing: null,
    focused: null,
    suggesting: { draftId, path: d.path, start: d.start, end: d.end, ending: false },
  });
}

/** ⌘↵ keeps the edit as the suggestion; Esc drops it. Ending the edit runs `complete`. */
export function finish(save: boolean) {
  decision = save ? "save" : "cancel";
  st.set((s) => (s.suggesting ? { suggesting: { ...s.suggesting, ending: true } } : {}));
}

/** The editor is ready: put the draft's earlier suggestion back, select the lines, focus. */
function attach(editor: Editor<"file-diff", unknown, undefined>) {
  const sg = st.get().suggesting;
  const file = st.currentFile();
  const d = st.get().drafts.find((x) => x.id === sg?.draftId);
  if (!sg || !file || !d) return;
  let last = sg.end;
  if (d.suggestion !== null) {
    editor.applyEdits(
      [
        {
          range: {
            start: { line: sg.start - 1, character: 0 },
            end: { line: sg.end - 1, character: lineText(file, sg.end).length },
          },
          newText: d.suggestion,
        },
      ],
      false,
    );
    last = sg.start + d.suggestion.split("\n").length - 1;
  }
  editor.focus({ lineNumber: sg.start, preventScroll: true });
  const lastText = d.suggestion !== null ? (d.suggestion.split("\n").at(-1) ?? "") : lineText(file, sg.end);
  editor.setSelections([
    {
      start: { line: sg.start - 1, character: 0 },
      end: { line: last - 1, character: lastText.length },
      direction: "forward",
    },
  ]);
}

/**
 * The edit session ended. The suggestion is the edited text between the unchanged lines
 * before and after the commented range, compared exactly; an edit outside it is refused
 * rather than guessed at.
 */
export async function complete(event: FileDiffEditCompleteEvent<unknown, undefined>) {
  const sg = st.get().suggesting;
  st.set({ suggesting: null });
  if (!sg) return;
  const reopen = () => st.set({ editing: sg.draftId, focused: sg.draftId });
  if (decision === "cancel") return reopen();
  const file = st.get().files.find((f) => f.name === sg.path);
  const before = file ? (await st.fileContents(file)).new : null;
  const after = event.newFile?.contents ?? null;
  if (before === null || after === null) return reopen();
  const was = before.split("\n");
  const now = after.split("\n");
  const head = sg.start - 1;
  const tail = was.length - sg.end;
  const sameOutside =
    now.length >= head + tail &&
    was.slice(0, head).every((l, i) => l === now[i]) &&
    was.slice(was.length - tail).every((l, i) => l === now[now.length - tail + i]);
  if (!sameOutside) {
    const range = sg.start === sg.end ? `line ${sg.start}` : `lines ${sg.start}–${sg.end}`;
    st.toast(`Edits outside ${range} can't be a suggestion. Kept the last one.`);
    return reopen();
  }
  const suggestion = now.slice(head, now.length - tail).join("\n");
  const original = was.slice(head, was.length - tail);
  st.set((s) => ({
    drafts: s.drafts.map((x) => (x.id === sg.draftId ? { ...x, anchor: original } : x)),
  }));
  st.updateDraft(sg.draftId, { suggestion: suggestion === original.join("\n") ? null : suggestion });
  reopen();
}

/** Pierre's EditProvider factory: every editor attaches through `attach`. */
// biome-ignore lint/suspicious/noExplicitAny: one factory serves any annotation type
export const createEditor: EditorFactory<any, undefined> = (type, options, key) =>
  new Editor(
    type,
    {
      ...options,
      onAttach: (editor, component) => {
        options?.onAttach?.(editor, component);
        if (editor.type === "file-diff") attach(editor as Editor<"file-diff", unknown, undefined>);
      },
    },
    key,
  );
