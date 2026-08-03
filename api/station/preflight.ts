import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed, readString } from "../_lib/http.js";
import {
  assertStationMode,
  getScannerPreflight,
  getStationProfile,
  getSupabaseForToken,
  resolveProductForScanner,
  StationDataError,
  StationScanError
} from "../_lib/supabase.js";

// Endpoint de diagnóstico (no lo usa la app). Fusiona lo que antes eran dos
// funciones serverless separadas: el preflight completo y la resolución de
// producto (ahora `mode=resolve`, antes /api/station/resolve). Se unieron para
// mantenernos dentro del límite de 12 funciones del plan Hobby de Vercel.
export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res);

  const token = getSessionToken(req);
  if (!token) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  const body = (req.body || {}) as Record<string, unknown>;
  const queryMode = Array.isArray(req.query?.mode) ? req.query?.mode[0] : req.query?.mode;
  const mode = readString(req.method === "GET" ? queryMode : body.mode);
  const queryCode = Array.isArray(req.query?.code) ? req.query?.code[0] : req.query?.code;
  const queryCompare = Array.isArray(req.query?.compare) ? req.query?.compare : req.query?.compare ? [req.query.compare] : [];
  const code = readString(req.method === "GET" ? queryCode : body.code);
  const compareCodes =
    req.method === "GET"
      ? queryCompare.map(readString).filter(Boolean)
      : Array.isArray(body.compareCodes)
        ? body.compareCodes.map(readString).filter(Boolean)
        : [];

  if (!code) return jsonError(res, 400, "PRODUCT_NOT_FOUND", "Codigo no reconocido.");

  try {
    const client = getSupabaseForToken(token);
    const profile = await getStationProfile(client);
    assertStationMode(profile, "scanner");

    // mode=resolve: solo la resolución de producto (lo que hacía /resolve).
    if (mode === "resolve") {
      const resolution = await resolveProductForScanner(client, code);
      return res.status(200).json({ ok: true, ...resolution });
    }

    const preflight = await getScannerPreflight(client, profile, code, compareCodes);
    return res.status(200).json({ ok: true, ...preflight });
  } catch (error) {
    if (error instanceof StationDataError) {
      const statusCode =
        error.code === "TOKEN_EXPIRED" ? 401 : error.code === "INVALID_ROLE" || error.code === "INVALID_STATION_MODE" ? 403 : 409;
      return jsonError(res, statusCode, error.code, error.message, error.code === "SUPABASE_QUERY_FAILED");
    }
    if (error instanceof StationScanError) {
      return jsonError(res, error.status, error.code, error.message, error.retryable);
    }
    return jsonError(res, 500, "SCAN_WRITE_FAILED", "No fue posible validar la estacion.", true);
  }
}
