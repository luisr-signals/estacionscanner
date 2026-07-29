-- Repara la RPC de escaneo que quedo con un cuerpo anterior en Supabase.
-- No cambia datos historicos ni crea tablas; solo reemplaza la funcion de escritura.

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
  v_codigo_normalizado text := btrim(coalesce(p_codigo, ''));
  v_estado_identificacion text;
  v_ahora timestamptz := now();
  v_ahora_mx timestamp := now() at time zone 'America/Mexico_City';
  v_hora_decimal numeric;
begin
  if p_cliente_uuid is null then
    raise exception 'INVALID_SCAN_ID' using errcode = '22023';
  end if;
  if v_codigo_normalizado = '' then
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
  from public.productos p
  where p.estado = 'activo'
    and p.codigo_id = v_codigo_normalizado
  limit 1;

  if v_producto.id is null then
    select p.* into v_producto
    from public.productos_codigos_alias a
    join public.productos p on p.id = a.producto_id
    where p.estado = 'activo'
      and a.codigo_id = v_codigo_normalizado
    order by a.created_at desc nulls last, a.id
    limit 1;
  end if;

  v_estado_identificacion := case when v_producto.id is null then 'pendiente' else 'identificado' end;

  insert into public.produccion_eventos (
    cliente_uuid, codigo, codigo_normalizado, estado_identificacion,
    fecha_operativa, hora_registro, hora_local, jornada_id,
    registro_horario_id, producto_id, banda, cantidad, origen, usuario_id, estado
  )
  values (
    p_cliente_uuid, p_codigo, v_codigo_normalizado, v_estado_identificacion,
    v_jornada.fecha, v_ahora, v_ahora_mx::time, v_jornada.id,
    v_bloque.id, v_producto.id, v_banda, 1, 'scanner_pt', auth.uid(), 'activo'
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
    v_evento.producto_id::uuid,
    false::boolean;
end;
$$;

revoke all on function public.registrar_escaneo_scanner(uuid, text) from public;
grant execute on function public.registrar_escaneo_scanner(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
