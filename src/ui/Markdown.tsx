import { memo, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock, langFor } from "./Code";

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
  properties?: { className?: unknown };
  children?: HastNode[];
};
const hastText = (n: HastNode): string =>
  n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(hastText).join("");

/**
 * GitHub-flavoured Markdown: tables, task lists, strikethrough and autolinks. Raw HTML is
 * not rendered and unsafe URLs are dropped (react-markdown's defaults).
 */
export const Markdown = memo(function Markdown({
  source,
  onToggleTask,
  path,
}: {
  source: string;
  onToggleTask?: (index: number) => void;
  /** The commented file: a code block without a language is highlighted as this file's language. */
  path?: string;
}) {
  const fallbackLang = path ? langFor(path) : "";
  const taskIndex = useRef(0);
  taskIndex.current = 0;

  const components: Components = {
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
      if (lang === "suggestion") return <SuggestionBlock source={source} />;
      return <CodeBlock source={source} lang={lang ?? fallbackLang} />;
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
});
