/** How much two lines share at the start and at the end, so only the changed middle is marked. */
function sharedEnds(a: string, b: string) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { start, end };
}

/** One line of the diff; `mark` is the changed middle, drawn stronger, as GitHub does. */
function Row({ text, kind, mark }: { text: string; kind: "old" | "new"; mark?: { start: number; end: number } }) {
  const old = kind === "old";
  const changed = mark && mark.start < text.length - mark.end;
  return (
    <div className={`flex pr-3 whitespace-pre ${old ? "bg-red-tint text-ink-2" : "bg-green-tint text-ink"}`}>
      <span className={`w-7 shrink-0 select-none text-center ${old ? "text-red" : "text-green"}`}>
        {old ? "−" : "+"}
      </span>
      {changed ? (
        <span>
          {text.slice(0, mark.start)}
          <span
            className={`rounded-[2px] ${old ? "bg-[color-mix(in_oklch,var(--red)_28%,transparent)]" : "bg-[color-mix(in_oklch,var(--green)_28%,transparent)]"}`}
          >
            {text.slice(mark.start, text.length - mark.end)}
          </span>
          {text.slice(text.length - mark.end)}
        </span>
      ) : (
        text || " "
      )}
    </div>
  );
}

/**
 * A suggested change as GitHub draws it: the lines it replaces in red, the new ones in green.
 * When old and new have the same number of lines, each pair marks just what changed.
 */
export function SuggestionDiff({ before, after }: { before: string[]; after: string[] }) {
  const paired = before.length === after.length;
  const marks = paired ? before.map((b, i) => sharedEnds(b, after[i])) : [];
  return (
    <div className="mt-2.5 overflow-hidden rounded-control shadow-[0_0_0_1px_var(--line)]">
      <div className="bg-inset px-2.5 py-1 font-sans text-[11.5px] font-medium text-ink-3 shadow-[0_1px_0_var(--line)]">
        Suggested change
      </div>
      <div className="overflow-x-auto font-mono text-[12.5px] leading-5">
        {before.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of lines; position is the identity
          <Row key={`b${i}`} text={l} kind="old" mark={marks[i]} />
        ))}
        {after.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of lines; position is the identity
          <Row key={`a${i}`} text={l} kind="new" mark={marks[i]} />
        ))}
      </div>
    </div>
  );
}
