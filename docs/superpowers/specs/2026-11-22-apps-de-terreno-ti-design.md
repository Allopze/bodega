# TI › Apps: las apps del teléfono, si funcionan y quién las usa

Fecha: 2026-11-22 · Estado: aprobado por el usuario (2026-11-22)

## 1. Intención

Hoy TI › Apps (`/ti/apps`) le dice «app» a cada uno de los 20 módulos de la
plataforma (Compras, Bodega, Flota…) y mide sus visitas, movimientos de auditoría
e integraciones. El usuario lo resumió así: «la pantalla actual no tiene sentido».

Lo que pidió: que la pantalla muestre **las apps que se instalan en el teléfono**,
«como la del mecánico o la de PPA», y que al hacer clic en cada una se vean
**indicadores útiles para alguien de TI**. Lo dijo así: «me sirve todos los
indicadores utiles para alguien de ti, las cifra de negocio no me interesan esas
se pueden ver en su modulo».

Son tres apps instalables (tienen manifest y service worker):

| App | Entrada | Quién la usa | Cómo se identifica |
|---|---|---|---|
| PPA Digital | `/ppa` | trabajadores en faena | sin login; el trabajador da su RUT |
| Mantención (app del mecánico) | `/m/mantencion` | mecánicos | login + credencial por dispositivo (`mant_device_credentials`) |
| Control TAE | `/tae` | quien carga combustible TAE | sin login; enlace de acceso por faena o punto de carga (`fuel_tae_public_links`) |

El formulario offline del RE-20 (`/prevencion/incidentes/re20-offline`) tiene un
service worker, pero no tiene manifest y no se instala: no entra.

Para TI, la pantalla responde dos preguntas por app:

- **¿Funciona?** Envíos que llegan tarde o quedan atascados en el teléfono,
  versiones viejas, credenciales o enlaces vencidos, y en TAE la lectura
  automática del medidor.
- **¿Se usa?** Qué faenas, personas y teléfonos la usan, y quién dejó de enviar.

### El problema de fondo, y la decisión del usuario

Las tres apps funcionan sin señal y guardan lo pendiente en IndexedDB del
teléfono. El servidor sólo se entera de un problema cuando el envío por fin
llega, así que un teléfono con registros atascados hoy es invisible. El usuario
eligió la opción 2 (ver §4): **cada app manda un aviso chico al servidor** con
su estado, y la pantalla combina ese aviso con los datos que ya se guardan.

## 2. Objetivos, no objetivos, anti-objetivos

**Objetivos**

1. `/ti/apps` lista las tres apps instalables con su estado de un vistazo.
2. `/ti/apps/[app]` muestra, para una app, indicadores de funcionamiento y de
   uso: teléfonos, versiones, envíos atascados o con error, demora de llegada,
   uso por faena o persona, y el estado de sus accesos (credenciales o enlaces).
3. Cada app manda un aviso al abrirse y después de cada intento de envío.
4. La salud de las integraciones y tareas programadas, que hoy vive dentro de
   Apps, pasa a una pantalla propia: `/ti/integraciones` (decisión del usuario).
5. Arreglar dos fallas que salieron en el análisis (decisión del usuario:
   «arregla también esos errores»):
   - la versión de la app, que en prod puede quedar como `"dev"` o `"unknown"`;
   - PPA, que borra del teléfono evaluaciones sin enviar a los 30 días.
   Ver 5.2.

**No objetivos (v1)**

- Cifras de negocio: PPA detenidos, litros, preventivas, montos. Ya están en
  su módulo, y el usuario las descartó explícitamente.
- Uso por módulo de la plataforma (visitas y movimientos por módulo): sale de
  TI. `app_visits` se sigue registrando porque alimenta las «recientes» del
  lanzador ⊞.
- Alertas o correos a TI cuando un teléfono se atasca (podría venir después,
  por ejemplo en el cron `ti-alerts`).
- Acciones remotas desde TI: forzar actualización, borrar la cola, revocar.
  Revocar ya existe en las pantallas de cada módulo y el detalle enlaza a ellas.
- Registrar qué pantallas se abren dentro de cada app.
- El RE-20 offline.

**Anti-objetivos (fracaso aunque funcione)**

- Que el aviso demore, bloquee o muestre errores al trabajador o al mecánico. Es
  invisible: si falla, no pasa nada.
- Que la ruta pública del aviso permita escribir datos sin límite o sea una vía
  para ensuciar la base.
- Que el aviso filtre datos personales (nombre o RUT del trabajador) o el token
  de acceso de TAE.
- Que la pantalla se lea como «nadie la usa» cuando lo que pasa es que todavía
  no llegan avisos (los avisos empiezan con el deploy).

## 3. Restricciones

- Reglas de `AGENTS.md`: `PageHeader` + `PageContainer`, tarjetas flotantes (no
  es un tablero), `SummaryBar` con máximo 4 cifras y cada una accionable, sin
  input de búsqueda propio (la tabla usa la búsqueda de la TopBar), filtros por URL
  con `router.replace` + `scroll: false` (o `<Link replace scroll={false}>`, como hace
  hoy la página), tokens `-ink` para texto de estado, `formatDate`/`formatDateTime`,
  estados vacíos con `EmptyState` y CTA real.
- Paridad de autorización y navegación para `/ti/integraciones`: ruta,
  `requirePermission("ti:view")`, ítem en `modules/ti/manifest.ts`. No hay
  permiso nuevo.
- Migración con `npm run db:generate` (nunca a mano), checksum en
  `db/migrations/meta/_sql-checksums.json`, `db:generate` sin cambios después.
- Ruta pública: se agrega **exacta** a `lib/security/public-paths.ts`, y su
  `route.ts` debe quedar inventariado donde lo exige
  `lib/__tests__/module-toggles.test.ts` (ese test recorre todos los `route.ts`).
- Fechas y días: `todayInChile()`, nunca `toISOString().slice(0,10)`.
- La versión **no** puede salir de `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`. Ver 5.2,
  «Versión».

## 4. Enfoques considerados

1. **Sólo con los datos que ya se guardan.** No toca las apps. Da demoras de
   llegada, credenciales y enlaces, versión del mecánico (`mant_records.app_version`),
   OCR e identificación manual. No ve lo atascado en el teléfono, ni si está
   instalada, ni la versión de PPA y TAE. *Descartada:* lo atascado es lo que más
   le sirve a TI y aquí es invisible por diseño.
2. **Lo anterior + un aviso de cada app (elegida por el usuario).** Cada app manda
   versión, si está instalada, cuántos pendientes tiene y desde cuándo, el último
   error y un identificador al azar del teléfono. Cuesta tocar las tres apps, una
   migración y una ruta pública con límites. Mide desde el deploy hacia adelante.
3. *(Descartado en la conversación, sin presentarlo aparte)* registrar en el
   servidor los envíos rechazados: el aviso ya trae el último error y el conteo de
   fallidos, que cubre lo mismo sin tocar cada endpoint de envío.

Sobre la pantalla actual, el usuario eligió entre tres opciones la **1**: Apps
pasa a ser sólo las apps instalables y las integraciones se van a su propia
pantalla («integraciones en su propia pantalla»). Se descartaron las dos
pestañas en Apps (mezcla dos preguntas) y borrar las integraciones (TI pierde la
alerta de un sync caído).

## 5. Diseño

### 5.1 Catálogo de apps instalables

Archivo puro nuevo (p. ej. `lib/apps/field-apps.ts`). Los ids son `ppa`,
`mantencion` y `tae`. Cada entrada declara:

- el nombre visible (el `short_name` del manifest: «PPA Digital»,
  «Mantención», «Control TAE»);
- el ícono (los PNG de `public/`);
- la URL de entrada;
- el módulo del registry al que pertenece, para el interruptor del módulo:
  `ppa`, `mantencion_equipos` y `combustibles`;
- el enlace a la pantalla donde se administran sus accesos:
  `/mantencion/dispositivos` y `/combustibles/ajustes/puntos-de-carga`.

Una app cuyo módulo está apagado se muestra con la insignia «Desactivada», igual
que hoy.

### 5.2 El aviso (heartbeat)

**Qué manda cada app** (JSON, validado con zod en modo estricto, con todos los
campos acotados):

| Campo | Contenido |
|---|---|
| `app` | `"ppa"` \| `"mantencion"` \| `"tae"` |
| `deviceId` | UUID del teléfono para esa app (ver abajo) |
| `version` | identificador del build (ver «Versión» más abajo), ≤ 40 caracteres |
| `installed` | si corre instalada (display-mode standalone, fullscreen o minimal-ui, o `navigator.standalone`) |
| `platform` | rótulo corto tipo «Android · Chrome», ≤ 60 caracteres (ya existe `deviceLabel()` en `lib/mantencion/client/accounts.ts`) |
| `pending` | envíos sin enviar (0–10 000) |
| `failed` | envíos que **el servidor rechazó** y necesitan una persona (0–10 000). Un envío que agotó sus reintentos por falta de red **no** es `failed`: cuenta en `pending` |
| `oldestPendingAt` | fecha del pendiente más antiguo, o null |
| `lastAttemptAt` | último intento de envío, o null |
| `lastError` | mensaje del último error de envío, ≤ 200 caracteres, o null |
| `worksiteId` | sólo PPA: la faena del último envío. Opcional |
| `linkHash` | sólo TAE: SHA-256 hex del token de acceso guardado. Opcional |

No viaja nada del trabajador: ni nombre, ni RUT, ni empresa. Tampoco el token de
TAE en claro. Viaja su hash, que es lo mismo que guarda
`fuel_tae_public_links.token_hash` (`hashToken` en
`lib/services/fuel-tae/access.ts:21` es SHA-256 hex). El cliente lo calcula con
`crypto.subtle`.

**Cómo se calcula por app** (de la revisión del código):

- **Mantención.** `queueStats()` en `lib/mantencion/client/queue.ts:242` ya da
  `pending`, `rejected` y `oldestPendingMs`. `failed` es `rejected`; los ítems
  `needs_login` cuentan como pendientes, igual que en `queueStats`. `deviceId` es
  `getDeviceId()` (`meta.ts:25`) y `installed` es `isStandalone()`
  (`install.ts:90`). Se dispara en `startSyncLoop` → `tick()` → `onReport`
  (`sync-engine.ts:232-240`). Si hay una cuenta con credencial vigente, el aviso
  lleva `Authorization: Bearer <credencial>`: así el servidor asocia el teléfono a
  la persona sin que el cliente diga quién es.
- **PPA.** Cola en `lib/pwa/offline-queue.ts`, con estados pending, syncing,
  synced y failed.
  - Hoy `lib/pwa/hooks.ts:73-91` deja un ítem en failed por dos causas: el
    servidor lo rechazó, o se agotaron los reintentos por red (`MAX_SYNC_ATTEMPTS`).
    El ítem pasa a guardar **por qué** falló (`failureKind: "rejected" | "network"`).
    Para el aviso, `failed` cuenta sólo los `rejected`; los `network` son
    `pending`.
  - `deviceId` es un UUID nuevo.
  - Se dispara al abrir y al terminar `syncAllPending()` / `syncOne()` en
    `lib/pwa/hooks.ts`. Como PPA envía con una server action, el aviso usa un
    `fetch` nuevo a la ruta del aviso.
- **TAE.** Cola en `lib/pwa/tae-offline-queue.ts` (`countTaeQueue()` en :221).
  - `failed` aplica la misma regla que PPA: sólo los rechazos del servidor. Si
    TAE también marca failed por red agotada, se separa igual.
  - `deviceId` es un UUID nuevo.
  - Se dispara desde la página: al abrir y después de cada `sendQueued` /
    reenvío en `tae-form.tsx`. **No** se envía desde el service worker
    (`tae-sw.js`): la próxima vez que se abra la página se manda el estado real.

**Versión.** `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` no sirve:

- En `docker-compose.yml` es sólo una variable de ejecución, vacía por defecto.
  El `Dockerfile` no la declara como `ARG` y `scripts/deploy-prod.sh` no la fija.
- Next incrusta `NEXT_PUBLIC_*` en el bundle del cliente al compilar. En PPA y
  TAE quedaría vacía, y en el servidor sólo tiene valor si alguien la puso a mano
  en el `.env` de prod.

Esto también es una falla de hoy, no sólo un problema del aviso: el
`app_version` que la app del mecánico escribe en cada registro y el `appVersion`
de los respaldos (`app/(app)/admin/backups/actions.ts`,
`app/api/cron/backup-report/route.ts`) salen como `"dev"` o `"unknown"` en prod
si nadie llenó esa variable. **Se arregla para todos** (decisión del usuario:
«arregla también esos errores»):

- `scripts/deploy-prod.sh` pasa `--build-arg BODEGA_BUILD_SHA="$(git rev-parse --short=12 HEAD)"`
  al `docker buildx build`. Ya construye desde el checkout de `main`.
- El `Dockerfile` declara `ARG BODEGA_BUILD_SHA=` justo antes del `RUN … npm run build`,
  para no invalidar la caché de `npm ci`.
- `next.config.ts` fija, con `env`, `NEXT_PUBLIC_BUILD_SHA` (de
  `BODEGA_BUILD_SHA`, vacío si no viene) y `NEXT_PUBLIC_BUILD_TIME` (la hora en
  que se evalúa la configuración al compilar). Next los incrusta en el bundle
  del cliente y en el del servidor del mismo build (docs de Next, `env`).
- Un módulo único, `lib/build-info.ts`, expone `BUILD_ID`: el sha si existe y,
  si no, la hora del build. Expone también un rótulo legible, «22-11-2026 14:05 ·
  3f9c2a1b7d0e». Lo usan el aviso de las tres apps, la comparación de «versión
  atrasada» en el servidor, el `appVersion` de la app del mecánico
  (`app/(mecanico)/m/mantencion/page.tsx:34`) y el de los respaldos.
- `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` deja de leerse en el código. Las listas de
  variables que copian los respaldos (`lib/services/backup-run.ts`,
  `scripts/backup-orchestrator.sh`) y `docker-compose.yml` pueden conservarla sin
  daño; el constructor decide si la quita.
- En `next dev` la hora cambia en cada arranque. No importa: el servidor y el
  cliente comparten el mismo valor.

**PPA borra evaluaciones sin enviar: se arregla.** `purgeExpiredPpas`
(`lib/pwa/offline-queue.ts:188`) borra **todo** ítem de más de
`MAX_PPA_AGE_DAYS` (30 días), enviado o no. Una evaluación preventiva sin enviar
desaparece del teléfono sin rastro. El comentario del mismo archivo dice lo
contrario: «descartar en silencio un registro con valor probatorio sería peor que
negarse a aceptar uno nuevo». El servidor acepta un `filledAt` antiguo
(`lib/validation/ppa.ts:34` sólo rechaza fechas futuras), así que no hay razón
para tirarlo.

- `purgeExpiredPpas` pasa a borrar sólo ítems `synced`. Los no enviados se quedan
  hasta que se envíen.
- El tope `MAX_QUEUED_PPAS` (100) sigue protegiendo el espacio de IndexedDB. Al
  llenarse, rechaza el nuevo con un mensaje visible, no en silencio.
- Un PPA viejo sin enviar aparece en el aviso como pendiente antiguo, así que
  TI lo ve como «Atascado» o «Sin señal».
- TAE y Mantención no tienen este problema: sólo borran lo ya enviado
  (`purgeSyncedTaeSubmissions`, `pruneSent`).

**`deviceId` nuevo para PPA y TAE:** `crypto.randomUUID()` guardado en
`localStorage`, con una clave por app. Si el almacenamiento no está disponible se
genera uno por sesión. Eso infla un poco el conteo de teléfonos, pero es
aceptable y queda dicho en la nota de la pantalla. En iOS, una PWA instalada
tiene un almacenamiento distinto al de Safari, así que cuenta como otro teléfono.
Es lo que realmente pasa en el dispositivo.

**`installed`:** se saca `isStandalone()` de `lib/mantencion/client/install.ts` a
un helper compartido en `lib/pwa/` y Mantención lo reexporta. Así las tres apps
usan la misma regla.

**Cuándo se manda:**

- al abrir la app;
- al terminar cada intento de envío, haya salido bien o mal;
- fuera de esos momentos, no más de uno cada 5 minutos, salvo que hayan cambiado
  `pending` o `failed`.

Mantención intenta enviar cada 60 s, así que el freno es necesario. Se manda sólo
con `navigator.onLine`, con `fetch(..., { keepalive: true })`, y los errores se
tragan. **Nunca se encola ni se reintenta**: si no sale, el próximo aviso lleva
el estado nuevo. Nada de esto se ve en la interfaz de la app.

**Ruta:** `POST /api/pwa/aviso`, pública y agregada **exacta** a `PUBLIC_PATHS`.
Va en su propio prefijo, no bajo `/api/apps/*` (las rutas autenticadas del
lanzador), para que el carácter público quede a la vista en la ruta.

1. Cuota por IP y por `deviceId` con `consumeFixedWindowLimit`: **600 por 5 min
   por IP** y **20 por 5 min por dispositivo**. La de IP es holgada a propósito:
   una faena entera puede salir por una sola IP del operador al cambio de turno,
   y como el cliente ya frena a un aviso cada 5 minutos, 600 alcanza para cientos
   de teléfonos. El límite real lo pone la cuota por dispositivo y el tamaño
   acotado del payload. La cuota por IP se consume antes de validar, igual que en
   `submitPpaAction`.
2. Validación zod estricta. Si el payload es inválido: 400 sin detalle.
3. Si el módulo de la app está apagado (`isRouteOperational` o el equivalente
   del módulo): 204 y se descarta.
4. Mantención con `Bearer`: se valida con `authenticateDeviceToken`. Si es
   válida se toma `userId` de la credencial; si no, se ignora y el aviso queda
   anónimo. El aviso nunca falla por una credencial mala.
5. TAE con `linkHash`: se busca `fuel_tae_public_links.token_hash`. Si calza, se
   guarda `link_id` (y la faena del enlace), **aunque el enlace esté revocado o
   vencido**: un teléfono usando un enlace muerto es justo lo que TI tiene que
   ver.
6. PPA con `worksiteId`: se guarda sólo si la faena existe.
7. Upsert del estado del dispositivo y suma del día (ver 5.3). Responde 204 sin
   cuerpo, también cuando pasa el límite (429 sin cuerpo).

No se guarda la IP.

### 5.3 Datos (una migración)

- **`pwa_devices`**: PK `(app, device_id)`. Es el último estado conocido.
  Columnas:
  - `first_seen_at`, `last_seen_at`;
  - `version`, `installed`, `platform`;
  - `pending_count`, `failed_count`, `oldest_pending_at`, `last_attempt_at`;
  - `last_error`, `last_error_at` (se conserva el último error aunque el aviso
    siguiente llegue sin error, para poder decir «último error hace 2 días»);
  - `user_id` (FK users, set null);
  - `worksite_id` (FK worksites, set null);
  - `tae_link_id` (FK `fuel_tae_public_links`, set null).

  Lleva CHECK de `app` y de conteos ≥ 0.
- **`pwa_device_days`**: PK `(app, device_id, day)` con un contador de avisos.
  Sirve para «teléfonos activos por semana».

Sin purga en v1: son decenas de dispositivos. La pantalla ignora los
dispositivos sin aviso en más de 90 días.

### 5.4 Estado de un teléfono (función pura, con tests)

Con el último aviso y `now`:

| Estado | Regla |
|---|---|
| **Con error** | `failed_count > 0`: envíos que el servidor rechazó y que necesitan una persona |
| **Atascado** | `pending_count > 0`, el pendiente más antiguo tiene más de 1 h y el aviso es de las últimas 24 h. El teléfono tuvo señal para avisar, pero no logró enviar |
| **Sin señal / sin abrir** | último aviso hace más de 24 h con pendientes, o hace más de 7 días sin pendientes. No es un error de la app: hay que ir a ver el teléfono |
| **Al día** | el resto |

**Versión atrasada**: `version` distinta del identificador del build que corre en
el servidor. Es un indicador aparte del estado.

Los umbrales (1 h, 24 h, 7 días) son constantes con nombre. Ver §6.

### 5.5 Pantalla `/ti/apps` (la lista)

Tres tarjetas, una por app, que abren `/ti/apps/[app]`. Sin tira de cifras
arriba: con tres apps, la tarjeta ya es el resumen.

```
┌───────────────────────────────────────────────────────────────┐
│ [icono] PPA Digital                          [Requiere atención]│
│ Evaluación preventiva del trabajador · /ppa                    │
│ 14 teléfonos activos · 1 atascado · 3 con versión atrasada     │
│ Último aviso hace 12 min · último envío hace 2 h               │
└───────────────────────────────────────────────────────────────┘
┌─ [icono] Mantención ──────────────────────────── [Al día] ─────┐
┌─ [icono] Control TAE ─────────────────────── [Sin avisos aún] ─┐
```

La insignia de cada tarjeta:

- **Requiere atención**: algún teléfono con error o atascado, versión atrasada,
  o un acceso por vencer.
- **Al día**.
- **Sin avisos aún**: no ha llegado ningún aviso desde el deploy.
- **Desactivada**: el módulo está apagado.

Al pie va una nota de una línea: desde cuándo llegan avisos y qué es un teléfono
activo.

### 5.6 Pantalla `/ti/apps/[app]` (el detalle)

`PageHeader` con el nombre de la app, migas Inicio › TI › Apps › app, y la
acción «Abrir app» (como hoy). En Mantención se suma «Instalar en un teléfono»,
reutilizando `MechanicAppInstallDialog`, si aplica.

Las secciones, en este orden:

1. **Tira de 4 cifras** (`SummaryBar`). Cada cifra filtra la tabla de teléfonos
   por `?estado=`:
   - Teléfonos activos (aviso en 7 días), con «de N vistos en 90 días».
   - Atascados o con error.
   - Con versión atrasada.
   - Sin señal / sin abrir.
2. **Teléfonos** (`DataTable` con la búsqueda de la TopBar). Columnas:
   - Teléfono: plataforma e id corto. En Mantención va el nombre de la persona
     si la credencial la identificó.
   - Faena o enlace: en TAE, el rótulo del enlace y su estado si está revocado o
     vencido; en PPA, la faena.
   - Versión: con la insignia «Atrasada» si corresponde.
   - Instalada o Navegador.
   - Pendientes: «3 · desde hace 5 h».
   - Último error y su fecha.
   - Último aviso.
   - Estado (insignia de 5.4).

   El filtro activo se muestra como chip removible. Estado vacío: «Aún no llegan
   avisos de esta app. Empiezan cuando alguien la abre con la versión publicada
   el …», con la CTA «Abrir app».
3. **Demora de llegada** (con datos que ya existen; no depende del aviso).
   - Contenido: mediana y p90 por semana, 12 semanas, del tiempo entre que se
     llenó o firmó y que llegó al servidor, más el % de envíos hechos sin señal.
     Es un solo gráfico de líneas, con `lazyChart`.
   - Mantención: `received_at − signed_at`, sin señal = `offline_since` no nulo.
   - TAE: `created_at − loaded_at` con `source='public_pwa'`, sin señal =
     `loaded_at_source='device_offline'`.
   - PPA: `created_at − filled_at`; `filled_at` nulo cuenta como 0 y en línea.
4. **Uso**: quién la usa y quién dejó de enviar.
   - Por faena en PPA, por persona en Mantención y por enlace en TAE.
   - Columnas: teléfonos activos (del aviso), último envío, envíos en 30 días
     (como señal de uso, sin desglose de negocio) e insignia «Dejó de enviar»
     cuando tenía envíos en los 30 días previos y ninguno en los últimos 7.
   - Se acota con `serviceWorksiteScope(session)`, como el detalle actual.
5. **Accesos** (sólo Mantención y TAE), con datos que ya existen. Cada uno lleva
   «Administrar» hacia la pantalla del módulo.
   - Mantención: credenciales vigentes, vencen en 7 días, sin uso en 14 días y
     revocadas en 30 días, desde `mant_device_credentials`.
   - TAE: enlaces vigentes, vencidos, vencen en 7 días y sin uso en 14 días,
     desde `fuel_tae_public_links`.
6. **Calidad de captura** (sólo PPA y TAE), datos que ya existen:
   - % de identificación manual por faena (trabajador no encontrado en la
     nómina), que es un problema de datos maestros;
   - TAE: % de lecturas de medidor tomadas por OCR contra digitadas a mano, y la
     confianza media del OCR, por semana.

**Alcance por faena.** Todo el detalle (tira, tabla de teléfonos, demora y uso)
se acota con `serviceWorksiteScope(session)`. Un rol global, como `tecnico_ti`
(`isGlobal: true` en `lib/auth/system-rbac.ts:44`), lo ve todo. Un rol acotado
ve sólo las filas de sus faenas. Los teléfonos sin faena conocida, como los del
mecánico o un teléfono PPA que todavía no envía, sólo los ven los roles globales.

Las secciones 3 a 6 son tarjetas flotantes (`bg-white border rounded-2xl p-6
shadow-xs`). Si una no tiene datos, muestra su estado vacío, no un cero pelado.

### 5.7 Pantalla `/ti/integraciones`

Se muda lo que hoy está en la sección «Integraciones y tareas programadas» del
detalle de cada app, ahora para todos los jobs juntos:

- `PageHeader` «Integraciones», con la descripción «Sincronizaciones y tareas
  programadas: si corrieron bien y a tiempo.».
- `SummaryBar` con 4 cifras: Al día, Con falla, Detenidas y Sin corridas. Cada
  una filtra por `?estado=`.
- Lista agrupada por módulo (rótulo del módulo del registry). Cada job lleva:
  nombre, insignia de estado (`INTEGRATION_STATUS_META`), última corrida, fallas
  en 7 días y el detalle del último error si falló. El desplegable «Últimas
  corridas» reutiliza la tabla actual.
- Se reutilizan `APP_CRON_JOBS`, `integrationStatus()` y `getAppCronRuns()`.
  Pueden moverse a un archivo de integraciones si el constructor lo prefiere.
- Ítem de menú «Integraciones» en `modules/ti/manifest.ts`, grupo «Seguimiento»,
  justo después de «Apps», con permiso `ti:view`.

### 5.8 Lo que se elimina y lo que cambia alrededor

- Se van la tabla de módulos (`apps-table.tsx`), `getAppsOverview`,
  `getAppWorksiteUsage`, el mapeo `entity_type → app` (`ENTITY_EXACT`,
  `ENTITY_PREFIXES`, `appForEntityType`), `activityNote` y los tests que sólo
  cubrían eso.
- **Se queda** el catálogo de módulos `APPS` / `findApp` (lo usa el lanzador ⊞),
  el registro de visitas (`app_visits`, recientes del lanzador) y su ruta. Se
  actualiza el comentario de `db/schema/app-visits.ts`, que dice que existe para
  TI › Apps.
- El enlace del pie del lanzador sigue llevando a `/ti/apps`. Su texto «Ver uso
  de las apps» pasa a «Apps del teléfono».
- El comentario del ítem «Apps» en `modules/ti/manifest.ts` se actualiza.

### 5.9 Verificación esperada

- **Unitarias:**
  - estado del teléfono y versión atrasada (5.4);
  - validación del payload;
  - freno del aviso en el cliente;
  - el helper `isStandalone`;
  - en PPA, `failureKind` (rechazo contra red agotada) y que `purgeExpiredPpas`
    ya no borre ítems sin enviar;
  - `lib/build-info.ts` (con y sin sha).
- **PGlite:**
  - upsert del aviso;
  - mapeo de `linkHash` a enlace, también revocado;
  - credencial mala que deja el aviso anónimo;
  - módulo apagado que descarta;
  - cuota;
  - consultas de demora y de uso.
- **Tests de cliente existentes** que se tocan: `lib/pwa/offline-queue.test.ts`,
  `lib/pwa/tae-offline-queue.test.ts`,
  `app/(public)/tae/access/[accessToken]/access-activation.test.tsx` (mockea el
  módulo de la cola de TAE), los de `lib/mantencion/client/__tests__/` y
  `components/mantencion/app/__tests__/mant-app.test.tsx`.
- **E2E:**
  - `/ti/apps` → detalle → filtro por estado;
  - `/ti/integraciones` con filtro;
  - abrir `/ppa` y `/tae` genera un aviso (mirando la red o la base);
  - los specs existentes de PPA y TAE siguen verdes.
- **Navegador:** recorrido de las tres pantallas en el dev con datos sembrados
  (avisos `QA_` en los cuatro estados), consola y red limpias.

## 6. Decisiones que tomé yo (corregibles)

- Los nombres de las apps salen del `short_name` de su manifest.
- La ruta del aviso es `/api/pwa/aviso`, separada de `/api/apps/*`.
- El aviso no se manda desde el service worker de TAE, se espera a la página.
- Umbrales: atascado a 1 h, sin señal a 24 h con pendientes o 7 días sin
  pendientes, activo a 7 días, se ignora después de 90 días, «dejó de enviar»
  con 30 días previos y 7 en cero, accesos por vencer en 7 días y sin uso en 14.
- La lista de `/ti/apps` no lleva tira de cifras: tres tarjetas.
- En Mantención se muestra el nombre de la persona asociada a la credencial.
  Para PPA y TAE no hay personas, sólo teléfonos.
- El texto del enlace del lanzador cambia a «Apps del teléfono».
- Sin purga de avisos viejos en v1.
- La versión es el sha corto que pasa el deploy al compilar, o la hora del build si
  no viene. Sale de un solo módulo para el aviso, la app del mecánico y los
  respaldos.
- En PPA (y en TAE si pasa lo mismo), un envío que agotó sus reintentos por red
  cuenta como pendiente, no como error. Sólo es error lo que rechazó el servidor.
- PPA deja de borrar evaluaciones sin enviar; el tope de 100 sigue igual.
- Cuotas del aviso: 600 por 5 min por IP y 20 por 5 min por dispositivo.
- El alcance por faena se aplica a todo el detalle. Los teléfonos sin faena sólo
  los ven los roles globales.

## 7. Lo que queda al constructor

- Confirmar la estrategia de navegación de `public/sw.js` (PPA) y
  `public/tae-sw.js` (TAE). TAE es network-first para navegación (`tae-sw.js:49-54`).
  Si un teléfono con señal pudiera quedarse con HTML/JS viejo sin el aviso,
  subir el `CACHE_NAME` para que se renueve.
- Elegir dónde viven el helper compartido del aviso (p. ej.
  `lib/pwa/heartbeat.ts`) y el de `isStandalone`.
- Elegir el gráfico existente para «Demora de llegada» y los componentes de
  tabla (`DataTable`, `StateBadge`/`MetaBadge`).
- Elegir cómo inventariar `/api/pwa/aviso` en el test de interruptores, ya que
  sirve a tres módulos y decide el módulo dentro del handler.
- Sembrar datos de QA en `bodega_dev` para verificar en el navegador.
