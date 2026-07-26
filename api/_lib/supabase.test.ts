import { describe, expect, it, vi } from "vitest";
import { getRecentScans, saveStationScan, StationProfile } from "./supabase";

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
        availableToRemove: false
      },
      {
        id: "event-1",
        productId: "product-1",
        product: "Tenis - Negro - Talla 27",
        scannedAt: "2026-07-25T23:00:00.000Z",
        quantity: 1,
        status: "saved",
        availableToRemove: false
      }
    ]);
  });
});

function makeClient({ product: activeProduct, rpc }: { product: typeof product | null; rpc: ReturnType<typeof vi.fn> }) {
  return {
    rpc,
    from(table: string) {
      return new FakeQuery(table, activeProduct);
    }
  } as never;
}

class FakeQuery {
  private selected = "";

  constructor(
    private table: string,
    private activeProduct: typeof product | null
  ) {}

  select(columns: string) {
    this.selected = columns;
    return this;
  }

  eq() {
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
    if (this.table === "jornadas") return { data: { id: "journey-1", estado: "activa", banda: 1 }, error: null };
    if (this.table === "produccion_eventos" && this.selected === "jornada_id") {
      return { data: { jornada_id: "journey-1" }, error: null };
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
    resolve({ data: [{ pares: 8 }, { pares: 4 }], error: null });
  }
}
