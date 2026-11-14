import { getSharedHighlighter, type SupportedLanguages } from "@pierre/diffs";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const THEMES = { dark: "pierre-dark", light: "pierre-light" } as const;
const cache = new Map<string, Promise<string | null>>();

/** Highlights with the same Shiki themes as the diff; unknown languages fall back to plain text. */
function highlight(source: string, lang: string) {
  const key = `${lang}\u0000${source}`;
  let p = cache.get(key);
  if (!p) {
    p = getSharedHighlighter({ themes: [THEMES.dark, THEMES.light], langs: [lang as SupportedLanguages] })
      .then((h) => h.codeToHtml(source, { lang, themes: THEMES, defaultColor: false }))
      .catch((e: unknown) => {
        console.warn(`nit: could not highlight ${lang}`, e);
        return null;
      });
    cache.set(key, p);
  }
  return p;
}

function CodeBlock({ source, lang }: { source: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (lang) highlight(source, lang).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [source, lang]);
  // Shiki escapes the source, so its HTML is safe to insert.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output, source is escaped
  if (html) return <div dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <pre>
      <code>{source}</code>
    </pre>
  );
}

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

const text = (children: ReactNode): string =>
  Array.isArray(children) ? children.map(text).join("") : typeof children === "string" ? children : "";

/**
 * GitHub-flavoured Markdown: tables, task lists, strikethrough and autolinks. Raw HTML is
 * not rendered and unsafe URLs are dropped (react-markdown's defaults).
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
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const lang = /language-([\w+-]+)/.exec(className ?? "")?.[1];
      const source = text(children).replace(/\n$/, "");
      if (!className && !source.includes("\n")) return <code>{children}</code>;
      if (lang === "suggestion") return <SuggestionBlock source={source} />;
      return <CodeBlock source={source} lang={lang ?? ""} />;
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
