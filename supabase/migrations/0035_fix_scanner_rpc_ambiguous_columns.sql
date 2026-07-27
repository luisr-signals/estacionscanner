-- Corrige referencias ambiguas en las RPC de Estacion 337.
-- Los nombres de columnas retornadas tambien existen como variables PL/pgSQL.

begin;

create or replace function public.registrar_escaneo_scanner(
  p_cliente_uuid uuid,
  p_codigo text
)
returns table (
  evento_id uuid,
  registro_horario_id uuid,
  pares_bloque integer,
  producto_id uuid,
  duplicado boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_banda smallint;
  v_jornada public.jornadas%rowtype;
  v_bloque public.registros_horarios%rowtype;
  v_producto public.productos%rowtype;
  v_evento public.produccion_eventos%rowtype;
  v_ahora timestamptz := now();
  v_ahora_mx timestamp := now() at time zone 'America/Mexico_City';
  v_hora_decimal numeric;
begin
  if p_cliente_uuid is null then
    raise exception 'INVALID_SCAN_ID' using errcode = '22023';
  end if;
  if p_codigo is null or btrim(p_codigo) = '' then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cliente_uuid::text, 0));

  select banda_asignada into v_banda
  from public.usuarios
  where id = auth.uid()
    and rol = 'scanner_operator'
    and banda_asignada in (1, 2);

  if v_banda is null then
    raise exception 'No autorizado: se requiere rol scanner_operator con banda asignada.' using errcode = '42501';
  end if;

  select * into v_evento
  from public.produccion_eventos pe
  where pe.cliente_uuid = p_cliente_uuid
  order by pe.created_at desc, pe.id
  limit 1;

  if v_evento.id is not null then
    select * into v_bloque
    from public.registros_horarios
    where id = v_evento.registro_horario_id;

    return query
    select
      v_evento.id::uuid,
      v_evento.registro_horario_id::uuid,
      coalesce(v_bloque.pares, 0)::integer,
      v_evento.producto_id::uuid,
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
  limit 1
  for update;

  if v_jornada.id is null then
    raise exception 'NO_ACTIVE_SHIFT' using errcode = 'P0002';
  end if;

  v_hora_decimal := extract(hour from v_ahora_mx) + extract(minute from v_ahora_mx) / 60.0 + extract(second from v_ahora_mx) / 3600.0;

  select * into v_bloque
  from public.registros_horarios
  where jornada_id = v_jornada.id
    and v_hora_decimal >= hora_inicio_bloque
    and v_hora_decimal < hora_inicio_bloque + duracion
  order by orden
  limit 1
  for update;

  if v_bloque.id is null then
    raise exception 'NO_ACTIVE_BLOCK' using errcode = 'P0002';
  end if;

  select * into v_producto
  from public.productos
  where codigo_id = p_codigo
    and estado = 'activo';

  if v_producto.id is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.produccion_eventos (
    cliente_uuid, codigo, fecha_operativa, hora_registro, hora_local,
    jornada_id, registro_horario_id, producto_id, banda, cantidad,
    origen, usuario_id, estado
  )
  values (
    p_cliente_uuid, p_codigo, v_jornada.fecha, v_ahora,
    v_ahora_mx::time, v_jornada.id, v_bloque.id,
    v_producto.id, v_banda, 1, 'scanner_pt', auth.uid(), 'activo'
  )
  returning * into v_evento;

  update public.registros_horarios
  set pares = coalesce(pares, 0) + 1,
      updated_at = v_ahora
  where id = v_bloque.id
  returning * into v_bloque;

  update public.confirmaciones_bloque cb
  set estado = 'pendiente',
      invalidado_por = auth.uid(),
      invalidado_en = v_ahora,
      updated_at = v_ahora
  where cb.registro_horario_id = v_bloque.id
    and cb.estado = 'confirmado';

  return query
  select
    v_evento.id::uuid,
    v_bloque.id::uuid,
    coalesce(v_bloque.pares, 0)::integer,
    v_producto.id::uuid,
    false::boolean;
end;
$$;

create or replace function public.registrar_ajuste_scanner(
  p_ajuste_uuid uuid,
  p_producto_id uuid,
  p_cantidad integer
)
returns table (
  correccion_id uuid,
  evento_id uuid,
  registro_horario_id uuid,
  pares_bloque integer,
  producto_id uuid,
  cantidad integer,
  duplicado boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_banda smallint;
  v_jornada public.jornadas%rowtype;
  v_bloque_actual public.registros_horarios%rowtype;
  v_bloque_afectado public.registros_horarios%rowtype;
  v_producto public.productos%rowtype;
  v_correccion public.correcciones_produccion%rowtype;
  v_evento public.produccion_eventos%rowtype;
  v_evento_id uuid;
  v_ahora timestamptz := now();
  v_ahora_mx timestamp := now() at time zone 'America/Mexico_City';
  v_hora_decimal numeric;
  v_pares_bloque integer;
begin
  if p_ajuste_uuid is null then
    raise exception 'INVALID_ADJUSTMENT_ID' using errcode = '22023';
  end if;
  if p_producto_id is null then
    raise exception 'PRODUCT_NOT_AVAILABLE' using errcode = '22023';
  end if;
  if p_cantidad not in (-1, 1) then
    raise exception 'Cantidad invalida para ajuste scanner.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_ajuste_uuid::text, 0));

  select banda_asignada into v_banda
  from public.usuarios
  where id = auth.uid()
    and rol = 'scanner_operator'
    and banda_asignada in (1, 2);

  if v_banda is null then
    raise exception 'No autorizado: se requiere rol scanner_operator con banda asignada.' using errcode = '42501';
  end if;

  select * into v_correccion
  from public.correcciones_produccion cp
  where cp.ajuste_uuid = p_ajuste_uuid;

  if v_correccion.id is not null then
    select id into v_evento_id
    from public.produccion_eventos pe
    where pe.correccion_id = v_correccion.id
    order by pe.created_at desc, pe.id
    limit 1;

    return query
    select
      v_correccion.id::uuid,
      v_evento_id::uuid,
      v_correccion.registro_horario_id::uuid,
      v_correccion.valor_resultante::integer,
      coalesce(v_correccion.producto_nuevo_id, v_correccion.producto_anterior_id)::uuid,
      (case when v_correccion.tipo = 'quitar' then -v_correccion.cantidad else v_correccion.cantidad end)::integer,
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
  limit 1
  for update;

  if v_jornada.id is null then
    raise exception 'NO_ACTIVE_SHIFT' using errcode = 'P0002';
  end if;

  v_hora_decimal := extract(hour from v_ahora_mx) + extract(minute from v_ahora_mx) / 60.0 + extract(second from v_ahora_mx) / 3600.0;

  select * into v_bloque_actual
  from public.registros_horarios
  where jornada_id = v_jornada.id
    and v_hora_decimal >= hora_inicio_bloque
    and v_hora_decimal < hora_inicio_bloque + duracion
  order by orden
  limit 1
  for update;

  if v_bloque_actual.id is null then
    raise exception 'NO_ACTIVE_BLOCK' using errcode = 'P0002';
  end if;

  select * into v_producto
  from public.productos
  where id = p_producto_id
    and estado = 'activo';

  if v_producto.id is null then
    raise exception 'PRODUCT_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.produccion_eventos pe
    where pe.jornada_id = v_jornada.id
      and pe.banda = v_banda
      and pe.producto_id = p_producto_id
      and pe.estado = 'activo'
  ) then
    raise exception 'PRODUCT_NOT_WORKED' using errcode = 'P0002';
  end if;

  if p_cantidad = 1 then
    insert into public.correcciones_produccion (
      ajuste_uuid, tipo, jornada_id, registro_horario_id, banda,
      producto_anterior_id, producto_nuevo_id, cantidad, motivo,
      valor_anterior, valor_resultante, usuario_id
    )
    values (
      p_ajuste_uuid, 'agregar', v_jornada.id, v_bloque_actual.id, v_banda,
      null, p_producto_id, 1, 'Ajuste manual desde Estacion 337',
      coalesce(v_bloque_actual.pares, 0), coalesce(v_bloque_actual.pares, 0) + 1, auth.uid()
    )
    returning * into v_correccion;

    insert into public.produccion_eventos (
      cliente_uuid, codigo, fecha_operativa, hora_registro, hora_local,
      jornada_id, registro_horario_id, producto_id, banda, cantidad,
      origen, usuario_id, estado, correccion_id
    )
    values (
      p_ajuste_uuid, v_producto.codigo_id, v_jornada.fecha, v_ahora,
      v_ahora_mx::time, v_jornada.id, v_bloque_actual.id,
      p_producto_id, v_banda, 1, 'ajuste_manual', auth.uid(), 'activo',
      v_correccion.id
    )
    returning * into v_evento;

    update public.registros_horarios
    set pares = coalesce(pares, 0) + 1,
        updated_at = v_ahora
    where id = v_bloque_actual.id
    returning * into v_bloque_actual;
  else
    select * into v_evento
    from public.produccion_eventos pe
    where pe.jornada_id = v_jornada.id
      and pe.banda = v_banda
      and pe.producto_id = p_producto_id
      and pe.estado = 'activo'
    order by pe.created_at desc, pe.id
    limit 1
    for update;

    if v_evento.id is null then
      raise exception 'REMOVE_NOT_AVAILABLE' using errcode = 'P0002';
    end if;

    select * into v_bloque_afectado
    from public.registros_horarios
    where id = v_evento.registro_horario_id
      and jornada_id = v_jornada.id
    for update;

    if v_bloque_afectado.id is null or coalesce(v_bloque_afectado.pares, 0) <= 0 then
      raise exception 'REMOVE_NOT_AVAILABLE' using errcode = 'P0002';
    end if;

    insert into public.correcciones_produccion (
      ajuste_uuid, tipo, jornada_id, registro_horario_id, banda,
      producto_anterior_id, producto_nuevo_id, cantidad, motivo,
      valor_anterior, valor_resultante, usuario_id
    )
    values (
      p_ajuste_uuid, 'quitar', v_jornada.id, v_bloque_afectado.id, v_banda,
      p_producto_id, null, 1, 'Ajuste manual desde Estacion 337',
      coalesce(v_bloque_afectado.pares, 0), coalesce(v_bloque_afectado.pares, 0) - 1, auth.uid()
    )
    returning * into v_correccion;

    update public.produccion_eventos pe
    set estado = 'anulado',
        motivo_anulacion = 'Ajuste manual desde Estacion 337',
        anulado_por = auth.uid(),
        anulado_en = v_ahora,
        correccion_id = v_correccion.id
    where pe.id = v_evento.id
      and pe.estado = 'activo';

    update public.registros_horarios
    set pares = coalesce(pares, 0) - 1,
        updated_at = v_ahora
    where id = v_bloque_afectado.id
      and coalesce(pares, 0) > 0
    returning * into v_bloque_afectado;

    select * into v_bloque_actual
    from public.registros_horarios
    where id = v_bloque_actual.id;
  end if;

  update public.confirmaciones_bloque cb
  set estado = 'pendiente',
      invalidado_por = auth.uid(),
      invalidado_en = v_ahora,
      updated_at = v_ahora
  where cb.registro_horario_id = v_correccion.registro_horario_id
    and cb.estado = 'confirmado';

  v_pares_bloque := coalesce(v_bloque_actual.pares, 0);

  return query
  select
    v_correccion.id::uuid,
    v_evento.id::uuid,
    v_correccion.registro_horario_id::uuid,
    v_pares_bloque::integer,
    p_producto_id::uuid,
    p_cantidad::integer,
    false::boolean;
end;
$$;

revoke all on function public.registrar_escaneo_scanner(uuid, text) from public;
grant execute on function public.registrar_escaneo_scanner(uuid, text) to authenticated;

revoke all on function public.registrar_ajuste_scanner(uuid, uuid, integer) from public;
grant execute on function public.registrar_ajuste_scanner(uuid, uuid, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
