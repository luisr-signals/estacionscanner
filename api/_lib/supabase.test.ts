import { describe, expect, it, vi } from "vitest";
import {
  assertStationMode,
  getDisplayStatus,
  getManualProducts,
  getRecentScans,
  getScannerPreflight,
  getStationStatus,
  normalizeScannedCode,
  resolveProductForScanner,
  saveManualAdjustment,
  saveStationScan,
  StationProfile
} from "./supabase";

const profile: StationProfile = {
  userId: "scanner-user",
  operatorName: "Operador 1",
  role: "scanner_operator",
  bandId: 1,
  bandName: "Banda 1",
  stationId: "Estacion 337",
  stationMode: "scanner"
};

const product = {
  id: "product-1",
  codigo_id: "ABC123",
  sku: "ABC",
  cliente_marca: "DinoCore",
  modelo: "Tenis",
  color: "Negro",
  talla: "27",
  estado: "activo"
};

const leadingZeroProduct = {
  ...product,
  id: "product-leading-zero",
  codigo_id: "0888930260",
  modelo: "Etiqueta Dino"
};

describe("station Supabase scanner writes", () => {
  it("keeps leading-zero barcodes as text through catalog resolution", async () => {
    const client = makeClient({ product: leadingZeroProduct, rpc: vi.fn() });

    const resolution = await resolveProductForScanner(client, " 0888930260\r\n");

    expect(normalizeScannedCode(" 0888930260\r\n")).toBe("0888930260");
    expect(resolution).toMatchObject({
      normalizedCode: "0888930260",
      normalizedLength: 10,
      stage: "products.codigo_id",
      product: {
        id: "product-leading-zero",
        code: "0888930260",
        status: "activo"
      }
    });
  });

  it("does not treat a leading-zero barcode and its numeric-looking variant as the same code", async () => {
    const client = makeClient({ product: leadingZeroProduct, rpc: vi.fn() });

    await expect(resolveProductForScanner(client, "0888930260")).resolves.toMatchObject({
      product: { id: "product-leading-zero" }
    });
    await expect(resolveProductForScanner(client, "888930260")).resolves.toMatchObject({
      normalizedCode: "888930260",
      stage: "not_found",
      product: null
    });
  });

  it("classifies inactive catalog matches before writing production", async () => {
    const rpc = vi.fn();
    const client = makeClient({ product: { ...leadingZeroProduct, estado: "inactivo" }, rpc });

    await expect(
      saveStationScan(client, {
        barcode: "0888930260",
        scanId: "10101010-1010-4010-8010-101010101010",
        profile
      })
    ).rejects.toMatchObject({ code: "PRODUCT_INACTIVE", status: 409 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown barcodes before calling the production RPC", async () => {
    const rpc = vi.fn();
    const client = makeClient({ product: null, rpc });

    await expect(
      saveStationScan(client, {
        barcode: "NOPE",
        scanId: "11111111-1111-4111-8111-111111111111",
        profile
      })
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND", status: 404 });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a known barcode through registrar_escaneo_scanner", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          evento_id: "event-1",
          registro_horario_id: "block-1",
          pares_bloque: 8,
          producto_id: "product-1",
          duplicado: false
        }
      ],
      error: null
    });
    const client = makeClient({ product, rpc });

    const saved = await saveStationScan(client, {
      barcode: "ABC123",
      scanId: "22222222-2222-4222-8222-222222222222",
      profile
    });

    expect(rpc).toHaveBeenCalledWith("registrar_escaneo_scanner", {
      p_cliente_uuid: "22222222-2222-4222-8222-222222222222",
      p_codigo: "ABC123"
    });
    expect(saved).toMatchObject({
      productId: "product-1",
      product: "Tenis - Negro - Talla 27",
      hourTotal: 8,
      hourGoal: 10,
      dayTotal: 12,
      duplicate: false
    });
  });

  it("keeps persistent idempotency result from the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          evento_id: "event-1",
          registro_horario_id: "block-1",
          pares_bloque: 8,
          producto_id: "product-1",
          duplicado: true
        }
      ],
      error: null
    });
    const client = makeClient({ product, rpc });

    const saved = await saveStationScan(client, {
      barcode: "ABC123",
      scanId: "33333333-3333-4333-8333-333333333333",
      profile
    });

    expect(saved.duplicate).toBe(true);
    expect(saved.hourTotal).toBe(8);
  });

  it("accepts the RPC result when the secondary event confirmation is unreadable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          evento_id: "event-1",
          registro_horario_id: "block-1",
          pares_bloque: 8,
          producto_id: "product-1",
          duplicado: false
        }
      ],
      error: null
    });
    const client = makeClient({ product, rpc, eventConfirmationError: true });

    const saved = await saveStationScan(client, {
      barcode: "ABC123",
      scanId: "3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      profile
    });

    expect(saved).toMatchObject({
      productId: "product-1",
      product: "Tenis - Negro - Talla 27",
      hourTotal: 8,
      duplicate: false
    });
  });

  it("maps missing scanner RPC separately from generic write failures", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function registrar_escaneo_scanner does not exist" }
    });
    const client = makeClient({ product, rpc });

    await expect(
      saveStationScan(client, {
        barcode: "ABC123",
        scanId: "3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        profile
      })
    ).rejects.toMatchObject({ code: "SCAN_RPC_NOT_FOUND", status: 500 });
  });

  it("maps deployed RPC return type mismatches as signature mismatches", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42804", message: "structure of query does not match function result type" }
    });
    const client = makeClient({ product, rpc });

    await expect(
      saveStationScan(client, {
        barcode: "ABC123",
        scanId: "3ccccccc-cccc-4ccc-8ccc-cccccccccccc",
        profile
      })
    ).rejects.toMatchObject({ code: "SCAN_RPC_SIGNATURE_MISMATCH", status: 500 });
  });

  it("preflights catalog, journey, current block, and RPC contract without writing", async () => {
    const rpc = vi.fn();
    const client = makeClient({ product: leadingZeroProduct, rpc });

    const preflight = await getScannerPreflight(client, profile, "888930260", ["0888930260"], mexicoDateAtHour(9));

    expect(preflight.input).toMatchObject({
      received: "888930260",
      normalizedCode: "888930260",
      normalizedLength: 9
    });
    expect(preflight.catalogChecks).toMatchObject([
      { normalizedCode: "888930260", stage: "not_found", product: null },
      { normalizedCode: "0888930260", stage: "products.codigo_id", product: { code: "0888930260", codeLength: 10 } }
    ]);
    expect(preflight).toMatchObject({
      canonicalCode: null,
      productReady: false,
      journey: { id: "journey-1", bandId: 1, state: "activa" },
      block: { id: "block-1", status: "active", timezone: "America/Mexico_City" },
      rpc: { name: "registrar_escaneo_scanner", executionCheck: "not_executed_read_only" },
      expectedStatus: "PRODUCT_NOT_FOUND"
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows the same barcode when each physical read has a different scan id", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          evento_id: "event-1",
          registro_horario_id: "block-1",
          pares_bloque: 8,
          producto_id: "product-1",
          duplicado: false
        }
      ],
      error: null
    });
    const client = makeClient({ product, rpc });

    await saveStationScan(client, {
      barcode: "ABC123",
      scanId: "44444444-4444-4444-8444-444444444444",
      profile
    });
    await saveStationScan(client, {
      barcode: "ABC123",
      scanId: "55555555-5555-4555-8555-555555555555",
      profile
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_cliente_uuid).not.toEqual(rpc.mock.calls[1][1].p_cliente_uuid);
  });

  it("maps an unavailable journey rejection from the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "No hay jornada activa para esta banda" }
    });
    const client = makeClient({ product, rpc });

    await expect(
      saveStationScan(client, {
        barcode: "ABC123",
        scanId: "66666666-6666-4666-8666-666666666666",
        profile
      })
    ).rejects.toMatchObject({ code: "SHIFT_INACTIVE", status: 409 });
  });

  it("returns recent scans from the active authorized journey", async () => {
    const client = makeClient({ product, rpc: vi.fn() });

    const scans = await getRecentScans(client, profile);

    expect(scans).toEqual([
      {
        id: "event-2",
        productId: "product-1",
        product: "Tenis - Negro - Talla 27",
        scannedAt: "2026-07-25T23:01:00.000Z",
        quantity: 1,
        status: "saved",
        availableToRemove: true
      },
      {
        id: "event-1",
        productId: "product-1",
        product: "Tenis - Negro - Talla 27",
        scannedAt: "2026-07-25T23:00:00.000Z",
        quantity: 1,
        status: "saved",
        availableToRemove: true
      }
    ]);
  });
});

describe("station operational status", () => {
  it("marks the scanner ready only when the current hour is inside a real block", async () => {
    const client = makeClient({ product, rpc: vi.fn() });

    const status = await getStationStatus(client, profile, mexicoDateAtHour(9));

    expect(status).toMatchObject({
      shiftStatus: "active",
      blockStatus: "active",
      scannerStatus: "ready",
      statusTitle: "Escaner listo",
      hourTotal: 8
    });
  });

  it("separates active journey from break time", async () => {
    const client = makeClient({
      product,
      rpc: vi.fn(),
      registros: [
        { id: "block-1", pares: 8, hora_inicio_bloque: 8, duracion: 2 },
        { id: "block-2", pares: 4, hora_inicio_bloque: 11, duracion: 2 }
      ]
    });

    const status = await getStationStatus(client, profile, mexicoDateAtHour(10.75));

    expect(status).toMatchObject({
      shiftStatus: "active",
      blockStatus: "break",
      scannerStatus: "paused",
      statusTitle: "Horario de descanso",
      hourTotal: 0
    });
  });

  it("disables production outside schedule even if the journey is active", async () => {
    const client = makeClient({
      product,
      rpc: vi.fn(),
      registros: [
        { id: "block-1", pares: 8, hora_inicio_bloque: 8, duracion: 2 },
        { id: "block-2", pares: 4, hora_inicio_bloque: 11, duracion: 2 }
      ]
    });

    const status = await getStationStatus(client, profile, mexicoDateAtHour(23.75));

    expect(status).toMatchObject({
      shiftStatus: "active",
      blockStatus: "outside_schedule",
      scannerStatus: "paused",
      statusTitle: "Fuera del horario de produccion",
      hourTotal: 0
    });
  });

  it("reports closed journeys without keeping the scanner enabled", async () => {
    const client = makeClient({ product, rpc: vi.fn(), jornada: { estado: "cerrada" } });

    const status = await getStationStatus(client, profile, mexicoDateAtHour(9));

    expect(status).toMatchObject({
      shiftStatus: "closed",
      blockStatus: "missing",
      scannerStatus: "disabled"
    });
  });
});

describe("station display mode", () => {
  it("keeps scanner writes restricted to scanner mode", () => {
    expect(() => assertStationMode(profile, "scanner")).not.toThrow();
    expect(() => assertStationMode({ ...profile, stationMode: "band_display" }, "scanner")).toThrow(
      "Esta cuenta no puede escribir en el scanner."
    );
  });

  it("calculates display totals from the current block and operating day", async () => {
    const displayProfile = { ...profile, stationMode: "band_display" as const };
    const client = makeClient({
      product,
      rpc: vi.fn(),
      jornada: { meta_por_hora: 71 },
      registros: [
        { id: "block-1", pares: 35, hora_inicio_bloque: 8, duracion: 1, orden: 1 },
        { id: "block-2", pares: 9, hora_inicio_bloque: 9, duracion: 1, orden: 2 },
        { id: "block-3", pares: 0, hora_inicio_bloque: 11, duracion: 1, orden: 3 }
      ]
    });

    const status = await getDisplayStatus(client, displayProfile, mexicoDateAtHour(9.5));

    expect(status).toMatchObject({
      bandName: "Banda 1",
      shiftStatus: "active",
      blockStatus: "active",
      hourTotal: 9,
      hourGoal: 71,
      hourRemaining: 62,
      dayTotal: 44,
      dayGoal: 213,
      expectedTotal: 107,
      delay: 63,
      ahead: 0,
      productiveSecondsRemaining: 5400,
      currentAveragePerMinute: 0.49,
      idealAveragePerMinute: 1.88,
      projectedResult: 88,
      projectedCompliance: 41,
      paceStatus: "behind"
    });
  });

  it("keeps daily display totals visible during break time", async () => {
    const displayProfile = { ...profile, stationMode: "band_display" as const };
    const client = makeClient({
      product,
      rpc: vi.fn(),
      jornada: { meta_por_hora: 50 },
      registros: [
        { id: "block-1", pares: 50, hora_inicio_bloque: 8, duracion: 1, orden: 1 },
        { id: "block-2", pares: 0, hora_inicio_bloque: 11, duracion: 1, orden: 2 }
      ]
    });

    const status = await getDisplayStatus(client, displayProfile, mexicoDateAtHour(10));

    expect(status).toMatchObject({
      blockStatus: "break",
      hourTotal: 0,
      hourGoal: null,
      dayTotal: 50,
      dayGoal: 100,
      productiveSecondsRemaining: 3600,
      currentAveragePerMinute: 0.83,
      idealAveragePerMinute: 0.83,
      projectedResult: 100,
      projectedCompliance: 100
    });
    expect(status.nextBlockStartsAt).toContain("T11:00:00-06:00");
  });
});

describe("station manual adjustments", () => {
  it("groups manual products from the active journey", async () => {
    const client = makeClient({ product, rpc: vi.fn(), duplicateManualEvents: true });

    const products = await getManualProducts(client, profile);

    expect(products).toEqual([
      {
        productId: "product-1",
        product: "Tenis - Negro - Talla 27",
        count: 2,
        availableToRemove: true
      }
    ]);
  });

  it("returns an empty manual product list when the journey has no active events", async () => {
    const client = makeClient({ product, rpc: vi.fn(), manualEvents: [] });

    await expect(getManualProducts(client, profile)).resolves.toEqual([]);
  });

  it("records a +1 manual adjustment through registrar_ajuste_scanner", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          correccion_id: "correction-1",
          evento_id: "event-manual-1",
          registro_horario_id: "block-1",
          pares_bloque: 9,
          producto_id: "product-1",
          cantidad: 1,
          duplicado: false
        }
      ],
      error: null
    });
    const client = makeClient({ product, rpc });

    const saved = await saveManualAdjustment(client, {
      productId: "product-1",
      quantity: 1,
      adjustmentId: "77777777-7777-4777-8777-777777777777",
      profile
    });

    expect(rpc).toHaveBeenCalledWith("registrar_ajuste_scanner", {
      p_ajuste_uuid: "77777777-7777-4777-8777-777777777777",
      p_producto_id: "product-1",
      p_cantidad: 1
    });
    expect(saved).toMatchObject({
      productId: "product-1",
      product: "Tenis - Negro - Talla 27",
      hourTotal: 8,
      dayTotal: 12,
      duplicate: false
    });
  });

  it("records a -1 manual adjustment without local totals", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          correccion_id: "correction-2",
          evento_id: "event-2",
          registro_horario_id: "block-1",
          pares_bloque: 7,
          producto_id: "product-1",
          cantidad: -1,
          duplicado: false
        }
      ],
      error: null
    });
    const client = makeClient({ product, rpc });

    const saved = await saveManualAdjustment(client, {
      productId: "product-1",
      quantity: -1,
      adjustmentId: "88888888-8888-4888-8888-888888888888",
      profile
    });

    expect(saved.product).toBe("Tenis - Negro - Talla 27");
    expect(saved.hourTotal).toBe(8);
    expect(saved.dayTotal).toBe(12);
  });

  it("keeps duplicate manual adjustment state from the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          correccion_id: "correction-3",
          evento_id: "event-manual-3",
          registro_horario_id: "block-1",
          pares_bloque: 9,
          producto_id: "product-1",
          cantidad: 1,
          duplicado: true
        }
      ],
      error: null
    });
    const client = makeClient({ product, rpc });

    const saved = await saveManualAdjustment(client, {
      productId: "product-1",
      quantity: 1,
      adjustmentId: "99999999-9999-4999-8999-999999999999",
      profile
    });

    expect(saved.duplicate).toBe(true);
  });

  it("rejects product ids that were not worked in the active journey", async () => {
    const rpc = vi.fn();
    const client = makeClient({ product, rpc, manualEvents: [] });

    await expect(
      saveManualAdjustment(client, {
        productId: "other-product",
        quantity: 1,
        adjustmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        profile
      })
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_WORKED", status: 409 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

function makeClient({
  product: activeProduct,
  rpc,
  manualEvents,
  duplicateManualEvents = false,
  jornada,
  registros,
  eventConfirmationError = false
}: {
  product: typeof product | null;
  rpc: ReturnType<typeof vi.fn>;
  manualEvents?: unknown[];
  duplicateManualEvents?: boolean;
  jornada?: Partial<{ id: string; estado: "activa" | "cerrada"; banda: 1; meta_por_hora: number; hora_inicio: number; hora_fin_efectiva: number }>;
  registros?: unknown[];
  eventConfirmationError?: boolean;
}) {
  return {
    rpc,
    from(table: string) {
      return new FakeQuery(table, activeProduct, manualEvents, duplicateManualEvents, jornada, registros, eventConfirmationError);
    }
  } as never;
}

class FakeQuery {
  private selected = "";
  private filters = new Map<string, unknown>();

  constructor(
    private table: string,
    private activeProduct: typeof product | null,
    private manualEvents?: unknown[],
    private duplicateManualEvents = false,
    private jornada?: Partial<{ id: string; estado: "activa" | "cerrada"; banda: 1; meta_por_hora: number; hora_inicio: number; hora_fin_efectiva: number }>,
    private registros?: unknown[],
    private eventConfirmationError = false
  ) {}

  select(columns: string) {
    this.selected = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.set(column, value);
    return this;
  }

  not() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle() {
    if (this.table === "productos") {
      const requestedCode = this.filters.get("codigo_id");
      const requestedSku = this.filters.get("sku");
      const requestedStatus = this.filters.get("estado");
      const codeMatches = requestedCode == null || this.activeProduct?.codigo_id === requestedCode;
      const skuMatches = requestedSku == null || this.activeProduct?.sku === requestedSku;
      const statusMatches = requestedStatus == null || this.activeProduct?.estado === requestedStatus;
      return { data: this.activeProduct && codeMatches && skuMatches && statusMatches ? this.activeProduct : null, error: null };
    }
    if (this.table === "productos_codigos_alias") return { data: null, error: null };
    if (this.table === "jornadas") {
      return {
        data: {
          id: "journey-1",
          estado: "activa",
          banda: 1,
          meta_por_hora: 10,
          hora_inicio: 8,
          hora_fin_efectiva: 17,
          ...this.jornada
        },
        error: null
      };
    }
    if (this.table === "produccion_eventos" && this.selected === "jornada_id") {
      return { data: { jornada_id: "journey-1" }, error: null };
    }
    if (this.table === "produccion_eventos" && this.selected.startsWith("producto_id")) {
      const event = this.manualEventRows()[0] ?? null;
      return { data: event, error: null };
    }
    if (this.table === "correcciones_produccion") {
      return { data: { created_at: "2026-07-25T23:02:00.000Z" }, error: null };
    }
    if (this.table === "produccion_eventos") {
      if (this.eventConfirmationError) {
        return { data: null, error: { code: "42501", message: "permission denied for table produccion_eventos" } };
      }
      return {
        data: {
          id: "event-1",
          codigo: "ABC123",
          hora_registro: "2026-07-25T23:00:00.000Z",
          hora_local: "2026-07-25T17:00:00",
          producto_id: "product-1",
          cantidad: 1,
          estado: "activo",
          productos: this.activeProduct
        },
        error: null
      };
    }
    if (this.table === "registros_horarios") {
      return { data: { duracion: 1, jornadas: { meta_por_hora: 10 } }, error: null };
    }
    return { data: null, error: null };
  }

  async then(resolve: (value: { data: unknown[]; error: null }) => void) {
    if (this.table === "produccion_eventos") {
      if (this.selected.startsWith("id,producto_id")) {
        resolve({ data: this.manualEventRows(), error: null });
        return;
      }
      resolve({
        data: [
          {
            id: "event-2",
            codigo: "ABC123",
            hora_registro: "2026-07-25T23:01:00.000Z",
            hora_local: "2026-07-25T17:01:00",
            producto_id: "product-1",
            cantidad: 1,
            estado: "activo",
            productos: this.activeProduct
          },
          {
            id: "event-1",
            codigo: "ABC123",
            hora_registro: "2026-07-25T23:00:00.000Z",
            hora_local: "2026-07-25T17:00:00",
            producto_id: "product-1",
            cantidad: 1,
            estado: "activo",
            productos: this.activeProduct
          }
        ],
        error: null
      });
      return;
    }
    resolve({ data: this.registros ?? defaultRegistros(), error: null });
  }

  private manualEventRows() {
    if (this.manualEvents) return this.manualEvents;
    const rows = [
      {
        id: "event-1",
        producto_id: "product-1",
        estado: "activo",
        productos: this.activeProduct
      }
    ];
    if (this.duplicateManualEvents) rows.push({ ...rows[0], id: "event-duplicate" });
    return rows;
  }
}

function defaultRegistros() {
  return [
    { id: "block-1", pares: 8, hora_inicio_bloque: 0, duracion: 24 },
    { id: "block-2", pares: 4, hora_inicio_bloque: 25, duracion: 1 }
  ];
}

function mexicoDateAtHour(hour: number) {
  const wholeHour = Math.floor(hour);
  const minutes = Math.round((hour - wholeHour) * 60);
  return new Date(Date.UTC(2026, 6, 25, wholeHour + 6, minutes, 0));
}
