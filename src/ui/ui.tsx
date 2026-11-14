import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { keyLabel } from "./actions";

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

// Tooltips wait before the first one opens, then open instantly while you move between controls.
let lastClosed = 0;

export function Tooltip({
  label,
  keys,
  side = "bottom",
  children,
}: {
  label: string;
  keys?: string;
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  const [open, setOpen] = useState<"delayed" | "instant" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = () => {
    clearTimeout(timer.current);
    if (performance.now() - lastClosed < 400) setOpen("instant");
    else timer.current = setTimeout(() => setOpen("delayed"), 500);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (open) lastClosed = performance.now();
    setOpen(null);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only tracks hover and focus for its trigger
    <span
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[6px] bg-tooltip px-2 py-1 text-[11.5px] font-medium text-tooltip-fg shadow-overlay ${
            side === "bottom" ? "top-[calc(100%+6px)] origin-top" : "bottom-[calc(100%+6px)] origin-bottom"
          } ${open === "delayed" ? "transition-[opacity,scale] duration-150 ease-out-strong starting:scale-[0.97] starting:opacity-0" : ""}`}
        >
          {label}
          {keys && <span className="opacity-60">{keyLabel(keys)}</span>}
        </span>
      )}
    </span>
  );
}

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
    <div
      role="radiogroup"
      aria-label={label}
      className="flex h-7 items-center gap-px rounded-control bg-inset p-[2px] shadow-[inset_0_0_0_1px_var(--line)]"
    >
      {options.map((o) => (
        <Tooltip key={o.value} label={o.label} keys={o.keys}>
          {/* biome-ignore lint/a11y/useSemanticElements: an icon toggle; native radios can't be styled like this */}
          <button
            type="button"
            role="radio"
            aria-checked={value === o.value}
            aria-label={o.label}
            onClick={() => onChange(o.value)}
            className={`flex h-[22px] w-7 items-center justify-center rounded-[6px] transition-[background-color,color] duration-100 ${
              value === o.value ? "bg-surface text-ink shadow-btn" : "text-ink-3 [@media(hover:hover)]:hover:text-ink"
            }`}
          >
            {o.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

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
