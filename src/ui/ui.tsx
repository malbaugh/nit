import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { keyLabel } from "./actions";

/** Subsequence match; lower is better, null is no match. Contiguous and prefix hits win. */
export function score(query: string, text: string) {
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

export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

export function Kbd({ k, quiet = false }: { k: string; quiet?: boolean }) {
  return (
    <kbd
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-1 font-sans text-[11px] font-medium leading-none tracking-normal ${
        quiet ? "text-ink-3" : "bg-hover text-ink-2 shadow-[0_0_0_1px_var(--line)]"
      }`}
    >
      {keyLabel(k)}
    </kbd>
  );
}

/**
 * Base UI tooltip with nit's look. The app-wide <Tooltip.Provider> sets the delay; once one
 * tooltip is open, neighbours open instantly (Base UI's `data-instant`), so toolbars feel fast.
 */
export function Tooltip({
  label,
  keys,
  side = "bottom",
  children,
}: {
  label: string;
  keys?: string;
  side?: "top" | "bottom";
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
          <BaseTooltip.Popup className="flex origin-(--transform-origin) items-center gap-1.5 rounded-[6px] bg-tooltip px-2 py-1 text-[11.5px] font-medium text-tooltip-fg shadow-overlay transition-[opacity,scale] duration-150 ease-out-strong data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            {label}
            {keys ? <span className="opacity-60">{keyLabel(keys)}</span> : null}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <BaseTooltip.Provider delay={500} closeDelay={0} timeout={400}>
    {children}
  </BaseTooltip.Provider>
);

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  keys?: string;
  tone?: "default" | "danger";
  side?: "top" | "bottom";
  children: ReactNode;
};

export function IconButton({
  label,
  keys,
  tone = "default",
  side,
  className = "",
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip label={label} keys={keys} side={side}>
      <button
        type="button"
        aria-label={label}
        className={`flex size-7 shrink-0 items-center justify-center rounded-control text-ink-3 transition-[background-color,color,transform] duration-100 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:bg-hover-2 ${
          tone === "danger" ? "[@media(hover:hover)]:hover:text-red" : "[@media(hover:hover)]:hover:text-ink"
        } ${className}`}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function Button({
  children,
  tone = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "secondary" | "primary" | "ghost"; children: ReactNode }) {
  const tones = {
    secondary: "bg-surface text-ink shadow-btn [@media(hover:hover)]:hover:bg-hover",
    primary: "bg-accent text-white shadow-[0_1px_2px_oklch(0_0_0/0.2)] [@media(hover:hover)]:hover:brightness-110",
    ghost: "text-ink-2 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink",
  };
  return (
    <button
      type="button"
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-[12.5px] font-medium transition-[background-color,color,transform,filter] duration-100 ease-out active:scale-[0.97] ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** A single-choice icon switch (Base UI ToggleGroup): arrow keys move between options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon: ReactNode; keys?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(v) => {
        if (v[0]) onChange(v[0] as T);
      }}
      className="flex h-7 items-center gap-px rounded-control bg-inset p-[2px] shadow-[inset_0_0_0_1px_var(--line)]"
    >
      {options.map((o) => (
        <Tooltip key={o.value} label={o.label} keys={o.keys}>
          <Toggle
            value={o.value}
            aria-label={o.label}
            className="flex h-[22px] w-7 items-center justify-center rounded-[6px] text-ink-3 transition-[background-color,color] duration-100 data-pressed:bg-surface data-pressed:text-ink data-pressed:shadow-btn [@media(hover:hover)]:hover:text-ink"
          >
            {o.icon}
          </Toggle>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

/** A text switch for filters ("All / Changed"), same Base UI ToggleGroup underneath. */
export function TextSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(v) => {
        if (v[0]) onChange(v[0] as T);
      }}
      className="flex items-center gap-0.5"
    >
      {options.map((o) => (
        <Toggle
          key={o.value}
          value={o.value}
          className="h-6 rounded-[6px] px-2 text-[12px] font-medium text-ink-3 transition-[background-color,color] duration-100 data-pressed:bg-hover-2 data-pressed:text-ink [@media(hover:hover)]:hover:text-ink"
        >
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

export { Toggle };

/** A small ring that fills as files are marked viewed. */
export function ProgressRing({ value, size = 14 }: { value: number; size?: number }) {
  const r = (size - 2.5) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={value >= 1 ? "var(--green)" : "var(--accent)"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, value))}
        className="transition-[stroke-dashoffset] duration-300 ease-out-strong"
      />
    </svg>
  );
}

export function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="grid h-full place-items-center bg-page px-4">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="mb-3 flex size-9 items-center justify-center rounded-control bg-inset text-ink-3 shadow-[0_0_0_1px_var(--line)]">
          {icon}
        </span>
        <p className="text-[13.5px] font-medium text-ink">{title}</p>
        <p className="mt-1 text-ink-3">{body}</p>
      </div>
    </div>
  );
}

/**
 * Drag handle on a panel's inner edge. Drag or arrow keys resize; double-click resets.
 * `edge` is the side of the panel the handle sits on.
 */
export function Resizer({
  edge,
  value,
  min,
  max,
  onChange,
  onReset,
  label,
}: {
  edge: "left" | "right";
  value: number;
  min: number;
  max: number;
  onChange: (px: number) => void;
  onReset: () => void;
  label: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const sign = edge === "right" ? 1 : -1;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter needs the separator role on a div
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === "ArrowLeft") onChange(clamp(value - step * sign));
        else if (e.key === "ArrowRight") onChange(clamp(value + step * sign));
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const w0 = value;
        const move = (m: PointerEvent) => onChange(clamp(w0 + (m.clientX - x0) * sign));
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      className={`group/resizer absolute top-0 bottom-0 z-10 w-2 cursor-col-resize outline-none ${
        edge === "right" ? "-right-1" : "-left-1"
      }`}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-100 group-hover/resizer:bg-accent group-focus-visible/resizer:bg-accent group-active/resizer:bg-accent" />
    </div>
  );
}
