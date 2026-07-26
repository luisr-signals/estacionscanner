import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed } from "../_lib/http.js";
import {
  getStationProfile,
  getStationStatus,
  getSupabaseForToken,
  schemaMappingMessage,
  StationDataError
} from "../_lib/supabase.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "GET") return methodNotAllowed(res);

  const token = getSessionToken(req);
  if (!token) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  try {
    const client = getSupabaseForToken(token);
    const profile = await getStationProfile(client);
    const status = await getStationStatus(client, profile);
    res.status(200).json({ ok: true, ...status });
  } catch (error) {
    if (error instanceof StationDataError) {
      const statusCode = error.code === "TOKEN_EXPIRED" ? 401 : error.code === "INVALID_ROLE" ? 403 : 409;
      return jsonError(res, statusCode, error.code, error.message, error.code === "SUPABASE_QUERY_FAILED");
    }
    if ((error as Error).message === "SCHEMA_MAPPING_REQUIRED") {
      return jsonError(res, 501, "SCHEMA_MAPPING_REQUIRED", schemaMappingMessage());
    }
    if ((error as Error).message === "SUPABASE_NOT_CONFIGURED") {
      return jsonError(res, 503, "SUPABASE_NOT_CONFIGURED", "Configura Supabase.", true);
    }
    return jsonError(res, 500, "STATUS_FAILED", "No fue posible leer la estacion.", true);
  }
}
