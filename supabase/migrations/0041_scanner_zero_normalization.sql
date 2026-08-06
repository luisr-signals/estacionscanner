-- Normalización de un cero extra al inicio o al final del código escaneado.
--
-- Problema: un código válido del catálogo (ej. 888930270) a veces se lee con un
-- "0" de más al inicio o al final (0888930270 / 8889302700 / 08889302700) y
-- quedaba como "No identificado".
--
-- Regla: primero coincidencia EXACTA (código tal cual). Si no hay, se prueban en
-- orden: quitar un cero inicial, quitar un cero final, quitar ambos. Se usa la
-- PRIMERA variante que exista en el catálogo (productos.codigo_id es único, así
-- que cualquier match es único). Nunca se tocan ceros internos ni se quitan
-- varios ceros. Si ninguna variante coincide, queda "No identificado".
--
-- Parte 1: la RPC de escaneo para todos los escaneos futuros.
-- Parte 2: backfill de los "No identificado" de la jornada activa.

begin;

-- ========================= PARTE 1: RPC DE ESCANEO =========================
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

  -- 1) Coincidencia EXACTA (código tal cual) en catálogo y alias.
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

  -- 2) Sin match exacto: probar variantes de UN cero extra (inicio / fin / ambos),
  --    en ese orden. Primera que exista en el catálogo gana. No toca ceros internos.
  if v_producto.id is null then
    declare
      v_variantes text[] := array[]::text[];
      v_cand text;
    begin
      if left(v_codigo_normalizado, 1) = '0' and length(v_codigo_normalizado) > 1 then
        v_variantes := v_variantes || substr(v_codigo_normalizado, 2);
      end if;
      if right(v_codigo_normalizado, 1) = '0' and length(v_codigo_normalizado) > 1 then
        v_variantes := v_variantes || left(v_codigo_normalizado, length(v_codigo_normalizado) - 1);
      end if;
      if left(v_codigo_normalizado, 1) = '0'
         and right(v_codigo_normalizado, 1) = '0'
         and length(v_codigo_normalizado) > 2 then
        v_variantes := v_variantes || substr(left(v_codigo_normalizado, length(v_codigo_normalizado) - 1), 2);
      end if;

      foreach v_cand in array v_variantes loop
        select * into v_producto
        from public.productos p
        where p.estado = 'activo'
          and p.codigo_id = v_cand
        limit 1;

        if v_producto.id is not null then
          -- Se guarda el código PRINCIPAL del catálogo como normalizado; el
          -- original leído queda en `codigo` para auditoría.
          v_codigo_normalizado := v_producto.codigo_id;
          exit;
        end if;
      end loop;
    end;
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

-- ================== PARTE 2: BACKFILL DE LA JORNADA ACTIVA ==================
-- Re-identifica los eventos "No identificado" (producto_id null) de las jornadas
-- ACTIVAS aplicando la misma regla (exacto -> quitar cero inicial -> final ->
-- ambos). Solo actualiza producto_id/codigo_normalizado/estado_identificacion;
-- NO altera hora, NO duplica, NO toca los ya identificados. Los totales por
-- modelo/talla/hora se derivan de produccion_eventos, así que se corrigen solos;
-- registros_horarios.pares (total) no cambia (el par ya estaba contado).
with objetivo as (
  select pe.id, btrim(coalesce(pe.codigo_normalizado, pe.codigo)) as cod
  from public.produccion_eventos pe
  join public.jornadas j on j.id = pe.jornada_id
  where pe.estado = 'activo'
    and pe.producto_id is null
    and j.estado = 'activa'
),
candidatos as (
  select o.id, v.codigo_cand, v.precedencia
  from objetivo o
  cross join lateral (
    values
      (o.cod, 0),
      (case when left(o.cod, 1) = '0' and length(o.cod) > 1 then substr(o.cod, 2) end, 1),
      (case when right(o.cod, 1) = '0' and length(o.cod) > 1 then left(o.cod, length(o.cod) - 1) end, 2),
      (case when left(o.cod, 1) = '0' and right(o.cod, 1) = '0' and length(o.cod) > 2
            then substr(left(o.cod, length(o.cod) - 1), 2) end, 3)
  ) as v(codigo_cand, precedencia)
  where v.codigo_cand is not null
),
match as (
  select distinct on (c.id) c.id, p.id as producto_id, p.codigo_id
  from candidatos c
  join public.productos p on p.estado = 'activo' and p.codigo_id = c.codigo_cand
  order by c.id, c.precedencia
)
update public.produccion_eventos pe
set producto_id = m.producto_id,
    codigo_normalizado = m.codigo_id,
    estado_identificacion = 'identificado'
from match m
where pe.id = m.id;

notify pgrst, 'reload schema';

commit;
