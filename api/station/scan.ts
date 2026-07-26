import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed, readString } from "../_lib/http.js";
import { InMemoryIdempotencyStore } from "../_lib/idempotency.js";
import { getStationProfile, getSupabaseForToken, saveStationScan, SavedScan, schemaMappingMessage } from "../_lib/supabase.js";

const idempotencyStore = new InMemoryIdempotencyStore<SavedScan>();

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
    const previous = idempotencyStore.get(profile.userId, scanId);
    if (previous) {
      return res.status(200).json({ ok: true, duplicate: true, ...previous.result });
    }

    const saved = await saveStationScan(client, { barcode, scanId, profile });
    idempotencyStore.save(profile.userId, scanId, saved);
    return res.status(200).json({ ok: true, duplicate: false, ...saved });
  } catch (error) {
    if ((error as Error).message === "SCHEMA_MAPPING_REQUIRED") {
      return jsonError(res, 501, "SCHEMA_MAPPING_REQUIRED", schemaMappingMessage());
    }
    if ((error as Error).message === "UNKNOWN_BARCODE") {
      return jsonError(res, 404, "UNKNOWN_BARCODE", "Codigo no reconocido.");
    }
    return jsonError(res, 500, "SCAN_FAILED", "No fue posible guardar el registro.", true);
  }
}
