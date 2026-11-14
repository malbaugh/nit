import { getFiletypeFromFileName, getSharedHighlighter, type SupportedLanguages } from "@pierre/diffs";
import { useEffect, useState } from "react";

const THEMES = { dark: "pierre-dark", light: "pierre-light" } as const;
const cache = new Map<string, Promise<string | null>>();

export const langFor = (path: string) => getFiletypeFromFileName(path) ?? "";

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

/** A highlighted code block. With `startLine`, lines are numbered from it. */
export function CodeBlock({ source, lang, startLine }: { source: string; lang: string; startLine?: number }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setHtml(null);
    if (lang) highlight(source, lang).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [source, lang]);
  const numbered = startLine !== undefined;
  const style = numbered ? ({ counterReset: `line ${startLine - 1}` } as React.CSSProperties) : undefined;
  // Shiki escapes the source, so its HTML is safe to insert.
  if (html)
    return (
      <div
        className={numbered ? "code-numbered" : undefined}
        style={style}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output; the source is escaped
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  return (
    <div className={numbered ? "code-numbered" : undefined} style={style}>
      <pre>
        <code>
          {source.split("\n").map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed block
            <span key={i} className="line">
              {l}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
