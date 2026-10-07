// Sponsor panel: choose a tier, name and optional link, then pay on Stripe
// Checkout (opened in a new tab, since Checkout can't run inside the tweet
// iframe). Quantity can be raised on Stripe's page to climb the board.

import { spanText } from "../shared/format";
import type { Sponsor } from "../shared/protocol";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const LABELS = ["Gold", "Silver", "Bronze"];

export interface SponsorConfig {
  tiers: number[];
  hours: number;
  test: boolean;
}

// data-sponsor="500,300,100:24:test" (empty when Stripe isn't configured)
export function parseSponsorConfig(raw: string | undefined): SponsorConfig | null {
  if (!raw) return null;
  const [t, h, mode] = raw.split(":");
  const tiers = t.split(",").map(Number).filter((n) => n > 0);
  return tiers.length ? { tiers, hours: Number(h) || 168, test: mode === "test" } : null;
}

export class SponsorPanel {
  private wrap = el("div", "bidwrap");
  private card = el("div", "card bid");

  constructor(root: HTMLElement, private cfg: SponsorConfig, private room: string) {
    this.wrap.hidden = true;
    this.wrap.append(this.card);
    this.wrap.addEventListener("click", (e) => {
      if (e.target === this.wrap) this.close();
    });
    root.append(this.wrap);
  }

  get open(): boolean {
    return !this.wrap.hidden;
  }

  close(): void {
    this.wrap.hidden = true;
    this.card.replaceChildren();
  }

  private header(title: string): HTMLElement {
    const h = el("div", "bid-head");
    const x = el("button", "x", "✕");
    x.onclick = () => this.close();
    h.append(el("div", "dt", title), x);
    return h;
  }

  async show(): Promise<void> {
    this.wrap.hidden = false;
    let list: Sponsor[] = [];
    try {
      list = await (await fetch("/api/sponsors")).json();
    } catch {
      // show the form anyway
    }
    this.form(list);
  }

  private form(list: Sponsor[]): void {
    const { tiers, hours, test } = this.cfg;
    const parts: HTMLElement[] = [this.header("Sponsor the leaderboard 👑")];
    parts.push(el("p", "bid-copy",
      `Your name in the sponsor section of every player's leaderboard for ${spanText(hours)}. Ranked by total paid. Add quantity at checkout to climb.`));

    const ol = el("ol", "sp-list bid-board");
    if (list.length === 0) ol.append(el("li", "sp-empty", "No sponsors right now. The 👑 spot is open."));
    list.forEach((s, i) => {
      const li = el("li", i === 0 ? "sp-top" : "");
      li.append(el("span", "crown", i === 0 ? "👑" : "★"), el("span", "nm", s.name), el("span", "amt", usd(s.amount)));
      ol.append(li);
    });
    parts.push(ol);

    let tier = tiers[0];
    const tierRow = el("div", "tiers");
    const tierBtns = tiers.map((t, i) => {
      const b = el("button", "tier");
      b.type = "button";
      b.append(el("b", "", usd(t)), el("span", "", LABELS[i] ?? ""));
      b.onclick = () => {
        tier = t;
        tierBtns.forEach((x) => x.classList.toggle("on", x === b));
      };
      return b;
    });
    tierBtns[0].classList.add("on");
    tierRow.append(...tierBtns);

    const name = el("input");
    name.maxLength = 24;
    name.placeholder = "Name to show (your @, brand…)";
    const link = el("input");
    link.placeholder = "Link (optional, https://…)";
    link.inputMode = "url";
    const err = el("div", "bid-err");
    const go = el("button", "play", "Continue to checkout");
    go.type = "submit";
    const f = el("form", "bid-form");
    f.append(tierRow, name, link, err, go);
    f.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = "";
      go.disabled = true;
      // Open the tab during the click so popup blockers allow it, then point it at Stripe.
      const tab = window.open("", "_blank");
      try {
        const r = await fetch("/api/sponsor/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tier, name: name.value, url: link.value.trim() || undefined, room: this.room }),
        });
        const j = await r.json();
        if (!r.ok || !j.url) throw new Error(j.error || "Couldn't start checkout.");
        if (tab) {
          tab.opener = null;
          tab.location.href = j.url;
          this.sent();
        } else {
          this.fallback(j.url);
        }
      } catch (e2) {
        tab?.close();
        err.textContent = (e2 as Error).message;
        go.disabled = false;
      }
    };
    parts.push(f);
    parts.push(el("div", "fine", test
      ? "Stripe TEST MODE: nothing is charged. Use card 4242 4242 4242 4242, any future date, any CVC."
      : "Secure payment by Stripe. Sponsor spots are non-refundable."));
    this.card.replaceChildren(...parts);
    name.focus();
  }

  private sent(): void {
    const ok = el("button", "play", "Back to the game");
    ok.onclick = () => this.close();
    this.card.replaceChildren(
      this.header("Checkout opened"),
      el("p", "bid-copy", "Finish paying in the new tab. Your name shows on the leaderboard as soon as Stripe confirms."),
      ok,
    );
  }

  private fallback(url: string): void {
    const a = el("a", "play wallet", "Open Stripe checkout");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.onclick = () => setTimeout(() => this.sent(), 300);
    this.card.replaceChildren(this.header("One more tap"), el("p", "bid-copy", "Your browser blocked the new tab."), a);
  }
}
