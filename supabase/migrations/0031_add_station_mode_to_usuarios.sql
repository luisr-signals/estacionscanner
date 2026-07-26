-- Configuracion aditiva para enrutar Estacion 337 sin cambiar el rol DinoCore.
-- Todos los usuarios existentes quedan como scanner por defecto.

begin;

alter table public.usuarios
  add column if not exists station_mode text
  not null default 'scanner'
  check (station_mode in ('scanner', 'band_display'));

comment on column public.usuarios.station_mode is
  'Modo exclusivo de Estacion 337: scanner o band_display. No reemplaza el rol DinoCore.';

commit;
