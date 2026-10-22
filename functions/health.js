import { json } from "./_lib/db.js";

export async function onRequestGet() {
  return json({ ok: true, service: "familia-akt-control-canastas", storage: "cloudflare-d1" });
}
