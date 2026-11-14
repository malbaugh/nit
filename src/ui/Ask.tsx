import { ArrowUp, Sparks, Xmark } from "iconoir-react/regular";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import * as agent from "./agent";
import * as st from "./state";
import { Button, IconButton, Kbd } from "./ui";

const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

const STARTERS = [
  "What could go wrong here?",
  "Explain this change",
  "Who relies on this?",
  "Does this follow the project's guidelines?",
];

const TOOL_VERB: Record<string, string> = {
  Read: "Reading",
  Grep: "Searching for",
  Glob: "Looking for",
  read_guideline: "Reading the guideline",
  file_diff: "Reading the diff of",
};

/**
 * Ask Claude about the selected lines, right under them: the answer streams in, grounded in
 * the code it reads and the project's guidelines. Follow-ups continue the conversation, and
 * "Comment with this" turns the answer into your draft.
 */
export function AskAnnotation() {
  const at = st.useStore((s) => s.asking);
  const job = st.useStore((s) => s.job);
  const activity = st.useStore((s) => s.agentActivity);
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  const here =
    job?.kind === "ask" &&
    at &&
    job.at?.path === at.path &&
    job.at.side === at.side &&
    job.at.start === at.start &&
    job.at.end === at.end
      ? job
      : null;
  const running = here?.state === "running";
  const lastTool = [...activity].reverse().find((a) => a.kind === "tool");

  // Pierre mounts annotations a frame or two late; keep trying until focus lands.
  useEffect(() => {
    let tries = 0;
    let frame = 0;
    const focus = () => {
      input.current?.focus({ preventScroll: true });
      if (document.activeElement !== input.current && tries++ < 20) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!at) return null;
  const where = at.start === at.end ? `line ${at.start}` : `lines ${at.start}–${at.end}`;
  const send = (q: string) => {
    if (!q.trim() || running) return;
    void agent.ask(q);
    setText("");
  };
  const close = () => {
    if (running) agent.stop();
    st.set({ asking: null });
  };

  return (
    <div className="px-3 py-1.5 font-sans">
      <section
        aria-label={`Ask Claude about ${where}`}
        className="max-w-[780px] overflow-hidden rounded-card bg-surface shadow-[0_0_0_1px_color-mix(in_oklch,var(--accent)_45%,transparent),0_2px_8px_oklch(0_0_0/0.08)]"
      >
        <header className="flex h-9 items-center gap-2 px-3 text-[12px]">
          <Sparks width={13} height={13} className="text-accent-ink" />
          <span className="font-medium text-ink">Ask Claude</span>
          <span className="text-ink-3">{where}</span>
          {running ? (
            <span className="ml-1 flex min-w-0 items-center gap-1.5 text-ink-3">
              <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line-strong border-t-accent" />
              <span className="truncate">
                {lastTool?.kind === "tool"
                  ? `${TOOL_VERB[lastTool.tool] ?? lastTool.tool} ${lastTool.target}`.trim()
                  : "Thinking"}
                …
              </span>
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <Kbd k="Esc" quiet />
            <IconButton label="Close" keys="Esc" onClick={close}>
              <Xmark />
            </IconButton>
          </span>
        </header>

        {here ? (
          <div className="px-3.5 pb-3">
            <p className="mb-1.5 text-[12.5px] text-ink-3">{here.question}</p>
            {here.answer ? (
              <div className="text-[13px]">
                <Suspense fallback={<p className="whitespace-pre-wrap">{here.answer}</p>}>
                  <Markdown source={here.answer} />
                </Suspense>
              </div>
            ) : null}
            {here.state === "failed" ? (
              <p className="mt-1 text-[12.5px] text-red">{here.error ?? "Claude couldn't answer."}</p>
            ) : null}
            {here.state === "done" && here.answer ? (
              <div className="mt-2.5 flex items-center gap-1.5">
                <Button tone="secondary" className="h-6 px-2" onClick={agent.commentFromAnswer}>
                  Comment with this
                </Button>
                {here.guidelines.inline.length ? (
                  <span className="ml-auto truncate text-[11.5px] text-ink-3" title={here.guidelines.inline.join("\n")}>
                    Used {here.guidelines.inline.length} project{" "}
                    {here.guidelines.inline.length === 1 ? "guideline" : "guidelines"}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {STARTERS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="h-6 rounded-chip bg-hover px-2 text-[12px] text-ink-2 transition-[background-color,color] duration-100 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 bg-inset px-3 py-2 shadow-[0_-1px_0_var(--line)]">
          <textarea
            ref={input}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(text);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
            placeholder={here ? "Ask a follow-up…" : `Ask about ${where}…`}
            aria-label="Question for Claude"
            className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-[13px] leading-6 text-ink outline-none placeholder:text-ink-3 [field-sizing:content]"
          />
          {running ? (
            <Button tone="ghost" className="h-6 px-2" onClick={agent.stop}>
              Stop
            </Button>
          ) : (
            <IconButton label="Ask" keys="Enter" onClick={() => send(text)} disabled={!text.trim()}>
              <ArrowUp />
            </IconButton>
          )}
        </div>
      </section>
    </div>
  );
}
