// Steering: mouse direction from screen centre on desktop, a floating thumb
// joystick on touch. Boost: hold mouse / space / a second finger / boost button.

export interface Joy {
  id: number;
  ax: number;
  ay: number;
  x: number;
  y: number;
}

export class Input {
  angle = 0;
  touched = false;
  touch = false;
  joy: Joy | null = null;
  buttonBoost = false;
  private mouseBoost = false;
  private keyBoost = false;
  private extra = new Set<number>();
  private left = false;
  private right = false;

  events: Record<string, number> = {};

  constructor(el: HTMLElement) {
    for (const type of ["pointerdown", "pointermove", "touchstart", "mousedown", "mousemove", "keydown"]) {
      window.addEventListener(type, (e) => {
        const k = `${type}${(e as PointerEvent).pointerType ? ":" + (e as PointerEvent).pointerType : ""}`;
        this.events[k] = (this.events[k] || 0) + 1;
      }, { capture: true, passive: true });
    }
    el.addEventListener("pointerdown", (e) => {
      this.touched = true;
      if (e.pointerType === "mouse") {
        if (e.button === 0) this.mouseBoost = true;
        this.aimMouse(e);
        return;
      }
      this.touch = true;
      if (!this.joy) this.joy = { id: e.pointerId, ax: e.clientX, ay: e.clientY, x: e.clientX, y: e.clientY };
      else this.extra.add(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse") return this.aimMouse(e);
      const j = this.joy;
      if (!j || j.id !== e.pointerId) return;
      j.x = e.clientX;
      j.y = e.clientY;
      const dx = j.x - j.ax, dy = j.y - j.ay;
      const d = Math.hypot(dx, dy);
      if (d > 6) this.angle = Math.atan2(dy, dx);
      // Let the anchor trail the thumb so direction changes stay responsive.
      if (d > 60) {
        j.ax = j.x - (dx / d) * 60;
        j.ay = j.y - (dy / d) * 60;
      }
    });
    const up = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        this.mouseBoost = false;
        return;
      }
      if (this.joy && this.joy.id === e.pointerId) this.joy = null;
      this.extra.delete(e.pointerId);
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") this.keyBoost = true;
      if (e.code === "ArrowLeft" || e.code === "KeyA") this.left = true;
      if (e.code === "ArrowRight" || e.code === "KeyD") this.right = true;
      if (e.code === "Space") e.preventDefault();
      this.touched = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") this.keyBoost = false;
      if (e.code === "ArrowLeft" || e.code === "KeyA") this.left = false;
      if (e.code === "ArrowRight" || e.code === "KeyD") this.right = false;
    });
    window.addEventListener("blur", () => {
      this.mouseBoost = this.keyBoost = this.left = this.right = false;
      this.extra.clear();
      this.joy = null;
    });
  }

  private aimMouse(e: PointerEvent): void {
    this.touched = true;
    this.angle = Math.atan2(e.clientY - window.innerHeight / 2, e.clientX - window.innerWidth / 2);
  }

  update(dt: number): void {
    if (this.left) this.angle -= 4 * dt;
    if (this.right) this.angle += 4 * dt;
  }

  get boost(): boolean {
    return this.mouseBoost || this.keyBoost || this.buttonBoost || this.extra.size > 0;
  }
}
