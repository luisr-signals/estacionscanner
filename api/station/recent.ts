import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed } from "../_lib/http";
import { getRecentScans, getStationProfile, getSupabaseForToken, schemaMappingMessage } from "../_lib/supabase";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "GET") return methodNotAllowed(res);

  const token = getSessionToken(req);
  if (!token) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  try {
    const client = getSupabaseForToken(token);
    const profile = await getStationProfile(client);
    const scans = await getRecentScans(client, profile);
    res.status(200).json({ ok: true, scans });
  } catch (error) {
    if ((error as Error).message === "SCHEMA_MAPPING_REQUIRED") {
      return jsonError(res, 501, "SCHEMA_MAPPING_REQUIRED", schemaMappingMessage());
    }
    return jsonError(res, 500, "RECENT_FAILED", "No fue posible leer registros recientes.", true);
  }
}
