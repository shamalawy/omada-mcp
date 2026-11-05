/**
 * Summarise the difference between two Omada OpenAPI specs as Markdown.
 *
 *   npx tsx scripts/spec-diff.ts old.json new.json
 */
import { readFile } from "node:fs/promises";

type Doc = { paths?: Record<string, Record<string, { operationId?: string; summary?: string }>> };

async function operations(file: string): Promise<Map<string, string>> {
  const doc = JSON.parse(await readFile(file, "utf8")) as Doc;
  const ops = new Map<string, string>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      const id = op.operationId ?? `${method} ${path}`;
      ops.set(id, `\`${method.toUpperCase()} ${path}\` ${op.summary ?? ""}`.trim());
    }
  }
  return ops;
}

const [oldFile, newFile] = process.argv.slice(2);
if (!oldFile || !newFile) {
  console.error("usage: spec-diff.ts <old.json> <new.json>");
  process.exit(2);
}
const before = await operations(oldFile);
const after = await operations(newFile);
const added = [...after.keys()].filter((k) => !before.has(k));
const removed = [...before.keys()].filter((k) => !after.has(k));

const MAX = 100;
const list = (ids: string[], map: Map<string, string>) => [
  ...ids.slice(0, MAX).map((id) => `- \`${id}\` — ${map.get(id)}`),
  ...(ids.length > MAX ? [`- …and ${ids.length - MAX} more`] : []),
];

const out = [
  "## Omada Open API spec update",
  "",
  `Operations: ${before.size} → ${after.size} (${added.length} added, ${removed.length} removed).`,
  "",
];
if (added.length) out.push("### Added", "", ...list(added, after), "");
if (removed.length) out.push("### Removed", "", ...list(removed, before), "");
if (!added.length && !removed.length) out.push("No operations were added or removed; descriptions or schemas changed.", "");
console.log(out.join("\n"));
