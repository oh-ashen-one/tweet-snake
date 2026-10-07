// Sign in with X (OAuth 2.0 + PKCE) and our own signed session tokens.
//
// The game runs inside X's iframe, where cookies and storage are partitioned,
// so the login popup can't simply hand a cookie back. The iframe picks a random
// nonce, opens /auth/x/start?n=<nonce> in a popup, and the callback parks the
// token under that nonce in the Meta object. The iframe receives it either by
// postMessage (when the popup kept its opener) or by polling /auth/claim.

import type { Identity } from "../shared/protocol";

export interface AuthEnv {
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  DEV_LOGIN?: string;
}

interface TokenBody {
  i: string; // X user id
  h: string; // handle
  p: string; // pfp path under pbs.twimg.com/profile_images/
  exp: number;
}

const enc = new TextEncoder();
const PFP_PREFIX = "https://pbs.twimg.com/profile_images/";
const TOKEN_DAYS = 60;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomId(bytes = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function signToken(secret: string, id: string, handle: string, pfp: string): Promise<string> {
  const body: TokenBody = { i: id, h: handle, p: pfp, exp: Date.now() + TOKEN_DAYS * 86400e3 };
  const payload = b64url(enc.encode(JSON.stringify(body)));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function verifyToken(secret: string | undefined, token: unknown): Promise<Identity | null> {
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    if (!sameBytes(await hmac(secret, payload), fromB64url(sig))) return null;
    const body = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as TokenBody;
    if (typeof body.h !== "string" || !(body.exp > Date.now())) return null;
    return { name: `@${body.h}`.slice(0, 16), pfp: typeof body.p === "string" ? body.p : "", verified: true };
  } catch {
    return null;
  }
}

export function pfpPath(url: string | undefined): string {
  if (!url || !url.startsWith(PFP_PREFIX)) return "";
  const path = url.slice(PFP_PREFIX.length).replace("_normal.", "_bigger.");
  return /^[A-Za-z0-9_\-./]{1,160}$/.test(path) && !path.includes("..") ? path : "";
}

export function pfpUpstream(path: string): string | null {
  return /^[A-Za-z0-9_\-./]{1,160}$/.test(path) && !path.includes("..") ? PFP_PREFIX + path : null;
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

function cookie(req: Request, name: string): string | null {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function startLogin(req: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(req.url);
  const nonce = url.searchParams.get("n") || "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return new Response("bad nonce", { status: 400 });
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET || !env.SESSION_SECRET) {
    return new Response("Sign in with X is not configured on this server yet.", { status: 503 });
  }
  const state = randomId(16);
  const verifier = randomId(48);
  const auth = new URL("https://x.com/i/oauth2/authorize");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", env.X_CLIENT_ID);
  auth.searchParams.set("redirect_uri", `${url.origin}/auth/x/callback`);
  auth.searchParams.set("scope", "users.read tweet.read");
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", b64url(await sha256(verifier)));
  auth.searchParams.set("code_challenge_method", "S256");
  return new Response(null, {
    status: 302,
    headers: {
      location: auth.toString(),
      "set-cookie": `snek_oauth=${encodeURIComponent(`${state}.${verifier}.${nonce}`)}; Path=/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

// Returns the minted token and the nonce it belongs to, or an error message.
export async function finishLogin(req: Request, env: AuthEnv): Promise<{ token: string; nonce: string } | string> {
  const url = new URL(req.url);
  const saved = cookie(req, "snek_oauth");
  if (!saved || !env.X_CLIENT_ID || !env.X_CLIENT_SECRET || !env.SESSION_SECRET) return "Login expired, try again.";
  const [state, verifier, nonce] = saved.split(".");
  if (url.searchParams.get("error")) return "Login was cancelled.";
  if (!state || url.searchParams.get("state") !== state) return "Login expired, try again.";
  const code = url.searchParams.get("code");
  if (!code) return "Login failed.";

  const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      code, grant_type: "authorization_code", redirect_uri: `${url.origin}/auth/x/callback`, code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return "X rejected the login.";
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return "X rejected the login.";

  const meRes = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) return "Couldn't read your X profile.";
  const me = (await meRes.json()) as { data?: { id: string; username: string; profile_image_url?: string } };
  if (!me.data?.username) return "Couldn't read your X profile.";

  const token = await signToken(env.SESSION_SECRET, me.data.id, me.data.username, pfpPath(me.data.profile_image_url));
  return { token, nonce };
}

// Local testing only: mint a token for any handle when DEV_LOGIN=1.
export async function devLogin(req: Request, env: AuthEnv): Promise<{ token: string; nonce: string } | string> {
  if (env.DEV_LOGIN !== "1" || !env.SESSION_SECRET) return "Not available.";
  const url = new URL(req.url);
  const handle = (url.searchParams.get("h") || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);
  if (!handle) return "Missing handle.";
  return { token: await signToken(env.SESSION_SECRET, `dev-${handle}`, handle, ""), nonce: url.searchParams.get("n") || "" };
}

export function finishPage(result: { token: string; nonce: string } | string, origin: string): Response {
  const ok = typeof result !== "string";
  const data = JSON.stringify(ok ? { type: "snek-auth", token: result.token } : { type: "snek-auth-error", error: result });
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signing in…</title>
<body style="background:#0b0d14;color:#fff;font:600 16px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
<p>${ok ? "Signed in. You can close this window." : String(result).replace(/[<>&]/g, "")}</p>
<script>
const msg = ${data.replace(/</g, "\\u003c")};
try { if (msg.token) localStorage.setItem("snek.tok", msg.token); } catch {}
try { if (window.opener) window.opener.postMessage(msg, ${JSON.stringify(origin)}); } catch {}
setTimeout(() => window.close(), ${ok ? 600 : 2500});
</script>`;
  return new Response(body, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "snek_oauth=; Path=/auth; Max-Age=0; Secure; SameSite=Lax" },
  });
}
