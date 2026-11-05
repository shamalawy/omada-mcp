# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-05

### Added

- MCP server covering every Omada Open API operation (2,450 in the bundled spec), generated from the OpenAPI document.
- Seven meta tools (`omada_search_operations`, `omada_list_tags`, `omada_describe_operation`, `omada_call_operation`, `omada_get_schema`, `omada_request`, `omada_status`) and an optional full mode with one tool per operation.
- Client-credentials and authorization-code authentication, with automatic token refresh and a retry on expired tokens.
- Omada ID discovery, site names in place of site IDs, a default site, and default paging.
- Object query parameter flattening, JSON bodies, and multipart file uploads.
- Read-only mode, tag and operation filters, and the option to remove the raw request tool.
- Live spec loading from the controller, with the bundled spec as a fallback.
- stdio and Streamable HTTP transports (bearer token, DNS-rebinding protection), and a Docker image.
- Documentation site with a generated API reference.

[1.0.0]: https://github.com/shamalawy/omada-mcp/releases/tag/v1.0.0
