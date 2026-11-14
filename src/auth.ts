import { $ } from "bun";
import type { AuthStatus } from "./types";

/**
 * Whether Claude can run, as the page sees it. nit never signs you in itself: Claude Code's own
 * login (`claude`, then `/login`) is yours to manage, and nit only asks `claude auth status`.
 */
export function createAuth(
  /** The environment Claude runs get, so the status is what they'll see. */
  env: () => Promise<Record<string, string | undefined>>,
  hasKey: () => Promise<boolean>,
) {
  return async function status(): Promise<AuthStatus> {
    const bin = Bun.which("claude");
    const keyed = await hasKey();
    if (!bin) return { installed: false, loggedIn: false, method: null, hasKey: keyed };
    const r = await $`${bin} auth status --json`
      .env(await env())
      .nothrow()
      .quiet();
    let s: { loggedIn?: boolean; authMethod?: string } = {};
    try {
      s = JSON.parse(r.stdout.toString());
    } catch {}
    return { installed: true, loggedIn: !!s.loggedIn, method: s.authMethod ?? null, hasKey: keyed };
  };
}
