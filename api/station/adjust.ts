import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed, readString } from "../_lib/http";
import { InMemoryIdempotencyStore } from "../_lib/idempotency";
import {
  getStationProfile,
  getSupabaseForToken,
  saveManualAdjustment,
  SavedScan,
  schemaMappingMessage
} from "../_lib/supabase";

const adjustmentStore = new InMemoryIdempotencyStore<SavedScan>();

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
    const previous = adjustmentStore.get(profile.userId, adjustmentId);
    if (previous) {
      return res.status(200).json({ ok: true, duplicate: true, quantity, adjustedAt: previous.result.scannedAt, ...previous.result });
    }

    const saved = await saveManualAdjustment(client, { productId, quantity, adjustmentId, profile });
    adjustmentStore.save(profile.userId, adjustmentId, saved);
    return res.status(200).json({ ok: true, duplicate: false, quantity, adjustedAt: saved.scannedAt, ...saved });
  } catch (error) {
    if ((error as Error).message === "SCHEMA_MAPPING_REQUIRED") {
      return jsonError(res, 501, "SCHEMA_MAPPING_REQUIRED", schemaMappingMessage());
    }
    if ((error as Error).message === "REMOVE_NOT_AVAILABLE") {
      return jsonError(res, 409, "REMOVE_NOT_AVAILABLE", "No hay pares disponibles para quitar.");
    }
    if ((error as Error).message === "SHIFT_INACTIVE") {
      return jsonError(res, 409, "SHIFT_INACTIVE", "No hay jornada activa.");
    }
    return jsonError(res, 500, "ADJUSTMENT_FAILED", "No fue posible guardar el ajuste.", true);
  }
}
