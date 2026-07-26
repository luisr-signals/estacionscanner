# Estacion 337 - Scanner

Aplicacion independiente y ultraligera para registrar pares con lector tipo teclado desde un iPad con iOS 12.5 / Safari 12.1. No comparte frontend ni bundles con DinoCore; solo se conectara al mismo proyecto de Supabase mediante una API protegida.

## Arquitectura

- Frontend Vite + React en `src/`, con dos vistas: inicio de sesion y estacion de escaneo.
- API serverless para Vercel en `api/station/*`.
- Adaptador Supabase aislado en `api/_lib/supabase.ts`.
- El navegador envia solo `barcode` y `scanId`.
- La API debe resolver usuario, estacion, banda, jornada, producto, hora de servidor, cantidad fija `1`, origen `scanner` e idempotencia.

## Compatibilidad Safari 12.1

El build usa `@vitejs/plugin-legacy` con targets `Safari >= 12` e `iOS >= 12`, `build.target = "es2015"`, `cssTarget = "safari12"` y chunks legacy. La interfaz evita APIs modernas no esenciales, WebSockets, service workers y dependencias visuales pesadas.

Despues de compilar, revisa `dist/` y confirma que existan archivos legacy y polyfills generados por Vite.

## Variables

Copia `.env.example` a `.env.local` para desarrollo local:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

No agregues credenciales reales al repositorio. `.env*` esta ignorado excepto `.env.example`.

## Instalacion

```bash
npm install
npm run dev
```

## Verificacion

```bash
npm run lint
npm run test
npm run build
```

## API

- `POST /api/station/login`
- `GET /api/station/status`
- `POST /api/station/scan`
- `GET /api/station/recent`
- `POST /api/station/logout`

## Pendiente para conectar Supabase real

Antes de escribir registros de produccion hay que mapear el esquema real en `api/_lib/supabase.ts`. Informacion requerida:

- Tabla y columnas de perfiles o claims para validar `scanner_operator`.
- Fuente real de `band_id`, `station_id` y nombre de banda.
- Como se determina la jornada activa.
- Tabla de catalogo donde se busca el `barcode`.
- Tabla de registros individuales de produccion y campos obligatorios.
- Valor real para origen `scanner` y estado inicial.
- Como se calculan total por hora, meta por hora y total del dia.
- Estrategia persistente de idempotencia: tabla, columna o constraint unico por usuario/estacion + `scanId`.

Mientras ese mapeo no exista, la API responde `SCHEMA_MAPPING_REQUIRED` y no inventa nombres de tablas ni escribe datos simulados como produccion.

## Despliegue

Configura un proyecto Vercel independiente para este repositorio, con sus propias variables de entorno y dominio/subdominio. No despliegues desde DinoCore ni importes codigo de DinoCore.
