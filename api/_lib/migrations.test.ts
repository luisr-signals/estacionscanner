import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration0030 = readFileSync(
  join(process.cwd(), "supabase/migrations/0030_fix_scanner_manual_adjustments.sql"),
  "utf8"
);
const migration0031 = readFileSync(
  join(process.cwd(), "supabase/migrations/0031_add_station_mode_to_usuarios.sql"),
  "utf8"
);
const migration0040 = readFileSync(
  join(process.cwd(), "supabase/migrations/0040_net_scanner_defects.sql"),
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

describe("station mode migration 0031", () => {
  it("adds a server-side station mode with a safe scanner default", () => {
    expect(migration0031).toContain("alter table public.usuarios");
    expect(migration0031).toContain("add column if not exists station_mode text");
    expect(migration0031).toContain("not null default 'scanner'");
    expect(migration0031).toContain("check (station_mode in ('scanner', 'band_display'))");
  });
});

describe("scanner defect migration 0040", () => {
  it("wraps the existing defect insert RPC without changing the public signature", () => {
    expect(migration0040).toContain("rename to registrar_defecto_scanner_insert_only");
    expect(migration0040).toContain("create or replace function public.registrar_defecto_scanner");
    expect(migration0040).toContain("p_cliente_uuid uuid");
    expect(migration0040).toContain("p_codigo_defecto text");
    expect(migration0040).toContain("p_codigo_par text");
  });

  it("inserts the defect and decrements production in one transaction", () => {
    const insertIndex = migration0040.indexOf("registrar_defecto_scanner_insert_only");
    const updateIndex = migration0040.indexOf("update public.registros_horarios");

    expect(migration0040).toContain("begin;");
    expect(migration0040).toContain("commit;");
    expect(insertIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(insertIndex);
  });

  it("uses the last scanned pair block and never decrements below zero", () => {
    expect(migration0040).toContain("order by pe.hora_registro desc");
    expect(migration0040).toContain("where id = v_evento.registro_horario_id");
    expect(migration0040).toContain("coalesce(v_bloque.pares, 0) <= 0");
    expect(migration0040).toContain("and coalesce(pares, 0) > 0");
  });

  it("does not decrement again for duplicate defect requests", () => {
    const duplicateIndex = migration0040.indexOf("coalesce(v_result.duplicado, false)");
    const updateIndex = migration0040.indexOf("update public.registros_horarios");

    expect(duplicateIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(duplicateIndex);
  });
});
