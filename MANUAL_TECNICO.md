# Manual Técnico — HayMatch

## 1. Arquitectura General
HayMatch utiliza una arquitectura **Edge Realtime** en un único repositorio:

- **Frontend:** `Svelte 5` + `TypeScript` + `Vite 6` (`src/`). Servido como **Workers Static Assets** con fallback SPA.
- **Backend / Enrutador:** `Cloudflare Worker` (`worker/index.ts`).
- **Estado y Tiempo Real:** `Cloudflare Durable Objects` (`worker/SalaRoom.ts`) con **SQLite embebido** (`new_sqlite_classes` en `wrangler.jsonc`) y **WebSockets Hibernables** (`ctx.acceptWebSocket`).

### Por qué esta arquitectura
Cada sala (código de 4 caracteres, ej. `ASAD`) se enruta determinísticamente a su propia instancia de `SalaRoom` mediante `env.SALA_ROOM.getByName(code)`. Esto garantiza:
1. Aislamiento total de datos entre salas (cada sala tiene su propia BD SQLite).
2. Sincronización en milisegundos vía WebSockets a todos los clientes conectados.
3. Consistencia fuerte (sin condiciones de carrera en votos ni sorteos de desempate).

---

## 2. Esquema de Base de Datos (SQLite por Sala)
Definido en el constructor de `worker/SalaRoom.ts` dentro de `ctx.blockConcurrencyWhile`:
- `room_meta`: configuración de la sala, `organizer_pin_hash`, `organizer_salt`, `vaquita_mode` (`cuotas` | `gastos`), montos, `alias_mp` y `tiebreak_json`.
- `participants`: `client_id` (PK), `name`, `status` (`pendiente` | `seno` | `completo`), `paid_amount`, `joined_at`.
- `options`: `id` (PK), `category`, `title`, `proposed_by`, `created_at`.
- `votes`: `PRIMARY KEY (option_id, client_id)` garantizando 1 voto por persona por opción (actualizable).
- `expenses`: `id` (PK), `paid_by_client_id`, `paid_by_name`, `description`, `amount`, `created_at`.
- `auth_attempts`: control anti-fuerza bruta por `client_id` (5 fallos -> bloqueo de 120 segundos).

---

## 3. Seguridad Implementada
- **PIN de Organizador:** jamás se guarda ni compara en texto plano; se deriva con `PBKDF2` (100.000 iteraciones, SHA-256, salt aleatorio de 16 bytes) y comparación en tiempo constante (`timingSafeEqual`).
- **Cerrojo en Servidor:** las acciones administrativas (`set_payment`, `add_guest`, `update_alias`) verifican `att.isOrganizer === true` en el attachment del WebSocket en servidor.
- **Anti-inyección SQL:** 100% de las consultas SQLite usan placeholders `?`.
- **Anti-fuerza bruta:** 5 intentos fallidos de PIN bloquean la sesión por 120s con reloj regresivo en UI.

---

## 4. Comandos de Desarrollo, QA y Despliegue
- **Desarrollo local (Svelte + Worker + Durable Object SQLite en 1 puerto):**
  ```bash
  npm run dev
  ```
- **Chequeo de tipos Svelte + TypeScript:**
  ```bash
  npm run check
  ```
- **Build de producción:**
  ```bash
  npm run build
  ```
- **Protocolo de Tortura QA (7 capas):**
  ```bash
  npm run qa:torture
  ```
  Genera el reporte completo en `qa-torture/TORTURE_REPORT.md`.
- **Publicar en Cloudflare Workers (HTTPS público):**
  ```bash
  npx wrangler login
  npm run deploy
  ```
