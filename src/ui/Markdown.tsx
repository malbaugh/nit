import { memo, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./Code";

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

// GitHub renders a safe subset of HTML in comments (details, img, sup, kbd…). rehype-raw parses
// it and rehype-sanitize keeps only what GitHub's own sanitizer allows; scripts, styles, event
// handlers and HTML comments are dropped.
const REHYPE = [rehypeRaw, rehypeSanitize];

/**
 * GitHub-flavoured Markdown: tables, task lists, strikethrough, autolinks and GitHub's safe HTML.
 */
export const Markdown = memo(function Markdown({
  source,
  onToggleTask,
}: {
  source: string;
  onToggleTask?: (index: number) => void;
}) {
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={REHYPE} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
});
