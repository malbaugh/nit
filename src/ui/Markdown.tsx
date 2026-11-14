import { createElement, memo, type ReactNode, useRef } from "react";
import { type Components, Streamdown } from "streamdown";
import { CodeBlock } from "./Code";
import { SuggestionDiff } from "./SuggestionDiff";

function SuggestionBlock({ source }: { source: string }) {
  return (
    <div className="overflow-hidden rounded-control shadow-[0_0_0_1px_var(--line)]">
      <div className="bg-inset px-2.5 py-1 font-sans text-[11.5px] font-medium text-ink-3">Suggested change</div>
      <pre className="!rounded-none !shadow-none bg-green-tint">
        <code>{source}</code>
      </pre>
    </div>
  );
}

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown; align?: unknown; id?: unknown; start?: unknown; dir?: unknown };
  children?: HastNode[];
};
const hastText = (n: HastNode): string =>
  n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(hastText).join("");

// Streamdown draws these with its own markup (strong as a <span>, tables in wrappers) and its
// classes; nit wants the plain elements with the Markdown's own attributes: GitHub's
// contains-task-list / task-list-item classes (the .md styles expect them), an ordered list's
// start, footnote ids, a table column's :--: alignment.
const PLAIN = ["strong", "em", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "blockquote"] as const;
const plain = Object.fromEntries(
  PLAIN.map((tag) => [
    tag,
    ({ node, children }: { node?: HastNode; children?: ReactNode }) => {
      const p = node?.properties ?? {};
      const align = typeof p.align === "string" ? (p.align as "left" | "center" | "right") : undefined;
      return createElement(
        tag,
        {
          className: Array.isArray(p.className) ? p.className.join(" ") : undefined,
          id: typeof p.id === "string" ? p.id : undefined,
          start: typeof p.start === "number" ? p.start : undefined,
          dir: typeof p.dir === "string" ? p.dir : undefined,
          style: align ? { textAlign: align } : undefined,
        },
        children,
      );
    },
  ]),
) as Components;

/**
 * GitHub-flavoured Markdown through Streamdown: tables, task lists, strikethrough, autolinks and
 * GitHub's safe HTML (its sanitizer keeps what GitHub's allows; rehype-harden checks links and
 * images). While Claude's answer streams, an unfinished **bold**, `code` or fence renders as if it
 * were closed instead of flashing raw syntax, and finished blocks don't re-render.
 *
 * nit draws the pieces itself: code with Pierre's highlighter (one engine per page), suggestion
 * blocks, links in a new tab, and task boxes that can be ticked.
 */
export const Markdown = memo(function Markdown({
  source,
  onToggleTask,
  streaming = false,
  suggestionBase = null,
}: {
  source: string;
  onToggleTask?: (index: number) => void;
  /** The lines a ```suggestion block replaces: with them it's drawn as a diff, as on GitHub. */
  suggestionBase?: string[] | null;
  /** The text is still arriving (an answer from Claude). */
  streaming?: boolean;
}) {
  const taskIndex = useRef(0);
  taskIndex.current = 0;

  const components: Components = {
    ...plain,
    // Streamdown wraps images in a block with a download button; GitHub draws them inline (bots
    // put 16px icons in headings and summaries), and so does nit.
    img: ({ src, alt, width, height }) => (
      <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} width={width} height={height} />
    ),
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ),
    // Fenced blocks are the <code> inside a <pre>; any other <code> is inline.
    pre: ({ node, children }) => {
      const code = (node as HastNode | undefined)?.children?.find((c) => c.tagName === "code");
      if (!code) return <pre>{children}</pre>;
      const classes = Array.isArray(code.properties?.className) ? code.properties.className.join(" ") : "";
      const lang = /language-([\w+-]+)/.exec(classes)?.[1];
      const source = hastText(code).replace(/\n$/, "");
      if (lang === "suggestion")
        return suggestionBase?.length ? (
          <SuggestionDiff before={suggestionBase} after={source === "" ? [] : source.split("\n")} />
        ) : (
          <SuggestionBlock source={source} />
        );
      // As on GitHub, a fence without a language is plain text; it's usually prose (bot
      // prompts, logs), so it wraps instead of scrolling sideways.
      if (!lang)
        return (
          <pre className="wrap">
            <code>{source}</code>
          </pre>
        );
      return <CodeBlock source={source} lang={lang} />;
    },
    input: ({ checked, type }) => {
      if (type !== "checkbox") return null;
      const i = taskIndex.current++;
      return (
        <input
          type="checkbox"
          checked={!!checked}
          disabled={!onToggleTask}
          onChange={() => onToggleTask?.(i)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Task"
        />
      );
    },
  };

  return (
    <div className="md">
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        isAnimating={streaming}
        components={components}
        // Streamdown styles its own elements with Tailwind classes; a prefix nit's Tailwind
        // doesn't have keeps them from matching, so the .md styles (GitHub's look) apply.
        prefix="sd"
        controls={false}
        linkSafety={{ enabled: false }}
        tableMaxHeight={0}
        codeBlockMaxHeight={0}
      >
        {source}
      </Streamdown>
    </div>
  );
});
