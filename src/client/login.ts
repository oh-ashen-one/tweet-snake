// Client side of Sign in with X. See src/server/auth.ts for why the popup
// hands the token back through a nonce instead of a cookie.

const TOKEN_KEY = "snek.tok";

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the token still works for this session
  }
}

// Picks up a token passed in the URL hash by "play in new tab".
export function tokenFromHash(): string | null {
  const m = location.hash.match(/(?:^#|&)tok=([^&]+)/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return decodeURIComponent(m[1]);
}

function nonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signIn(mode: string, onToken: (t: string) => void, onFail: (msg: string) => void): void {
  const n = nonce();
  const url = mode === "dev"
    ? `/auth/dev?n=${n}&h=tester${Math.floor(100 + Math.random() * 900)}`
    : `/auth/x/start?n=${n}`;
  const pop = window.open(url, "snek-login", "width=520,height=720");
  if (!pop) {
    onFail("Popup blocked. Open the game in a new tab to sign in.");
    return;
  }

  let done = false;
  const finish = (t: string) => {
    if (done) return;
    done = true;
    window.removeEventListener("message", onMsg);
    clearInterval(poll);
    onToken(t);
  };
  const onMsg = (e: MessageEvent) => {
    if (e.origin !== location.origin) return;
    const d = e.data as { type?: string; token?: string; error?: string };
    if (d?.type === "snek-auth" && d.token) finish(d.token);
    else if (d?.type === "snek-auth-error") {
      done = true;
      clearInterval(poll);
      window.removeEventListener("message", onMsg);
      onFail(d.error || "Sign in failed.");
    }
  };
  window.addEventListener("message", onMsg);

  const started = Date.now();
  const poll = setInterval(async () => {
    if (done || Date.now() - started > 180e3) {
      clearInterval(poll);
      return;
    }
    try {
      const r = await fetch(`/auth/claim?n=${n}`);
      if (r.status === 200) finish(((await r.json()) as { token: string }).token);
    } catch {
      // keep polling
    }
  }, 1500);
}
