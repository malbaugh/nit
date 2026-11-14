import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import * as term from "./term";

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
