-- Ajustes manuales seguros desde Estacion 337.
-- Mantiene auditoria en correcciones_produccion e idempotencia persistente por
-- ajuste_uuid. No otorga permisos globales ni permite elegir banda/jornada.

begin;

alter table public.correcciones_produccion
  add column if not exists ajuste_uuid uuid;

create unique index if not exists correcciones_produccion_ajuste_uuid_key
  on public.correcciones_produccion (ajuste_uuid)
  where ajuste_uuid is not null;

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
  v_bloque public.registros_horarios%rowtype;
  v_producto public.productos%rowtype;
  v_correccion public.correcciones_produccion%rowtype;
  v_evento public.produccion_eventos%rowtype;
  v_evento_id uuid;
  v_ahora timestamptz := now();
  v_ahora_mx timestamp := now() at time zone 'America/Mexico_City';
  v_hora_decimal numeric;
  v_pares integer;
begin
  if p_cantidad not in (-1, 1) then
    raise exception 'Cantidad invalida para ajuste scanner.' using errcode = '22023';
  end if;

  select banda_asignada into v_banda
  from public.usuarios
  where id = auth.uid() and rol = 'scanner_operator';

  if v_banda is null then
    raise exception 'No autorizado: se requiere rol scanner_operator con banda asignada.' using errcode = '42501';
  end if;

  select * into v_correccion
  from public.correcciones_produccion
  where ajuste_uuid = p_ajuste_uuid;

  if v_correccion.id is not null then
    select id into v_evento_id
    from public.produccion_eventos
    where correccion_id = v_correccion.id
    order by created_at desc, id
    limit 1;

    return query
    select
      v_correccion.id,
      v_evento_id,
      v_correccion.registro_horario_id,
      v_correccion.valor_resultante,
      coalesce(v_correccion.producto_nuevo_id, v_correccion.producto_anterior_id),
      case when v_correccion.tipo = 'quitar' then -v_correccion.cantidad else v_correccion.cantidad end,
      true;
    return;
  end if;

  select * into v_jornada
  from public.jornadas
  where usuario_id = '278a5fc3-be3d-460c-ae2c-fa890bfca685'
    and banda = v_banda
    and estado = 'activa'
    and deshabilitada = false
  order by fecha desc, created_at desc
  limit 1;

  if v_jornada.id is null then
    raise exception 'Sin jornada activa para esta banda.' using errcode = 'P0002';
  end if;

  select * into v_producto
  from public.productos
  where id = p_producto_id and estado = 'activo';

  if v_producto.id is null then
    raise exception 'Producto no disponible.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.produccion_eventos
    where jornada_id = v_jornada.id
      and banda = v_banda
      and producto_id = p_producto_id
      and estado = 'activo'
  ) then
    raise exception 'El producto no tiene registros activos en esta jornada.' using errcode = 'P0002';
  end if;

  v_hora_decimal := extract(hour from v_ahora_mx) + extract(minute from v_ahora_mx) / 60.0 + extract(second from v_ahora_mx) / 3600.0;

  select * into v_bloque
  from public.registros_horarios
  where jornada_id = v_jornada.id
    and v_hora_decimal >= hora_inicio_bloque
    and v_hora_decimal < hora_inicio_bloque + duracion
  limit 1;

  if v_bloque.id is null then
    raise exception 'Fuera de bloque horario.' using errcode = 'P0002';
  end if;

  if p_cantidad = 1 then
    insert into public.correcciones_produccion (
      ajuste_uuid, tipo, jornada_id, registro_horario_id, banda,
      producto_anterior_id, producto_nuevo_id, cantidad, motivo,
      valor_anterior, valor_resultante, usuario_id
    )
    values (
      p_ajuste_uuid, 'agregar', v_jornada.id, v_bloque.id, v_banda,
      null, p_producto_id, 1, 'Ajuste manual desde Estacion 337',
      coalesce(v_bloque.pares, 0), coalesce(v_bloque.pares, 0) + 1, auth.uid()
    )
    returning * into v_correccion;

    insert into public.produccion_eventos (
      cliente_uuid, codigo, fecha_operativa, hora_registro, hora_local,
      jornada_id, registro_horario_id, producto_id, banda, cantidad,
      origen, usuario_id, estado, correccion_id
    )
    values (
      p_ajuste_uuid, v_producto.codigo_id, v_jornada.fecha, v_ahora,
      to_char(v_ahora_mx, 'HH24:MI:SS'), v_jornada.id, v_bloque.id,
      p_producto_id, v_banda, 1, 'ajuste_manual', auth.uid(), 'activo',
      v_correccion.id
    )
    returning * into v_evento;

    update public.registros_horarios
    set pares = coalesce(pares, 0) + 1, updated_at = v_ahora
    where id = v_bloque.id
    returning pares into v_pares;
  else
    select * into v_evento
    from public.produccion_eventos
    where jornada_id = v_jornada.id
      and banda = v_banda
      and producto_id = p_producto_id
      and estado = 'activo'
    order by created_at desc, id
    limit 1
    for update;

    if v_evento.id is null then
      raise exception 'No hay pares disponibles para quitar.' using errcode = 'P0002';
    end if;

    select * into v_bloque
    from public.registros_horarios
    where id = v_evento.registro_horario_id
    for update;

    if coalesce(v_bloque.pares, 0) <= 0 then
      raise exception 'No hay pares disponibles para quitar.' using errcode = 'P0002';
    end if;

    insert into public.correcciones_produccion (
      ajuste_uuid, tipo, jornada_id, registro_horario_id, banda,
      producto_anterior_id, producto_nuevo_id, cantidad, motivo,
      valor_anterior, valor_resultante, usuario_id
    )
    values (
      p_ajuste_uuid, 'quitar', v_jornada.id, v_bloque.id, v_banda,
      p_producto_id, null, 1, 'Ajuste manual desde Estacion 337',
      coalesce(v_bloque.pares, 0), coalesce(v_bloque.pares, 0) - 1, auth.uid()
    )
    returning * into v_correccion;

    update public.produccion_eventos
    set estado = 'anulado',
        motivo_anulacion = 'Ajuste manual desde Estacion 337',
        anulado_por = auth.uid(),
        anulado_en = v_ahora,
        correccion_id = v_correccion.id
    where id = v_evento.id;

    update public.registros_horarios
    set pares = coalesce(pares, 0) - 1, updated_at = v_ahora
    where id = v_bloque.id and coalesce(pares, 0) > 0
    returning pares into v_pares;
  end if;

  update public.confirmaciones_bloque
  set estado = 'pendiente',
      invalidado_por = auth.uid(),
      invalidado_en = v_ahora,
      updated_at = v_ahora
  where registro_horario_id = v_bloque.id
    and estado = 'confirmado';

  return query
  select
    v_correccion.id,
    v_evento.id,
    v_bloque.id,
    v_pares,
    p_producto_id,
    p_cantidad,
    false;
end;
$$;

revoke all on function public.registrar_ajuste_scanner(uuid, uuid, integer) from public;
grant execute on function public.registrar_ajuste_scanner(uuid, uuid, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
