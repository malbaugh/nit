import { Page, Search } from "iconoir-react/regular";
import { type ReactNode, useDeferredValue, useMemo, useRef, useState } from "react";
import { actions } from "./actions";
import { stats } from "./lines";
import * as st from "./state";
import { basename, dirname, Kbd } from "./ui";

type Item = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  meta?: ReactNode;
  keys?: string[];
  icon: ReactNode;
  run: () => void;
};

/** Subsequence match; lower is better, null is no match. Contiguous and prefix hits win. */
function score(query: string, text: string) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let at = -1;
  let gaps = 0;
  for (const ch of q) {
    const next = t.indexOf(ch, at + 1);
    if (next === -1) return null;
    gaps += next - at - 1;
    at = next;
  }
  const contiguous = t.indexOf(q);
  return gaps + (contiguous === -1 ? 0 : -100 - (contiguous === 0 ? 50 : 0));
}

export function Palette() {
  const mode = st.useStore((s) => s.palette);
  if (!mode) return null;
  return <PaletteWindow mode={mode} />;
}

function PaletteWindow({ mode }: { mode: "all" | "files" }) {
  const files = st.useStore((s) => s.files);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const fileItems: Item[] = files.map((f, i) => {
      const { add, del } = stats(f);
      return {
        id: `file:${f.name}`,
        group: "Files",
        label: basename(f.name),
        hint: dirname(f.name).replace(/\/$/, ""),
        icon: <Page />,
        meta: (
          <span className="font-mono text-[11px] tabular-nums text-ink-3">
            {add ? <span className="text-green">+{add}</span> : null}{" "}
            {del ? <span className="text-red">−{del}</span> : null}
          </span>
        ),
        run: () => st.openFile(i),
      };
    });
    const actionItems: Item[] = actions
      .filter((a) => !a.hidden && a.id !== "files" && (!a.when || a.when()))
      .map((a) => ({ id: a.id, group: a.group, label: a.label, keys: a.keys, icon: a.icon, run: a.run }));
    const pool = mode === "files" ? fileItems : deferred ? [...actionItems, ...fileItems] : actionItems;
    if (!deferred) return pool;
    return pool
      .map((it) => ({ it, s: score(deferred, it.hint ? `${it.hint}/${it.label}` : it.label) }))
      .filter((x): x is { it: Item; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s)
      .slice(0, 60)
      .map((x) => x.it);
  }, [mode, files, deferred]);

  const close = () => st.set({ palette: null });
  const run = (it: Item | undefined) => {
    if (!it) return;
    close();
    it.run();
  };
  const move = (d: number) => {
    if (!items.length) return;
    const next = (active + d + items.length) % items.length;
    setActive(next);
    document.getElementById(`palette-${next}`)?.scrollIntoView({ block: "nearest" });
  };

  // Group headers only when not searching; search results are one ranked list.
  const grouped = !deferred;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes; Esc does the same from the keyboard
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[oklch(0_0_0/0.28)] px-4 pt-[13vh]"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-label={mode === "files" ? "Go to file" : "Command palette"}
        className="flex max-h-[min(520px,70vh)] w-[620px] max-w-full flex-col overflow-hidden rounded-window bg-surface shadow-overlay"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 px-4 shadow-[0_1px_0_var(--line)]">
          <Search width={16} height={16} className="shrink-0 text-ink-3" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${active}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) move(1);
              else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) move(-1);
              else if (e.key === "Enter") run(items[active]);
              else if (e.key === "Escape") close();
              else return;
              e.preventDefault();
            }}
            placeholder={mode === "files" ? "Search changed files…" : "Search files and actions…"}
            className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-3"
          />
          <Kbd k="Esc" quiet />
        </div>

        <div
          id="palette-list"
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {items.map((it, i) => (
            <div key={it.id}>
              {grouped && (i === 0 || items[i - 1].group !== it.group) ? (
                <div className={`px-2.5 pb-1 text-[11.5px] font-medium text-ink-3 ${i ? "pt-3" : "pt-1.5"}`}>
                  {it.group}
                </div>
              ) : null}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns the keyboard (arrows + Enter) */}
              <div
                id={`palette-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => run(it)}
                className={`flex h-9 cursor-default items-center gap-2.5 rounded-control px-2.5 ${i === active ? "bg-hover-2" : ""}`}
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center ${i === active ? "text-ink" : "text-ink-3"}`}
                >
                  {it.icon}
                </span>
                <span className={`shrink-0 truncate ${i === active ? "text-ink" : "text-ink-2"}`}>{it.label}</span>
                {it.hint ? <span className="min-w-0 truncate text-[12px] text-ink-3">{it.hint}</span> : null}
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {it.meta}
                  {it.keys?.map((k) => (
                    <Kbd key={k} k={k} />
                  ))}
                </span>
              </div>
            </div>
          ))}
          {!items.length ? (
            <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
              <span className="text-ink-2">No results for “{query}”</span>
              <span className="text-[12px] text-ink-3">Try part of a file name or an action.</span>
            </div>
          ) : null}
        </div>

        <div className="flex h-9 shrink-0 items-center gap-4 bg-inset px-4 text-[11.5px] text-ink-3 shadow-[0_-1px_0_var(--line)]">
          <span className="flex items-center gap-1.5">
            <Kbd k="ArrowUp" quiet />
            <Kbd k="ArrowDown" quiet /> Move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd k="Enter" quiet /> Open
          </span>
          <span className="ml-auto">{mode === "files" ? "Changed files" : "Type to search files too"}</span>
        </div>
      </div>
    </div>
  );
}
