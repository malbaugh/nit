import { $ } from "bun";
import type { AuthStatus } from "./types";

/**
 * Claude Code's sign-in, driven from the page. `claude auth login` opens the browser and
 * finishes through its own localhost callback; when the browser can't call back, the page shows a
 * code that goes to the process's stdin. nit only starts it, relays the URL and the code, and
 * asks `claude auth status` whether it worked.
 */
/** `ended` hears how each sign-in finished: null when it worked, else what went wrong. */
export function createAuth(ended: (error: string | null) => void = () => {}) {
  let login: { proc: Bun.Subprocess<"pipe", "pipe", "pipe">; url: string | null; output: string } | null = null;
  let error: string | null = null;

  async function status(): Promise<AuthStatus> {
    const bin = Bun.which("claude");
    const base = { signingIn: !!login, url: login?.url ?? null, error };
    if (!bin) return { ...base, installed: false, loggedIn: false, method: null };
    const r = await $`${bin} auth status --json`.nothrow().quiet();
    let s: { loggedIn?: boolean; authMethod?: string } = {};
    try {
      s = JSON.parse(r.stdout.toString());
    } catch {}
    return { ...base, installed: true, loggedIn: !!s.loggedIn, method: s.authMethod ?? null };
  }

  /** Starts signing in (once) and resolves with the sign-in page's URL once Claude Code prints it. */
  async function start(): Promise<{ url: string | null }> {
    if (login) return { url: login.url };
    const bin = Bun.which("claude");
    if (!bin) throw new Error("Claude Code isn't installed. Install it from claude.com/code, then try again.");
    error = null;
    const proc = Bun.spawn([bin, "auth", "login", "--claudeai"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const current = { proc, url: null as string | null, output: "" };
    login = current;
    const { promise: printed, resolve } = Promise.withResolvers<string | null>();
    const read = async (stream: ReadableStream<Uint8Array>) => {
      const text = new TextDecoder();
      for await (const chunk of stream) {
        current.output += text.decode(chunk, { stream: true });
        const urls = Bun.stripANSI(current.output).match(/https:\/\/[^\s"'<>)]+/g) ?? [];
        const url = urls.find((u) => /oauth|authorize/.test(u)) ?? null;
        if (url && !current.url) {
          current.url = url;
          resolve(url);
        }
      }
    };
    void read(proc.stdout);
    void read(proc.stderr);
    void proc.exited.then((code) => {
      if (login !== current) return; // cancelled
      login = null;
      // Claude Code's last words, after its "Paste code here >" prompt.
      const last = Bun.stripANSI(current.output)
        .split(/\n|> /)
        .map((l) => l.trim())
        .filter(Boolean)
        .at(-1);
      if (code !== 0) error = last ?? `claude auth login exited with ${code}`;
      ended(code === 0 ? null : error);
      resolve(null);
    });
    setTimeout(() => resolve(null), 5000); // the browser opened and nothing was printed
    return { url: await printed };
  }

  /** The code the sign-in page shows when it can't hand the sign-in back on its own. */
  function code(text: string) {
    if (!login) return false;
    login.proc.stdin.write(`${text.trim()}\n`);
    void login.proc.stdin.flush();
    return true;
  }

  function cancel() {
    const l = login;
    login = null;
    l?.proc.kill();
  }

  return { status, start, code, cancel };
}
