# Auditoría — Módulo de Adquisiciones (Plataforma Chome)

> Basada en el código real del repositorio. Cada hallazgo marcado **[Confirmado]** (deriva del código) o **[Por verificar]** (requiere runtime/BD).

## Estado de remediación

| ID | Hallazgo | Severidad | Estado |
|----|----------|-----------|--------|
| H-1 | `prevencionista` no puede aprobar EPP en la UI | Alto | ✅ Hecho |
| H-2 | `jefe_mantencion` no ve sus solicitudes en `/solicitudes` | Alto | ✅ Hecho |
| H-3 | Export de solicitudes ignora filtro `requesterId` | Alto | ✅ Hecho |
| M-1 | Servicios entra en la cola genérica de aprobación | Medio | ✅ Hecho |
| M-2 | Tarea "Registrar entrega" no completable por `solicitante_faena` | Medio | ✅ Hecho |
| M-3 | Recepción no captura rechazo/daño (reencuadrado) | Medio-Alto | ✅ Hecho (feature + migración 0029) |
| M-4 | Estado "En compra" para ítems ya recibidos | Medio | ✅ Hecho (relabel "En proceso") |
| B-1 | Dueño elimina solicitud sin `requests:delete` | Bajo→Medio | ✅ Hecho (subconjunto owner-deletable) |
| B-2 | Transición `purchased→pending_purchase` fuera de la máquina | Bajo | ✅ Hecho (documentado) |
| B-3 | `prevencionista` en recepción `directo_faena`: form muerto | Bajo | ✅ Hecho |
| B-4 | `EPP_APPROVER_ROLES` redundante / divergente | Bajo | ✅ Hecho (fuente única `./roles`) |
| B-5 | `check` acepta `requestType` 'stock'/'mantencion' sin uso UI | Bajo | ⏭️ Diferido (data-safety: verificar filas antes) |
| B-6 | `/reportes` incluye recepciones `worksiteId IS NULL` para scoped | Bajo | ✅ Hecho |

Leyenda: ⏳ Pendiente · 🔧 En curso · ✅ Hecho · ⏭️ Diferido (decisión de producto)

---

## Hallazgos por severidad

### 🔴 H-1 — `prevencionista` no puede aprobar/rechazar EPP en la UI (backend sí)
- **[Confirmado]**
- `app/(app)/aprobaciones/page.tsx:273` calcula `canApproveEpp` solo con `["administrador","jefa_chome","secretaria"]` (omite `prevencionista`).
- `app/(app)/aprobaciones/request-group.tsx:37`: `canApproveThisRequest = requestType !== "epp" || canApproveEpp`.
- Backend `app/(app)/aprobaciones/actions.ts:17` `EPP_APPROVER_ROLES` **sí** incluye `prevencionista`.
- **Fix:** calcular `canApproveEpp` con las 4 roles; separar el gate del selector de modo de despacho (que sí es solo admin/jefa/secretaria = `DISPATCH_DECIDER_ROLES`).

### 🔴 H-2 — `jefe_mantencion` no ve sus propias solicitudes en `/solicitudes`
- **[Confirmado en código; Por verificar asignaciones]**
- `app/(app)/solicitudes/page.tsx:31-43` condiciona el filtro de faena a la *permission* `view_all`, no a `isGlobalRole`. `jefe_mantencion` es global, sin `view_all` y sin `worksiteIds` → `sql\`false\`` → cero filas.
- Contraste correcto en `app/(app)/compras/page.tsx:39` (usa `isGlobalRole`).
- **Fix:** condicionar el filtro por `isGlobalRole(session)`; para global sin `view_all`, filtrar solo por `requesterId`.

### 🔴 H-3 — Export de Solicitudes no aplica filtro `requesterId`
- **[Confirmado]**
- `lib/reports/export-module/solicitudes.ts:12-18` filtra solo por faena. La pantalla filtra además por `requesterId` para `view_own`.
- Endpoint `app/api/reportes/export/route.ts:26` autoriza con `canAny("requests:view_own","requests:view_all")`.
- **Fix:** en `solicitudesList`, si la sesión no tiene `requests:view_all`, añadir `eq(requesterId, session.user.id)`.

### 🟠 M-1 — Servicios entra en la cola genérica de aprobación
- **[Confirmado la asimetría; Por verificar intención]**
- `app/(app)/aprobaciones/page.tsx:44` solo excluye `requestType != 'repuestos'`. Servicios usa el mismo submit que pone ítems en `requested` (`lib/requests/request-service-module/submit-request.ts:49`).
- **Fix:** `requestType NOT IN ('repuestos','servicios')`.

### 🟠 M-2 — Tarea "Registrar entrega" no completable
- **[Confirmado]**
- `lib/work-queue-builders.ts:125-138`: gate `warehouse:register_movement`, href `/entregas`. `/entregas` exige `deliveries:create` para enviar. `solicitante_faena` tiene el primero, no el segundo.
- **Fix:** gate por `deliveries:create` (entrega a trabajador).

### 🟠 M-3 — La recepción no captura rechazo/daño (REENCUADRADO tras revisión)
- **[Confirmado — más grave de lo detectado inicialmente]**
- Al implementar el fix se descubrió que **el formulario de recepción hardcodea `quantityRejected: 0` y `quantityDamaged: 0`** (`app/(app)/recepcion/receipt-form.tsx:73-74`). La UI **no captura rechazo ni daño en ningún caso**, no solo el "rechazo total". Las columnas `quantity_rejected`/`quantity_damaged` y la lógica del servicio existen pero están muertas desde la UI.
- Constraints que además bloquean el rechazo total: `check receipt_items_quantities_valid` exige `quantityReceived > 0` (`db/schema/receiving.ts:49`); el servicio también (`lib/services/receiving.ts:122`); y la acción filtra líneas con `quantityReceived > 0` (`app/(app)/recepcion/actions.ts:81`).
- **Por qué se DIFIERE (no es fix de una línea):** requiere (1) decisión de producto sobre cómo se representa rechazo/daño en recepción (¿campos por línea?, ¿motivo obligatorio?, ¿afecta cierre de OC?), (2) inputs nuevos en `receipt-form.tsx`, (3) relajar `receiptItemSchema.quantityReceived` a `>= 0` con invariante `recibido+rechazado+dañado > 0`, (4) ajustar el servicio para no transicionar ítem ni generar stock cuando `qtyRec = 0` y setear `status` de la línea a `rejected`/`damaged`, (5) **nueva migración** (no editar journal/migraciones previas) que reemplace el `check` por `quantityReceived >= 0 AND ... AND (recibido+rechazado+dañado) > 0`.
- **Plan de implementación:** ver "Trabajo faltante" abajo.

### 🟠 M-4 — Estado "En compra" para ítems ya recibidos
- **[Confirmado]** `rollupRequestStatus` marca `in_purchasing` con cualquier `received`/`partially_delivered` (`lib/services/item-state-module/rollup.ts:27,39`). Label "En compra".
- **Fix (UX):** badge de lista basado en `requestCurrentStage` por ítems, o estados nuevos de solicitud.

### 🟢 Bajos
- **B-1** `app/(app)/solicitudes/actions-module/delete.ts:18-33` permite a dueño eliminar sin `requests:delete` (acotado por estados borrables).
- **B-2** `cancelOrder`/`deleteOrder` hacen `purchased→pending_purchase` por SQL directo (no en la máquina de estados).
- **B-3** `app/(app)/recepcion/nueva/page.tsx:27-28,95-96`: `prevencionista` en OC `directo_faena` obtiene form sin acciones.
- **B-4** `EPP_APPROVER_ROLES` == holders de `approvals:approve` (diferenciación muerta).
- **B-5** `db/schema/requests.ts:38` acepta `requestType` 'stock'/'mantencion' no usados en UI.
- **B-6** `app/(app)/reportes/page.tsx:33` incluye recepciones `worksiteId IS NULL` para scoped (bajo impacto).

---

## Registro de cambios

### Tanda 1 — 2026-07-08 (typecheck OK, tests verdes)

- **H-1 ✅** `app/(app)/aprobaciones/page.tsx`: `canApproveEpp` ahora incluye `prevencionista` (4 roles). Nuevo flag `canSetDispatch` (3 roles) separa el selector de despacho. Propagado por `approval-panel.tsx` → `request-group.tsx` (el selector ahora usa `canSetDispatch`). Copy en `item-row.tsx`: "Requiere Jefatura, Secretaría o Prevención".
- **H-2 ✅** `app/(app)/solicitudes/page.tsx`: el filtro de faena se condiciona a `isGlobalRole`; roles globales sin `view_all` (jefe_mantencion) filtran solo por `requesterId`.
- **H-3 ✅** `lib/reports/export-module/solicitudes.ts`: agrega `eq(requesterId, self)` cuando la sesión no tiene `requests:view_all` (espeja la pantalla).
- **M-1 ✅** `app/(app)/aprobaciones/page.tsx`: la cola excluye `requestType NOT IN ('repuestos','servicios')`. Verificado que `selectQuotation` aprueba los ítems de servicios (vía propia completa), así que no quedan varados.
- **M-2 ✅** `lib/work-queue-builders.ts`: la tarea `warehouse_delivery` se gatea por `deliveries:create` (coincide con `/entregas`). Test nuevo en `lib/__tests__/work-queue.test.ts` que verifica que `warehouse:register_movement` solo NO genera la tarea.
- **B-3 ✅** `app/(app)/recepcion/nueva/page.tsx`: redirige a `/recepcion` si el usuario no puede ni oficina (considerando `directo_faena`) ni faena.

Tests corridos: `work-queue`, `report-export`, `request-actions`, `request-type-permissions`, `report-export-route`, `receipt-form` → **todos verdes**. `tsc --noEmit` sin errores en los archivos tocados.

### Tanda 2 — 2026-07-08

- **M-3 ✅** Captura de rechazo/daño en recepción (feature completa):
  - `lib/validation/operations.ts`: `receiptItemSchema.quantityReceived` pasa a `>= 0` con `.refine` (`recibido+rechazado+dañado > 0`).
  - `lib/services/receiving.ts`: acepta `qtyRec = 0`; status de línea `rejected`/`damaged`; no suma stock ni avanza el ítem cuando no hubo cantidad buena.
  - `app/(app)/recepcion/actions.ts`: `nonZeroItems` cuenta líneas con recibido/rechazado/dañado.
  - `app/(app)/recepcion/receipt-form.tsx`: columnas **Rechazado** y **Dañado** por línea (con scroll horizontal), envía sus cantidades.
  - `db/schema/receiving.ts` + **migración `0029_outgoing_moondragon.sql`**: reemplaza el `check` por `>= 0 ... AND (suma) > 0` (generada con `db:generate`, journal intacto).
  - Tests: 2 casos nuevos en `operations-validation.test.ts` (rechazo total válido / todo-cero inválido). Suites `receiving-service`, `receiving-concurrency-postgres`, `receipt-form` verdes.
  - Nota: `receiving-two-stage.test.ts` falla al cargar por un problema **preexistente** de resolución de `next/server` (confirmado con los cambios stasheados); no relacionado.

### Tanda 3 — 2026-07-08 (tsc OK · 198 tests verdes en 12 suites)

- **M-4 ✅** Relabel del estado de solicitud `in_purchasing` a "En proceso" (`components/states/state-badge.tsx` badge de lista, antes "En OC"; `lib/work-queue-labels.ts` `requestStatusLabel`, antes "En compra"). Evita el badge engañoso para ítems ya recibidos/en entrega. El detalle sigue mostrando la etapa precisa vía `requestCurrentStage`.
- **B-1 ✅** (subió de severidad al revisar: `DELETABLE_REQUEST_STATUSES` incluía `submitted`/`in_review`/`partially_approved`). Nuevo `OWNER_DELETABLE_REQUEST_STATUSES` (`draft`/`returned`/`rejected`/`cancelled`) en `requests-delete.constants.ts`. `delete.ts`: el dueño sin `requests:delete` solo puede borrar fuera del pipeline de aprobación. `request-list.tsx`: el botón se alinea. Tests nuevos (bloqueo B-1 + borrado privilegiado de `submitted`).
- **B-2 ✅** Documentada la excepción de rollback `purchased→pending_purchase` en `item-state-module/types.ts`.
- **B-4 ✅** Fuente única de verdad de roles: nuevo `app/(app)/aprobaciones/roles.ts` (`EPP_APPROVER_ROLES`, `DISPATCH_DECIDER_ROLES`, helpers) consumido por `page.tsx` y `actions.ts`. Elimina la raíz que causó H-1.
- **B-6 ✅** `reportes/page.tsx`: usuario scoped ya no ve recepciones con `worksiteId IS NULL` (aislamiento de faena).

Suites verdes: `work-queue`, `operations-validation`, `delete-request-action`, `requests-delete`, `request-actions`, `report-export`, `report-export-route`, `receiving-service`, `purchasing-service`, `trazabilidad-export`, `trazabilidad-export-scope`, `receipt-form`.

---

## Trabajo faltante

### Diferido (con motivo)
- **B-5 (Bajo) — data-safety.** El `check` de `requests` acepta `requestType` 'stock'/'mantencion' no usados por la UI. **No se tightening** sin antes confirmar que no existen filas con esos valores en prod: `SELECT DISTINCT request_type FROM purchase_requests;`. Si el resultado es solo `epp/otro/repuestos/servicios`, generar migración que restrinja el `check`.

### Tests recomendados aún no agregados
- H-1: render de `RequestGroup`/`page` con `prevencionista` → botones de aprobar EPP presentes; selector de despacho ausente.
- H-2: integración `solicitudes/page` para global sin `view_all` (ve sus solicitudes).
- H-3: `solicitudesList` con sesión `view_own` → solo filas del `requesterId` (requiere fixture DB).
- M-1: solicitud de servicios enviada NO aparece en `/aprobaciones`.
- E2E: llamadas directas a Server Actions/endpoints de export con roles no autorizados → 403 / `{ok:false}`.

### Verificaciones runtime pendientes (BD/pantalla)
- **H-2:** confirmar que `jefe_mantencion` no tiene faenas asignadas: `SELECT worksite_id FROM user_worksites uw JOIN users u ON uw.user_id=u.id WHERE u.email='<jefe_mant>'` (esperado 0 filas). Ya funciona con el fix aunque tuviera algunas.
- **H-1:** loguear como `prevencionista`, abrir `/aprobaciones` con una solicitud EPP y confirmar botones Aprobar/Rechazar + ausencia del selector de despacho.
- **M-1:** enviar una solicitud de servicios y confirmar que NO aparece en la cola ítem-a-ítem.
