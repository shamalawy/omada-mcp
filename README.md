# omada-mcp

[![CI](https://github.com/shamalawy/omada-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shamalawy/omada-mcp/actions/workflows/ci.yml)
[![Docs](https://github.com/shamalawy/omada-mcp/actions/workflows/docs.yml/badge.svg)](https://shamalawy.github.io/omada-mcp/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server for the **TP-Link Omada Open API**. It exposes **every** Open API operation (2,450 in the current spec, across 163 categories) to AI assistants such as Claude. The tools are generated from the controller's OpenAPI spec, not hand-written, so nothing is left out.

**Documentation: https://shamalawy.github.io/omada-mcp/**

## Features

- **Every operation.** Sites, devices, clients, wireless, switching, gateways, VPN, firewall, hotspot, MSP and more. The spec is loaded from your controller when possible, so the tools match its firmware.
- **Works with any MCP client.** Seven small tools let the model search, inspect and call any operation. A full one-tool-per-operation mode is available too.
- **Login handled.** Client-credentials and authorization-code modes, automatic token refresh, and a retry when a token expires.
- **Easy to use.** Site names work in place of IDs, the Omada ID is filled in for you, and list calls are paged automatically.
- **Safe.** Read-only mode, category and operation filters, TLS verification, and bearer-token auth for HTTP.
- **Runs anywhere.** stdio, Streamable HTTP, and a multi-arch Docker image.

## Quick start

1. In the controller, go to **Settings > Platform Integration > Open API**, add an app (Client Credentials mode), and note the Client ID, Client Secret and Interface Access Address.
2. Build:

   ```bash
   git clone https://github.com/shamalawy/omada-mcp.git
   cd omada-mcp && npm ci && npm run build
   ```

3. Add it to your MCP client. For Claude Code:

   ```bash
   claude mcp add omada \
     -e OMADA_BASE_URL=https://192.168.0.10:8043 \
     -e OMADA_CLIENT_ID=your-client-id \
     -e OMADA_CLIENT_SECRET=your-client-secret \
     -e OMADA_VERIFY_SSL=false \
     -- node "$PWD/dist/index.js"
   ```

4. Ask: *"List my Omada sites."*

See [Getting started](https://shamalawy.github.io/omada-mcp/guide/getting-started) for Claude Desktop, Docker, and Cloud-Based Controller.

## How it works

By default the server exposes seven tools:

| Tool | Purpose |
| --- | --- |
| `omada_search_operations` | Find operations by keywords, category or method |
| `omada_list_tags` | List API categories |
| `omada_describe_operation` | Parameters, body schema, permissions and error codes |
| `omada_call_operation` | Run any operation by `operationId` |
| `omada_get_schema` | Expand a named data schema |
| `omada_request` | Raw HTTP request with the token attached |
| `omada_status` | Show config and test the connection |

```json
{ "operationId": "rebootDevice", "params": { "siteId": "Home", "deviceMac": "AA-BB-CC-DD-EE-FF" } }
```

More in [Tools](https://shamalawy.github.io/omada-mcp/guide/tools), [Configuration](https://shamalawy.github.io/omada-mcp/guide/configuration) and the full [API reference](https://shamalawy.github.io/omada-mcp/reference/).

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). This project is not affiliated with or endorsed by TP-Link. Omada is a trademark of TP-Link. The bundled API spec (`spec/omada-openapi.json`) is TP-Link's published Omada Open API document.
