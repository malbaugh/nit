import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import type { ColorMode, ColorScheme } from "@pierre/theming";
import { Check, NavArrowDown, Settings as SettingsIcon } from "iconoir-react/regular";
import type { ReactNode } from "react";
import * as st from "./state";
import { catalog, nameFor, theme, useTheme } from "./theme";
import { IconButton, Kbd, TextSegmented } from "./ui";

// Shiki's themes have ids only (night-owl, github-dark-dimmed); show them as names.
const WORDS: Record<string, string> = { github: "GitHub", vs: "VS", vscode: "VS Code", gruvbox: "Gruvbox", hc: "HC" };
const pretty = (id: string) =>
  id
    .split("-")
    .map((w) => WORDS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
const label = (name: string) => {
  const t = catalog.getThemes().find((d) => d.name === name);
  return t?.displayName ?? pretty(name);
};
const options = (scheme: ColorScheme) =>
  catalog.getThemes({ colorScheme: scheme }).map((t) => ({ value: t.name, label: t.displayName ?? pretty(t.name) }));

const MODES: { value: ColorMode; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-3">
      <span className="w-[76px] shrink-0 text-[12.5px] text-ink-2">{title}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ThemeSelect({ scheme }: { scheme: ColorScheme }) {
  const s = useTheme();
  const value = nameFor(s, scheme);
  const items = options(scheme);
  return (
    <Select.Root items={items} value={value} onValueChange={(v) => v && theme.setThemeNameForScheme(scheme, v)}>
      <Select.Trigger
        aria-label={`${scheme === "dark" ? "Dark" : "Light"} theme`}
        className="flex h-7 w-full min-w-0 items-center gap-2 rounded-control bg-field px-2.5 text-left text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-[box-shadow] duration-100 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-tint)] data-popup-open:shadow-[inset_0_0_0_1px_var(--line-strong)]"
      >
        <Select.Value className="min-w-0 flex-1 truncate">{() => label(value)}</Select.Value>
        <Select.Icon className="shrink-0 text-ink-3">
          <NavArrowDown width={13} height={13} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} className="z-[60] outline-none" alignItemWithTrigger={false}>
          <Select.Popup className="max-h-[min(360px,var(--available-height))] min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-card bg-surface p-1 shadow-overlay outline-none transition-[opacity,scale] duration-150 ease-out-strong data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            <Select.List>
              {items.map((t) => (
                <Select.Item
                  key={t.value}
                  value={t.value}
                  className="flex h-7 cursor-default items-center gap-2 rounded-[6px] pr-2 pl-2.5 text-[12.5px] text-ink-2 outline-none select-none data-highlighted:bg-hover-2 data-highlighted:text-ink data-selected:text-ink"
                >
                  <Select.ItemText className="min-w-0 flex-1 truncate">{t.label}</Select.ItemText>
                  <Select.ItemIndicator className="shrink-0 text-accent-ink">
                    <Check width={13} height={13} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/** Theme and appearance, from the gear in the sidebar footer or ⌘,. */
export function SettingsButton() {
  const open = st.useStore((s) => s.settingsOpen);
  const { mode } = useTheme();
  return (
    <Popover.Root open={open} onOpenChange={(o) => st.set({ settingsOpen: o })}>
      <Popover.Trigger
        render={
          <IconButton label="Theme and appearance" keys="Mod+," side="top">
            <SettingsIcon />
          </IconButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="w-[300px] origin-(--transform-origin) rounded-card bg-surface p-3 pt-2.5 shadow-overlay outline-none transition-[opacity,scale] duration-150 ease-out-strong data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            <div className="mb-1.5 flex h-6 items-center">
              <Popover.Title className="text-[13px] font-medium text-ink">Appearance</Popover.Title>
              <span className="ml-auto">
                <Kbd k="Mod+," quiet />
              </span>
            </div>
            <Row title="Mode">
              <TextSegmented label="Colour mode" value={mode} onChange={(m) => theme.setColorMode(m)} options={MODES} />
            </Row>
            <Row title="Light theme">
              <ThemeSelect scheme="light" />
            </Row>
            <Row title="Dark theme">
              <ThemeSelect scheme="dark" />
            </Row>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
