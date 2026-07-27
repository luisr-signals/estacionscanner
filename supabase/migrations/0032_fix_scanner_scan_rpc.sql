-- Corrige la RPC principal de escaneo de Estacion 337.
-- No inserta datos al aplicarse; solo reemplaza la funcion para que la firma
-- y el retorno coincidan con la llamada desde Vercel.

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
  from public.produccion_eventos
  where cliente_uuid = p_cliente_uuid
  order by created_at desc, id
  limit 1;

  if v_evento.id is not null then
    select * into v_bloque
    from public.registros_horarios
    where id = v_evento.registro_horario_id;

    return query
    select
      v_evento.id,
      v_evento.registro_horario_id,
      coalesce(v_bloque.pares, 0),
      v_evento.producto_id,
      true;
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
    to_char(v_ahora_mx, 'HH24:MI:SS'), v_jornada.id, v_bloque.id,
    v_producto.id, v_banda, 1, 'scanner_pt', auth.uid(), 'activo'
  )
  returning * into v_evento;

  update public.registros_horarios
  set pares = coalesce(pares, 0) + 1,
      updated_at = v_ahora
  where id = v_bloque.id
  returning * into v_bloque;

  update public.confirmaciones_bloque
  set estado = 'pendiente',
      invalidado_por = auth.uid(),
      invalidado_en = v_ahora,
      updated_at = v_ahora
  where registro_horario_id = v_bloque.id
    and estado = 'confirmado';

  return query
  select
    v_evento.id,
    v_bloque.id,
    coalesce(v_bloque.pares, 0),
    v_producto.id,
    false;
end;
$$;

revoke all on function public.registrar_escaneo_scanner(uuid, text) from public;
grant execute on function public.registrar_escaneo_scanner(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
