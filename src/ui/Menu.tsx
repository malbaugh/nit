import { ContextMenu } from "@base-ui/react/context-menu";
import { type ReactNode, useState } from "react";
import * as st from "./state";
import { Kbd } from "./ui";

/** One menu row; `null` is a separator. */
export type MenuItem = {
  label: ReactNode;
  icon?: ReactNode;
  keys?: string;
  run: () => void;
  danger?: boolean;
} | null;

/** The older way to copy, for embedded browsers that refuse clipboard-write permission. */
function copyByCommand(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

/** Copies text and says so. */
export function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => st.toast(`Copied ${what}`),
    () => st.toast(copyByCommand(text) ? `Copied ${what}` : "Couldn't copy to the clipboard."),
  );
}

/** Selected text, including inside a shadow root (the diff draws in one). */
export function selectedText(target: Element) {
  const root = target.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  const sel = root.getSelection?.() ?? document.getSelection();
  return sel?.toString() ?? "";
}

/**
 * A right-click menu over an area. `resolve` gets the element actually clicked (the diff and
 * the tree draw in shadow roots, so it's the event's real target, not the host) and returns the
 * rows, or null to leave the browser's own menu (text boxes, the suggestion editor, cards).
 */
export function RightClick({
  resolve,
  children,
  className,
}: {
  resolve: (target: Element) => MenuItem[] | null;
  children: ReactNode;
  className?: string;
}) {
  const [items, setItems] = useState<MenuItem[]>([]);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        className={className}
        onContextMenu={(e) => {
          const target = e.nativeEvent.composedPath()[0];
          const next = target instanceof Element ? resolve(target) : null;
          if (!next?.length) return e.preventBaseUIHandler();
          setItems(next);
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50 outline-none">
          <ContextMenu.Popup className="min-w-[220px] origin-(--transform-origin) rounded-card bg-surface p-1 shadow-overlay outline-none transition-[opacity,scale] duration-100 ease-out-strong data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            {items.map((it, i) =>
              it === null ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity of their own
                <ContextMenu.Separator key={`sep${i}`} className="mx-1 my-1 h-px bg-line" />
              ) : (
                <ContextMenu.Item
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows of one fixed menu
                  key={i}
                  onClick={it.run}
                  className={`flex h-7 cursor-default items-center gap-2.5 rounded-[6px] px-2 text-[12.5px] outline-none select-none data-highlighted:bg-hover-2 ${
                    it.danger ? "text-red" : "text-ink-2 data-highlighted:text-ink"
                  }`}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-[14px]">
                    {it.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.keys ? <Kbd k={it.keys} quiet /> : null}
                </ContextMenu.Item>
              ),
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
