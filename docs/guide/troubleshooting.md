# Troubleshooting

Start with the `omada_status` tool. It shows the configuration (without secrets), which spec was loaded, and whether the server can get an access token.

The server logs to **stderr**. In Claude Desktop, logs are under Settings > Developer. For Claude Code, run `claude --debug`.

## Common problems

### "self-signed certificate" or "unable to verify"

The controller uses a certificate Node doesn't trust. Either set `OMADA_VERIFY_SSL=false`, or keep verification on and trust the CA with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

### "Cannot reach …: ECONNREFUSED / ENOTFOUND / ETIMEDOUT"

Check `OMADA_BASE_URL`. Use the app's **Interface Access Address**, including the port (local controllers usually use `8043`), and make sure the machine running the server can reach it.

### "OMADA_ID is not set and could not be read"

Set `OMADA_ID` to the Omada ID shown on the app. This is always needed for Cloud-Based Controller.

### "The client id or client secret is wrong" (-44106) or "Authorization failed" (-44116)

Re-copy the client ID and secret from the app, and check `OMADA_ID`. If you use username and password, check that the app was created in Authorization Code mode.

### "Operation forbidden" (-1005)

The app's role doesn't allow this action, or the app can't access the site. Edit the app's role or site access in the controller.

### "only works in authorization-code mode" (-44118)

This operation can't be used in client-credentials mode. Create an Authorization Code app and set `OMADA_USERNAME` and `OMADA_PASSWORD`.

### "Unknown operationId"

The operation isn't in the loaded spec, or the name is misspelled. The error suggests close matches. Use `omada_search_operations` to find the right name.

### "exists but is disabled by this server's configuration"

A filter or read-only mode hides it. Check `OMADA_READ_ONLY`, `OMADA_INCLUDE_TAGS`, `OMADA_EXCLUDE_TAGS`, `OMADA_INCLUDE_OPERATIONS`, `OMADA_EXCLUDE_OPERATIONS` and `OMADA_EXCLUDE_DEPRECATED`.

### "No site named …"

Site names are matched exactly (ignoring case). The error lists the sites the app can see.

### "Live spec unavailable … using the bundled spec"

The controller didn't serve its OpenAPI document. Everything still works with the bundled spec. Set `OMADA_SPEC=bundled` to skip the attempt.

### The reply ends with "truncated"

The result was larger than `OMADA_MAX_RESPONSE_CHARS`. Ask for smaller pages (`pageSize`), or use `searchKey` or filters.

### The client lists no tools, or times out at startup

Make sure the path to `dist/index.js` is right and that you ran `npm run build`. Run the server by hand to see errors:

```bash
OMADA_BASE_URL=... OMADA_CLIENT_ID=... OMADA_CLIENT_SECRET=... node dist/index.js
```

It should print `Ready on stdio.` and `Loaded 2450 operations` to stderr.

## Error codes

Generic codes the controller can return in `errorCode`:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `-1005` | Operation forbidden (app role or permissions) |
| `-1505` | No access to this site |
| `-44106` | Client ID or client secret invalid |
| `-44107` | Response type invalid |
| `-44108` | CSRF token invalid (authorization-code login) |
| `-44109` | Session ID invalid (authorization-code login) |
| `-44110` | Authorization code expired |
| `-44111` | Grant type invalid for this app |
| `-44112` | Access token expired (the server refreshes and retries) |
| `-44113` | Access token invalid (the server gets a new one and retries) |
| `-44114` | Refresh token expired (the server logs in again) |
| `-44116` | Open API authorization failed: check the parameters |
| `-44118` | Only supported in authorization-code mode |
| `-44119` | Only for Omada Pro controllers |

HTTP status codes: `400` bad request, `401` unauthorized, `403` forbidden, `413`/`417` request too large, `429` rate limit exceeded, `500` controller error.

Operation-specific error codes are listed under each operation in the [API reference](/reference/).
