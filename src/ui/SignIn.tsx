import { Dialog } from "@base-ui/react/dialog";
import { Sparks } from "iconoir-react/regular";
import { useEffect, useState } from "react";
import { api } from "./api";
import * as st from "./state";
import { Button } from "./ui";

/** Opens the sign-in prompt; `retry` runs again once Claude is signed in. */
export function needSignIn(retry: (() => void) | null) {
  st.set({ signIn: { retry } });
}

/**
 * Claude's sign-in expired (or never happened): sign in from here instead of a terminal. Claude
 * Code opens the browser; this waits for it to land, then retries what you were doing.
 */
export function SignInDialog() {
  const open = st.useStore((s) => s.signIn);
  if (!open) return null;
  return <SignIn retry={open.retry} />;
}

function SignIn({ retry }: { retry: (() => void) | null }) {
  const [phase, setPhase] = useState<"ask" | "waiting">("ask");
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // While the browser is out, ask Claude Code every second and a half whether it's done.
  useEffect(() => {
    if (phase !== "waiting") return;
    const t = setInterval(async () => {
      const s = await api.auth().catch(() => null);
      if (s?.loggedIn) {
        st.set({ signIn: null });
        st.notify("Signed in to Claude");
        retry?.();
      } else if (s && !s.signingIn) {
        setPhase("ask");
        setError(s.error ?? "The sign-in didn't finish.");
      }
    }, 1500);
    return () => clearInterval(t);
  }, [phase, retry]);

  const start = async () => {
    setError(null);
    try {
      const r = await api.signIn();
      setUrl(r.url);
      setPhase("waiting");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start signing in.");
    }
  };
  const close = () => {
    if (phase === "waiting") void api.cancelSignIn().catch(() => {});
    st.set({ signIn: null });
  };
  const send = async () => {
    if (!code.trim()) return;
    try {
      await api.signInCode(code);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the code.");
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[oklch(0_0_0/0.28)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-[22vh] left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-window bg-surface p-5 shadow-overlay outline-none transition-[opacity,scale] duration-150 ease-out-strong data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
          <div className="mb-3 flex size-8 items-center justify-center rounded-control bg-accent-tint text-accent-ink">
            <Sparks width={16} height={16} />
          </div>
          <Dialog.Title className="text-[15px] font-semibold text-ink">Sign in to Claude</Dialog.Title>
          {phase === "ask" ? (
            <>
              <Dialog.Description className="mt-1.5 text-[13px] text-ink-2">
                nit runs Claude with your Claude subscription, and its sign-in has expired. Sign in again in your
                browser{retry ? " and nit picks up where you left off" : ""}.
              </Dialog.Description>
              {error ? <p className="mt-3 text-[12.5px] text-red">{error}</p> : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button tone="ghost" onClick={close}>
                  Not now
                </Button>
                <Button tone="primary" autoFocus onClick={start}>
                  Sign in with Claude
                </Button>
              </div>
            </>
          ) : (
            <>
              <Dialog.Description className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-2">
                <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line-strong border-t-accent" />
                Finish signing in in the browser tab that opened.
              </Dialog.Description>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[12.5px] text-accent-ink underline underline-offset-2"
                >
                  No tab? Open the sign-in page
                </a>
              ) : null}
              <label className="mt-4 block text-[12px] text-ink-3" htmlFor="nit-signin-code">
                If the page shows a code, paste it here
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="nit-signin-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void send()}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-8 min-w-0 flex-1 rounded-control bg-inset px-2.5 font-mono text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                />
                <Button tone="secondary" onClick={send} disabled={!code.trim()}>
                  Send
                </Button>
              </div>
              {error ? <p className="mt-3 text-[12.5px] text-red">{error}</p> : null}
              <div className="mt-5 flex justify-end">
                <Button tone="ghost" onClick={close}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
