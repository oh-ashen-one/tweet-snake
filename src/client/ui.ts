// DOM overlay: name chip + name editor, colour button, collapsible
// leaderboard with sponsor slots, death card, boost button, hints and toasts.
// User-supplied strings only ever go through textContent.

import type { LeaderEntry, Sponsor } from "../shared/protocol";
import { MAX_NAME, SKINS, TITLE } from "../shared/rules";

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

function rgb(c: [number, number, number]): string {
  return `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
}

function avatar(name: string, skin: number): HTMLElement {
  const a = el("span", "av");
  const [c1, c2] = SKINS[skin % SKINS.length];
  a.style.background = `linear-gradient(135deg, ${rgb(c1)}, ${rgb(c2)})`;
  a.textContent = name.slice(0, 1).toUpperCase();
  return a;
}

export class UI {
  root: HTMLElement;
  private chip = el("button", "chip");
  private colorBtn = el("button", "dot");
  // Not a <form>: X's sandboxed iframe blocks form submission.
  private editor = el("div", "editor");
  private nameInput = el("input");
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
  private deathAt = 0;
  private sponsorOn: boolean;
  private customName: boolean;
  skin = 0;

  onName: (name: string) => void = () => {};
  onRespawn: () => void = () => {};
  onNewTab: () => void = () => {};
  onSkin: (skin: number) => void = () => {};
  onBoost: (on: boolean) => void = () => {};
  shareUrl = "";

  onSponsor: () => void = () => {};

  constructor(root: HTMLElement, opts: { embed: boolean; sponsorOn: boolean; skin: number; customName: boolean }) {
    this.root = root;
    this.skin = opts.skin;
    this.sponsorOn = opts.sponsorOn;
    this.customName = opts.customName;

    const tl = el("div", "tl");
    this.chip.title = "Set your name";
    this.chip.onclick = () => this.openEditor();
    this.colorBtn.title = "Change colour";
    this.colorBtn.onclick = () => {
      this.skin = (this.skin + 1) % SKINS.length;
      this.onSkin(this.skin);
      this.renderChip();
    };
    tl.append(this.chip, this.colorBtn);
    if (opts.embed) {
      const nt = el("button", "btn ghost", "↗ Full screen");
      nt.onclick = () => this.onNewTab();
      tl.append(nt);
    }

    this.nameInput.maxLength = MAX_NAME;
    this.nameInput.placeholder = "your name";
    this.nameInput.autocomplete = "off";
    this.nameInput.spellcheck = false;
    this.nameInput.enterKeyHint = "done";
    const save = el("button", "btn save", "Save");
    save.type = "button";
    this.editor.append(this.nameInput, save);
    this.editor.hidden = true;
    const commit = () => {
      const name = this.nameInput.value.trim();
      this.closeEditor();
      if (name) {
        this.customName = true;
        this.onName(name);
      }
    };
    save.onclick = commit;
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") this.closeEditor();
    });
    // Clicking anywhere else closes the editor so the game takes input again.
    document.addEventListener("pointerdown", (e) => {
      if (!this.editor.hidden && !this.editor.contains(e.target as Node) && !this.chip.contains(e.target as Node)) this.closeEditor();
    }, { capture: true });

    this.lbHead.onclick = () => this.lb.classList.toggle("collapsed");
    this.lb.append(this.lbHead, this.lbBody);

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
      if ((e.target as HTMLElement).closest("a,button,input,.editor")) return;
      if (performance.now() - this.deathAt > 700) this.onRespawn();
    });

    const coarse = matchMedia("(pointer: coarse)").matches;
    this.hint.textContent = coarse ? "Drag anywhere to steer · 2nd finger boosts" : "Move your mouse to steer · hold click to boost";
    this.hint.hidden = true;

    root.append(tl, this.editor, this.lb, this.boostBtn, this.death, this.toastEl, this.hint);
    this.renderChip();
    this.renderBoard();
  }

  openEditor(): void {
    this.nameInput.value = this.customName ? this.myName : "";
    this.editor.hidden = false;
    this.nameInput.focus();
  }

  closeEditor(): void {
    this.editor.hidden = true;
    this.nameInput.blur();
  }

  get editing(): boolean {
    return !this.editor.hidden;
  }

  setName(name: string): void {
    this.myName = name;
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
    const label = el("span", "nm", this.myName || "joining…");
    const parts: HTMLElement[] = [avatar(this.myName || "?", this.skin), label];
    if (!this.customName) parts.push(el("span", "set", "Set name ✎"));
    else parts.push(el("span", "pen", "✎"));
    this.chip.replaceChildren(...parts);
    const [c1, c2] = SKINS[this.skin % SKINS.length];
    this.colorBtn.style.background = `linear-gradient(135deg, ${rgb(c1)}, ${rgb(c2)})`;
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
        li.append(el("span", "crown", i === 0 ? "👑" : "★"), name, el("span", "amt", `$${s.amount.toLocaleString()}`));
        ol.append(li);
      });
      sp.append(ol);
    }
    if (this.sponsorOn) {
      const cta = el("button", "sp-cta", this.sponsors.length ? "Sponsor & take the 👑 spot →" : "Your name here → sponsor");
      cta.onclick = () => this.onSponsor();
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
      li.append(el("span", "rk", String(i + 1)), avatar(e.n, e.s), el("span", "nm", e.n), el("span", "ms", e.m.toLocaleString()));
      ol.append(li);
    });
    if (this.board.rank > top.length) {
      const li = el("li", "me");
      li.append(el("span", "rk", String(this.board.rank)), avatar(this.myName, this.skin), el("span", "nm", this.myName), el("span", "ms", ""));
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
    const rename = el("button", "linkish", this.customName ? `Playing as ${this.myName} · change name` : "Set your name");
    rename.onclick = () => this.openEditor();
    const row = el("div", "row");
    row.append(play, share);
    card.append(title, stats, this.boardContent(true), row, rename, el("div", "hint", "tap anywhere to play again"));
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
