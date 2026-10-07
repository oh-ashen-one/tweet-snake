// DOM overlay: identity chip + sign-in, collapsible leaderboard with sponsor
// slots, death card, boost button and toasts. User-supplied strings only ever
// go through textContent.

import type { LeaderEntry, Sponsor } from "../shared/protocol";
import { SKINS, TITLE } from "../shared/rules";

type Board = { top: LeaderEntry[]; rank: number; count: number; humans: number };

export interface DeathInfo {
  mass: number;
  kills: number;
  killer: string | null;
  best: number;
  secs: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function pfpUrl(path: string): string {
  return `/api/pfp?p=${encodeURIComponent(path)}`;
}

function rgb(c: [number, number, number]): string {
  return `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
}

function avatar(name: string, pfp: string, skin: number): HTMLElement {
  const a = el("span", "av");
  if (pfp) {
    const img = el("img");
    img.src = pfpUrl(pfp);
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => img.remove();
    a.append(img);
  } else {
    const [c1, c2] = SKINS[skin % SKINS.length];
    a.style.background = `linear-gradient(135deg, ${rgb(c1)}, ${rgb(c2)})`;
    a.textContent = name.replace(/^@/, "").slice(0, 1).toUpperCase();
  }
  return a;
}

export class UI {
  root: HTMLElement;
  private chip = el("button", "chip");
  private signin = el("button", "btn xbtn", "Sign in with 𝕏");
  private lb = el("div", "lb collapsed");
  private lbHead = el("button", "lb-head");
  private lbBody = el("div", "lb-body");
  private death = el("div", "death");
  private toastEl = el("div", "toast");
  private hint = el("div", "hint-pill");
  boostBtn = el("button", "boost", "BOOST");
  private sponsors: Sponsor[] = [];
  private board: Board = { top: [], rank: 0, count: 0, humans: 0 };
  private myName = "";
  private myPfp = "";
  private deathAt = 0;
  skin = 0;

  onSignIn: () => void = () => {};
  onRespawn: () => void = () => {};
  onNewTab: () => void = () => {};
  onSkin: (skin: number) => void = () => {};
  shareUrl = "";

  constructor(root: HTMLElement, opts: { login: string; embed: boolean; sponsorUrl: string; skin: number }) {
    this.root = root;
    this.skin = opts.skin;
    const tl = el("div", "tl");
    this.chip.title = "Tap to change colour";
    this.chip.onclick = () => {
      this.skin = (this.skin + 1) % SKINS.length;
      this.onSkin(this.skin);
      this.renderChip();
      this.toast("New colour next life");
    };
    tl.append(this.chip);
    if (opts.login) {
      this.signin.onclick = () => this.onSignIn();
      tl.append(this.signin);
    }
    if (opts.embed) {
      const nt = el("button", "btn ghost", "↗ Full screen");
      nt.onclick = () => this.onNewTab();
      tl.append(nt);
    }

    this.lbHead.onclick = () => this.lb.classList.toggle("collapsed");
    this.lb.append(this.lbHead, this.lbBody);
    this.sponsorUrl = opts.sponsorUrl;

    this.boostBtn.hidden = true;
    const press = (on: boolean) => (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.boostBtn.classList.toggle("on", on);
      this.onBoost(on);
    };
    this.boostBtn.addEventListener("pointerdown", press(true));
    this.boostBtn.addEventListener("pointerup", press(false));
    this.boostBtn.addEventListener("pointercancel", press(false));
    this.boostBtn.addEventListener("pointerleave", press(false));

    this.death.hidden = true;
    this.death.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a,button")) return;
      if (performance.now() - this.deathAt > 700) this.onRespawn();
    });

    const coarse = matchMedia("(pointer: coarse)").matches;
    this.hint.textContent = coarse ? "Drag anywhere to steer · 2nd finger boosts" : "Move your mouse to steer · hold click to boost";
    this.hint.hidden = true;
    root.append(tl, this.lb, this.boostBtn, this.death, this.toastEl, this.hint);
    this.renderChip();
    this.renderBoard();
  }

  private sponsorUrl: string;
  onBoost: (on: boolean) => void = () => {};

  setIdentity(name: string, pfp: string, verified: boolean): void {
    this.myName = name;
    this.myPfp = pfp;
    this.signin.hidden = verified;
    this.renderChip();
  }

  showHint(on: boolean): void {
    if (this.hint.hidden === !on) return;
    this.hint.hidden = !on;
  }

  showTouch(on: boolean): void {
    this.boostBtn.hidden = !on;
  }

  private renderChip(): void {
    this.chip.replaceChildren(avatar(this.myName || "?", this.myPfp, this.skin), el("span", "nm", this.myName || "joining…"));
  }

  setSponsors(list: Sponsor[]): void {
    this.sponsors = list;
    this.renderBoard();
  }

  setBoard(b: Board): void {
    this.board = b;
    this.renderBoard();
  }

  get dead(): boolean {
    return !this.death.hidden;
  }

  private boardContent(full: boolean): HTMLElement {
    const wrap = el("div", "board");

    const sp = el("div", "sp");
    sp.append(el("div", "sec", "Sponsors"));
    if (this.sponsors.length) {
      const ol = el("ol", "sp-list");
      this.sponsors.slice(0, full ? 5 : 3).forEach((s, i) => {
        const li = el("li", i === 0 ? "sp-top" : "");
        const name = s.url ? el("a", "", s.name) : el("span", "", s.name);
        if (s.url && name instanceof HTMLAnchorElement) {
          name.href = s.url;
          name.target = "_blank";
          name.rel = "noopener sponsored";
        }
        li.append(el("span", "crown", i === 0 ? "👑" : "★"), name);
        ol.append(li);
      });
      sp.append(ol);
    }
    if (this.sponsorUrl) {
      const cta = el("a", "sp-cta", this.sponsors.length ? "Take the top spot →" : "Your name here →");
      cta.href = this.sponsorUrl;
      cta.target = "_blank";
      cta.rel = "noopener";
      sp.append(cta);
    } else if (!this.sponsors.length) {
      sp.append(el("div", "sp-empty", "Your name here"));
    }
    wrap.append(sp);

    wrap.append(el("div", "sec", "Top snakes"));
    const ol = el("ol", "top");
    const top = this.board.top.slice(0, full ? 10 : 5);
    top.forEach((e, i) => {
      const li = el("li", e.n === this.myName && this.board.rank === i + 1 ? "me" : "");
      li.append(el("span", "rk", String(i + 1)), avatar(e.n, e.p, e.s), el("span", "nm", e.n), el("span", "ms", e.m.toLocaleString()));
      ol.append(li);
    });
    if (this.board.rank > top.length) {
      const li = el("li", "me");
      li.append(el("span", "rk", String(this.board.rank)), avatar(this.myName, this.myPfp, this.skin), el("span", "nm", this.myName), el("span", "ms", ""));
      ol.append(li);
    }
    wrap.append(ol);
    return wrap;
  }

  private renderBoard(): void {
    const b = this.board;
    const head = [el("span", "trophy", "🏆")];
    head.push(el("span", "pos", b.rank ? `#${b.rank}` : "Leaderboard"));
    if (b.rank) head.push(el("span", "of", `of ${b.count}`));
    head.push(el("span", "chev", "▾"));
    this.lbHead.replaceChildren(...head);
    if (this.sponsors[0]) {
      const by = el("div", "lb-by");
      by.append(el("span", "", "sponsored by "), el("b", "", this.sponsors[0].name));
      this.lbHead.append(by);
    }
    this.lbBody.replaceChildren(this.boardContent(false));
    const live = this.death.querySelector(".board");
    if (live) live.replaceWith(this.boardContent(true));
  }

  showDeath(d: DeathInfo): void {
    this.deathAt = performance.now();
    this.lb.classList.add("collapsed");
    this.lb.hidden = true;
    const card = el("div", "card");
    const title = el("div", "dt");
    if (d.killer) title.append(el("span", "", "Eaten by "), el("b", "", d.killer));
    else title.textContent = "You crashed!";
    const stats = el("div", "stats");
    const stat = (v: string, k: string) => {
      const s = el("div", "st");
      s.append(el("b", "", v), el("span", "", k));
      return s;
    };
    stats.append(
      stat(d.mass.toLocaleString(), "length"),
      stat(String(d.kills), "kills"),
      stat(d.best < 999 ? `#${d.best}` : "-", "best rank"),
      stat(`${Math.floor(d.secs / 60)}:${String(d.secs % 60).padStart(2, "0")}`, "alive"),
    );
    const play = el("button", "play", "Play again");
    play.onclick = () => this.onRespawn();
    const share = el("a", "share", "Share on 𝕏");
    const text = d.killer
      ? `I hit length ${d.mass.toLocaleString()} before ${d.killer} ate me in ${TITLE} 🐍 Come get revenge:`
      : `I hit length ${d.mass.toLocaleString()} in ${TITLE} 🐍 Beat me:`;
    share.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(this.shareUrl)}`;
    share.target = "_blank";
    share.rel = "noopener";
    const row = el("div", "row");
    row.append(play, share);
    card.append(title, stats, this.boardContent(true), row, el("div", "hint", "tap anywhere to play again"));
    this.death.replaceChildren(card);
    this.death.hidden = false;
  }

  hideDeath(): void {
    this.death.hidden = true;
    this.death.replaceChildren();
    this.lb.hidden = false;
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("on");
    clearTimeout((this.toastEl as unknown as { t?: number }).t);
    (this.toastEl as unknown as { t?: number }).t = window.setTimeout(() => this.toastEl.classList.remove("on"), 2200);
  }
}
