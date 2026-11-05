# Contributing

Thanks for helping improve omada-mcp.

## Reporting bugs and asking for features

Open an [issue](https://github.com/shamalawy/omada-mcp/issues). For bugs, include:

- the server version and your controller version (shown in the controller's About page)
- what you asked for, the operation that ran, and the error text
- relevant stderr log lines, **with secrets and IDs removed**

Report security problems privately instead; see [SECURITY.md](SECURITY.md).

## Pull requests

1. Fork the repository and create a branch.
2. Make your change and add a test in `test/server.test.ts` when it changes behaviour.
3. Run the checks:

   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run docs:build   # if you changed the docs
   ```

4. Open a pull request describing what changed and why.

CI runs on every pull request. Workflows from first-time and outside contributors need the maintainer's approval before they run.

Only the maintainer can push to `main` and merge pull requests.

## Updating the API spec

Don't edit `spec/omada-openapi.json` by hand. Run `npm run update-spec`, or let the weekly `spec-update` workflow open a pull request.

## Code style

- TypeScript, strict mode, ES modules.
- Keep error messages short and actionable: say what's wrong and how to fix it.
- Logs go to stderr only (stdout carries the MCP protocol).
