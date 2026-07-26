import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed, readString } from "../_lib/http.js";
import {
  assertStationMode,
  getStationProfile,
  getSupabaseForToken,
  saveManualAdjustment,
  StationDataError,
  StationScanError
} from "../_lib/supabase.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const token = getSessionToken(req);
  if (!token) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  const body = (req.body || {}) as Record<string, unknown>;
  const productId = readString(body.productId);
  const adjustmentId = readString(body.adjustmentId);
  const quantity = body.quantity === -1 ? -1 : body.quantity === 1 ? 1 : null;

  if (!productId || !adjustmentId || quantity == null) {
    return jsonError(res, 400, "INVALID_ADJUSTMENT", "Selecciona accion y producto para ajustar.");
  }

  try {
    const client = getSupabaseForToken(token);
    const profile = await getStationProfile(client);
    assertStationMode(profile, "scanner");
    const saved = await saveManualAdjustment(client, { productId, quantity, adjustmentId, profile });
    return res.status(200).json({ ok: true, ...saved, quantity, adjustedAt: saved.scannedAt });
  } catch (error) {
    if (error instanceof StationDataError) {
      const statusCode = error.code === "TOKEN_EXPIRED" ? 401 : error.code === "INVALID_ROLE" ? 403 : 409;
      return jsonError(res, statusCode, error.code, error.message, error.code === "SUPABASE_QUERY_FAILED");
    }
    if (error instanceof StationScanError) {
      return jsonError(res, error.status, error.code, error.message, error.retryable);
    }
    return jsonError(res, 500, "ADJUSTMENT_FAILED", "No fue posible guardar el ajuste.", true);
  }
}
