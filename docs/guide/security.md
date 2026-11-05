# Security

This server can do anything its Open API app is allowed to do, including rebooting devices, changing Wi-Fi passwords, and deleting sites. Limit it in layers.

## 1. Give the app a small role

In the controller, give the Open API app (client-credentials mode) the smallest role and the fewest sites it needs. The controller enforces this whatever the server or the model tries. Operations outside the role fail with `-1005`.

In authorization-code mode, the server has the permissions of the user you log in as. Use a dedicated user with a limited role.

## 2. Use read-only mode when you can

`OMADA_READ_ONLY=true` enables only GET operations. Write operations are hidden from search, `omada_call_operation` refuses them, and `omada_request` only sends GET.

## 3. Limit the operations

Hide whole categories or specific operations:

```bash
OMADA_INCLUDE_TAGS=Site,Device,Client
OMADA_EXCLUDE_OPERATIONS=^(delete|reset|reboot)
OMADA_ALLOW_RAW_REQUEST=false   # the raw tool ignores filters
```

## 4. Keep the client's confirmation prompts on

Tools are annotated as read-only or destructive. MCP clients use this to decide when to ask you before running a tool. Don't auto-approve `omada_call_operation` unless the server is read-only.

## 5. Protect the HTTP transport

- Leave `MCP_HTTP_HOST` at `127.0.0.1` unless you need remote access.
- Set `MCP_HTTP_TOKEN` to a long random value (for example `openssl rand -hex 32`).
- Put TLS in front (a reverse proxy) for anything beyond localhost.

## 6. Keep TLS verification on where possible

`OMADA_VERIFY_SSL=false` is convenient for a self-signed local controller, but it also accepts an attacker's certificate. A better option is to install a certificate the machine trusts on the controller, or add the controller's CA to Node with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` and keep verification on.

## 7. Handle secrets with care

- Don't commit `.env` files. The repository's `.gitignore` already excludes `.env`.
- `omada_status` never shows the client secret or password, and only the first characters of the client ID.
- Rotate the client secret in the controller if you think it has leaked. Editing the app also invalidates existing tokens.

## Reporting a vulnerability

Please report security problems privately. See [SECURITY.md](https://github.com/shamalawy/omada-mcp/blob/main/SECURITY.md).
