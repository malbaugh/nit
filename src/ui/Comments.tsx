import { Tabs } from "@base-ui/react/tabs";
import {
  Bold,
  Check,
  CheckCircle,
  Code,
  EditPencil,
  Italic,
  Link,
  List,
  NumberedListLeft,
  Quote,
  TaskList,
  TextSize,
  Trash,
  WarningCircle,
} from "iconoir-react/regular";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Draft } from "../types";
import * as md from "./markdown-edit";
import * as st from "./state";
import { Button, IconButton, Kbd } from "./ui";

// The Markdown parser is the heaviest piece of the UI; load it after the diff has painted.
const LazyMarkdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));
export function Markdown(props: { source: string; path?: string; onToggleTask?: (index: number) => void }) {
  return (
    <Suspense fallback={<p className="md whitespace-pre-wrap">{props.source}</p>}>
      <LazyMarkdown {...props} />
    </Suspense>
  );
}

const LABEL = /^\s*(nit|question|blocking|suggestion|praise|issue|thought)\s*:\s*/i;

/** "nit: rename this" → label "nit", rest "rename this". */
export function splitLabel(body: string) {
  const m = body.match(LABEL);
  return m ? { label: m[1].toLowerCase(), rest: body.slice(m[0].length) } : { label: null, rest: body };
}

const labelTone: Record<string, string> = {
  blocking: "bg-red-tint text-red",
  issue: "bg-red-tint text-red",
  question: "bg-accent-tint text-accent-ink",
  suggestion: "bg-green-tint text-green",
  praise: "bg-green-tint text-green",
  nit: "bg-hover-2 text-ink-2",
  thought: "bg-hover-2 text-ink-2",
};

const where = (d: Draft) =>
  d.replyTo ? "Reply" : d.start === 0 ? "File" : d.start === d.end ? `Line ${d.end}` : `Lines ${d.start}–${d.end}`;

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
export function ago(ms: number) {
  const s = Math.round((ms - Date.now()) / 1000);
  if (s > -45) return "just now";
  if (s > -3600) return rtf.format(Math.round(s / 60), "minute");
  if (s > -86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

export function DraftAnnotation({ id }: { id: string }) {
  return (
    <div className="px-3 py-1.5 font-sans">
      <DraftView id={id} />
    </div>
  );
}

/** A draft as its composer (while editing) or its card. Also used inside thread cards for replies. */
export function DraftView({ id }: { id: string }) {
  const draft = st.useStore((s) => s.drafts.find((d) => d.id === id));
  const editing = st.useStore((s) => s.editing === id);
  const focused = st.useStore((s) => s.focused === id);
  if (!draft) return null;
  return editing ? <Composer draft={draft} /> : <Card draft={draft} focused={focused} />;
}

function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measures whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

type Tool = { label: string; keys?: string; icon: React.ReactNode; run: (s: md.Sel) => md.Edit };
const TOOLS: Tool[][] = [
  [
    { label: "Heading", icon: <TextSize />, run: (s) => md.prefixLines(s, "### ") },
    { label: "Bold", keys: "Mod+b", icon: <Bold />, run: (s) => md.wrap(s, "**") },
    { label: "Italic", keys: "Mod+i", icon: <Italic />, run: (s) => md.wrap(s, "_") },
  ],
  [
    { label: "Quote", keys: "Mod+Shift+.", icon: <Quote />, run: (s) => md.prefixLines(s, "> ") },
    { label: "Code", keys: "Mod+e", icon: <Code />, run: md.code },
    { label: "Link", keys: "Mod+k", icon: <Link />, run: (s) => md.link(s) },
  ],
  [
    { label: "Bulleted list", keys: "Mod+Shift+8", icon: <List />, run: (s) => md.prefixLines(s, "- ") },
    {
      label: "Numbered list",
      keys: "Mod+Shift+7",
      icon: <NumberedListLeft />,
      run: (s) => md.prefixLines(s, (i) => `${i + 1}. `),
    },
    { label: "Task list", icon: <TaskList />, run: (s) => md.prefixLines(s, "- [ ] ") },
  ],
];

/** GitHub's comment shortcuts, matched on the physical key so ⇧ doesn't change the character. */
function shortcut(e: React.KeyboardEvent): ((s: md.Sel) => md.Edit) | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (!e.shiftKey) {
    if (k === "b") return (s) => md.wrap(s, "**");
    if (k === "i") return (s) => md.wrap(s, "_");
    if (k === "e") return md.code;
    if (k === "k") return (s) => md.link(s);
    return null;
  }
  if (e.code === "Period") return (s) => md.prefixLines(s, "> ");
  if (e.code === "Digit8") return (s) => md.prefixLines(s, "- ");
  if (e.code === "Digit7") return (s) => md.prefixLines(s, (i) => `${i + 1}. `);
  return null;
}

function Composer({ draft }: { draft: Draft }) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const suggestionRef = useRef<HTMLTextAreaElement>(null);
  const saving = st.useStore((s) => s.saving[draft.id]);
  const [preview, setPreview] = useState(false);
  useAutoGrow(bodyRef, draft.body);
  useAutoGrow(suggestionRef, draft.suggestion ?? "");
  const canSuggest = draft.side === "additions" && draft.start > 0;

  // Pierre mounts annotations a frame or two after React renders them; keep trying until focus lands.
  useEffect(() => {
    let tries = 0;
    let frame = 0;
    const focus = () => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (document.activeElement !== el && tries++ < 20) frame = requestAnimationFrame(focus);
      else el.setSelectionRange(el.value.length, el.value.length);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, []);

  const edit = (run: (s: md.Sel) => md.Edit) => {
    const el = bodyRef.current;
    if (!el) return;
    if (preview) setPreview(false);
    requestAnimationFrame(() => md.apply(el, run({ value: el.value, start: el.selectionStart, end: el.selectionEnd })));
  };

  const toggleSuggestion = () => {
    if (!canSuggest) return;
    if (draft.suggestion === null)
      void st.suggest(draft.id).then(() => requestAnimationFrame(() => suggestionRef.current?.focus()));
    else st.updateDraft(draft.id, { suggestion: null });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape" || (mod && e.key === "Enter")) {
      e.preventDefault();
      e.stopPropagation();
      st.finishEditing();
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setPreview((p) => !p);
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      toggleSuggestion();
      return;
    }
    if (e.target !== bodyRef.current) return;
    const run = shortcut(e);
    if (run) {
      e.preventDefault();
      edit(run);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !mod && !e.nativeEvent.isComposing) {
      const el = bodyRef.current;
      if (!el) return;
      const next = md.continueList({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
      if (next) {
        e.preventDefault();
        md.apply(el, next);
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const next = md.pasteLink(
      { value: el.value, start: el.selectionStart, end: el.selectionEnd },
      e.clipboardData.getData("text/plain"),
    );
    if (next) {
      e.preventDefault();
      md.apply(el, next);
    }
  };

  const hasContent = draft.body.trim() !== "" || draft.suggestion !== null;

  return (
    <fieldset
      aria-label="Comment draft"
      data-md-editor
      onKeyDown={onKeyDown}
      className="min-w-0 max-w-[780px] overflow-hidden rounded-card bg-surface shadow-raised transition-shadow duration-150 focus-within:shadow-[0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-tint),0_2px_10px_oklch(0_0_0/0.2)]"
    >
      <div className="flex h-9 items-center gap-2 px-1.5 shadow-[0_1px_0_var(--line)]">
        <Tabs.Root value={preview ? "preview" : "write"} onValueChange={(v) => setPreview(v === "preview")}>
          <Tabs.List aria-label="Editor mode" className="flex items-center gap-0.5">
            {(["write", "preview"] as const).map((t) => (
              <Tabs.Tab
                key={t}
                value={t}
                className="h-6 rounded-[6px] px-2 text-[12.5px] font-medium text-ink-3 capitalize transition-[background-color,color] duration-100 data-active:bg-hover-2 data-active:text-ink [@media(hover:hover)]:hover:text-ink"
              >
                {t}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.Root>
        <span className="text-[11.5px] text-ink-3">{where(draft)}</span>
        <div className={`ml-auto flex items-center ${preview ? "invisible" : ""}`}>
          {TOOLS.map((group, gi) => (
            <div
              key={group[0].label}
              className={`flex items-center ${gi ? "ml-1 pl-1 shadow-[inset_1px_0_0_var(--line)]" : ""}`}
            >
              {group.map((t) => (
                <IconButton
                  key={t.label}
                  label={t.label}
                  keys={t.keys}
                  side="top"
                  onClick={() => edit(t.run)}
                  tabIndex={-1}
                >
                  {t.icon}
                </IconButton>
              ))}
            </div>
          ))}
        </div>
      </div>

      {preview ? (
        <div className="min-h-[76px] px-3.5 py-3">
          {draft.body.trim() ? (
            <Markdown source={draft.body} path={draft.path} />
          ) : (
            <p className="text-ink-3">Nothing to preview.</p>
          )}
          {draft.suggestion !== null ? (
            <SuggestionDiff before={draft.anchor} after={draft.suggestion.split("\n")} />
          ) : null}
        </div>
      ) : (
        <>
          <textarea
            ref={bodyRef}
            value={draft.body}
            onChange={(e) => st.updateDraft(draft.id, { body: e.target.value })}
            onPaste={onPaste}
            placeholder="Leave a comment. Markdown works. Start with nit:, question: or blocking: to label it."
            aria-label="Comment"
            rows={3}
            className="block max-h-[50vh] min-h-[76px] w-full resize-none bg-transparent px-3.5 py-3 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
          />
          {draft.suggestion !== null ? (
            <div className="mx-3 mb-3 overflow-hidden rounded-control shadow-[0_0_0_1px_var(--line)]">
              <div className="flex h-7 items-center bg-inset px-2.5 text-[11.5px] font-medium text-ink-3 shadow-[0_1px_0_var(--line)]">
                Suggested change
                <button
                  type="button"
                  onClick={toggleSuggestion}
                  className="ml-auto text-ink-3 transition-colors duration-100 [@media(hover:hover)]:hover:text-red"
                >
                  Remove
                </button>
              </div>
              <textarea
                ref={suggestionRef}
                value={draft.suggestion}
                onChange={(e) => st.updateDraft(draft.id, { suggestion: e.target.value })}
                aria-label="Suggested change"
                spellCheck={false}
                className="block w-full resize-none bg-green-tint px-2.5 py-2 font-mono text-[12.5px] leading-5 text-ink outline-none"
              />
            </div>
          ) : null}
        </>
      )}

      <div className="flex h-10 items-center gap-3 bg-inset px-3 text-[11.5px] text-ink-3 shadow-[0_-1px_0_var(--line)]">
        {canSuggest ? (
          <button
            type="button"
            onClick={toggleSuggestion}
            className="flex items-center gap-1.5 transition-colors duration-100 [@media(hover:hover)]:hover:text-ink"
          >
            <Kbd k="Mod+Shift+s" quiet />
            {draft.suggestion === null ? "Suggest a change" : "Remove suggestion"}
          </button>
        ) : null}
        <span className="flex items-center gap-1.5">
          <Kbd k="Mod+Shift+p" quiet /> {preview ? "Write" : "Preview"}
        </span>
        <SaveState state={saving} hasContent={hasContent} />
        <Button tone="primary" onClick={st.finishEditing} className="h-6 px-2">
          Done <span className="opacity-70">{"⌘↵"}</span>
        </Button>
      </div>
    </fieldset>
  );
}

function SaveState({ state, hasContent }: { state?: "saving" | "error"; hasContent: boolean }) {
  if (state === "error")
    return (
      <output className="ml-auto flex items-center gap-1 text-red">
        <WarningCircle width={13} height={13} /> Not saved, retrying
      </output>
    );
  if (!hasContent) return <span className="ml-auto" />;
  return (
    <output className="ml-auto flex items-center gap-1">
      {state === "saving" ? (
        "Saving…"
      ) : (
        <>
          <Check width={13} height={13} /> Saved
        </>
      )}
    </output>
  );
}

function Card({ draft, focused }: { draft: Draft; focused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { label, rest } = splitLabel(draft.body);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click focuses the card; ]/[ and its buttons cover the keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
    <div
      ref={ref}
      onClick={() => st.set({ focused: draft.id })}
      onDoubleClick={() => st.editDraft(draft.id)}
      className={`group max-w-[780px] rounded-card bg-surface px-3.5 pt-2.5 pb-3 transition-shadow duration-150 ${
        focused ? "shadow-[0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-tint)]" : "shadow-card"
      }`}
    >
      <div className="flex h-6 items-center gap-2 text-[12px]">
        <span className="size-1.5 rounded-full bg-orange" aria-hidden />
        <span className="font-medium text-ink">Draft</span>
        {label ? (
          <span className={`rounded-chip px-1.5 py-px text-[11.5px] font-medium ${labelTone[label]}`}>{label}</span>
        ) : null}
        <span className="text-ink-3">{where(draft)}</span>
        <span className="text-ink-3">·</span>
        <span className="text-ink-3">{ago(draft.updatedAt)}</span>
        <span
          className={`ml-auto flex items-center gap-0.5 transition-opacity duration-100 ${
            focused ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        >
          {draft.suggestion !== null ? (
            <IconButton label="Apply suggestion" keys="a" onClick={() => void st.applySuggestion(draft.id)}>
              <CheckCircle />
            </IconButton>
          ) : null}
          <IconButton label="Edit" keys="e" onClick={() => st.editDraft(draft.id)}>
            <EditPencil />
          </IconButton>
          <IconButton label="Delete" keys="Backspace" tone="danger" onClick={() => st.removeDraft(draft.id)}>
            <Trash />
          </IconButton>
        </span>
      </div>
      {rest.trim() ? (
        <div className="mt-1">
          <Markdown
            path={draft.path}
            source={rest}
            onToggleTask={(i) => st.updateDraft(draft.id, { body: md.toggleTask(draft.body, i) })}
          />
        </div>
      ) : null}
      {draft.suggestion !== null ? <SuggestionDiff before={draft.anchor} after={draft.suggestion.split("\n")} /> : null}
    </div>
  );
}

function SuggestionDiff({ before, after }: { before: string[]; after: string[] }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-control shadow-[0_0_0_1px_var(--line)]">
      <div className="bg-inset px-2.5 py-1 text-[11.5px] font-medium text-ink-3 shadow-[0_1px_0_var(--line)]">
        Suggested change
      </div>
      <div className="overflow-x-auto font-mono text-[12.5px] leading-5">
        {before.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of lines; position is the identity
          <div key={`b${i}`} className="flex bg-red-tint pr-3 whitespace-pre text-ink-2">
            <span className="w-7 shrink-0 select-none text-center text-red">−</span>
            {l || " "}
          </div>
        ))}
        {after.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of lines; position is the identity
          <div key={`a${i}`} className="flex bg-green-tint pr-3 whitespace-pre text-ink">
            <span className="w-7 shrink-0 select-none text-center text-green">+</span>
            {l || " "}
          </div>
        ))}
      </div>
    </div>
  );
}
