/**
 * Generate the API reference pages (docs/reference/) from the bundled spec:
 * one page per category, plus an index and the sidebar.
 *
 *   npm run docs:gen
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadSpec, multipartParts, type ApiSpec, type Operation } from "../src/spec.js";
import type { Config } from "../src/config.js";
import type { JsonSchema } from "../src/schema.js";

const OUT = fileURLToPath(new URL("../docs/reference/", import.meta.url));

const spec = await loadSpec({ spec: "bundled" } as Config, async () => undefined);

/** Escape text so markdown and Vue leave it alone. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{\{/g, "&#123;&#123;")
    .replace(/\}\}/g, "&#125;&#125;")
    .replace(/([\\`*_[\]|])/g, "\\$1");
}

/** For table cells: escape and keep it on one line. */
function cell(s: string | undefined): string {
  return esc((s ?? "").replace(/\s*\n\s*/g, " ").trim());
}

function typeOf(schema: JsonSchema | undefined): string {
  if (!schema) return "";
  if (schema.$ref) return String(schema.$ref).split("/").pop()!;
  if (schema.type === "array") return `array<${typeOf(schema.items) || "any"}>`;
  if (schema.format && schema.format !== "int32" && schema.format !== "int64") return `${schema.type} (${schema.format})`;
  return schema.type ?? (schema.properties ? "object" : "");
}

function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untagged";
}

function opSection(op: Operation, api: ApiSpec): string {
  const out: string[] = [];
  out.push(`## ${op.operationId} {#${op.operationId}}`, "");
  out.push(`<span class="method method-${op.method.toLowerCase()}">${op.method}</span> \`${op.path}\``, "");
  if (op.deprecated) out.push("::: warning Deprecated", "This operation is deprecated.", ":::", "");
  if (op.summary) out.push(`**${esc(op.summary)}**`, "");

  // Path + query parameters
  const rows: string[] = [];
  for (const p of op.pathParams) {
    let note = p.description ?? "";
    if (p.name === "omadacId" || p.name === "mspId") note += " (filled in automatically)";
    if (p.name === "siteId") note += " (site ID or site name)";
    const required = p.name === "omadacId" || p.name === "mspId" ? "auto" : "yes";
    rows.push(`| \`${p.name}\` | path | string | ${required} | ${cell(note)} |`);
  }
  for (const q of op.queryParams) {
    const resolved = q.schema ? api.resolve(q.schema, 4) : undefined;
    let note = q.description ?? "";
    let required = q.required ? "yes" : "no";
    if (q.required && q.name === "page") (required = "no"), (note += " (default 1)");
    if (q.required && q.name === "pageSize") (required = "no"), (note += " (default 100)");
    if (q.isObject && resolved?.properties) {
      note += ` Object: its fields (${Object.keys(resolved.properties).join(", ")}) are sent as separate query parameters.`;
      required = "no";
    }
    rows.push(`| \`${q.name}\` | query | ${cell(typeOf(q.schema))} | ${required} | ${cell(note)} |`);
  }
  if (rows.length) {
    out.push("| Parameter | In | Type | Required | Description |", "| --- | --- | --- | --- | --- |", ...rows, "");
  }

  // Body
  const example: Record<string, unknown> = { operationId: op.operationId };
  const params: Record<string, string> = {};
  for (const p of op.pathParams) if (p.name !== "omadacId" && p.name !== "mspId") params[p.name] = `<${p.name}>`;
  for (const q of op.queryParams) {
    if (q.required && !q.isObject && q.name !== "page" && q.name !== "pageSize") params[q.name] = `<${q.name}>`;
  }
  if (Object.keys(params).length) example.params = params;

  if (op.body) {
    const required = op.body.required ? "required" : "optional";
    if (op.body.contentType.includes("multipart")) {
      const parts = multipartParts(api, op);
      out.push(`**Request body** — \`multipart/form-data\` (${required}). File field(s): ${parts.files.map((f) => `\`${f}\``).join(", ")}.`, "");
      const fieldNames = Object.keys(parts.fields.properties ?? {});
      if (fieldNames.length) out.push(`Other form fields (sent as JSON parts): ${fieldNames.map((f) => `\`${f}\``).join(", ")}.`, "");
      if (fieldNames.length) example.body = Object.fromEntries(fieldNames.map((f) => [f, "{...}"]));
      example.files = { [parts.files[0] ?? "file"]: { path: "/path/to/file" } };
    } else {
      const raw = op.body.schema as JsonSchema;
      const name = raw.$ref ? ` — schema \`${typeOf(raw)}\`` : "";
      out.push(`**Request body** — \`${op.body.contentType}\` (${required})${name}`, "");
      const top = api.resolve(raw, 1);
      const unresolved = raw.$ref ? (api.schemas[typeOf(raw)] as JsonSchema | undefined) : raw;
      const props = (unresolved?.properties ?? {}) as Record<string, JsonSchema>;
      const req: string[] = unresolved?.required ?? [];
      if (Object.keys(props).length) {
        out.push("| Field | Type | Required | Description |", "| --- | --- | --- | --- |");
        for (const [k, v] of Object.entries(props)) {
          out.push(`| \`${k}\` | ${cell(typeOf(v))} | ${req.includes(k) ? "yes" : "no"} | ${cell(v.description ?? top.properties?.[k]?.description)} |`);
        }
        out.push("");
      } else if (top.type) {
        out.push(`Type: \`${cell(typeOf(raw) || top.type)}\``, "");
      }
      example.body = "{...}";
    }
  }

  out.push("```json", `// omada_call_operation`, JSON.stringify(example, null, 2), "```", "");

  if (op.description && op.description !== op.summary) {
    const body = op.description
      .split("\n")
      .map((l) => esc(l.trim()))
      .filter(Boolean)
      .join("<br>\n");
    out.push("<details><summary>Details, permissions and error codes</summary>", "", body, "", "</details>", "");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const byTag = new Map<string, Operation[]>();
for (const op of spec.operations) {
  const tag = op.tags[0];
  byTag.set(tag, [...(byTag.get(tag) ?? []), op]);
}
const tags = [...byTag.keys()].sort((a, b) => a.localeCompare(b));
const slugs = new Map<string, string>();
const used = new Set<string>();
for (const tag of tags) {
  let slug = slugify(tag);
  for (let i = 2; used.has(slug); i++) slug = `${slugify(tag)}-${i}`;
  used.add(slug);
  slugs.set(tag, slug);
}

for (const tag of tags) {
  const ops = byTag.get(tag)!.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const page = [
    "---",
    `title: ${JSON.stringify(`${tag} — API reference`)}`,
    "editLink: false",
    "outline: { level: 2, label: Operations }",
    "---",
    "",
    `# ${esc(tag)}`,
    "",
    `${ops.length} operation${ops.length === 1 ? "" : "s"}. Call any of them with \`omada_call_operation\` (or, in full tool mode, as a tool named by its operationId).`,
    "",
    "| Operation | Method | Summary |",
    "| --- | --- | --- |",
    ...ops.map((op) => `| [${op.operationId}](#${op.operationId}) | ${op.method} | ${cell(op.summary)}${op.deprecated ? " *(deprecated)*" : ""} |`),
    "",
    ...ops.map((op) => opSection(op, spec)),
  ].join("\n");
  await writeFile(`${OUT}${slugs.get(tag)}.md`, page);
}

const methods = new Map<string, number>();
for (const op of spec.operations) methods.set(op.method, (methods.get(op.method) ?? 0) + 1);

const index = [
  "---",
  "title: API reference",
  "editLink: false",
  "---",
  "",
  "# API reference",
  "",
  `Every operation in the bundled Omada Open API spec: **${spec.operations.length} operations** in **${tags.length} categories** (${[...methods.entries()].map(([m, n]) => `${n} ${m}`).join(", ")}).`,
  "",
  "This reference is generated from `spec/omada-openapi.json`. Your controller may have a few more or fewer operations depending on its firmware; at runtime the server uses your controller's own spec when it can.",
  "",
  "Use the search box (top of the page) to find an operation by name, or pick a category:",
  "",
  "| Category | Operations |",
  "| --- | --- |",
  ...tags.map((t) => `| [${cell(t)}](./${slugs.get(t)}) | ${byTag.get(t)!.length} |`),
  "",
].join("\n");
await writeFile(`${OUT}index.md`, index);

const sidebar = tags.map((t) => ({ text: `${t} (${byTag.get(t)!.length})`, link: `/reference/${slugs.get(t)}` }));
await writeFile(`${OUT}sidebar.json`, JSON.stringify(sidebar, null, 2));

console.log(`Generated ${tags.length} category pages (${spec.operations.length} operations) in docs/reference/`);
