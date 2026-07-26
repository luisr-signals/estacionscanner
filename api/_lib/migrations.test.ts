import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration0030 = readFileSync(
  join(process.cwd(), "supabase/migrations/0030_fix_scanner_manual_adjustments.sql"),
  "utf8"
);

describe("scanner manual adjustment migration 0030", () => {
  it("replaces the existing RPC without changing the argument signature", () => {
    expect(migration0030).toContain("create or replace function public.registrar_ajuste_scanner");
    expect(migration0030).toContain("p_ajuste_uuid uuid");
    expect(migration0030).toContain("p_producto_id uuid");
    expect(migration0030).toContain("p_cantidad integer");
  });

  it("does not depend on the historical production owner uuid literal", () => {
    expect(migration0030).not.toContain("278a5fc3-be3d-460c-ae2c-fa890bfca685");
    expect(migration0030).not.toContain("where usuario_id = '");
  });

  it("resolves the active shift by assigned band and Mexico operating date", () => {
    expect(migration0030).toContain("j.banda = v_banda");
    expect(migration0030).toContain("j.estado = 'activa'");
    expect(migration0030).toContain("coalesce(j.deshabilitada, false) = false");
    expect(migration0030).toContain("j.fecha = v_ahora_mx::date");
  });

  it("serializes retries for the same adjustment uuid before reading existing corrections", () => {
    const lockIndex = migration0030.indexOf("pg_advisory_xact_lock");
    const readIndex = migration0030.indexOf("where ajuste_uuid = p_ajuste_uuid");

    expect(lockIndex).toBeGreaterThan(-1);
    expect(readIndex).toBeGreaterThan(lockIndex);
  });

  it("checks the current block before any production writes", () => {
    const noBlockIndex = migration0030.indexOf("NO_ACTIVE_BLOCK");
    const firstCorrectionInsert = migration0030.indexOf("insert into public.correcciones_produccion");
    const firstEventInsert = migration0030.indexOf("insert into public.produccion_eventos");

    expect(noBlockIndex).toBeGreaterThan(-1);
    expect(firstCorrectionInsert).toBeGreaterThan(noBlockIndex);
    expect(firstEventInsert).toBeGreaterThan(noBlockIndex);
  });
});
