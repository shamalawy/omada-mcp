/**
 * Refresh the bundled spec (spec/omada-openapi.json).
 *
 *   npm run update-spec                         # TP-Link cloud (US) spec
 *   npm run update-spec -- https://host:8043    # your controller's spec
 *
 * Set OMADA_VERIFY_SSL=false for a self-signed controller certificate.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Agent, fetch } from "undici";

const base = (process.argv[2] ?? "https://use1-omada-northbound.tplinkcloud.com").replace(/\/+$/, "");
const url = `${base}/v3/api-docs/00%20All`;
const verify = !/^(0|false|no|off)$/i.test(process.env.OMADA_VERIFY_SSL ?? "true");
const out = fileURLToPath(new URL("../spec/omada-openapi.json", import.meta.url));

const res = await fetch(url, { dispatcher: new Agent({ connect: { rejectUnauthorized: verify } }) });
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
const doc = (await res.json()) as { paths?: Record<string, Record<string, unknown>> };
if (!doc.paths) throw new Error(`${url} did not return an OpenAPI document`);
const ops = Object.values(doc.paths).reduce((n, item) => n + Object.keys(item).length, 0);
await writeFile(out, JSON.stringify(doc));
console.log(`Saved ${ops} operations from ${url} to ${out}`);
