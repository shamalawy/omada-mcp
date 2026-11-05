# Development

## Setup

```bash
git clone https://github.com/shamalawy/omada-mcp.git
cd omada-mcp
npm ci
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the server from source with `tsx` |
| `npm run build` | Compile to `dist/` |
| `npm test` | Run the tests against a mock controller |
| `npm run typecheck` | Type-check source, tests and scripts |
| `npm run update-spec` | Refresh `spec/omada-openapi.json` from TP-Link's cloud (or pass your controller's URL) |
| `npm run docs:dev` | Generate the API reference and serve the docs locally |
| `npm run docs:build` | Build the docs site to `docs/.vitepress/dist` |

## Project layout

```text
src/
  index.ts      entry point: config, spec loading, transport
  config.ts     environment variables
  spec.ts       OpenAPI loading, the operation index and search
  schema.ts     $ref resolution into self-contained JSON Schema
  auth.ts       OAuth token handling (both modes, refresh, retry)
  client.ts     HTTP client: TLS, timeouts, Omada ID, site names
  executor.ts   runs one operation: params, query, body, uploads, replies
  tools.ts      MCP tool definitions (meta tools and full mode)
  server.ts     MCP server wiring
  http.ts       Streamable HTTP transport
spec/
  omada-openapi.json   bundled Omada Open API spec
scripts/
  update-spec.ts       refresh the bundled spec
  gen-docs.ts          generate docs/reference/ from the spec
test/
  mock-controller.ts   fake Omada controller
  server.test.ts       end-to-end tests through an MCP client
docs/                  this site (VitePress)
```

## How it works

1. **Spec.** At startup the server loads the OpenAPI document: from the controller (`/v3/api-docs/00 All`, then the group list, then `/v3/api-docs`), or the bundled copy. Each operation is indexed with its parameters, body and search keywords. Path parameters come from the URL template, because the spec sometimes leaves them out of its parameter lists.
2. **Tools.** `tools.ts` builds the seven meta tools and, in full mode, one tool per operation. Each tool's input schema has every `$ref` inlined, with recursion and depth limits.
3. **Calls.** `executor.ts` fills in IDs, resolves site names, sorts parameters into path and query, flattens object query parameters, encodes JSON or multipart bodies, and formats the reply.
4. **Auth.** `auth.ts` gets and refreshes tokens. `client.ts` attaches them and retries once on token errors.

## Tests

`npm test` runs end-to-end tests: a real MCP client talks to the server, which talks to a fake controller (`test/mock-controller.ts`). The tests cover both login modes, token refresh, site names, query flattening, uploads, read-only mode, filters, full mode and the HTTP transport.

When you add a feature, add a test there.

## Continuous integration

GitHub Actions workflows in `.github/workflows/`:

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` | Every push to `main` and every pull request | Type-check, test and build on Node 20, 22 and 24. Build the docs. Build the Docker image and check its health endpoint. |
| `docs.yml` | Push to `main` | Build and publish this site to GitHub Pages |
| `release.yml` | Tag `v*` | Test, create a GitHub release with the npm package attached, and push a multi-arch image to GHCR |
| `spec-update.yml` | Weekly, or by hand | Fetch TP-Link's latest spec and open a pull request if it changed |

Dependabot keeps npm packages, GitHub Actions and the Docker base image up to date.

## Releasing

Maintainer only:

1. Update `version` in `package.json` and `src/version.ts`, and add an entry to `CHANGELOG.md`.
2. Commit, then tag and push:

   ```bash
   git tag v1.1.0
   git push origin main v1.1.0
   ```

3. The `release` workflow checks that the tag matches `package.json`, runs the tests, creates the GitHub release, and publishes `ghcr.io/shamalawy/omada-mcp:1.1.0` and `:latest`.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](https://github.com/shamalawy/omada-mcp/blob/main/CONTRIBUTING.md). Only the maintainer can push to `main` and merge pull requests.
