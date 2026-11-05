/**
 * Access-token handling for the Omada Open API (OAuth 2.0).
 *
 * - Client-credentials mode (default): POST /openapi/authorize/token?grant_type=client_credentials
 * - Authorization-code mode (when OMADA_USERNAME/OMADA_PASSWORD are set):
 *   /openapi/authorize/login -> /openapi/authorize/code -> /openapi/authorize/token
 * - Refresh: POST /openapi/authorize/token?grant_type=refresh_token
 *
 * Access tokens live ~2h, refresh tokens ~14 days. Tokens are renewed shortly
 * before they expire; if renewal fails the server logs in from scratch.
 */
import type { Config } from "./config.js";
import { OmadaError } from "./errors.js";
import { log } from "./log.js";
import type { OmadaClient, RawResponse } from "./client.js";

interface TokenState {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

const EXPIRY_MARGIN_MS = 60_000;

export class TokenManager {
  private state?: TokenState;
  private inflight?: Promise<string>;

  constructor(
    private readonly cfg: Config,
    private readonly client: OmadaClient,
  ) {}

  get mode(): "client_credentials" | "authorization_code" {
    return this.cfg.username && this.cfg.password ? "authorization_code" : "client_credentials";
  }

  status(): { mode: string; hasToken: boolean; expiresInSeconds?: number } {
    return {
      mode: this.mode,
      hasToken: !!this.state,
      expiresInSeconds: this.state ? Math.max(0, Math.round((this.state.expiresAt - Date.now()) / 1000)) : undefined,
    };
  }

  async getAccessToken(): Promise<string> {
    if (this.state && Date.now() < this.state.expiresAt - EXPIRY_MARGIN_MS) return this.state.accessToken;
    // One token request at a time; concurrent callers share it.
    this.inflight ??= this.obtain().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Mark the access token as expired (keeps the refresh token). */
  invalidate(): void {
    if (this.state) this.state.expiresAt = 0;
  }

  private async obtain(): Promise<string> {
    const { clientId, clientSecret } = this.cfg;
    if (!clientId || !clientSecret) {
      throw new OmadaError(
        "OMADA_CLIENT_ID and OMADA_CLIENT_SECRET are not set. Create an Open API app in the controller (Settings > Platform Integration > Open API) and set them.",
      );
    }
    if (this.state?.refreshToken) {
      try {
        return this.store(await this.refresh(this.state.refreshToken));
      } catch (e) {
        log(`Token refresh failed (${(e as Error).message}); logging in again.`);
      }
    }
    this.state = undefined;
    const result = this.mode === "authorization_code" ? await this.authorizationCode() : await this.clientCredentials();
    return this.store(result);
  }

  private store(t: TokenResult): string {
    this.state = {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? this.state?.refreshToken,
      expiresAt: Date.now() + (t.expiresIn && t.expiresIn > 0 ? t.expiresIn : 7200) * 1000,
    };
    return t.accessToken;
  }

  private async clientCredentials(): Promise<TokenResult> {
    const omadacId = await this.client.getOmadacId();
    return this.tokenCall(
      { grant_type: "client_credentials" },
      { omadacId, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret },
    );
  }

  private async authorizationCode(): Promise<TokenResult> {
    const omadacId = await this.client.getOmadacId();
    const clientId = this.cfg.clientId!;

    const login = await this.post(
      "/openapi/authorize/login",
      { client_id: clientId, omadac_id: omadacId },
      { username: this.cfg.username, password: this.cfg.password },
    );
    const loginResult = this.unwrap(login, "Open API login") as { csrfToken?: string; sessionId?: string };
    if (!loginResult?.csrfToken || !loginResult?.sessionId) {
      throw new OmadaError("Open API login did not return csrfToken/sessionId", undefined, login.status, login.data);
    }

    const codeRes = await this.post(
      "/openapi/authorize/code",
      { client_id: clientId, omadac_id: omadacId, response_type: "code" },
      undefined,
      { "Csrf-Token": loginResult.csrfToken, Cookie: `TPOMADA_SESSIONID=${loginResult.sessionId}` },
    );
    const code = this.unwrap(codeRes, "Authorization code request");
    if (typeof code !== "string" || !code) {
      throw new OmadaError("Authorization code request did not return a code", undefined, codeRes.status, codeRes.data);
    }

    return this.tokenCall(
      { grant_type: "authorization_code", code },
      { client_id: clientId, client_secret: this.cfg.clientSecret },
    );
  }

  private refresh(refreshToken: string): Promise<TokenResult> {
    // The docs show these as query params; the body copy is harmless and
    // matches the written description.
    return this.tokenCall(
      {
        client_id: this.cfg.clientId!,
        client_secret: this.cfg.clientSecret!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      },
      { client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret },
    );
  }

  private async tokenCall(query: Record<string, string>, body: object): Promise<TokenResult> {
    const res = await this.post("/openapi/authorize/token", query, body);
    const result = this.unwrap(res, `Token request (${query.grant_type})`) as TokenResult | undefined;
    if (!result?.accessToken) {
      throw new OmadaError("Token response did not contain an accessToken", undefined, res.status, res.data);
    }
    return result;
  }

  private post(path: string, query: Record<string, string>, body?: object, headers?: Record<string, string>) {
    return this.client.request({
      method: "POST",
      path,
      query: Object.entries(query),
      json: body,
      headers,
      auth: false,
    });
  }

  private unwrap(res: RawResponse, what: string): unknown {
    const data = res.data as { errorCode?: number; msg?: string; result?: unknown } | undefined;
    if (res.status >= 400 || !data || typeof data !== "object" || data.errorCode !== 0) {
      const code = data && typeof data === "object" ? data.errorCode : undefined;
      const msg = data && typeof data === "object" && data.msg ? data.msg : `HTTP ${res.status}`;
      throw new OmadaError(`${what} failed: ${msg}${code !== undefined ? ` (errorCode ${code})` : ""}`, code, res.status, res.data);
    }
    return data.result;
  }
}
