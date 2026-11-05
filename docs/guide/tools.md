# Tools

The Omada Open API has about 2,450 operations. Most MCP clients can't load that many tools, and loading them all would fill the model's context. So by default the server exposes **seven tools** that together reach every operation.

## The seven tools

| Tool | Purpose |
| --- | --- |
| `omada_search_operations` | Find operations by keywords, category or HTTP method |
| `omada_list_tags` | List the API categories and how many operations each has |
| `omada_describe_operation` | Show one operation's parameters, request body schema, permissions and error codes |
| `omada_call_operation` | Run any operation by its `operationId` |
| `omada_get_schema` | Expand a named data schema from the spec |
| `omada_request` | Send a raw HTTP request with the access token attached |
| `omada_status` | Show the configuration (without secrets) and test the connection |

A typical exchange: the model searches, describes, then calls.

```text
omada_search_operations  { "query": "reboot device" }
  → rebootDevice — POST /openapi/v1/{omadacId}/sites/{siteId}/devices/{deviceMac}/reboot — Reboot device

omada_describe_operation { "operationId": "rebootDevice" }
  → parameters, permissions, error codes, an example call

omada_call_operation     { "operationId": "rebootDevice",
                           "params": { "siteId": "Home", "deviceMac": "AA-BB-CC-DD-EE-FF" } }
  → { "errorCode": 0, "msg": "Success." }
```

### omada_search_operations

| Input | Description |
| --- | --- |
| `query` | Keywords, for example `list clients` or `create ssid`. Matches the operationId, summary, category, path and description. Plurals and common synonyms (wifi → wlan/ssid, router → gateway) are understood. |
| `tag` | Only search one category (see `omada_list_tags`). |
| `method` | Only `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. |
| `limit` | Maximum results (default 20, max 200). |

### omada_describe_operation

| Input | Description |
| --- | --- |
| `operationId` | The operation to describe (case-insensitive). |
| `includeResponseSchema` | Also show the schema of the `result` field. Default `false`. |

### omada_call_operation

| Input | Description |
| --- | --- |
| `operationId` | The operation to run. |
| `params` | Path and query parameters by name. The server works out which go in the path and which go in the query string. |
| `body` | The JSON request body. A JSON string is accepted too. |
| `files` | Files for upload operations. See [File uploads](#file-uploads). |

### omada_get_schema

Some request bodies are deeply nested. When a schema says `call omada_get_schema "SomeName"`, this tool expands it.

| Input | Description |
| --- | --- |
| `name` | Schema name, for example `CreateSiteEntity`. |
| `maxDepth` | How many levels of nested schemas to expand (default 6). |

### omada_request

For anything not in the spec. The path is relative to `OMADA_BASE_URL`. `{omadacId}` and `{mspId}` are replaced with your Omada ID, and `{siteId}` with the default site.

```json
{ "method": "GET", "path": "/openapi/v1/{omadacId}/sites", "query": { "page": 1, "pageSize": 10 } }
```

Requests can't leave the controller's host. Read-only mode blocks everything except GET. Tag and operation filters do **not** apply here; set `OMADA_ALLOW_RAW_REQUEST=false` to remove this tool.

## How parameters work

- **`omadacId` and `mspId`** are filled in automatically with your Omada ID. For MSP apps, pass a customer's ID as `omadacId` in `params` to work inside that customer.
- **`siteId`** accepts a site ID or a site **name** (case-insensitive). If you set `OMADA_SITE`, it's used when no site is given.
- **Paging.** List operations need `page` and `pageSize`. They default to `1` and `100`. The maximum `pageSize` is usually 1000.
- **Object query parameters.** Some operations take a query object (named things like `queryParam` or `vo`). Its fields are sent as separate query parameters, the way the controller expects. You can pass either `{"vo": {"type": 1}}` or the fields directly, `{"type": 1}`.
- **Arrays and nested values** in query parameters become repeated keys (`a=1&a=2`) and dotted names (`filters.status=1`).
- **Unknown parameters** are sent as query parameters, because the spec isn't always complete.
- **Path parameters missing from the spec.** The spec leaves some path parameters out of its parameter lists. The server reads them from the URL template, so they still work.

## File uploads

About ten operations upload files, such as VPN client configs, portal pages and pictures, certificates and firmware. Pass files in `files`, keyed by form field name (usually `file`). Give each one a `path`, `base64` or `text`:

```json
{
  "operationId": "uploadVpnCertificateFile",
  "params": { "siteId": "Home" },
  "files": { "file": { "path": "/home/me/client.ovpn" } }
}
```

Other form fields go in `body`. Object fields, like the `config` of an LDAP profile, are sent as JSON parts:

```json
{
  "operationId": "createGoogleLdapProfile",
  "params": { "siteId": "Home" },
  "body": { "config": { "name": "Google LDAP" } },
  "files": { "file": { "path": "/home/me/google.crt" } }
}
```

Optional per-file fields: `filename` (defaults to the path's base name) and `contentType` (guessed from the extension).

## Responses and errors

Replies are the controller's JSON, usually `{ "errorCode": 0, "msg": "Success.", "result": ... }`.

- `errorCode` 0 means success.
- Any other `errorCode`, or an HTTP error, is returned as a tool error. Known codes come with a plain-language hint (see [Troubleshooting](./troubleshooting#error-codes)).
- Very long replies are cut at `OMADA_MAX_RESPONSE_CHARS`, with a note to narrow the request.

## Full mode

With `OMADA_TOOL_MODE=full`, every operation also becomes its own tool, named by its `operationId` (for example `getSiteList` or `rebootDevice`), with a complete input schema. Path and query parameters are top-level inputs, the request body is `body`, and uploads are `files`.

Without filters that's about 2,450 tools and roughly 5 MB of schemas, which is more than most clients handle well. Combine full mode with filters:

```bash
OMADA_TOOL_MODE=full
OMADA_INCLUDE_TAGS=Site,Device,Client,Wireless Network
```

The seven tools above are always available too.

## Tool hints

Tools carry MCP annotations so clients can ask before risky actions. In full mode, GET operations are marked read-only, writes as destructive, and GET/PUT/DELETE as idempotent. `omada_call_operation` and `omada_request` are marked destructive unless the server is in read-only mode.
