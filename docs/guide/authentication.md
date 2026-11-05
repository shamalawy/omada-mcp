# Authentication

The Omada Open API uses OAuth 2.0. You create an app in the controller, and the server exchanges its credentials for an access token. You never handle tokens yourself.

## Which mode to use

| | Client credentials | Authorization code |
| --- | --- | --- |
| Acts as | The app itself | A controller user |
| Permissions | The role and sites you give the app | Whatever that user can do |
| Needs | Client ID and secret | Client ID and secret, plus username and password |
| Best for | Most setups | The few operations that only work in this mode (error `-44118`) |

Use **client credentials** unless you hit `-44118`.

## Client-credentials mode

Set `OMADA_CLIENT_ID` and `OMADA_CLIENT_SECRET`, and leave `OMADA_USERNAME` and `OMADA_PASSWORD` empty. The server calls:

```text
POST /openapi/authorize/token?grant_type=client_credentials
{ "omadacId": "...", "client_id": "...", "client_secret": "..." }
```

## Authorization-code mode

Also set `OMADA_USERNAME` and `OMADA_PASSWORD`, and use an app created in Authorization Code mode. The server logs in, gets a short-lived authorization code, and exchanges it for a token:

```text
POST /openapi/authorize/login?client_id=...&omadac_id=...      { "username", "password" }
POST /openapi/authorize/code?client_id=...&omadac_id=...&response_type=code
     (with the Csrf-Token header and TPOMADA_SESSIONID cookie from the login)
POST /openapi/authorize/token?grant_type=authorization_code&code=...   { "client_id", "client_secret" }
```

Consider a dedicated controller user with only the rights the assistant needs.

## Token lifetime

- Access tokens last about **2 hours** and refresh tokens about **14 days**.
- The server renews the access token a minute before it expires, using the refresh token.
- If a call reports an expired or invalid token (`-44112`, `-44113`, or HTTP 401), the server gets a new token and retries the call once.
- If refreshing fails, for example because the refresh token expired, the server logs in again from scratch.

The controller also drops tokens when the app is changed or deleted, when its permissions change, or when sites are copied or imported. The server recovers from this automatically on the next call.

## The Omada ID

Every call includes the controller's Omada ID (`omadacId`). On a local controller, the server reads it from `GET /api/info` if `OMADA_ID` is empty. For Cloud-Based Controller, set `OMADA_ID` to the value shown on the app.

## MSP mode

For an app created in the MSP view:

- Set `OMADA_ID` to the **MSP ID**. It's used to log in and is filled in for `{mspId}` and `{omadacId}`.
- MSP operations (paths under `/openapi/v1/msp/{mspId}/...`) work as they are.
- To work inside one customer, pass that customer's ID as `omadacId` in `params`.
