# Getting started

This page takes you from nothing to asking your AI assistant about your network.

## What you need

- An Omada controller with the Open API: a software or hardware controller on your network, or Omada Cloud-Based Controller.
- Node.js 20 or newer, or Docker.
- An MCP client, such as Claude Code, Claude Desktop, or any other client that supports MCP.

## 1. Create an Open API app in the controller

1. Open the controller and go to **Settings > Platform Integration > Open API** (in the Global or MSP view).
2. Click **Add New App** and pick a mode:
   - **Client Credentials** (recommended). The app has its own role and site access. Give it the smallest role that does what you need, for example a viewer role if you only want to read.
   - **Authorization Code**. The app acts as a controller user, so you also give the server a username and password. A few operations only work in this mode. See [Authentication](./authentication).
3. Save, then click **View** on the app and copy:
   - **Client ID** and **Client Secret**
   - **Omada ID**
   - **Interface Access Address**: the URL the server will call, for example `https://192.168.0.10:8043`

## 2. Install

::: code-group

```bash [From source]
git clone https://github.com/shamalawy/omada-mcp.git
cd omada-mcp
npm ci
npm run build
# the server is now at dist/index.js
```

```bash [From a release]
# Each GitHub release has an npm package attached.
npm install -g https://github.com/shamalawy/omada-mcp/releases/download/v1.0.0/omada-mcp-1.0.0.tgz
# the server is now on your PATH as `omada-mcp`
```

```bash [Docker]
docker pull ghcr.io/shamalawy/omada-mcp:latest
# see Deployment for how to run it
```

:::

## 3. Connect your MCP client

The examples use a local controller with a self-signed certificate, which is why `OMADA_VERIFY_SSL` is `false`. For Omada Cloud-Based Controller, use the northbound address (for example `https://use1-omada-northbound.tplinkcloud.com`), set `OMADA_ID`, and leave TLS verification on.

::: code-group

```bash [Claude Code]
claude mcp add omada \
  -e OMADA_BASE_URL=https://192.168.0.10:8043 \
  -e OMADA_CLIENT_ID=your-client-id \
  -e OMADA_CLIENT_SECRET=your-client-secret \
  -e OMADA_VERIFY_SSL=false \
  -- node /path/to/omada-mcp/dist/index.js
```

```json [Claude Desktop]
{
  "mcpServers": {
    "omada": {
      "command": "node",
      "args": ["/path/to/omada-mcp/dist/index.js"],
      "env": {
        "OMADA_BASE_URL": "https://192.168.0.10:8043",
        "OMADA_CLIENT_ID": "your-client-id",
        "OMADA_CLIENT_SECRET": "your-client-secret",
        "OMADA_VERIFY_SSL": "false"
      }
    }
  }
}
```

```json [Installed from a release]
{
  "mcpServers": {
    "omada": {
      "command": "omada-mcp",
      "env": {
        "OMADA_BASE_URL": "https://192.168.0.10:8043",
        "OMADA_CLIENT_ID": "your-client-id",
        "OMADA_CLIENT_SECRET": "your-client-secret",
        "OMADA_VERIFY_SSL": "false"
      }
    }
  }
}
```

:::

For Claude Desktop, the config file is `claude_desktop_config.json` (Settings > Developer > Edit Config). Restart the app after editing it.

## 4. Check the connection

Ask your assistant to run the `omada_status` tool, or just ask "check the Omada connection". You should see `"connection": "ok"` and your Omada ID. If not, see [Troubleshooting](./troubleshooting).

## 5. Try it

Some things to ask:

- "List my Omada sites."
- "Which clients are connected at the Home site, and which use the most traffic?"
- "Show all access points at Office that are offline."
- "Create a guest SSID called Visitors at Home with a password I'll give you."
- "Reboot the switch with MAC AA-BB-CC-DD-EE-FF."

The assistant finds the right operation with `omada_search_operations`, reads its parameters with `omada_describe_operation`, and runs it with `omada_call_operation`. [Tools](./tools) explains how this works.

::: tip Start read-only
Set `OMADA_READ_ONLY=true` while you get a feel for it. Only GET operations are enabled, so nothing can be changed. See [Security](./security).
:::
