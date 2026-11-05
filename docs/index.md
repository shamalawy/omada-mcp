---
layout: home

hero:
  name: omada-mcp
  text: Your whole Omada network, available to your AI assistant
  tagline: An MCP server that exposes every TP-Link Omada Open API operation (2,450 and counting), generated from the controller's own OpenAPI spec.
  image:
    src: /logo.svg
    alt: omada-mcp
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: How the tools work
      link: /guide/tools
    - theme: alt
      text: API reference
      link: /reference/

features:
  - title: Every operation
    details: Sites, devices, clients, wireless, switching, gateways, VPN, firewall, hotspot, MSP and more. Tools are built from the spec, not hand-written, so nothing is left out.
  - title: Works with any MCP client
    details: Seven small tools let the model search, inspect and call any operation without loading thousands of tool definitions. A full one-tool-per-operation mode is there if you want it.
  - title: Login handled for you
    details: Client-credentials and authorization-code modes, automatic token refresh, and a retry when a token expires.
  - title: Speaks your language
    details: Use site names instead of IDs. The Omada ID is filled in for you, and list calls are paged automatically.
  - title: Safe by default
    details: Read-only mode, category and operation filters, TLS verification, and bearer-token auth for the HTTP transport.
  - title: Run it anywhere
    details: stdio for desktop clients, Streamable HTTP for remote use, and a multi-arch Docker image.
---
