import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import * as term from "./term";
import type { CommandSetting, CommandSettings } from "./types";

/** The plug points a config can set: shell commands nit runs instead of its built-ins. */
export const COMMANDS = ["checkout", "editor"] as const;
export type Command = (typeof COMMANDS)[number];

/** A command and which layer set it, so nit can say where it came from. */
export type Commands = Partial<Record<Command, { run: string; from: string }>>;

const out = async (p: ReturnType<typeof $>) => (await p.nothrow().quiet().text()).trim();

export const userConfigPath = () =>
  join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "nit", "config.toml");

/** `[commands]` from one layer's TOML; anything malformed is skipped with a warning, never fatal. */
function commandsIn(text: string, from: string): Commands {
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(text);
  } catch (e) {
    term.warn(`ignoring ${from}: ${e instanceof Error ? e.message : e}`);
    return {};
  }
  const table = (parsed as { commands?: unknown }).commands;
  const found: Commands = {};
  if (table === undefined) return found;
  if (typeof table !== "object" || table === null) {
    term.warn(`ignoring [commands] in ${from}: it isn't a table`);
    return found;
  }
  for (const [name, run] of Object.entries(table)) {
    if (!COMMANDS.includes(name as Command))
      term.warn(`${from}: unknown command "${name}" (known: ${COMMANDS.join(", ")})`);
    else if (typeof run !== "string" || !run.trim()) term.warn(`${from}: commands.${name} must be a command string`);
    else found[name as Command] = { run, from };
  }
  return found;
}

/**
 * Commands for the repo at `root`, layered, later winning:
 * 1. ~/.config/nit/config.toml: yours, every repo
 * 2. .nit.toml on origin's default branch: the team's, never from the branch under review
 * 3. .nit.local.toml in the checkout: yours, this repo; refused if git tracks it, since a
 *    PR could otherwise commit one and run a command on the reviewer's machine
 * 4. NIT_COMMANDS_<NAME> environment variables: this run
 */
export async function loadCommands(root: string): Promise<Commands> {
  const layers: Commands[] = [];

  const user = userConfigPath();
  if (existsSync(user)) layers.push(commandsIn(readFileSync(user, "utf8"), term.tilde(user)));

  const head = (await out($`git symbolic-ref --short refs/remotes/origin/HEAD`.cwd(root))) || "origin/main";
  const shared = await $`git show ${`${head}:.nit.toml`}`.cwd(root).nothrow().quiet();
  if (shared.exitCode === 0) layers.push(commandsIn(shared.text(), `.nit.toml on ${head}`));

  const local = join(root, ".nit.local.toml");
  if (existsSync(local)) {
    const tracked = (await $`git ls-files --error-unmatch .nit.local.toml`.cwd(root).nothrow().quiet()).exitCode === 0;
    if (tracked) term.warn("ignoring .nit.local.toml: it's committed to git, and it should be git-ignored");
    else layers.push(commandsIn(readFileSync(local, "utf8"), ".nit.local.toml"));
  }

  const env: Commands = {};
  for (const name of COMMANDS) {
    const key = `NIT_COMMANDS_${name.toUpperCase()}`;
    const run = process.env[key];
    if (run?.trim()) env[name] = { run, from: key };
  }
  layers.push(env);

  return Object.assign({}, ...layers);
}

/** What the settings screen shows for each command: yours (the user file) and the one in effect here. */
export async function commandSettings(root: string): Promise<CommandSettings> {
  const file = userConfigPath();
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (Bun.TOML.parse(text) as Record<string, unknown>) : {};
  } catch {}
  const yours = (parsed.commands ?? {}) as Record<string, unknown>;
  const effective = await loadCommands(root);
  const one = (name: Command): CommandSetting => ({
    yours: typeof yours[name] === "string" ? (yours[name] as string) : null,
    effective: effective[name] ?? null,
  });
  // nit writes the file whole, so it only edits one that holds nothing but [commands].
  const editable = Object.keys(parsed).every((k) => k === "commands");
  return { file: term.tilde(file), editable, checkout: one("checkout"), editor: one("editor") };
}

/** Sets (or, with null or "", removes) commands in your config file. */
export async function saveUserCommands(patch: Partial<Record<Command, string | null>>) {
  const file = userConfigPath();
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const parsed = (text ? Bun.TOML.parse(text) : {}) as Record<string, unknown>;
  if (Object.keys(parsed).some((k) => k !== "commands"))
    throw new Error(`${term.tilde(file)} has more than [commands] in it; edit it by hand.`);
  const commands = { ...((parsed.commands ?? {}) as Record<string, string>) };
  for (const [name, run] of Object.entries(patch)) {
    if (!COMMANDS.includes(name as Command)) throw new Error(`unknown command "${name}"`);
    if (run?.trim()) commands[name] = run.trim();
    else delete commands[name];
  }
  // JSON strings are valid TOML basic strings.
  const lines = Object.entries(commands).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
  await Bun.write(
    file,
    `# nit: written by its settings screen (⌘,).\n${lines.length ? `[commands]\n${lines.join("\n")}\n` : ""}`,
  );
}

/** Opens a file at a line in your editor: the editor command, else VS Code, else the OS's default app. */
export async function openInEditor(root: string, file: string, line: number) {
  const configured = (await loadCommands(root)).editor?.run;
  const quoted = `'${file.replaceAll("'", "'\\''")}'`;
  const run =
    configured ??
    (Bun.which("code") ? "code --goto {file}:{line}" : `${process.platform === "darwin" ? "open" : "xdg-open"} {file}`);
  const cmd = run.replaceAll("{file}", quoted).replaceAll("{line}", String(line));
  const proc = Bun.spawn(["sh", "-c", cmd], { cwd: root, stdout: "ignore", stderr: "pipe" });
  // An editor that stays open (a -w flag) counts as opened after a moment.
  const code = await Promise.race([proc.exited, Bun.sleep(3000).then(() => 0)]);
  if (code !== 0)
    throw new Error(`${run} failed: ${(await new Response(proc.stderr).text()).trim() || `exit ${code}`}`);
  return run;
}
