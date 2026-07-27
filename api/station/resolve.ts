import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed, readString } from "../_lib/http.js";
import {
  assertStationMode,
  getStationProfile,
  getSupabaseForToken,
  resolveProductForScanner,
  StationDataError,
  StationScanError
} from "../_lib/supabase.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "POST" && req.method !== "GET") return methodNotAllowed(res);

  const token = getSessionToken(req);
  if (!token) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  const body = (req.body || {}) as Record<string, unknown>;
  const queryCode = Array.isArray(req.query?.code) ? req.query?.code[0] : req.query?.code;
  const code = readString(req.method === "GET" ? queryCode : body.code);
  if (!code) return jsonError(res, 400, "PRODUCT_NOT_FOUND", "Codigo no reconocido.");

  try {
    const client = getSupabaseForToken(token);
    const profile = await getStationProfile(client);
    assertStationMode(profile, "scanner");
    const resolution = await resolveProductForScanner(client, code);
    return res.status(200).json({ ok: true, ...resolution });
  } catch (error) {
    if (error instanceof StationDataError) {
      const statusCode = error.code === "TOKEN_EXPIRED" ? 401 : error.code === "INVALID_ROLE" || error.code === "INVALID_STATION_MODE" ? 403 : 409;
      return jsonError(res, statusCode, error.code, error.message, error.code === "SUPABASE_QUERY_FAILED");
    }
    if (error instanceof StationScanError) {
      return jsonError(res, error.status, error.code, error.message, error.retryable);
    }
    return jsonError(res, 500, "SCAN_WRITE_FAILED", "No fue posible validar el codigo.", true);
  }
}
