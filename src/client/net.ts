import { MSG_INPUT, packAngle, type ServerJson } from "../shared/protocol";

export class Net {
  private ws: WebSocket | null = null;
  private backoff = 800;
  private lastAngle = -1;
  private lastBoost = false;
  private lastSent = 0;
  open = false;
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  onTick: (buf: ArrayBuffer) => void = () => {};
  onJson: (m: ServerJson) => void = () => {};

  constructor(private room: string) {
    setInterval(() => this.send("ping"), 20e3);
  }

  connect(): void {
    if (this.ws) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/${this.room}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.backoff = 800;
      this.lastAngle = -1;
      this.onOpen();
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return this.onTick(e.data as ArrayBuffer);
      if (e.data === "pong") return;
      try {
        this.onJson(JSON.parse(e.data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.open = false;
      this.onClose();
      setTimeout(() => this.connect(), this.backoff * (0.6 + Math.random() * 0.8));
      this.backoff = Math.min(10e3, this.backoff * 1.8);
    };
  }

  send(d: string | ArrayBuffer | object): void {
    if (!this.ws || !this.open) return;
    try {
      this.ws.send(typeof d === "string" || d instanceof ArrayBuffer ? d : JSON.stringify(d));
    } catch {
      // socket closing
    }
  }

  // Sends steering at most every 30ms, and only when it changed.
  input(angle: number, boost: boolean, now: number): void {
    const a = packAngle(angle);
    const changed = Math.abs(a - this.lastAngle) > 40 || boost !== this.lastBoost;
    if (!changed && now - this.lastSent < 400) return;
    if (now - this.lastSent < 30) return;
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    dv.setUint8(0, MSG_INPUT);
    dv.setUint16(1, a, true);
    dv.setUint8(3, boost ? 1 : 0);
    this.send(buf);
    this.lastAngle = a;
    this.lastBoost = boost;
    this.lastSent = now;
  }
}
