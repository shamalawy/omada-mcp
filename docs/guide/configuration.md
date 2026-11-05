# Configuration

All settings are environment variables. A commented template is in [`.env.example`](https://github.com/shamalawy/omada-mcp/blob/main/.env.example).

## Connection

| Variable | Default | Description |
| --- | --- | --- |
| `OMADA_BASE_URL` | — | The app's **Interface Access Address**, for example `https://192.168.0.10:8043` or `https://use1-omada-northbound.tplinkcloud.com`. Required. |
| `OMADA_CLIENT_ID` | — | The app's client ID. Required. |
| `OMADA_CLIENT_SECRET` | — | The app's client secret. Required. |
| `OMADA_ID` | auto | The app's Omada ID (the MSP ID for MSP apps). On local controllers it is read from `/api/info` if you leave it empty. Required for Cloud-Based Controller. |
| `OMADA_VERIFY_SSL` | `true` | Verify the controller's TLS certificate. Set `false` for a local controller with a self-signed certificate. |
| `OMADA_TIMEOUT_MS` | `30000` | Timeout for each request, in milliseconds. |

## Authentication mode

| Variable | Default | Description |
| --- | --- | --- |
| `OMADA_USERNAME` | — | Controller username. If set together with `OMADA_PASSWORD`, the server uses authorization-code mode. |
| `OMADA_PASSWORD` | — | Controller password. |

Leave both empty for client-credentials mode. See [Authentication](./authentication).

## Behaviour

| Variable | Default | Description |
| --- | --- | --- |
| `OMADA_SITE` | — | Default site (name or ID) used when an operation needs `siteId` and none is given. |
| `OMADA_READ_ONLY` | `false` | Enable only GET operations. Write operations are hidden from search and blocked. |
| `OMADA_MAX_RESPONSE_CHARS` | `100000` | Longer replies are cut, with a note to use paging or filters. |

## Which operations are exposed

| Variable | Default | Description |
| --- | --- | --- |
| `OMADA_TOOL_MODE` | `meta` | `meta`: seven tools that reach every operation. `full`: also one tool per operation. See [Tools](./tools#full-mode). |
| `OMADA_INCLUDE_TAGS` | — | Comma-separated categories to allow, for example `Site,Device,Client`. Categories are listed in the [API reference](/reference/). |
| `OMADA_EXCLUDE_TAGS` | — | Comma-separated categories to hide. |
| `OMADA_INCLUDE_OPERATIONS` | — | Regular expression on `operationId`; only matching operations are allowed. Case-insensitive. |
| `OMADA_EXCLUDE_OPERATIONS` | — | Regular expression on `operationId`; matching operations are hidden, for example `^(delete\|reset)`. |
| `OMADA_EXCLUDE_DEPRECATED` | `false` | Hide operations the spec marks as deprecated. |
| `OMADA_ALLOW_RAW_REQUEST` | `true` | Expose the `omada_request` tool. It is **not** limited by the filters above (read-only mode still applies), so turn it off if you rely on filters. |

Filters apply to both tool modes: hidden operations don't show up in search and can't be called.

## API spec source

| Variable | Default | Description |
| --- | --- | --- |
| `OMADA_SPEC` | `auto` | `auto`: load the spec from your controller, falling back to the bundled copy. `live`: controller only (fail if unavailable). `bundled`: always use the bundled copy. Or a path to a spec JSON file. |

Loading the spec from your controller means the tools match its firmware exactly. The bundled copy comes from TP-Link's cloud and is refreshed by a weekly job.

## Transport

| Variable | Default | Description |
| --- | --- | --- |
| `MCP_TRANSPORT` | `stdio` | `stdio` for desktop clients, `http` for Streamable HTTP. |
| `MCP_HTTP_HOST` | `127.0.0.1` | Address to listen on in HTTP mode. |
| `MCP_HTTP_PORT` | `3000` | Port to listen on in HTTP mode. |
| `MCP_HTTP_TOKEN` | — | If set, `/mcp` requires `Authorization: Bearer <token>`. Strongly recommended when not listening on 127.0.0.1. |

See [Deployment](./deployment).

## Example: a read-only assistant for one site

```bash
OMADA_BASE_URL=https://192.168.0.10:8043
OMADA_CLIENT_ID=...
OMADA_CLIENT_SECRET=...
OMADA_VERIFY_SSL=false
OMADA_SITE=Home
OMADA_READ_ONLY=true
OMADA_ALLOW_RAW_REQUEST=false
```
