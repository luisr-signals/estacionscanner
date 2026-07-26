import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed, readString } from "../_lib/http.js";
import {
  getStationProfile,
  getSupabaseForToken,
  saveStationScan,
  schemaMappingMessage,
  StationDataError,
  StationScanError
} from "../_lib/supabase.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const token = getSessionToken(req);
  if (!token) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  const body = (req.body || {}) as Record<string, unknown>;
  const barcode = readString(body.barcode).replace(/\s+/g, "");
  const scanId = readString(body.scanId);
  if (!barcode || !scanId) {
    return jsonError(res, 400, "INVALID_SCAN", "El codigo y el identificador de escaneo son obligatorios.");
  }

  try {
    const client = getSupabaseForToken(token);
    const profile = await getStationProfile(client);
    const saved = await saveStationScan(client, { barcode, scanId, profile });
    return res.status(200).json({ ok: true, ...saved });
  } catch (error) {
    if (error instanceof StationDataError) {
      const statusCode = error.code === "TOKEN_EXPIRED" ? 401 : error.code === "INVALID_ROLE" ? 403 : 409;
      return jsonError(res, statusCode, error.code, error.message, error.code === "SUPABASE_QUERY_FAILED");
    }
    if (error instanceof StationScanError) {
      return jsonError(res, error.status, error.code, error.message, error.retryable);
    }
    if ((error as Error).message === "SCHEMA_MAPPING_REQUIRED") {
      return jsonError(res, 501, "SCHEMA_MAPPING_REQUIRED", schemaMappingMessage());
    }
    return jsonError(res, 500, "SCAN_FAILED", "No fue posible guardar el registro.", true);
  }
}
