export type ApiResponse<T> = {
  status: (code: number) => ApiResponse<T>;
  json: (body: T) => void;
  setHeader: (name: string, value: string) => void;
};

export type ApiRequest = {
  method?: string;
  body?: unknown;
  cookies?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
};

export function methodNotAllowed(res: ApiResponse<any>) {
  res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Metodo no permitido" });
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function jsonError(res: ApiResponse<any>, status: number, code: string, message: string, retryable = false) {
  res.status(status).json({ ok: false, code, message, retryable });
}

export function setSessionCookie(res: ApiResponse<any>, accessToken: string) {
  res.setHeader(
    "Set-Cookie",
    "station_session=" +
      encodeURIComponent(accessToken) +
      "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800"
  );
}

export function clearSessionCookie(res: ApiResponse<any>) {
  res.setHeader("Set-Cookie", "station_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
}

export function getSessionToken(req: ApiRequest): string {
  const cookieToken = req.cookies && req.cookies.station_session;
  if (cookieToken) return cookieToken;
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7);
  }
  return "";
}
