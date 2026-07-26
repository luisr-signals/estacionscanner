import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed } from "../_lib/http.js";
import { assertStationMode, getManualProducts, getStationProfile, getSupabaseForToken, StationDataError } from "../_lib/supabase.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "GET") return methodNotAllowed(res);

  const token = getSessionToken(req);
  if (!token) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  try {
    const client = getSupabaseForToken(token);
    const profile = await getStationProfile(client);
    assertStationMode(profile, "scanner");
    const products = await getManualProducts(client, profile);
    return res.status(200).json({ ok: true, products });
  } catch (error) {
    if (error instanceof StationDataError) {
      const statusCode = error.code === "TOKEN_EXPIRED" ? 401 : error.code === "INVALID_ROLE" ? 403 : 409;
      return jsonError(res, statusCode, error.code, error.message, error.code === "SUPABASE_QUERY_FAILED");
    }
    return jsonError(res, 500, "MANUAL_PRODUCTS_FAILED", "No fue posible leer los modelos ajustables.", true);
  }
}
