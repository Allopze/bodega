# QA — Órdenes de trabajo en Mantención y retiro del módulo antiguo (2026-11-02)

Rama `feat/mantencion-ot`. Plan aprobado por el usuario el 2026-11-02, a partir de la auditoría
`qa/reports/auditoria-flujo-ot-2026-11-01.md`. La OT reproduce el talonario «Orden de Trabajo
Reparación/Mantención» (Nº 32401).

## Qué cambió

- **Retiro del módulo antiguo `mantenciones`.** Se borran:
  - las rutas, los servicios y los crons de `/mantenciones`;
  - los permisos `mantenciones:*` (los retira `db:sync-rbac`);
  - el interruptor del módulo;
  - las tablas `maintenance_*`, en la migración `0368_drop_legacy_maintenance`.

  En producción las siete tablas y todo lo que dependía de ellas tenían **0 filas** (lectura READ ONLY,
  2026-11-02). Las tablas quedaron en `LEGACY_ACTION_TABLES` del preflight. Sale también todo
  costo de mantención de Flota, Control operacional, Tablero y Analítica.
- **OT nueva en `/mantencion`.**
  - Tablas `mant_work_orders`, `mant_work_order_items` y `mant_work_order_events`, más
    `mant_records.work_order_id` (migración aditiva `0369`). Folio por faena: `OT-BIO-0001`.
  - Estados: solicitada → asignada → en taller → por recibir → por conformidad → cerrada, más
    anulada. Un rechazo vuelve la OT a «en taller» con el mismo mecánico.
  - Permisos `mant:ot:*`:
    - el administrador de contrato crea, recibe y da conformidad en sus faenas;
    - la jefatura de mantención gestiona y asigna;
    - los mecánicos ejecutan, en cualquier faena.
  - Avisos después del commit, con destinatarios elegidos por permiso y faena.
  - Web (lista, «Nueva OT», detalle, PDF calcado del talonario) y app del mecánico (Mis OT, OT
    disponibles, ingreso, ítems SÍ/NO, correctiva enlazada, terminar).
  - Cifras de OT en Flota, Control operacional y Tablero.
  - Un hallazgo de inspección de vehículo crea la OT, y la conformidad de esa OT acredita la CAPA.

## Puertas deterministas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK (exit 0) |
| `npm run lint` | OK |
| `db:verify-migrations` | OK, 370 entradas hasta `0369_mantencion_work_orders`; sin identificadores largos nuevos ni `DROP` sin guarda |
| `npm run db:generate` | «No schema changes» |
| `test:fast` | 16 706 pasan. Tras la corrida completa fallaron 2, ambas por la integración, y ya están corregidas: el inventario de capturas de rutas y el orden esperado del menú. Las dos pasan aisladas. |
| `test:pglite` | 3 880 pasan. Fallaron 6 de la prueba de inspecciones por un fixture (`nameKey`), ya corregido: 6/6 aislada. |
| Pruebas nuevas | `mantencion-work-orders-pglite` (42), `mantencion-work-orders-sync-pglite` (16), `mantencion-work-orders-metrics-pglite` (26), `inspection-capa-lifecycle-pglite` (6), cliente de la app (337 en `lib/mantencion` + `components/mantencion/app`), web (51) |

La suite completa no se volvió a correr después de los últimos ajustes de integración. Sí se
corrieron, aislados, los archivos afectados.

## E2E (worktree desechable, `bodega-e2e-postgres` :55432, chromium)

| Spec | Resultado |
|---|---|
| `mantencion-5-ot` (nueva, de punta a punta) | 7/7 |
| `mantencion-1-app` / `2-jefatura` / `3a-equipos` / `3b-pautas` / `4-permisos` | 7/7 · 13/13 · 8/8 · 15/15 · 5/5 |
| `legacy-mantenciones-retired` | 1/1 |
| `prevencion-inspecciones-cierre` | 9/9 |
| `control-operacional-navegacion` · `densidad-kpi` · `densidad-kpi-filtros` · `flota` | 27/27 · 18/18 · 13/13 · 2/2 |

`mantencion-5-ot` recorre este flujo:

1. El administrador de contrato de Biodiversa crea la OT.
2. La jefatura recibe el aviso en la campana y asigna a un mecánico **de Cholguan**.
3. En la app, el mecánico ve «Equipo de otra faena», registra el ingreso, marca SÍ/NO, comprueba
   que no puede terminar sin registro, registra la correctiva enlazada y termina.
4. El administrador de contrato recibe el equipo y rechaza en la conformidad.
5. La app muestra «Devuelta: motivo». El mecánico registra una correctiva nueva y termina de nuevo.
6. Recepción y conformidad: la OT queda cerrada.
7. Se comprueban el PDF y el alcance: el administrador de contrato de Cholguan recibe 404 sobre la
   OT de Biodiversa.

Consola sin errores en cada actor.

No se corrieron: los proyectos móviles (requieren `E2E_MOBILE_BROWSERS=1`) y la suite E2E completa.

## Recorrido asistido en navegador

Se usó una copia desechable de desarrollo (`bodega_ot_qa`, copiada de `bodega_dev` y migrada a 0369)
en `next dev` :3002, con un usuario `QA_ Admin OT` creado sólo en esa copia.

- **PASS: lista `/mantencion/ot`.** Pestañas, filtros, búsqueda propia y estado vacío con CTA. El
  menú muestra «Órdenes de trabajo» encabezando el grupo Mantención.
- **PASS: crear.** Equipo, REPARACIÓN + MANTENCIÓN e ítems → `OT-ARA-0001`, «Por asignar».
- **PASS: asignar.** El selector lista mecánicos de todas las faenas.
- **PASS: ingreso a taller.** El equipo pasa a `mantencion` con el motivo
  `OT-ARA-0001: Ingreso a taller`.
- **PASS: guardias de salida.** Sin ítems marcados: «faltan 2». Tras un rechazo: «registra una
  correctiva o preventiva nueva desde esta OT».
- **PASS: rechazo en la conformidad.** La OT vuelve a «En taller», con el aviso «devuelta una vez»,
  el motivo y el historial completo.
- **PASS: cierre con conformidad.** La OT queda «Cerrada» y el equipo vuelve a `operativo`.
- **PASS: avisos.** `mant_ot_created` llegó a Alexis (`jefe_mantencion`) y a los administradores. El
  aviso de asignación no se emite cuando quien asigna es el mismo asignado.
- **PASS: PDF.** 200 `application/pdf`, una página. La página de impresión calca el talonario.
- **PASS: rutas.** Control operacional muestra el tile «OT abiertas», «Horas en taller» y MTTR.
  `/flota`, el tablero y la lista de cerradas responden 200. `/mantenciones` responde 404.
- **PASS: anchos.** Sin desborde horizontal a 1280 ni a 390 px.

Consola: el único error fue el 404 esperado de `/mantenciones`. Red: sin respuestas 5xx.

Notas del entorno:

- El primer intento de PDF dio 502 porque `PDF_RENDER_ORIGIN` de `.env.local` apunta a :3001, el
  servidor de `main`, que no tiene la página de impresión de OT. No es un defecto: con el origen en
  :3002 respondió 200.
- La copia necesitó la limpieza auditada de Aramco (`scripts/retire-aramco.ts`) para aplicar la 0367
  de `main`.
- El **preflight bloqueó la 0368** mientras quedaban 2 OT `QA_` antiguas en la copia. Es la guarda
  funcionando. Se borraron sólo ahí y la migración siguió.

## Hallazgos

| Tipo | Hallazgo |
|---|---|
| UX FINDING | En «En taller» el encabezado del detalle muestra 7 acciones. A 1440 px caben, pero truncan la migaja y bajan el subtítulo. Conviene agrupar las secundarias (Corregir ingreso, Descargar PDF, Anular) en un menú «Más». |
| IMPROVEMENT | Los avisos llegan también a todos los `administrador`, que tienen todos los permisos. Si molesta, filtrar a usuarios asignados a la faena. |
| FUNCTIONAL FINDING | Un hallazgo de inspección sobre un equipo sin ficha en el módulo de mantención deriva la CAPA, pero **no** abre OT; la respuesta lo dice. Hoy en producción ningún equipo tiene ficha, porque el seed P4 está pendiente: hasta cargarlo, las inspecciones no abrirán OT. |
| COVERAGE GAP | No hay prueba en navegador de punta a punta del cierre de la CAPA por conformidad. Está cubierto en PGlite (`mantencion-work-orders-pglite`). |
| COVERAGE GAP | La lectura del ingreso a taller no se suma al historial de lecturas del equipo. |
| COVERAGE GAP | Faltan las E2E móviles y la suite E2E completa. |

## Pendiente para el despliegue

1. Despliegue (lo corre el usuario). Viajan juntas la 0368 (borra tablas, protegida por el
   preflight) y la 0369 (aditiva). Después, `db:sync-rbac` para los permisos `mant:ot:*` y el retiro
   de `mantenciones:*`.
2. Antes, repetir la lectura READ ONLY de las tablas `maintenance_*`. Si apareció alguna fila, el
   preflight detiene la migración.
3. Para usar la OT hacen falta el seed del módulo (P4), invitar a los mecánicos (P1) y que los
   administradores de contrato tengan su rol y su faena.
