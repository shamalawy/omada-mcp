export class OmadaError extends Error {
  constructor(
    message: string,
    readonly errorCode?: number,
    readonly httpStatus?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "OmadaError";
  }
}

/** errorCodes that mean "get a new access token and try again". */
export const TOKEN_ERROR_CODES = new Set([-44112, -44113]);

/** Plain-language hints for well-known Omada error codes. */
export const ERROR_HINTS: Record<number, string> = {
  [-1005]:
    "Operation forbidden: the Open API app does not have permission for this. Check the app's role and privileges under Settings > Platform Integration > Open API.",
  [-1505]: "The app (or user) has no access to this site.",
  [-44106]: "The client ID or client secret is wrong (OMADA_CLIENT_ID / OMADA_CLIENT_SECRET).",
  [-44108]: "CSRF token rejected during authorization-code login.",
  [-44109]: "Session rejected during authorization-code login.",
  [-44110]: "The authorization code expired before it was used. Try again.",
  [-44111]: "Grant type not allowed for this app. Check the app's mode (client credentials vs authorization code).",
  [-44112]: "Access token expired and could not be renewed.",
  [-44113]: "Access token rejected. If the app's permissions changed, the old token is no longer valid.",
  [-44114]: "Refresh token expired; the server will log in again on the next call.",
  [-44116]: "Authorization failed: check OMADA_ID, OMADA_CLIENT_ID and OMADA_CLIENT_SECRET.",
  [-44118]:
    "This operation only works in authorization-code mode. Set OMADA_USERNAME and OMADA_PASSWORD (and use an authorization-code app).",
  [-44119]: "This operation is for Omada Pro controllers only.",
};
