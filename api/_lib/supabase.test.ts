import { describe, expect, it, vi } from "vitest";
import {
  getManualProducts,
  getRecentScans,
  getStationStatus,
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
  stationId: "Estacion 337"
};

const product = {
  id: "product-1",
  codigo_id: "ABC123",
  cliente_marca: "DinoCore",
  modelo: "Tenis",
  color: "Negro",
  talla: "27",
  estado: "activo"
};

describe("station Supabase scanner writes", () => {
  it("rejects unknown barcodes before calling the production RPC", async () => {
    const rpc = vi.fn();
    const client = makeClient({ product: null, rpc });

    await expect(
      saveStationScan(client, {
        barcode: "NOPE",
        scanId: "11111111-1111-4111-8111-111111111111",
        profile
      })
    ).rejects.toMatchObject({ code: "UNKNOWN_BARCODE", status: 404 });

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
  registros
}: {
  product: typeof product | null;
  rpc: ReturnType<typeof vi.fn>;
  manualEvents?: unknown[];
  duplicateManualEvents?: boolean;
  jornada?: Partial<{ id: string; estado: "activa" | "cerrada"; banda: 1; meta_por_hora: number; hora_inicio: number; hora_fin_efectiva: number }>;
  registros?: unknown[];
}) {
  return {
    rpc,
    from(table: string) {
      return new FakeQuery(table, activeProduct, manualEvents, duplicateManualEvents, jornada, registros);
    }
  } as never;
}

class FakeQuery {
  private selected = "";

  constructor(
    private table: string,
    private activeProduct: typeof product | null,
    private manualEvents?: unknown[],
    private duplicateManualEvents = false,
    private jornada?: Partial<{ id: string; estado: "activa" | "cerrada"; banda: 1; meta_por_hora: number; hora_inicio: number; hora_fin_efectiva: number }>,
    private registros?: unknown[]
  ) {}

  select(columns: string) {
    this.selected = columns;
    return this;
  }

  eq() {
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
    if (this.table === "productos") return { data: this.activeProduct, error: null };
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
