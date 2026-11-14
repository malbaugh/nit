/**
 * The environment nit gives Claude Code and gh: only what a command-line tool needs to run as you,
 * nothing else from nit's own environment. Bun loads the .env files of the folder nit starts in,
 * which belong to the repo under review: its ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, GITHUB_TOKEN,
 * NODE_TLS_REJECT_UNAUTHORIZED and the like must not decide where your credentials go.
 * (snapshot.ts builds git's environment the same way.)
 */
const KEEP = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TERM",
  "COLORTERM",
  "LANG",
  "TZ",
  "SSH_AUTH_SOCK",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  // A corporate network needs these to reach Anthropic or GitHub at all.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && (KEEP.has(k) || k.startsWith("LC_"))) env[k] = v;
  return env;
}
