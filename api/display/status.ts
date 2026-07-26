import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed } from "../_lib/http.js";
import {
  assertStationMode,
  getDisplayStatus,
  getStationProfile,
  getSupabaseForToken,
  StationDataError
} from "../_lib/supabase.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "GET") return methodNotAllowed(res);

  const token = getSessionToken(req);
  if (!token) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  try {
    const client = getSupabaseForToken(token);
    const profile = await getStationProfile(client);
    assertStationMode(profile, "band_display");
    const status = await getDisplayStatus(client, profile);
    return res.status(200).json({ ok: true, ...status });
  } catch (error) {
    if (error instanceof StationDataError) {
      const statusCode = error.code === "TOKEN_EXPIRED" ? 401 : error.code === "INVALID_ROLE" || error.code === "INVALID_STATION_MODE" ? 403 : 409;
      return jsonError(res, statusCode, error.code, error.message, error.code === "SUPABASE_QUERY_FAILED");
    }
    return jsonError(res, 500, "DISPLAY_STATUS_FAILED", "No fue posible leer el tablero.", true);
  }
}
