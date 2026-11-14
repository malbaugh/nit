import { CodeBracketsSquare, Search, Xmark } from "iconoir-react/regular";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Location } from "../types";
import { CodeBlock, langFor } from "./Code";
import * as nav from "./nav";
import * as st from "./state";
import { basename, dirname, IconButton, Kbd } from "./ui";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The line's text with each whole-word use of `name` marked. */
function Marked({ text, name }: { text: string; name: string | null }) {
  if (!name) return <>{text}</>;
  const parts = text.split(new RegExp(`(?<![\\w$])(${escapeRe(name)})(?![\\w$])`));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: fragments of one line
          <span key={i} className="rounded-[3px] bg-accent-tint text-ink">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

function LocationRow({
  loc,
  name,
  active,
  onPick,
  onHover,
  showText,
}: {
  loc: Location;
  name: string | null;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  showText: boolean;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the peek container owns the keyboard (arrows + Enter)
    <div
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onPick}
      className={`flex h-8 cursor-default items-center gap-2.5 rounded-control px-2.5 ${active ? "bg-hover-2" : ""}`}
    >
      <span className="flex min-w-0 shrink-0 items-baseline gap-1.5" style={{ maxWidth: showText ? "45%" : "100%" }}>
        <span className={`shrink-0 ${active ? "text-ink" : "text-ink-2"}`}>{basename(loc.path)}</span>
        <span className="min-w-0 truncate text-[12px] text-ink-3">{dirname(loc.path).replace(/\/$/, "")}</span>
        <span className="shrink-0 font-mono text-[11.5px] text-ink-3">:{loc.line}</span>
      </span>
      {showText ? (
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">
          <Marked text={loc.text} name={name} />
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {loc.kind ? (
        <span className="shrink-0 rounded-chip bg-hover px-1.5 py-px text-[11px] text-ink-3">{loc.kind}</span>
      ) : null}
      {loc.inDiff ? (
        <span className="shrink-0 text-[11px] text-orange" title="This file is part of the review">
          in review
        </span>
      ) : null}
    </div>
  );
}

export function PeekAnnotation() {
  const peek = st.useStore((s) => s.peek);
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [showText, setShowText] = useState(false);

  // The flat list the keyboard walks: identifiers to pick, or locations.
  const items = useMemo(() => {
    if (!peek || peek.status !== "ready") return [];
    if (peek.kind === "pick") return peek.identifiers.map((i) => ({ id: `i:${i.name}`, name: i.name }));
    if (peek.kind === "references")
      return [...peek.untouched, ...peek.changed, ...(showText ? peek.text : [])].map((l) => ({
        id: `${l.path}:${l.line}:${l.col}`,
        loc: l,
      }));
    return peek.results.map((l) => ({ id: `${l.path}:${l.line}`, loc: l }));
  }, [peek, showText]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus and reset whenever a new lookup lands
  useEffect(() => {
    setActive(0);
    setShowText(false);
    let frame = 0;
    let tries = 0;
    const focus = () => {
      ref.current?.focus({ preventScroll: true });
      if (document.activeElement !== ref.current && tries++ < 20) frame = requestAnimationFrame(focus);
      else ref.current?.scrollIntoView({ block: "nearest" });
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [peek?.kind, peek?.status, peek?.at.line]);

  if (!peek) return null;

  const pick = (i: number) => {
    const it = items[i];
    if (!it) return;
    if ("name" in it && peek.kind === "pick") return void nav.lookup(peek.mode, { name: it.name });
    if ("loc" in it && it.loc) {
      if (!nav.openLocation(it.loc)) {
        if (peek.kind === "references") st.toast(`${basename(it.loc.path)} isn't part of this review`);
        setActive(i);
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n") || (peek.kind === "pick" && e.key === "ArrowRight"))
      setActive((a) => Math.min(a + 1, items.length - 1));
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p") || (peek.kind === "pick" && e.key === "ArrowLeft"))
      setActive((a) => Math.max(a - 1, 0));
    else if (e.key === "Enter") pick(active);
    else if (e.key === "Escape") nav.closePeek();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const title =
    peek.kind === "pick"
      ? peek.mode === "definition"
        ? "Go to definition of…"
        : "Find references to…"
      : peek.kind === "references"
        ? "References"
        : "Definition";
  const name = peek.kind === "pick" ? null : peek.name;
  const icon = peek.kind === "references" ? <Search /> : <CodeBracketsSquare />;
  const selected = items[active] && "loc" in items[active] ? items[active].loc : undefined;

  return (
    <div className="px-3 py-1.5 font-sans">
      <section
        ref={ref}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the panel takes focus so arrows and Enter drive it
        tabIndex={0}
        aria-label={title}
        data-peek
        onKeyDown={onKeyDown}
        className="max-w-[880px] overflow-hidden rounded-card bg-surface shadow-raised outline-none focus-visible:shadow-[0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-tint)]"
      >
        <header className="flex h-9 items-center gap-2 pr-1.5 pl-3 shadow-[0_1px_0_var(--line)]">
          <span className="text-ink-3">{icon}</span>
          <span className="text-[12.5px] font-medium text-ink">{title}</span>
          {name ? (
            <code className="rounded-[5px] bg-hover px-1.5 py-px font-mono text-[12px] text-ink">{name}</code>
          ) : null}
          {peek.status === "ready" && peek.kind === "references" ? (
            <span className="text-[12px] text-ink-3 tabular-nums">
              {peek.untouched.length + peek.changed.length}
              {peek.truncated ? "+" : ""}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <Kbd k="Esc" quiet />
            <IconButton label="Close" keys="Esc" onClick={nav.closePeek}>
              <Xmark />
            </IconButton>
          </span>
        </header>

        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {peek.status === "loading" ? <Loading /> : null}
          {peek.status === "error" ? <p className="px-2.5 py-3 text-ink-3">{peek.error}</p> : null}

          {peek.status === "ready" && peek.kind === "pick" ? (
            <div className="flex flex-wrap gap-1.5 px-1.5 py-1.5">
              {peek.identifiers.map((it, i) => (
                <button
                  key={it.name}
                  type="button"
                  onClick={() => void nav.lookup(peek.mode, { name: it.name })}
                  onMouseMove={() => setActive(i)}
                  className={`h-7 rounded-control px-2 font-mono text-[12.5px] transition-[background-color,color] duration-100 ${
                    i === active
                      ? "bg-accent-tint text-ink shadow-[inset_0_0_0_1px_var(--accent)]"
                      : "bg-hover text-ink-2"
                  }`}
                >
                  {it.name}
                </button>
              ))}
            </div>
          ) : null}

          {peek.status === "ready" && peek.kind === "definition" ? (
            peek.results.length ? (
              <>
                {peek.results.length > 1 ? (
                  <div role="listbox" aria-label="Definitions">
                    {peek.results.map((l, i) => (
                      <LocationRow
                        key={`${l.path}:${l.line}`}
                        loc={l}
                        name={name}
                        active={i === active}
                        onPick={() => pick(i)}
                        onHover={() => setActive(i)}
                        showText={false}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-8 items-center gap-1.5 px-2.5 text-[12.5px]">
                    <span className="text-ink-2">{basename(peek.results[0].path)}</span>
                    <span className="text-[12px] text-ink-3">{dirname(peek.results[0].path).replace(/\/$/, "")}</span>
                    <span className="font-mono text-[11.5px] text-ink-3">:{peek.results[0].line}</span>
                  </div>
                )}
                {selected?.snippet ? (
                  <div className="md mt-1 px-1.5 pb-1.5">
                    <CodeBlock
                      source={selected.snippet}
                      lang={langFor(selected.path)}
                      startLine={selected.snippetStart}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="px-2.5 py-3 text-ink-3">
                No definition{name ? ` of ${name}` : ""} in this repo. It may come from a dependency.
              </p>
            )
          ) : null}

          {peek.status === "ready" && peek.kind === "references" ? (
            peek.untouched.length + peek.changed.length + peek.text.length ? (
              <div role="listbox" aria-label="References">
                <Group
                  title="Not touched by this diff"
                  hint="Uses this review didn't change. Check they still work."
                  count={peek.untouched.length}
                />
                {peek.untouched.map((l, i) => (
                  <LocationRow
                    key={`${l.path}:${l.line}:${l.col}`}
                    loc={l}
                    name={name}
                    active={i === active}
                    onPick={() => pick(i)}
                    onHover={() => setActive(i)}
                    showText
                  />
                ))}
                <Group title="Changed in this diff" count={peek.changed.length} />
                {peek.changed.map((l, j) => {
                  const i = peek.untouched.length + j;
                  return (
                    <LocationRow
                      key={`${l.path}:${l.line}:${l.col}`}
                      loc={l}
                      name={name}
                      active={i === active}
                      onPick={() => pick(i)}
                      onHover={() => setActive(i)}
                      showText
                    />
                  );
                })}
                {peek.text.length ? (
                  <button
                    type="button"
                    onClick={() => setShowText((v) => !v)}
                    className="mt-1 flex h-7 w-full items-center gap-2 rounded-control px-2.5 text-left text-[11.5px] text-ink-3 transition-colors duration-100 [@media(hover:hover)]:hover:text-ink"
                  >
                    <span className="font-medium">
                      {showText ? "Hide" : "Show"} {peek.text.length} text{" "}
                      {peek.text.length === 1 ? "match" : "matches"}
                    </span>
                    <span className="truncate">in files nit can't parse, so they may be comments</span>
                  </button>
                ) : null}
                {showText
                  ? peek.text.map((l, j) => {
                      const i = peek.untouched.length + peek.changed.length + j;
                      return (
                        <LocationRow
                          key={`${l.path}:${l.line}:${l.col}`}
                          loc={l}
                          name={name}
                          active={i === active}
                          onPick={() => pick(i)}
                          onHover={() => setActive(i)}
                          showText
                        />
                      );
                    })
                  : null}
              </div>
            ) : (
              <p className="px-2.5 py-3 text-ink-3">No uses of {name} found in code.</p>
            )
          ) : null}
        </div>

        <footer className="flex h-8 items-center gap-4 bg-inset px-3 text-[11.5px] text-ink-3 shadow-[0_-1px_0_var(--line)]">
          <span className="flex items-center gap-1.5">
            <Kbd k="ArrowUp" quiet />
            <Kbd k="ArrowDown" quiet /> Move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd k="Enter" quiet /> Open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd k="Mod+[" quiet /> Back
          </span>
        </footer>
      </section>
    </div>
  );
}

function Group({ title, hint, count }: { title: string; hint?: string; count: number }) {
  if (!count) return null;
  return (
    <div className="flex min-w-0 items-baseline gap-2 overflow-hidden px-2.5 pt-2 pb-1 text-[11.5px] whitespace-nowrap">
      <span className="shrink-0 font-medium text-ink-2">{title}</span>
      <span className="shrink-0 text-ink-3 tabular-nums">{count}</span>
      {hint ? <span className="min-w-0 truncate text-ink-3">{hint}</span> : null}
    </div>
  );
}

/** Appears only if the lookup takes longer than 150ms, so fast results don't flash. */
function Loading() {
  return (
    <div className="space-y-2 px-2.5 py-2.5 opacity-0 [animation:fade-in_150ms_ease-out_150ms_forwards]">
      {[70, 48, 60].map((w) => (
        <div key={w} className="h-3 animate-pulse rounded bg-hover" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
