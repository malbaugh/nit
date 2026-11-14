import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandSettings, loadCommands, saveUserCommands } from "./config";

// A bare "origin" whose default branch has the team's .nit.toml, a clone to review in, and a
// private XDG_CONFIG_HOME for the user's own config.
let dir: string;
let work: string;
const saved = { xdg: process.env.XDG_CONFIG_HOME, env: process.env.NIT_COMMANDS_CHECKOUT };
const ident = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** git in `cwd`, unsigned, failing loudly. */
function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd, env: { ...process.env, ...ident } });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nit-config-"));
  const seed = join(dir, "seed");
  mkdirSync(seed);
  git(seed, "init", "-q", "-b", "main");
  writeFileSync(join(seed, ".nit.toml"), `[commands]\ncheckout = "team-checkout"\n`);
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "init");
  git(dir, "clone", "-q", "--bare", "seed", "origin.git");
  git(dir, "clone", "-q", "origin.git", "work");
  work = join(dir, "work");
  mkdirSync(join(dir, "xdg", "nit"), { recursive: true });
  writeFileSync(join(dir, "xdg", "nit", "config.toml"), `[commands]\ncheckout = "my-checkout"\neditor = "zed"\n`);
  process.env.XDG_CONFIG_HOME = join(dir, "xdg");
  delete process.env.NIT_COMMANDS_CHECKOUT;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = saved.xdg;
  if (saved.env !== undefined) process.env.NIT_COMMANDS_CHECKOUT = saved.env;
});

test("the repo's .nit.toml overrides your config, command by command", async () => {
  const c = await loadCommands(work);
  expect(c.checkout).toEqual({ run: "team-checkout", from: ".nit.toml on origin/main" });
  expect(c.editor?.run).toBe("zed"); // only yours sets it
});

test("your config applies where the repo sets nothing", async () => {
  const bare = join(dir, "bare");
  mkdirSync(bare);
  git(bare, "init", "-q", "-b", "main");
  const c = await loadCommands(bare);
  expect(c.checkout?.run).toBe("my-checkout");
  expect(c.checkout?.from).toContain("nit/config.toml");
});

test("a .nit.toml only on the branch under review is never read", async () => {
  git(work, "checkout", "-q", "-b", "feature");
  writeFileSync(join(work, ".nit.toml"), `[commands]\ncheckout = "evil"\n`);
  git(work, "commit", "-qam", "evil");
  expect((await loadCommands(work)).checkout?.run).toBe("team-checkout");
  git(work, "checkout", "-q", "main");
});

test("an untracked .nit.local.toml overrides the repo's; a committed one is refused", async () => {
  writeFileSync(join(work, ".nit.local.toml"), `[commands]\ncheckout = "local-checkout"\n`);
  expect((await loadCommands(work)).checkout?.run).toBe("local-checkout");
  git(work, "add", "-f", ".nit.local.toml");
  git(work, "commit", "-qm", "local");
  expect((await loadCommands(work)).checkout?.run).toBe("team-checkout");
});

test("NIT_COMMANDS_CHECKOUT wins over every file", async () => {
  process.env.NIT_COMMANDS_CHECKOUT = "env-checkout";
  try {
    expect((await loadCommands(work)).checkout).toEqual({ run: "env-checkout", from: "NIT_COMMANDS_CHECKOUT" });
  } finally {
    delete process.env.NIT_COMMANDS_CHECKOUT;
  }
});

test("a malformed or unknown entry is skipped, not fatal", async () => {
  writeFileSync(
    join(dir, "xdg", "nit", "config.toml"),
    `[commands]\ncheckout = 42\nfrobnicate = "x"\neditor = "nvim"\n`,
  );
  const bare = join(dir, "bare");
  const c = await loadCommands(bare);
  expect(c.checkout).toBeUndefined();
  expect(c.editor?.run).toBe("nvim");
});

test("the settings screen edits your config file; the team's command still wins here, and says so", async () => {
  const file = join(dir, "xdg", "nit", "config.toml");
  const before = await Bun.file(file).text();
  try {
    await saveUserCommands({ editor: 'cursor -g "{file}:{line}"', checkout: null });
    const s = await commandSettings(work);
    expect(s.editable).toBe(true);
    expect(s.editor.yours).toBe('cursor -g "{file}:{line}"');
    expect(s.editor.effective?.run).toBe('cursor -g "{file}:{line}"');
    expect(s.checkout.yours).toBeNull();
    expect(s.checkout.effective).toEqual({ run: "team-checkout", from: ".nit.toml on origin/main" });
    // Round-trips through TOML intact.
    expect((await loadCommands(work)).editor?.run).toBe('cursor -g "{file}:{line}"');

    await Bun.write(file, `[commands]\neditor = "zed"\n[other]\nx = 1\n`);
    expect((await commandSettings(work)).editable).toBe(false);
    await expect(saveUserCommands({ editor: "vim" })).rejects.toThrow("edit it by hand");
  } finally {
    await Bun.write(file, before);
  }
});
