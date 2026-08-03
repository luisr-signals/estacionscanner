-- Hace que un defecto registrado desde Estacion 337 descuente el par del
-- mismo bloque horario del escaneo marcado como defectuoso.
-- La insercion en calidad_perdidas y la resta en registros_horarios ocurren
-- en una sola RPC/transaction; si una parte falla, Postgres revierte todo.

begin;

do $$
begin
  if to_regprocedure('public.registrar_defecto_scanner_insert_only(uuid,text,text)') is null then
    alter function public.registrar_defecto_scanner(uuid, text, text)
      rename to registrar_defecto_scanner_insert_only;
  end if;
end;
$$;

create or replace function public.registrar_defecto_scanner(
  p_cliente_uuid uuid,
  p_codigo_defecto text,
  p_codigo_par text
)
returns table (
  perdida_id uuid,
  defecto_id uuid,
  defecto_nombre text,
  modelo text,
  producto_nombre text,
  duplicado boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_banda smallint;
  v_jornada public.jornadas%rowtype;
  v_evento public.produccion_eventos%rowtype;
  v_bloque public.registros_horarios%rowtype;
  v_result record;
  v_codigo_normalizado text := btrim(regexp_replace(coalesce(p_codigo_par, ''), '[\r\n\t]+', '', 'g'));
  v_ahora timestamptz := now();
  v_ahora_mx timestamp := now() at time zone 'America/Mexico_City';
begin
  if p_cliente_uuid is null then
    raise exception 'INVALID_DEFECT_ID' using errcode = '22023';
  end if;
  if v_codigo_normalizado = '' then
    raise exception 'PAIR_REQUIRED' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cliente_uuid::text, 0));

  select u.banda_asignada into v_banda
  from public.usuarios u
  where u.id = auth.uid()
    and u.rol = 'scanner_operator'
    and u.banda_asignada in (1, 2);

  if v_banda is null then
    raise exception 'No autorizado: se requiere rol scanner_operator con banda asignada.' using errcode = '42501';
  end if;

  select * into v_result
  from public.registrar_defecto_scanner_insert_only(
    p_cliente_uuid,
    p_codigo_defecto,
    p_codigo_par
  );

  if not found or v_result.perdida_id is null then
    raise exception 'DEFECT_REGISTER_FAILED' using errcode = 'P0001';
  end if;

  if coalesce(v_result.duplicado, false) then
    return query
    select
      v_result.perdida_id::uuid,
      v_result.defecto_id::uuid,
      v_result.defecto_nombre::text,
      v_result.modelo::text,
      v_result.producto_nombre::text,
      true::boolean;
    return;
  end if;

  select * into v_jornada
  from public.jornadas j
  where j.banda = v_banda
    and j.estado = 'activa'
    and coalesce(j.deshabilitada, false) = false
    and j.fecha = v_ahora_mx::date
  order by j.fecha desc, j.created_at desc
  limit 1;

  if v_jornada.id is null then
    raise exception 'NO_ACTIVE_SHIFT' using errcode = 'P0002';
  end if;

  select * into v_evento
  from public.produccion_eventos pe
  where pe.jornada_id = v_jornada.id
    and pe.banda = v_banda
    and pe.estado = 'activo'
    and (
      pe.codigo_normalizado = v_codigo_normalizado
      or btrim(regexp_replace(coalesce(pe.codigo, ''), '[\r\n\t]+', '', 'g')) = v_codigo_normalizado
    )
  order by pe.hora_registro desc, pe.created_at desc, pe.id desc
  limit 1
  for update;

  if v_evento.id is null or v_evento.registro_horario_id is null then
    raise exception 'PAIR_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_bloque
  from public.registros_horarios
  where id = v_evento.registro_horario_id
  for update;

  if v_bloque.id is null then
    raise exception 'NO_ACTIVE_BLOCK' using errcode = 'P0002';
  end if;
  if coalesce(v_bloque.pares, 0) <= 0 then
    raise exception 'REMOVE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  update public.registros_horarios
  set pares = coalesce(pares, 0) - 1,
      updated_at = v_ahora
  where id = v_bloque.id
    and coalesce(pares, 0) > 0
  returning * into v_bloque;

  if v_bloque.id is null then
    raise exception 'REMOVE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  update public.confirmaciones_bloque cb
  set estado = 'pendiente',
      invalidado_por = auth.uid(),
      invalidado_en = v_ahora,
      updated_at = v_ahora
  where cb.registro_horario_id = v_bloque.id
    and cb.estado = 'confirmado';

  return query
  select
    v_result.perdida_id::uuid,
    v_result.defecto_id::uuid,
    v_result.defecto_nombre::text,
    v_result.modelo::text,
    v_result.producto_nombre::text,
    false::boolean;
end;
$$;

revoke all on function public.registrar_defecto_scanner_insert_only(uuid, text, text) from public;
revoke all on function public.registrar_defecto_scanner(uuid, text, text) from public;
grant execute on function public.registrar_defecto_scanner(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
