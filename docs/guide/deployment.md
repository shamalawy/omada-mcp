# Deployment

## stdio (default)

Desktop MCP clients start the server themselves and talk to it over stdin/stdout. Nothing listens on the network. This is the simplest and safest setup; see [Getting started](./getting-started#_3-connect-your-mcp-client).

## Streamable HTTP

Run the server as a long-lived service that clients reach over HTTP:

```bash
MCP_TRANSPORT=http \
MCP_HTTP_TOKEN=a-long-random-string \
OMADA_BASE_URL=https://192.168.0.10:8043 \
OMADA_CLIENT_ID=... OMADA_CLIENT_SECRET=... OMADA_VERIFY_SSL=false \
node dist/index.js
```

| Endpoint | Description |
| --- | --- |
| `POST /mcp` | MCP Streamable HTTP endpoint (stateless, JSON responses) |
| `GET /health` | Returns `ok` |

Point your client at `http://127.0.0.1:3000/mcp` and send the header `Authorization: Bearer <MCP_HTTP_TOKEN>`. For Claude Code:

```bash
claude mcp add --transport http omada http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer a-long-random-string"
```

::: warning
Anyone who can reach this endpoint can run operations on your network. Keep it on 127.0.0.1, or set `MCP_HTTP_TOKEN` and put it behind TLS (a reverse proxy) before exposing it further.
:::

When bound to a loopback address, the server also checks the `Host` header to block DNS-rebinding attacks from web pages.

## Docker

Each release publishes a multi-arch image (amd64 and arm64) to GitHub Container Registry. The image runs in HTTP mode on port 3000.

```bash
docker run -d --name omada_mcp \
  -p 127.0.0.1:3000:3000 \
  -e MCP_HTTP_TOKEN=a-long-random-string \
  -e OMADA_BASE_URL=https://192.168.0.10:8043 \
  -e OMADA_CLIENT_ID=... \
  -e OMADA_CLIENT_SECRET=... \
  -e OMADA_VERIFY_SSL=false \
  ghcr.io/shamalawy/omada-mcp:latest
```

### Docker Compose

```yaml
services:
  mcp:
    image: ghcr.io/shamalawy/omada-mcp:latest
    container_name: omada_mcp
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    env_file: .env   # OMADA_* and MCP_HTTP_TOKEN
```

### Build the image yourself

```bash
docker build -t omada-mcp .
```

## Running as a service (systemd)

```ini
# /etc/systemd/system/omada-mcp.service
[Unit]
Description=omada-mcp
After=network-online.target

[Service]
EnvironmentFile=/etc/omada-mcp.env
Environment=MCP_TRANSPORT=http
ExecStart=/usr/bin/node /opt/omada-mcp/dist/index.js
Restart=on-failure
DynamicUser=yes

[Install]
WantedBy=multi-user.target
```

Keep `/etc/omada-mcp.env` readable by root only (`chmod 600`), since it holds the client secret.
