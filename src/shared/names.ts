// Display-name cleaning shared by player names and sponsor names.

// Very small blocklist for the worst slurs; matching names are rejected.
const BLOCKED = /n[i1!]gg|f[a@4]gg?[o0e]t|r[e3]t[a@4]rd|k[i1]ke|tr[a@4]nny|ch[i1]nk|sp[i1]c\b|c[o0]{2}n\b|wetback|n[a@4]z[i1]|h[i1]tler|rap(e|ist)/i;

// Strips control/markup characters and a leading @ (no posing as X accounts),
// collapses whitespace and caps the length. Returns "" when empty or blocked.
export function cleanDisplayName(raw: unknown, max: number): string {
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/^@+/, "").replace(/\s+/g, " ").trim();
  const name = [...s].slice(0, max).join("").trim();
  if (!name || BLOCKED.test(name.replace(/[\s._-]/g, ""))) return "";
  return name;
}
