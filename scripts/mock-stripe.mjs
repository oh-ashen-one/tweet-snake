// Minimal mock of the Stripe Checkout Sessions API for local tests.
//   node scripts/mock-stripe.mjs [port]            (default 8897, 127.0.0.1 only)
//   POST /v1/checkout/sessions, GET /v1/checkout/sessions/:id  (Stripe shapes)
//   POST /pay/:id?qty=N                             marks a session paid

import http from "node:http";
import crypto from "node:crypto";

const port = Number(process.argv[2] || 8897);
const sessions = new Map();

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url, "http://x");
    const send = (code, obj) => {
      res.statusCode = code;
      res.end(JSON.stringify(obj));
    };
    if (url.pathname.startsWith("/v1/") && !/^Bearer (sk|rk)_test_/.test(req.headers.authorization || "")) {
      return send(401, { error: { message: "bad key" } });
    }
    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const f = new URLSearchParams(body);
      const id = `cs_test_${crypto.randomBytes(18).toString("hex")}`;
      const unit = Number(f.get("line_items[0][price_data][unit_amount]"));
      const metadata = {};
      for (const [k, v] of f) {
        const m = k.match(/^metadata\[(.+)\]$/);
        if (m) metadata[m[1]] = v;
      }
      const s = {
        id, object: "checkout.session", mode: f.get("mode"), payment_status: "unpaid", status: "open",
        amount_total: unit * Number(f.get("line_items[0][quantity]") || 1), currency: "usd", metadata,
        url: `http://127.0.0.1:${port}/checkout/${id}`, _unit: unit,
        success_url: f.get("success_url"),
      };
      sessions.set(id, s);
      return send(200, s);
    }
    let m = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/);
    if (req.method === "GET" && m) {
      const s = sessions.get(m[1]);
      return s ? send(200, s) : send(404, { error: { message: "No such checkout.session" } });
    }
    m = url.pathname.match(/^\/pay\/(cs_[A-Za-z0-9_]+)$/);
    if (req.method === "POST" && m) {
      const s = sessions.get(m[1]);
      if (!s) return send(404, {});
      const qty = Number(url.searchParams.get("qty") || 1);
      Object.assign(s, { payment_status: "paid", status: "complete", amount_total: s._unit * qty });
      return send(200, s);
    }
    send(404, { error: { message: "not found" } });
  });
}).listen(port, "127.0.0.1", () => console.log(`mock stripe on 127.0.0.1:${port}`));
