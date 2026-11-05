# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report them privately through GitHub: go to the repository's **Security** tab and click **Report a vulnerability** ([direct link](https://github.com/shamalawy/omada-mcp/security/advisories/new)).

Please include what you found, how to reproduce it, and the impact. You'll get a reply as soon as possible, and credit in the advisory if you want it.

## Supported versions

Security fixes go into the latest release.

## Scope

In scope: this server's code, its Docker image, and its GitHub workflows. For example, bypassing read-only mode or filters, leaking credentials, or unauthenticated access to the HTTP transport.

Out of scope: vulnerabilities in the Omada controller or the Omada Open API itself. Report those to TP-Link.

## Hardening

See the [security guide](https://shamalawy.github.io/omada-mcp/guide/security) for how to run the server safely.
