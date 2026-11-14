import { getFiletypeFromFileName, getSharedHighlighter, type SupportedLanguages } from "@pierre/diffs";
import { useEffect, useState } from "react";
import { useTheme } from "./theme";

type Themes = { dark: string; light: string };
const cache = new Map<string, Promise<string | null>>();

export const langFor = (path: string) => getFiletypeFromFileName(path) ?? "";

/** Highlights with the same themes as the diff; unknown languages fall back to plain text. */
function highlight(source: string, lang: string, themes: Themes) {
  const key = `${themes.dark}\u0000${themes.light}\u0000${lang}\u0000${source}`;
  let p = cache.get(key);
  if (!p) {
    p = getSharedHighlighter({ themes: [themes.dark, themes.light], langs: [lang as SupportedLanguages] })
      .then((h) => h.codeToHtml(source, { lang, themes, defaultColor: false }))
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
  const { darkThemeName: dark, lightThemeName: light } = useTheme();
  useEffect(() => {
    let alive = true;
    if (lang) highlight(source, lang, { dark, light }).then((h) => alive && setHtml(h));
    else setHtml(null);
    return () => {
      alive = false;
    };
  }, [source, lang, dark, light]);
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
