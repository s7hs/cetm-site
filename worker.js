// worker.js — Cloudflare Worker: bộ đếm lượt xem (D1) + trả file của trang
// Mỗi lượt mở trang = +1, tính đúng 1 lần dù mạng chập chờn (mỗi lượt có mã riêng).
const START = 639264; // số mà người đầu tiên vào sẽ thấy
const BOT = /[a-z]bot\/|\bbot\b|crawl|spider|slurp|facebookexternalhit|curl\/|wget|python-requests|headlesschrome/i;
let ready;

function init(db) {
  ready ??= db
    .batch([
      db.prepare("CREATE TABLE IF NOT EXISTS views (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, t INTEGER NOT NULL)"),
      db.prepare("INSERT OR IGNORE INTO views (id, n) VALUES (1, ?)").bind(START - 1),
    ])
    .catch((e) => {
      ready = undefined;
      throw e;
    });
  return ready;
}

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/api/view")) {
      return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
    }
    if (!env.DB) return J({ error: "Chưa gắn D1 với tên DB" }, 500);
    try {
      await init(env.DB);
      const read = async () => (await env.DB.prepare("SELECT n FROM views WHERE id = 1").first()).n;
      if (req.method === "GET") return J({ n: await read() });
      if (req.method !== "POST") return J({ error: "method" }, 405);
      const v = url.searchParams.get("v") || "";
      if (!/^[\w-]{8,64}$/.test(v)) return J({ error: "bad id" }, 400);
      if (BOT.test(req.headers.get("user-agent") || "")) return J({ n: await read() });
      const now = Date.now();
      const ins = await env.DB.prepare("INSERT OR IGNORE INTO seen (id, t) VALUES (?, ?)").bind(v, now).run();
      let n;
      if (ins.meta.changes > 0) {
        n = (await env.DB.prepare("UPDATE views SET n = n + 1 WHERE id = 1 RETURNING n").first()).n;
        if (Math.random() < 0.02) ctx.waitUntil(env.DB.prepare("DELETE FROM seen WHERE t < ?").bind(now - 864e5).run());
      } else {
        n = await read();
      }
      return J({ n });
    } catch (e) {
      return J({ error: "db" }, 500);
    }
  },
};
