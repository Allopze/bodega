# Auditoría del flujo de adquisiciones

**Fecha:** 2026-08-07 · **Alcance:** árbol de trabajo actual (incluye el rediseño del flujo lineal del mismo día, aún sin commitear; migración `0141_simplify_acquisitions.sql` pendiente de aplicar en dev).
**Método:** seis auditorías independientes en paralelo (lógica de negocio, integridad/concurrencia, seguridad/permisos, UI/UX/a11y/responsive, tests, arquitectura/rendimiento) + verificación adversarial cruzada de los hallazgos de mayor severidad + sondas de invariantes contra la BD de desarrollo (solo lectura) + ejecución de las suites unit y PGlite del flujo.
**Convergencia:** los hallazgos principales fueron encontrados por ≥2 auditores independientes o verificados línea a línea antes de reportarse. Total: **~65 hallazgos únicos** tras deduplicación (78 brutos).

---

## 1. Resumen ejecutivo

El flujo de adquisiciones —solicitud → aprobación → orden de compra → recepción en dos etapas → entrega— está **bien construido en su núcleo**. La máquina de estados de ítems es explícita y centralizada (`lib/services/item-state-module/`), los caminos calientes (aprobar, emitir OC, recibir, entregar) usan `FOR UPDATE` + UPDATE con guarda de estado + `canTransition`, la autorización es sólida (cada server action con permiso concreto, scoping por faena y re-verificación en la capa de servicio dentro de la transacción), y la migración 0141 del rediseño es idempotente y con traza. Las sondas contra la BD de desarrollo no encontraron **ninguna** violación de invariantes producida por la aplicación (todas las anomalías presentes provienen de un seed demo anterior al rediseño).

Lo que falla se concentra en cuatro zonas:

1. **Dos bugs de producción con test rojo committeado** (previos al rediseño, ya en HEAD): el avance de recepción de la OC cuenta la llegada a oficina como "recibido" (TST-1) y el contador de alertas de trazabilidad descarta su propio query (TST-2). El proyecto PGlite está rojo en CI desde antes de ayer.
2. **Los caminos de "muerte" no limpian lo que el camino feliz reservó**: la brecha de reposición EPP queda suprimida para siempre si su solicitud se rechaza (LOG-1); cerrar una OC con mercadería solo en oficina la manda a re-compra y esfuma el registro físico (LOG-7); una solicitud cancelada puede resucitar vía rollup (LOG-2/DAT-2).
3. **El patrón TOCTOU en los caminos secundarios**: el factory de repuestos/servicios, la cancelación genérica y el borrado validan con `findFirst` fuera de la transacción y escriben sin guarda de estado — exactamente la disciplina que los caminos núcleo sí aplican (DAT-2/3/4/5/6).
4. **El camino de cotizaciones de repuestos/servicios está a medio coser en UX**: regla de ≥3 comunicada de tres formas distintas (ninguna correcta), doble mecanismo de captura que degrada los datos, errores de subida silenciados y una etapa entera (seleccionar ganadora) invisible para la cola operativa (UX-2/3/4/5, LOG-9).

No se encontró ningún hallazgo de nivel CRÍTICO según la rúbrica (ver §7). La seguridad es el área más fuerte (§10): sin IDOR, sin escalada, sin acciones retiradas ejecutables, archivos y descargas correctamente gateados.

## 2. Nota global

| Área | Nota | Justificación breve |
|---|---:|---|
| Lógica de negocio | 7,5 | Núcleo con transiciones validadas e idempotencia correcta; agujeros en caminos de cancelación/cierre (LOG-2/3/7) y regla de cotizaciones porosa (LOG-9) |
| Integridad de datos | 7,0 | CHECKs fuertes post-0141 y 0 violaciones reales en BD; pero varias invariantes solo-app (Σ recepciones, entregado≤recibido, una cotización ganadora) y trazabilidad asimétrica (DAT-10) |
| Seguridad y permisos | 9,0 | Matriz completa sin huecos; defensa en profundidad servicio+tx; 1 hallazgo bajo (SEC-1) y 2 informativos |
| Robustez | 7,0 | Locks y guardas ejemplares en caminos calientes; familia TOCTOU en secundarios; deadlock posible por orden de locks (DAT-18) |
| UI | 8,0 | Sistema consistente, badges/estados bien resueltos; tokens inexistentes en un aviso clave (UX-8) y dos bugs de pluralización |
| UX | 7,0 | Flujo lineal claro y bien coscido en listas/tabs; camino de cotizaciones áspero, submits sin pending (UX-1) y acción principal sin confirmación (UX-6) |
| Accesibilidad | 7,0 | Base correcta (labels, aria en la mayoría); 3 violaciones concretas: textarea sin label, selector solo-color, targets < 24px |
| Responsive | 7,5 | Patrones móviles aplicados casi en todo; una fila recortada sin scroll en /compras/nueva (UX-13) y una asimetría móvil/desktop |
| Rendimiento | 6,5 | Sin N+1 graves ni imports pesados; pero catálogo completo serializado en el detalle (ARQ-8/9) y waterfalls evitables en 5 páginas (ARQ-10) |
| Arquitectura | 7,5 | Rediseño limpio en el núcleo, constantes compartidas; un flujo paralelo muerto y divergente (ARQ-1) y sets de estados re-escritos en 5 sitios (ARQ-6) |
| Tests | 7,0 | 478 unit verdes + PGlite/e2e actualizados al vocabulario nuevo; 3 fallas PGlite en HEAD (2 son bugs reales), gaps en bulk-approve y directo_faena e2e |
| Mantenibilidad | 7,5 | Convenciones fuertes y comentarios de intención; código muerto del rediseño (ARQ-1/2/3), 17 casts `as unknown as`, vocabulario fantasma en CHECKs |

```text
NOTA GLOBAL: 7,4/10
```

## 3. ¿Está listo para producción?

```text
LISTO PARA PRODUCCIÓN CON CORRECCIONES MENORES
```

**Qué bloquea el nivel superior (LISTO PARA PRODUCCIÓN):**

1. **DAT-8 — corregir la migración 0141 ANTES de commitearla/aplicarla** (no limpia `sent_at`/`confirmed_at` al revertir `issued→draft`). Es una línea y todavía es gratis: la migración no está aplicada ni commiteada.
2. **TST-1 y TST-2 — dos bugs reales con test rojo en CI** (avance de OC inflado y contador de alertas descartado). Ya están en HEAD/producción; el release del rediseño no debería salir sin ellos.
3. **LOG-2 + DAT-2 — cerrar la resurrección de canceladas** (quitar `cancelled` de la guarda del rollup + validar el padre en `approveItem`). Dos cambios pequeños que eliminan la única vía de corrupción de estado encontrada.
4. **Recordatorio de deploy:** el release necesita `db:sync-rbac` (retiro de `requests:submit`) y código+migración en el mismo despliegue (la ventana migrate-antes-de-código rompe el código viejo, DAT-9).

**Por qué no es "NO LISTO":** no hay bypass de autorización, no hay corrupción producida por la app en datos reales, los caminos de dinero y stock están protegidos por BD (CHECKs + locks), y todos los escenarios adversariales de concurrencia del núcleo (doble aprobación, doble recepción, doble emisión, doble entrega, correlativos) están correctamente cerrados y testeados.

## 4. Arquitectura actual del flujo

**Pantallas / puntos de entrada:**

| Ruta | Rol en el flujo |
|---|---|
| `/solicitudes`, `/solicitudes/nueva`, `/solicitudes/[id]` | Crear y consultar solicitudes. EPP/otro nacen `submitted` (sin borrador); repuestos/servicios nacen `draft` para adjuntar ≥3 cotizaciones. `/repuestos/*` y `/servicios/*` son redirects al flujo unificado |
| `/aprobaciones` | Cola de aprobación por ítem (solo EPP/otro; repuestos/servicios se aprueban vía selección de cotización en el detalle) |
| `/compras`, `/compras/nueva`, `/compras/[id]` | Consolidado de ítems `pending_purchase` → crear OC por proveedor → emitir y enviar (un acto) → detalle con progreso, facturas, DTE, conciliación |
| `/recepcion`, `/recepcion/nueva`, `/recepcion/[id]` | Recepción en dos etapas (oficina → faena) para `via_oficina`; una etapa para `directo_faena`. La etapa faena genera stock |
| `/entregas` | Entrega a trabajador (EPP, con comprobante) o a faena; descuenta stock |
| `/pendientes` | Cola operativa transversal (aprobar, emitir, recibir oficina/faena…) |
| API | `GET /api/purchase-orders/invoices/[id]` (descarga factura), `POST /api/purchase-orders/invoices/extract` (OCR), descargas de cotizaciones y comprobantes |

**Capas:** page.tsx (RSC, consultas Drizzle directas) → componentes cliente → server actions (`actions*.ts`, guard de permiso + Zod + scoping) → servicios (`lib/services/*`, transacciones, locks, máquina de estados) → Postgres (CHECKs, uniques, FKs). Efectos secundarios: stock (`applyMovementTx`, único mutador), notificaciones (siempre post-commit vía `notifyAfterCommit`), archivos en `storage/` (escritos antes de la tx, unlink compensatorio en catch), `status_history` (traza de transiciones), `approval_decisions`, cadena documental (`document-chain`).

**Entidades:** `purchase_requests` (1) ←→ (N) `purchase_request_items` ← `request_item_attributes`, `approval_decisions`, `epp_replenishment_links` · `purchase_orders` (1) ←→ (N) `purchase_order_items` (FK a request item) ← `purchase_order_invoices`/`purchase_order_invoice_items`, `quotations` · `receipts`/`receipt_items` · `deliveries`/`delivery_items` · `worksite_stock` · `repuesto_quotations`/`service_quotations` · `code_sequences` (correlativos por secuencia nativa).

## 5. Mapa de estados y transiciones

### Ítem de solicitud (`purchase_request_items`) — terminales: `rejected`, `delivered`

| Estado | Cómo se llega | Acciones válidas | Rol autorizado | Siguiente estado | Validaciones | Efectos secundarios |
|---|---|---|---|---|---|---|
| `draft` | `persistDraft` (repuestos/servicios), duplicar | enviar, cancelar, eliminar | solicitante | `requested`, `rejected` (cancel) | ≥3 cotizaciones o justificación | history |
| `requested` | nace así (EPP/otro) o `submitItemTx` | aprobar, rechazar, cancelar | `approvals:approve` (+gate EPP por rol); repuestos/servicios: `X:approve` vía selección de cotización | `approved`, `rejected` | `canTransition` + FOR UPDATE + guarda | decisión, history, notificación post-commit, rollup padre |
| `approved` | aprobación / selección de cotización | añadir a OC, cancelar | `purchasing:create_order` | `in_purchase_order`, `rejected` (cancel) | qty OC ≤ aprobada, faena, proveedor activo | split si compra parcial; history |
| `pending_purchase` | rollback de OC (cancel/delete/close) o split | añadir a OC | `purchasing:create_order` | `in_purchase_order` | ídem | ídem |
| `in_purchase_order` | `addItemToPurchaseOrderTx` | emitir OC; anular/eliminar OC (rollback) | `purchasing:send_order` / `create_order` | `purchased` · `pending_purchase` | OC draft + FOR UPDATE | history OC + ítems |
| `purchased` | `issueAndSendOrder` | recibir (faena); anular OC | recepcion faena / compras | `partially_received`, `received` · `pending_purchase` | caps por etapa; CHECK BD contadores | stock (`ingreso_oc`), rollup OC y solicitud, cierre automático |
| `partially_received` / `received` | `receiveItemTx` | recibir saldo, entregar | `deliveries:create` | `received` · `partially_delivered`, `delivered` | entregado ≤ pedido (no ≤ recibido: LOG-5) | stock egreso, comprobante |
| `partially_delivered` | `deliverItemTx` | entregar saldo, recibir saldo | ídem | `delivered` (recepción conserva el estado) | suma bajo lock | ídem |

### Solicitud (`purchase_requests`)

Nace `draft` (repuestos/servicios) o `submitted` (EPP/otro, `createSubmittedRequest` — misma tx que la reserva EPP). `draft→submitted` vía factory (regla de cotizaciones). `submitted/in_review→approved` directo en `selectQuotation`. `cancelled` por dos caminos **divergentes** (LOG-3). El resto es **derivado** por `rollupRequestStatus` tras cada mutación de ítem, con precedencia: algún `requested` → `in_review` · todos `rejected` → `rejected` · todos `rejected/delivered` → `closed` · alguno en OC/recepción/entrega parcial → `in_purchasing` · si no → `approved`/`partially_approved`. La guarda del rollup incluye hoy `cancelled` y el muerto `returned` (LOG-2/12). Los cambios del padre **no dejan traza en history** (DAT-10).

### Orden de compra (`purchase_orders`)

`draft` (crear, por proveedor) → `sent` (`issueAndSendOrder`: issuedAt+sentAt en un acto, FOR UPDATE + guarda) → `partially_office_received → office_received → partially_received → received` (derivado de cantidades por `rollupOrderReceiptStatus`; `directo_faena` salta oficina) → `closed` (automático al completar, o manual con motivo desde cualquier estado de recepción — con el limbo de oficina de LOG-7). `draft` o `sent` → `cancelled` (`cancelOrder`); `deleteOrder` = cancelled + soft-delete + código renombrado `-DELETED-`. Ítems de OC: `issued → cancelled` únicamente (los valores `partially_received/received` del CHECK no los escribe nadie, ARQ-12).

**Recepciones** (`receipts`): nacen `closed`, inmutables (el estado `open` del CHECK es código muerto). **Entregas**: registro inmutable acumulado por `requestItemId`.

**Caminos ocultos detectados** (no visibles en la UI): aprobar/rechazar ítems de solicitudes canceladas o de repuestos/servicios invocando la action directamente (LOG-2); `updateSentOrderItems` como servicio completo sin UI (LOG-8); el rollup como "acción" implícita que reescribe el padre sin traza.

## 6. Matriz de roles y permisos

Verificada acción por acción (cuerpo completo de cada server action + manifests de roles). Convención: **A** = scoping por faena verificado en la action; **A(svc)** = el servicio re-valida faena/estado/pertenencia dentro de la transacción.

| Acción | Permiso real exigido | Scoping | Riesgo |
|---|---|---|---|
| Crear/enviar solicitud (EPP/otro y cotización) | `requests:create` / `permissionForRequestType` | A | OK (SEC-1: workerId sin validar contra faena) |
| Duplicar / cancelar / eliminar solicitud | `requests:create` + owner o `view_all`/`delete` | A | OK |
| Subir/borrar/seleccionar cotización | `X:submit` (requester-only) / `X:approve` | A + pertenencia | OK |
| Aprobar / rechazar / lote / modo de despacho | `approvals:approve` + gate EPP por rol; despacho además `DISPATCH_DECIDER_ROLES` | A (por ítem) | OK |
| Crear OC | `purchasing:create_order` | A + A(svc) por ítem con FOR UPDATE | OK |
| Emitir y enviar / cerrar / anular / eliminar OC | `purchasing:send_order` / `create_order` / `delete_order` | A + A(svc) | OK |
| Facturas (subir/borrar) y OCR | `purchasing:send_order` | A + líneas∈OC | OK (OCR sin rate-limit, SEC-3) |
| Descargar XML DTE | `purchasing:view` | ninguno | Informativo (SEC-2: hoy solo roles globales lo tienen) |
| Registrar recepción oficina / faena | `receiving:register_office` / `register_faena` | oficina: N/A (roles globales); faena: A + A(svc) | OK |
| Registrar entrega | `deliveries:create` | A + A(svc) worker∈faena | OK |
| Asignación de pendientes | `operations:assign_work` | A + elegibilidad por faena | OK |
| Descargas GET (facturas, cotizaciones, comprobantes) | sesión + permiso + faena del recurso + path-safe | A | OK |

Grants coherentes con la UI: `approvals:approve` = admin/jefa/secretaria/prevencionista; `purchasing:create_order`/`send_order` = admin/secretaria (+ `delete_order` jefa); `receiving:register_office` solo roles globales. Ningún rol de faena puede aprobar ni emitir.

## 7. Hallazgos críticos

**Ninguno confirmado con la rúbrica de CRÍTICO** (corrupción irreversible, bypass de autorización, operación financiera incorrecta sin intervención, bloqueo general). Se verificó explícitamente: doble ejecución de cada acción, sobre-recepción, sobre-entrega de stock, duplicación de correlativos, IDOR y acciones retiradas — todos cerrados.

Los tres hallazgos ALTO más cercanos al umbral, priorizados con Impacto × Probabilidad × Frecuencia (escala 1–5):

| ID | Hallazgo | I×P×F | Esfuerzo | Riesgo impl. |
|---|---|---|---|---|
| TST-1 | Avance de OC cuenta oficina como recibido (dato operativo falso en cada OC via_oficina) | 4×5×4 = 80 | XS | Bajo |
| LOG-1/DAT-7 | Brecha de reposición EPP suprimida para siempre al morir la solicitud | 4×4×3 = 48 | S | Bajo |
| LOG-2/DAT-2 | Resurrección de solicitudes canceladas + aprobación de repuestos sin cotización | 4×2×2 = 16 | S | Medio |

## 8. Hallazgos de lógica de negocio

```text
ID: TST-1
Título: getOcReconciliation cuenta la llegada a oficina como "recibido"
Categoría: lógica de negocio (dato derivado incorrecto)
Severidad: ALTO
Confianza: alta (verificado línea a línea; test rojo committeado lo documenta)
Archivo(s): lib/services/oc-reconciliation.ts:8-14
Pantalla / ruta: /compras/[id] (tabla de progreso y conciliación)
Estado del flujo: OC via_oficina en cualquier etapa de recepción
Descripción: el servicio suma receiptItems.quantityReceived de TODAS las recepciones sin join a receipts ni filtro locationType='faena'. En el flujo de dos etapas cada unidad pasa por oficina Y faena, así que el avance se infla (10/10 "recibido" cuando solo llegó a oficina).
Cómo reproducir: correr lib/__tests__/receiving-two-stage.test.ts ("no suma la etapa de oficina": expected 10 to be +0) — rojo en HEAD, previo al rediseño. El test se committeó en 0354850; el fix del servicio nunca se hizo.
Comportamiento esperado: solo la etapa faena cuenta como recibido (contrato que trazabilidad-matrix.ts:165-175 sí implementa).
Causa raíz: query sin la dimensión de etapa; el contrato se especificó en el test pero no se aplicó al servicio.
Impacto: quien mira la OC cree que la mercadería está en faena cuando está en oficina; decisiones de cierre y reclamo a proveedor sobre datos falsos.
Solución: join a receipts + eq(receipts.locationType,'faena') en el where.
Test de regresión: el que ya existe (pasará al arreglar el servicio).
```

```text
ID: LOG-1 (= DAT-7 = ARQ-7; hallado por 3 auditores independientes)
Título: La reserva de reposición EPP no tiene camino de liberación: una brecha cuya solicitud muere queda suprimida para siempre
Categoría: lógica de negocio / integridad
Severidad: ALTO
Confianza: alta (grep exhaustivo: cero escrituras de resolvedAt en el repo)
Archivo(s): lib/services/epp-replenishment.ts:72,115-128; db/schema/requests.ts:112-127
Pantalla / ruta: /solicitudes/nueva (sugerencias de reposición)
Estado del flujo: solicitud EPP creada desde sugerencia → ítem rechazado / solicitud cancelada / borrada
Descripción: al crear la solicitud se inserta epp_replenishment_links con resolvedAt NULL (única escritura de la tabla). listReplenishmentSuggestions filtra por isNull(resolvedAt); nada escribe resolvedAt jamás. gapVersion solo cambia con una entrega que nunca ocurrirá. El FK onDelete "set null" deja el link huérfano y sigue bloqueando.
Cómo reproducir: crear solicitud desde una sugerencia de brecha, rechazar el ítem en /aprobaciones, volver a /solicitudes/nueva: la brecha ya no se sugiere, y no volverá a sugerirse nunca.
Comportamiento esperado: la brecha reaparece cuando la reposición muere sin entregar.
Causa raíz: el rediseño convirtió el servicio en "solo sugiere" y la reserva quedó sin liberación en los caminos de muerte.
Impacto: trabajadores sin EPP desaparecen silenciosamente de las sugerencias de reposición (dato de seguridad laboral).
Solución: en rejectItem y en la cancelación, UPDATE epp_replenishment_links SET resolved_at=now() WHERE request_item_id IN (...) AND resolved_at IS NULL; saneo one-shot para links con ítem rechazado o requestItemId NULL.
Test de regresión: PGlite — "rechazar el ítem de una reposición vuelve a ofrecer la brecha".
```

```text
ID: LOG-2 (+ DAT-2)
Título: approveItem/rejectItem no validan estado del padre ni tipo de solicitud; el rollup puede resucitar canceladas
Categoría: lógica de negocio / máquina de estados
Severidad: ALTO
Confianza: alta (verificado: approval.ts no referencia al padre; rollup.ts:58 incluye 'cancelled' en la guarda)
Archivo(s): lib/services/item-state-module/approval.ts; rollup.ts:58; app/(app)/aprobaciones/actions.ts:26-201
Estado del flujo: solicitud cancelada (o repuestos/servicios) con ítems 'requested'
Descripción: dos vías. (a) El factory de repuestos/servicios cancela el padre SIN tocar los ítems (LOG-3): quedan 'requested' bajo un padre 'cancelled'. approveItemAction sobre uno de esos ítems pasa canTransition(requested→approved) y rollupRequestStatus reescribe cancelled→in_review/partially_approved: la solicitud revive sin traza (el rollup no escribe history, DAT-10). (b) La exclusión de repuestos/servicios de la aprobación por ítem vive SOLO en el filtro del listado (lib/approvals-queue.ts:34), no en la acción: un aprobador puede aprobar un repuesto directamente, esquivando la selección de cotización (y la regla de ≥3).
Cómo reproducir: (a) cancelar un repuesto desde su flujo; invocar approveItemAction con el itemId (visible en el detalle). (b) invocar approveItemAction sobre cualquier ítem 'requested' de una solicitud de repuestos.
Comportamiento esperado: aprobar/rechazar solo con padre en submitted/in_review/partially_approved y tipo EPP/otro; 'cancelled' terminal.
Causa raíz: reglas de elegibilidad implementadas en el filtro de la cola (frontend del dato) y no en el servicio; guarda del rollup demasiado ancha.
Impacto: estado contradictorio persistido; bypass del flujo de cotizaciones por un usuario legítimo con approvals:approve; también alcanzable por carrera cancelación↔aprobación sin malicia.
Solución: en approveItem/rejectItem/bulkApproveItems, dentro de la tx: verificar padre en estados aprobables y requestType NOT IN ('repuestos','servicios'); quitar 'cancelled' (y el muerto 'returned') de la guarda del rollup — después de unificar la cancelación (LOG-3), que hoy usa esa guarda como red.
Test de regresión: unit de acción (padre cancelado → ok:false; tipo repuestos → ok:false) + PGlite de no-resurrección.
```

**Resto de hallazgos de lógica (formato condensado: ID · Severidad · Archivo · Escenario → Fix):**

- **LOG-7 · MEDIO-ALTO · `lib/services/purchasing-module/receiving.ts:81-107,116-132`** — Cerrar una OC `via_oficina` con mercadería recibida SOLO en oficina: `unresolvedItems` mira únicamente el contador de faena (`received <= 0`), así que el ítem con 10 unidades físicamente en oficina vuelve a `pending_purchase` → el consolidado lo re-ofrece y **se compra de nuevo lo que ya llegó**; el registro de oficina se recorta con `LEAST` en el split y no queda en ningún stock. → Bloquear (o exigir confirmación con motivo) el cierre cuando `quantityOfficeReceived > quantityReceived`, o dar destino explícito al saldo de oficina. *I×P×F = 4×2×2=16, esfuerzo S.*
- **LOG-3 · MEDIO · `lib/requests/request-service-module/cancel-request.ts:24-32` vs `app/(app)/solicitudes/actions-module/cancel.ts:25-68`** — Dos cancelaciones divergentes: el factory marca `cancelled` sin tocar ítems ni fijar… al revés: el factory fija `closedAt` y NO toca ítems; la genérica rechaza ítems y NO fija `closedAt`. Además la genérica valida fuera de la tx sin lock (TOCTOU con la creación de OC → `cancelled` con ítem vivo en OC activa). → Un solo servicio de cancelación con `FOR UPDATE` del padre + guarda de estado en el UPDATE; decidir si `cancelled` lleva `closedAt` (la 0141 sí lo fija).
- **LOG-4 (= DAT-4) · MEDIO · `lib/requests/request-service-module/select-quotation.ts:37-56`** — Dos aprobadores concurrentes pueden dejar **dos cotizaciones `selected`** (sin `FOR UPDATE`, UPDATE ganador sin guarda `status='pending'`, sin unique en BD pese al comentario "Exactly one becomes selected"). → Guarda en el UPDATE + `UNIQUE INDEX (request_id) WHERE status='selected'` en `repuesto_quotations` y `service_quotations` (una línea de SQL cada uno).
- **LOG-5 (= DAT-13) · MEDIO · `lib/services/deliveries-worksite.ts:58-68`, `deliveries-worker-epp.ts:82-91`** — El tope de entrega es la cantidad **pedida**, no la **recibida**: ítem 4/10 recibido con stock de otras OCs puede marcarse `delivered` completo; la trazabilidad por ítem reporta más entregado que recibido y las 6 unidades que lleguen después quedan sin destino. → Cap adicional `min(quantity, Σ quantity_received faena del ítem)`.
- **LOG-6 · MEDIO · `lib/services/item-state-module/receiving.ts:29-57`** — `receiveItemTx` lee el request item sin lock y su UPDATE no lleva guarda de estado: carrera recepción‖entrega puede pisar `partially_delivered → received` (READ COMMITTED). → `.for("update")` + `AND status = <leído>` (el patrón que `approval.ts` ya usa).
- **LOG-8 (+ DAT-5) · MEDIO latente · `lib/services/purchasing-module/purchase-orders-edit.ts`** — `updateSentOrderItems` no tiene ninguna UI que lo invoque (solo tests) y arrastra 3 invariantes rotos si se recablea: sin tope contra lo aprobado, sin split al reducir cantidad, ítems con `requestItemId` null jamás generan `ingreso_oc` (el movimiento de stock está anidado en `if (requestItemId)`, `receiving.ts:217,243`); además no toma `FOR UPDATE` de la orden (única transición del módulo sin lock). → Eliminarlo, o arreglar los 4 puntos antes de conectarlo.
- **LOG-9 · MEDIO · `app/(app)/solicitudes/actions-module/draft.ts:74-99`** — Las cotizaciones subidas al guardar borrador NO pasan por `validateFileBuffer` (solo tamaño; MIME del cliente) y se crean con `totalAmount: 0`, `supplierId: null`, que **cuentan** para la regla de ≥3 (`submit-request.ts:35`): tres archivos cualesquiera satisfacen la regla sin ningún dato de cotización. → Validar magic-bytes como el camino normal + decidir si cotizaciones sin monto cuentan.
- **LOG-10 · BAJO · `aprobaciones/actions.ts:41`** — `modifiedQty` solo exige `> 0`: se pueden aprobar 500 donde se pidieron 5. → Cap `modifiedQty ≤ quantity` (o documentar la ampliación como regla).
- **LOG-11 · BAJO · `aprobaciones/actions.ts:242-247`** — `hasPurchasedItems` omite `partially_delivered`/`delivered` al bloquear el cambio de modo de despacho.
- **LOG-13 · BAJO (posible diseño) · `lib/services/receiving.ts`** — Sin dedupe por `dispatchGuideNo`: doble submit de la misma guía parcial registra el doble sin aviso (los topes impiden solo la sobre-recepción total). → Advertencia cuando la guía ya existe para esa OC/etapa.

## 9. Hallazgos de datos e integridad

**Sondas contra la BD de desarrollo (solo lectura):** 0 violaciones producidas por la app. Todas las anomalías presentes (1 OC `issued`, 12 contadores descuadrados con recepciones, 77 ítems con OC > solicitado, 6 ítems `in_purchase_order` sin línea de OC) son filas `demo-*` de un seed anterior; el seed actual ya no produce `issued`. Sin códigos duplicados, sin recepciones sobre OC inválidas, sin folios duplicados, entregado ≤ recibido en todos los datos reales.

**Tabla de invariantes del dominio y quién las garantiza:**

| Invariante | Garantía |
|---|---|
| Vocabulario de estados (ítem/OC) | **BD** (CHECKs post-0141) — el padre conserva `returned` en su CHECK (DAT-9/ARQ-5) |
| Códigos SOL-/OC-/REC- únicos | **BD** (UNIQUE + secuencia nativa; gaps por diseño) |
| 0 ≤ contadores de recepción ≤ cantidad por línea | **BD** (CHECK) |
| Σ receipt_items por etapa == contador de línea | **Solo app** (único writer serializado por lock de la orden; el seed la viola — DAT-12) |
| Oficina antes que faena (via_oficina) | **Solo app** (documentado en el schema) |
| Stock de faena ≥ 0 | **BD** (CHECK + UPDATE atómico con guard) |
| Un folio de factura por OC | **BD** (unique) — mismo folio en OCs distintas del mismo proveedor no restringido (0 casos; mejora posible) |
| Máx. una cotización `selected` por solicitud | **No garantizada** (DAT-4/LOG-4) |
| Entregado ≤ pedido | Solo app (correcta, suma bajo lock) |
| Entregado ≤ recibido | **No garantizada** (LOG-5/DAT-13) |
| Un request item en una sola OC viva | Solo app (correcta: guarda por estado bajo lock) |
| `cancelled` terminal para solicitudes | **No garantizada** (LOG-2/DAT-2) |
| Estado padre == rollup de ítems | Solo app, con carrera benigna (DAT-1) |
| Toda transición deja `status_history` | **No garantizada** (DAT-10) |
| Totales OC == Σ subtotales líneas vivas | Solo app (0 divergencias en dev) |
| OCs eliminadas fuera de métricas | App incompleta (DAT-16) |

**Hallazgos (condensados):**

- **DAT-1 · MEDIO · `rollup.ts:13-60`** — Rollup lee a los hermanos sin lock: dos aprobaciones simultáneas de ítems distintos pueden dejar el padre en `in_review` con cero pendientes (se auto-repara en la siguiente transición; mientras tanto la UI miente). → `FOR UPDATE` del padre al inicio del rollup, orden de lock padre→ítems en todos los caminos.
- **DAT-3 · MEDIO · factory repuestos/servicios (`persist-draft.ts:26-51`, `submit-request.ts:16-58`, `cancel-request.ts:18-33`)** — Familia TOCTOU: `persistDraft` concurrente con submit hace `DELETE` de TODOS los ítems (sin filtro de estado) y deja una solicitud `submitted` con ítems `draft` e historial huérfano. → Helper `lockRequest(tx, id, expectedStatuses)` + guardas en cada UPDATE/DELETE.
- **DAT-6 · BAJO-MEDIO · `requests-delete.ts:59-100`** — El comentario dice cerrar la ventana TOCTOU pero el `DELETE` va sin guarda de estado: puede borrar una solicitud enviada en la carrera (sin decisiones no hay backstop FK). → `AND status='draft'` en el DELETE y tratar 0 filas como conflicto.
- **DAT-8 · BAJO (corregir YA: gratis) · `db/migrations/0141_simplify_acquisitions.sql:104-105`** — El paso 7 revierte `issued→draft` limpiando `issued_at/issued_by` pero **no `sent_at` ni `confirmed_at`** → OC `draft` con `sent_at` poblado (combinación que el flujo nuevo no puede producir; evidencia en dev: `demo-oc-001tn`). → Añadir ambos NULL al UPDATE antes de commitear/aplicar.
- **DAT-9 · BAJO** — El CHECK del padre aún admite `returned` y `draft` EPP/otro; ventana de deploy migrate-antes-de-código rompe el código viejo (mismo release obligatorio + `db:sync-rbac`).
- **DAT-10 · BAJO-MEDIO · `purchase-orders-status.ts:55-76,135-157`, `purchase-orders-edit.ts:81-91`, `rollup.ts`** — Trazabilidad asimétrica: la emisión escribe history `in_purchase_order→purchased` para TODOS los ids (hubieran cambiado o no); el cancel traza con estado leído sin lock; el edit revierte ítems sin history; los cambios del PADRE jamás se trazan. → `.returning({id,status})` y trazar solo filas retornadas; decidir explícitamente si el rollup traza.
- **DAT-11 · BAJO** — FKs calientes sin índice (verificado en `pg_index`): `purchase_order_items.purchase_order_id` (¡CASCADE!), `purchase_order_items.request_item_id`, `receipt_items.receipt_id`, `delivery_items.delivery_id`, `quotations.purchase_order_id`, `approval_decisions.request_id`, `repuesto_quotations.request_id`, `service_quotations.request_id`. → 8 CREATE INDEX.
- **DAT-12 · MEDIO estructural** — El cap de recepción se calcula sumando `receipt_items` y el estado usa los contadores: dos fuentes para el mismo hecho. Hoy coherentes (writer único serializado); el seed las divierge y produce un error críptico de CHECK al recepcionista en datos demo. → Arreglar el seed; a futuro derivar ambos de la misma fuente.
- **DAT-14 · BAJO · `create-order.ts:65-83`** — `deliveryMode` de la OC se snapshotea de una lectura pre-tx: carrera con `updateDeliveryModeAction` crea la OC con el modo viejo (altera las etapas de recepción exigidas). → Re-derivar dentro de la tx desde los requests ya lockeados.
- **DAT-15 · BAJO** — Correlativos: sin duplicados posibles (secuencia nativa). Asperezas: carrera de `CREATE SEQUENCE IF NOT EXISTS` en el primer código de un año nuevo (23505 recuperable); la tabla `code_sequences` es un cadáver del generador pre-0014 aún en el esquema.
- **DAT-16 · BAJO-MEDIO** — `deletedAt` casi nunca filtrado: `reportes/page.tsx:63-69` suma `totalAmount` de todas las OCs; `operational-period-metrics.ts:114-128` cuenta por `issuedAt IS NOT NULL` (el delete no limpia `issuedAt`); el export "gasto por faena" con filtro anuladas incluye las `-DELETED-`. Una OC de $5M eliminada por error sigue sumando en el dashboard. → `isNull(deletedAt)` en los 3 agregados o helper `liveOrders()`.
- **DAT-17 · BAJO (¿negocio?)** — Cierre parcial de OC: el excedente de oficina se recorta con `LEAST` sin traza; el ítem recortado queda `partially_received` a pesar de que recibido == cantidad nueva. → Trazar `officeExcess` y/o transicionar a `received`.
- **DAT-18 · BAJO** — Orden de locks no determinista en `purchase-orders-create.ts:98-116`: dos OCs con ítems solapados en orden distinto → deadlock posible. → `sort()` de los ids antes del loop (como `approval.ts:23`).

## 10. Hallazgos de seguridad

El área más sólida de la auditoría. Verificado sin hallazgos: IDOR en creación de OC / facturas / recepciones / descargas (todas re-validan pertenencia en tx), path traversal (`isSafeStorageName` con basename + sanitización), acciones retiradas (no existen en el árbol; `requests:submit` purgado vía `RETIRED_PERMISSION_NAMES`), escalada vertical (grants correctos), mass assignment (requesterId/status/productId/subtotal server-side; Zod con `Number.isFinite`), XSS (sin `dangerouslySetInnerHTML`; React autoescapa los nombres libres), CSRF (server actions + solo POST autenticados).

- **SEC-1 · BAJO · `lib/services/requests-draft-create.ts:97` + `lib/validation/operations.ts:46`** — `workerId` de ítem no se valida contra la faena de la solicitud: un solicitante de faena A puede colocar el GUID de un trabajador de faena B en `itemsJson` (el detalle renderiza su nombre). Mitigante: la **entrega** sí bloquea el cruce (`deliveries-worker-epp.ts:43`), así que el EPP nunca llega a manos equivocadas; y el GUID ajeno no se expone por otras vías. → Validar `worker.worksiteId === data.worksiteId` en `insertAllItems`.
- **SEC-2 · Informativo · `compras/actions/dte-download-xml.ts:44-51`** — Sin scoping por faena, pero todos los titulares de `purchasing:view` son roles globales → explotabilidad nula hoy. Documentar el invariante o añadir scoping defensivo (la action además escribe caché de montos).
- **SEC-3 · Informativo** — Sin rate-limiting fuera del login; el endpoint OCR (`POST /api/purchase-orders/invoices/extract`, CPU-intensivo) queda gateado solo por permiso (admin/secretaria).

## 11. Hallazgos de UI/UX

```text
ID: UX-1
Título: Los tres botones de envío del formulario de solicitud nunca muestran pending ni se deshabilitan
Categoría: UX (feedback / prevención de doble acción)
Severidad: ALTO
Confianza: alta (mecanismo verificado; el duplicado efectivo es reproducible por diseño de React)
Archivo(s): app/(app)/solicitudes/request-form.tsx:258,338 (forms con onSubmit) + components/admin/submit-button.tsx:16 (useFormStatus)
Pantalla / ruta: /solicitudes/nueva y /solicitudes/[id]
Descripción: los dos <form> usan onSubmit + startTransition, pero SubmitButton lee useFormStatus, que SOLO reporta pending cuando el form usa action=. El comentario de la línea 348 ("Siguen siendo dos <form> porque SubmitButton lee useFormStatus") revela el malentendido: pending es siempre false para "Crear y enviar a aprobación", "Guardar borrador" y "Enviar a aprobación". Cada clic adicional despacha la action otra vez; createSubmittedRequest no tiene clave de idempotencia → dos clics en conexión lenta = dos solicitudes.
Comportamiento esperado: botón en estado de carga y deshabilitado durante la transición.
Causa raíz: mezcla de dos mecanismos de submit de React 19 (onSubmit imperativo vs action declarativo) con un componente que asume el segundo.
Solución: pasar isSubmitting/isSaving del hook (use-request-form.ts:159-160, ya existen) como disabled/loading explícitos, o migrar los forms a action=.
Test de regresión: RTL — con la action pendiente, el botón está disabled y un segundo click no despacha.
```

- **UX-2 · ALTO** — La regla "≥3 cotizaciones **o justificación en notas**" (backend real, `submit-request.ts:35-39`) está comunicada con tres redacciones contradictorias (obligatorio / "se recomienda" / "agrega al menos una") y **ninguna menciona el escape de justificación**; el checklist del resumen (`request-form.helpers.ts:69-85`) ni siquiera incluye cotizaciones → dice "Listo para enviar" y el servidor rechaza. → Unificar copy + añadir la condición al checklist.
- **UX-3 · ALTO** — Doble mecanismo de captura de cotizaciones: el uploader por ítem del formulario persiste `totalAmount: 0, supplierId: null` (`draft.ts:84-96`), así que quien aprueba ve tres filas "Proveedor sin nombre · $0" y no puede comparar sin abrir cada PDF. → Permitir editar proveedor/monto en el panel, o capturar los metadatos al subir; considerar retirar uno de los dos mecanismos.
- **UX-4 · ALTO** — Fallos de subida de cotizaciones silenciados: `draft.ts:93-99` hace catch + log y retorna `ok: true` ("Borrador guardado"); el hook limpia la lista local al éxito → el usuario cree que subió N y subió menos, sin ningún eco en `/nueva` de lo persistido. → Degradar el ActionState a advertencia con el conteo real.
- **UX-5 · ALTO (impacto operativo por validar)** — La etapa "seleccionar cotización ganadora" es **invisible para toda cola**: excluida de `/aprobaciones` (correcto por diseño), sin fuente en `/pendientes` (`operational-work-queue.ts:575-585`) y la notificación de envío va a `approvals:approve` en lugar de `repuestos/servicios:approve` (`submit.ts:22-35`). Una solicitud de repuestos puede quedar varada sin que nadie tenga la tarea a la vista. → Nueva fuente en la cola operativa + corregir destinatario.
- **UX-6 · MEDIO** — "Emitir y enviar" (la acción principal del módulo) no confirma: el redirect lleva `?actualizada=enviada` que **nadie consume**, y los toasts de éxito de `oc-actions.tsx:88-91` / `oc-list-rows.tsx:44-49` son inalcanzables (el redirect lanza antes de devolver `ok:true`). Crear una OC única tampoco confirma (el banner existe solo para `creadas > 1`). → Consumir el param con un banner (patrón ya existente).
- **UX-7 · MEDIO** — `/compras/nueva` con cola vacía hace `redirect("/compras")` en silencio: el botón "Nueva OC" parece roto. → Redirigir con aviso o renderizar el empty state que el formulario ya tiene.
- **UX-8 · MEDIO** — La caja "Advertencias de conciliación" del cierre de OC usa los tokens `--color-warning-50/200/700` que **no existen** en `globals.css` (solo hay `warning`, `-tint`, `-line`, `-ink`): el aviso más importante del cierre se pinta sin fondo, borde ni color. → Usar los tokens reales.
- **UX-9 · MEDIO** — El resumen de la OC muestra "ítems seleccionados" **sin el número** (`oc-form-summary.tsx:30-32`: `pluralize` devuelve solo la palabra). **UX-10 · BAJO** — "3ítems" sin espacio en la barra de lote (`bulk-approve-bar.tsx:57-60`, JSX descarta el salto de línea). → `countPluralize` en ambos.
- **UX-15 · BAJO** — El hint de `/recepcion` describe solo el camino vía oficina y omite que las OC de EPP también se reciben ahí (falso para `directo_faena`, que el propio form ya modela). **UX-16 · BAJO** — capacidades distintas móvil/desktop en `/entregas` (enlace a trazabilidad solo en móvil). **UX-17 · BAJO** — `DETAIL_BASE` enlaza a `/repuestos/{id}` y `/servicios/{id}` que hoy son solo redirects de vuelta (`next.config.ts`): pagar un redirect por clic y un comentario del mundo anterior. **UX-18 · BAJO** — "Qty aprobada" (Spanglish) en `approve-form.tsx:34`. **UX-19 · BAJO** — el banner "Guarda el borrador primero" contradice al uploader activo justo debajo (los archivos sí se aceptan y se suben al guardar). **UX-20 · BAJO** — la tarjeta móvil de solicitudes no tiene la acción de eliminar que la fila desktop sí.

## 12. Hallazgos de accesibilidad

- **UX-11 · MEDIO (WCAG 1.3.1/4.1.2) · `aprobaciones/reason-form.tsx:29-36`** — El textarea del motivo de rechazo no tiene label asociada (`<label>` sin `htmlFor`, control sin `id`): el lector de pantalla solo anuncia el placeholder. El formulario de aprobar, al lado, sí lo hace bien. → Asociar con `htmlFor`/`id`.
- **UX-12 · MEDIO (WCAG 1.4.1/4.1.2) · `recepcion/receipt-form.tsx:138-174`** — El selector de etapa (oficina/faena) comunica la selección solo por color de borde/fondo, sin `aria-pressed` ni semántica de grupo; por teclado no hay forma de saber cuál está activa. Los chips de `/pendientes` ya usan `aria-pressed`. → `aria-pressed` + indicador no cromático.
- **UX-14 · MEDIO (WCAG 2.5.8) · `solicitudes/item-editor.tsx:142-149,102-110`, `item-editor-cotizaciones.tsx:96-103`** — Objetivos táctiles de ~22×22 y ~16×16 px ("Eliminar ítem", "Quitar archivo") en el formulario que más se usa en terreno; el mismo defecto ya se corrigió en oc-list con `size-6`. → Mínimo 24px (ideal la escala táctil del sistema).

## 13. Hallazgos responsive

- **UX-13 · MEDIO · `compras/oc-form-items.tsx:103,116-120,163-228`** — Al marcar un ítem en `/compras/nueva`, el grupo de controles (cantidad + proveedor + precio + descuento + subtotal, ~520px de anchos fijos con `shrink-0`) excede el viewport móvil dentro de un contenedor `overflow-hidden` sin `flex-wrap`: precio/descuento/subtotal quedan **inalcanzables** en 390px. Misma clase de bug que A-01/A-02, corregidos en aprobaciones/recepción pero no aquí. → `flex-wrap` o `overflow-x-auto`.
- **UX-20** (ver §11) — asimetría de acciones móvil/desktop en solicitudes.
- Verificado sin hallazgo: tablas del flujo con card-view móvil o overflow correcto; `/pendientes` persiste su estado en sessionStorage (patrón del repo aplicado).

## 14. Hallazgos de rendimiento

- **ARQ-8 · ALTO · `solicitudes/[id]/page.tsx:119-134,199-213`** — El detalle de solicitud (pantalla más visitada del flujo) carga el **catálogo completo**: `select()` total de products + toda `product_attributes` + toda `product_suppliers`, serializado al cliente como `productOptions` — para un formulario que tras el rediseño es de solo lectura para EPP/otro (los borradores repuestos/servicios usan texto libre). Payload RSC O(catálogo) + cruce O(productos×atributos). → Cargar solo los productos referenciados por los ítems (`referencedProductIds` ya existe en la línea 115) con columnas mínimas; catálogo completo solo en `/nueva`.
- **ARQ-9 · MEDIO · `entregas/page.tsx:90-93,133-143`** — `worksiteStock` con `with: { product: true }` del que solo se leen 3 columnas, y el catálogo entero serializado como `returnProducts` para un selector opcional de devolución. → Seleccionar columnas; filtrar a EPP.
- **ARQ-10 · MEDIO** — Waterfalls de awaits secuenciales independientes: `/compras` (3 roundtrips extra), `/aprobaciones` (1), `/recepcion` (2), `/compras/[id]` (2), y `document-chain.ts:209-285` (5 queries en serie donde caben 2 niveles) que corre en los tres detalles. → `Promise.all` por nivel de dependencia.
- **DAT-11** (ver §9) — FKs sin índice: hoy volumen chico, pero `purchase_order_items.purchase_order_id` es la FK más consultada del módulo.
- Verificado sin hallazgo: sin N+1 en loops, sin `recharts`/dashboard-charts en el árbol inicial de las 8 rutas, paginación presente en listados grandes.

## 15. Hallazgos de arquitectura y código

- **ARQ-1 · ALTO · `lib/requests/request-actions-draft.ts` (entero), `request-actions-workflow.ts` (submit/cancel impls), `request-service-module/cancel-request.ts`, `repuestos/actions.ts:58-63`, `servicios/actions.ts`** — El factory de repuestos/servicios expone `saveDraftAction`/`submitRequestAction`/`cancelRequestAction` con **0 consumidores** (el flujo vivo pasa por `solicitudes/actions-module/`); dos implementaciones del mismo flujo que **ya divergieron** (semántica de cancelación distinta, LOG-3). Es la causa sistémica histórica del repo en su forma más pura. → Eliminar el camino muerto; el factory queda solo con las 3 acciones de cotización.
- **ARQ-6 · ALTO · `operational-work-queue.ts:642-649`, `receiving.ts:74`, `recepcion/nueva/page.tsx:72-78`, `dashboard-metrics.ts:78`, `reportes/page.tsx:66`** — Los conjuntos de estados recibibles de OC existen como constantes con nombre (`lib/work-queue-labels.ts:33-44`, con comentario que pide usarlas) pero están **re-escritos como literales en 5 sitios** — la reedición exacta del bug badge≠página (A-03/A-13) que motivó `approvals-queue.ts`. No hay impedimento técnico (`inArray` con constantes ya se usa en el mismo archivo). → Interpolar las constantes en los 5 sitios.
- **ARQ-2 · MEDIO** — La rama "borrador" de `createRequestWithDiff` es inalcanzable (`isNew` siempre true, único caller pasa `submitted: true`): insinúa que aún se pueden crear borradores EPP/otro. → Hornear el único camino y renombrar (ya no hay diff). **ARQ-3 · BAJO** — Wrappers no-Tx de item-state (`submitItem`, `receiveItem`, `deliverItem`, `addItemToPurchaseOrder`, `TERMINAL_STATES`) solo usados por tests: un caller nuevo se saltaría la transacción compuesta. → Borrar y migrar tests a las variantes Tx.
- **ARQ-4 · MEDIO** — Remanentes del estado `issued` de OC: opción "Emitida" en dos exportes de `/reportes` (`reports-export-menu.tsx:32,48` → Excel siempre vacío) y en `INVOICE_ALLOWED_STATUSES` (`invoices.ts:14`); comentarios de cabecera desactualizados. **ARQ-5 · BAJO** — El CHECK del padre aún admite `returned` y el rollup lo lista (asimetría con la intención declarada de la 0141). **ARQ-12 · BAJO** — el CHECK de ítems de OC declara `partially_received/received` que ninguna escritura produce. **LOG-12** agrupa el resto del vocabulario fantasma (`approval_decisions` con `return`, `confirmedAt` sin productor, `receipts.status` `open` muerto).
- **ARQ-11 · BAJO** — `serviceWorksiteScope` copiado idéntico en 5 actions. → Mover junto a `resolveWorksiteScope`. **ARQ-13 · BAJO** — 17 casts `as unknown as` alrededor de `DataTable` (los más frágiles en `compras/[id]/page.tsx:349-364`). → `DataTable<T>` genérico elimina el patrón. **ARQ-14 · BAJO** — formato de cantidad a mano en `entregas/page.tsx:284` donde existe `formatQty`.
- `npx tsc --noEmit`: **limpio** (0 errores en el árbol actual).

## 16. Cobertura y problemas de tests

**Ejecución real:** unit (57 archivos del flujo): **478 tests PASAN** (14,5 s; 4 archivos skipped por gate de Postgres, esperado en local). PGlite (16 archivos): **143/146 — 3 fallas que ya existen en HEAD** (no las causa el árbol sucio): TST-1 (bug real, §8), TST-2 (bug real, abajo) y TST-3 (limitación de PGlite).

- **TST-2 · ALTO (bug real, test rojo) · `lib/services/trazabilidad-matrix.ts:262`** — `const alertCount = rows.filter(r => r.alert).length + (alertRow ? 0 : 0)`: el query SQL de alertas de todo el universo (líneas 131-144, cuyo comentario explica que la cifra del banner no puede salir de la página de 50) se calcula y **se descarta** — `(alertRow ? 0 : 0)` es siempre 0. Edición a medio terminar. → `Number(alertRow?.n ?? 0)`.
- **TST-3 · ALTO (infra) · `lib/__tests__/code-sequences.test.ts:81`** — `listCodeSequences` lee `pg_sequences`, que bajo PGlite 0.5.2 + la cadena de migraciones no expone las secuencias creadas por `next_document_code()` (verificado con probes: la secuencia funciona pero no aparece en el catálogo). Test rojo desde su commit; producción probablemente bien. → Mover el caso al proyecto Postgres-gateado o bump de PGlite; no dejar el proyecto rojo.
- **TST-4 · MEDIO** — `bulkApproveRequestAction` (scoping + gating EPP por rol + dedupe) sin ningún test de acción: si el gating EPP masivo regresiona, nada lo ve. **TST-5 · MEDIO** — `createSubmittedRequest` (el corazón del rediseño) solo probado con el servicio mockeado; sin integración PGlite que verifique filas reales. **TST-6 · MEDIO** — e2e `repuestos-servicios-oc-flow` con asserts condicionales (`if (await btn.isVisible())`) que pasan aunque no se apruebe nada; ningún e2e sube una cotización real ni ejercita `selectQuotation`. **TST-7 · MEDIO** — la doble recepción solo se verifica en UI en e2e; la protección real (locks) solo corre en CI con env-gates (aceptable, documentarlo). **TST-8/9/10 · BAJO** — tests de wrapper que prueban configuración; fixtures con estados retirados (`returned`/`postponed`/`issued` en stubs); e2e smoke que sobrevenden su nombre.
- **Gap e2e principal:** ninguna OC `directo_faena` recorrida de punta a punta.
- **Positivo:** la matriz `canTransition` post-rediseño está testeada exhaustivamente; los specs e2e principales (`purchase-flow`, `oc-flow`, `repuestos-servicios-flow`) ya hablan el vocabulario nuevo; cero referencias vivas a los símbolos eliminados; concurrencia núcleo (aprobación/recepción/entrega/stock/correlativos) cubierta en los tests Postgres de CI.

## 17. Inconsistencias de producto

1. **La regla de cotizaciones tiene tres versiones en la UI y una cuarta en el backend** (UX-2 + LOG-9): obligatoria/recomendada/mínimo-una vs "3 o justificación en notas" — y archivos sin monto cuentan. Definir la regla de negocio una vez y comunicarla igual en editor, panel, checklist y error.
2. **Dos semánticas de cancelación** (LOG-3): con/sin `closedAt`, con/sin rechazo de ítems, según la puerta por la que entres.
3. **Dos mecanismos de captura de cotizaciones** con calidades de dato distintas (UX-3).
4. **La etapa de selección de cotización no existe para la cola operativa ni para las notificaciones correctas** (UX-5): el flujo la exige pero el sistema no la ofrece como tarea.
5. **"Recibido" significa cosas distintas** según la pantalla: el detalle de OC infla con oficina (TST-1) mientras trazabilidad filtra por faena — el mismo número con dos valores.
6. **Cerrar una OC** puede significar "perder el registro de lo que está en oficina" (LOG-7/DAT-17) sin que la UI lo diga.

## 18. Oportunidades de mejora

| Propuesta | Problema actual | Cambio | Beneficio | Riesgo | Esfuerzo |
|---|---|---|---|---|---|
| Fuente "Seleccionar cotización" en /pendientes | Etapa invisible (UX-5) | Nueva fuente en operational-work-queue + notificación al permiso correcto | Solicitudes de repuestos dejan de vararse | Bajo | S |
| Editar proveedor/monto de cotización pendiente en el panel | Filas "$0 · sin nombre" (UX-3) | Form inline de edición en quotation-panel | Selección de ganadora comparable sin abrir PDFs | Bajo | S |
| Advertencia de guía duplicada en recepción | Doble registro accidental de la misma guía (LOG-13) | Aviso no bloqueante si dispatchGuideNo ya existe para la OC/etapa | Menos dobles registros en terreno | Bajo | XS |
| Confirmación de "Emitir y enviar" | Acción principal muda (UX-6) | Consumir `?actualizada=enviada` con banner | Certeza de la acción más importante del módulo | Nulo | XS |
| Destino explícito del saldo de oficina al cerrar OC | Limbo y re-compra (LOG-7) | Paso de confirmación con opciones (traslado pendiente / merma con motivo) | Cierra el hueco financiero y de trazabilidad | Medio (definición de negocio) | M |
| Helper `liveOrders()` | Agregados contaminados por OCs borradas (DAT-16) | Scope compartido con `isNull(deletedAt)` | Métricas fieles con un solo punto de verdad | Bajo | XS |
| Índice único de cotización ganadora + guardas | Invariante documentado sin garantía (LOG-4) | Unique parcial + WHERE status='pending' | Elimina la ambigüedad de decisión | Bajo | XS |

## 19. Causas raíz sistémicas

1. **Disciplina de concurrencia aplicada por camino, no por convención.** Los caminos núcleo (aprobar, emitir, recibir, entregar, crear OC) usan FOR UPDATE + UPDATE guardado; los secundarios (cancelar, borrar, persistir borrador, seleccionar cotización, editar OC) usan `findFirst` pre-tx + escritura incondicional. De ahí salen LOG-3/4/6, DAT-2/3/5/6/14. **Fix estructural:** helpers `lockRequest`/`lockOrder(tx, id, expectedStatuses)` y la regla "toda escritura de estado lleva guarda" — elimina la clase entera.
2. **Los caminos de muerte no limpian lo que el camino feliz reservó.** Reserva EPP sin liberación (LOG-1), saldo de oficina sin destino al cerrar (LOG-7/DAT-17), padre cancelado con ítems vivos (LOG-3). **Fix estructural:** checklist de "qué libera cada terminal" por entidad.
3. **Criterios re-escritos en vez de importados** — la causa histórica del repo reincidiendo: sets de estados recibibles en 5 sitios (ARQ-6), regla de cotizaciones en 4 redacciones (UX-2), semántica de cancelación duplicada (ARQ-1/LOG-3), elegibilidad de aprobación solo en el filtro del listado (LOG-2). **Fix estructural:** la regla vive en una constante/servicio y los consumidores la importan; el rediseño ya lo hizo bien con `approvals-queue.ts` y `work-queue-labels.ts` — falta usarlas.
4. **Feedback desacoplado del mecanismo real:** `useFormStatus` sin `action=` (UX-1), toasts tras `redirect` inalcanzables (UX-6), query param que nadie consume. **Fix estructural:** un patrón único de submit+confirmación documentado en AGENTS.md.
5. **Retiros a medias:** flujo paralelo del factory (ARQ-1), `updateSentOrderItems` sin UI (LOG-8), vocabulario fantasma en CHECKs y exportes (ARQ-4/5/12). **Fix estructural:** al retirar una capacidad, borrar el productor Y los consumidores en el mismo cambio (el rediseño lo hizo con los símbolos grandes; quedó la segunda línea).

## 20. Quick wins

| ID | Cambio | Esfuerzo |
|---|---|---|
| DAT-8 | 0141: `sent_at = NULL, confirmed_at = NULL` en el paso 7 — **antes de commitear** | XS |
| TST-2 | `Number(alertRow?.n ?? 0)` en trazabilidad-matrix.ts:262 | XS |
| TST-1 | Join + filtro faena en oc-reconciliation.ts | XS |
| LOG-4/DAT-4 | 2 índices únicos parciales + guarda en el UPDATE | XS |
| UX-8 | 3 tokens de warning reales en oc-actions.tsx | XS |
| UX-9/10/18 | countPluralize ×2 + "Cantidad aprobada" | XS |
| LOG-11 | 2 estados más en hasPurchasedItems | XS |
| ARQ-4 | Quitar "Emitida" de 2 exportes + de INVOICE_ALLOWED_STATUSES | XS |
| UX-17 | Enlazar directo a /solicitudes/{id} y borrar DETAIL_BASE | XS |
| UX-11 | htmlFor + id en reason-form | XS |
| DAT-18 | sort() de ids antes del loop de locks en create | XS |
| DAT-11 | 8 CREATE INDEX de FKs | S |

## 21. Plan de corrección priorizado

```text
Fase 0 — Bloqueantes críticos (antes de commitear/deployar el rediseño)
```
- [ ] **F0-1** · Problema: 0141 no limpia sent_at/confirmed_at (DAT-8) · Cambio: añadir ambos `= NULL` al UPDATE del paso 7 · Archivos: `db/migrations/0141_simplify_acquisitions.sql:104-105` · Dependencias: ninguna (migración aún no aplicada) · Aceptación: tras la migración, ninguna OC draft tiene sent_at · Tests: sonda SQL post-migración · Esfuerzo: XS · Riesgo: Bajo
- [ ] **F0-2** · Problema: avance de OC cuenta oficina (TST-1) · Cambio: join `receipts` + filtro `locationType='faena'` en `getOcReconciliation` · Archivos: `lib/services/oc-reconciliation.ts:8-14` · Aceptación: `receiving-two-stage.test.ts` verde · Tests: el existente · Esfuerzo: XS · Riesgo: Bajo
- [ ] **F0-3** · Problema: alertCount descartado (TST-2) · Cambio: `Number(alertRow?.n ?? 0)` · Archivos: `lib/services/trazabilidad-matrix.ts:262` · Aceptación: `trazabilidad-matrix.test.ts` verde · Esfuerzo: XS · Riesgo: Bajo
- [ ] **F0-4** · Problema: PGlite rojo permanente (TST-3) · Cambio: mover el caso de listado de secuencias al proyecto Postgres-gateado · Archivos: `lib/__tests__/code-sequences.test.ts`, `tests/pglite-files.ts` · Aceptación: `test:pglite` verde local y CI · Esfuerzo: S · Riesgo: Bajo
- [ ] **F0-5** · Deploy: código + 0141 + `db:sync-rbac` en el mismo release (DAT-9) · Aceptación: checklist de deploy actualizado · Esfuerzo: XS

```text
Fase 1 — Integridad y lógica
```
- [ ] **F1-1** · Resurrección de canceladas (LOG-2/DAT-2) · Cambio: validar padre (estado + tipo) dentro de la tx en `approveItem`/`rejectItem`/`bulkApproveItems`; quitar `cancelled` y `returned` de la guarda del rollup · Archivos: `item-state-module/approval.ts`, `rollup.ts:58` · Dependencias: F1-2 (la guarda hoy es red del race de cancelación) · Aceptación: aprobar ítem de cancelada/repuestos → error; rollup nunca reescribe cancelled · Tests: unit acción + PGlite no-resurrección · Esfuerzo: S · Riesgo: Medio
- [ ] **F1-2** · Cancelación unificada (LOG-3/DAT-3) · Cambio: un servicio con FOR UPDATE del padre + guarda de estado + rechazo de ítems; el factory delega; decidir `closedAt` · Archivos: `request-service-module/cancel-request.ts`, `solicitudes/actions-module/cancel.ts` · Aceptación: misma semántica por ambas puertas; carrera con creación de OC rechazada · Tests: PGlite carrera cancelación↔OC · Esfuerzo: M · Riesgo: Medio
- [ ] **F1-3** · Liberación de reservas EPP (LOG-1) · Cambio: resolver links al rechazar/cancelar + saneo de huérfanos · Archivos: `item-state-module/approval.ts`, cancelación, script one-shot · Aceptación: brecha reaparece tras rechazo · Tests: PGlite · Esfuerzo: S · Riesgo: Bajo
- [ ] **F1-4** · Cotización ganadora única (LOG-4) · Cambio: guarda `status='pending'` + 2 unique parciales · Archivos: `select-quotation.ts`, migración nueva · Aceptación: segunda selección concurrente falla limpio · Tests: Postgres-gateado concurrente · Esfuerzo: XS · Riesgo: Bajo
- [ ] **F1-5** · Entregado ≤ recibido (LOG-5) · Cambio: cap `min(quantity, Σ recibido faena)` en ambas entregas · Archivos: `deliveries-worksite.ts`, `deliveries-worker-epp.ts` · Aceptación: ítem 4/10 recibido no acepta entregar 10 · Tests: unit + PGlite · Esfuerzo: S · Riesgo: Bajo
- [ ] **F1-6** · Lock en receiveItemTx (LOG-6) y rollup con lock del padre (DAT-1) · Archivos: `item-state-module/receiving.ts`, `rollup.ts` · Aceptación: tests de concurrencia CI extendidos · Esfuerzo: S · Riesgo: Medio (orden de locks consistente)
- [ ] **F1-7** · Cierre de OC con saldo en oficina (LOG-7/DAT-17) · Cambio: bloquear o confirmar explícitamente cuando officeReceived > received; trazar excedente · Archivos: `purchasing-module/receiving.ts` · Dependencias: definición de negocio (¿merma o traslado?) · Esfuerzo: M · Riesgo: Medio
- [ ] **F1-8** · Cotizaciones del borrador (LOG-9) · Cambio: `validateFileBuffer` en persistDraft; decidir si monto 0 cuenta para la regla · Archivos: `solicitudes/actions-module/draft.ts` · Esfuerzo: S · Riesgo: Bajo
- [ ] **F1-9** · deleteRequest con guarda (DAT-6); cap modifiedQty (LOG-10); hasPurchasedItems completo (LOG-11); sort de locks (DAT-18); deliveryMode en tx (DAT-14) · Esfuerzo: S total · Riesgo: Bajo

```text
Fase 2 — Seguridad y permisos
```
- [ ] **F2-1** · workerId vs faena (SEC-1) · Cambio: validar pertenencia en `insertAllItems` (patrón de deliveries-worker-epp) · Archivos: `requests-draft-create.ts:97` · Tests: unit acción · Esfuerzo: XS · Riesgo: Bajo
- [ ] **F2-2** · Documentar invariante de `purchasing:view` global o scoping defensivo en DTE (SEC-2); evaluar rate-limit del OCR (SEC-3) · Esfuerzo: XS-S

```text
Fase 3 — UX del flujo
```
- [ ] **F3-1** · Pending en los 3 submits del request-form (UX-1) · Cambio: `disabled`/`loading` desde el hook o migrar a `action=` · Archivos: `request-form.tsx`, `submit-button.tsx` · Tests: RTL doble-click · Esfuerzo: S
- [ ] **F3-2** · Regla de cotizaciones unificada (UX-2) + checklist del resumen · Esfuerzo: S
- [ ] **F3-3** · Metadatos de cotización editables o capturados al subir (UX-3) + errores de subida visibles (UX-4) · Esfuerzo: M
- [ ] **F3-4** · Fuente "seleccionar cotización" en /pendientes + notificación al permiso correcto (UX-5) · Archivos: `operational-work-queue.ts`, `submit.ts` · Esfuerzo: M
- [ ] **F3-5** · Confirmaciones: banner de emitida (UX-6), rebote explicado de /compras/nueva (UX-7), hint de recepción (UX-15) · Esfuerzo: S

```text
Fase 4 — UI y consistencia visual
```
- [ ] **F4-1** · Tokens de warning (UX-8), countPluralize ×2 (UX-9/10), "Cantidad aprobada" (UX-18), banner del uploader (UX-19), asimetrías móvil/desktop (UX-16/20), fila con wrap en oc-form-items (UX-13), targets táctiles (UX-14), labels/aria (UX-11/12) · Esfuerzo: S-M total · Riesgo: Bajo

```text
Fase 5 — Arquitectura y deuda técnica
```
- [ ] **F5-1** · Borrar el flujo paralelo muerto del factory (ARQ-1) y la rama borrador de createRequestWithDiff (ARQ-2) · Dependencias: F1-2 · Esfuerzo: S
- [ ] **F5-2** · Constantes de estados recibibles en los 5 sitios (ARQ-6) · Esfuerzo: S
- [ ] **F5-3** · Eliminar o arreglar updateSentOrderItems (LOG-8/DAT-5) — decisión de producto: ¿se necesita editar OCs enviadas? · Esfuerzo: S (borrar) / M (arreglar)
- [ ] **F5-4** · Detalle de solicitud sin catálogo completo (ARQ-8), entregas sin relación product (ARQ-9), Promise.all en 5 páginas (ARQ-10) · Esfuerzo: M
- [ ] **F5-5** · Limpieza de vocabulario: "Emitida" en exportes + INVOICE_ALLOWED_STATUSES (ARQ-4), CHECK del padre sin returned (ARQ-5, migración corta), CHECK de OC items (ARQ-12), wrappers no-Tx (ARQ-3), serviceWorksiteScope compartido (ARQ-11), DataTable genérico (ARQ-13), formatQty (ARQ-14), history con returning (DAT-10), deletedAt en agregados (DAT-16), índices FK (DAT-11), seed coherente (DAT-12) · Esfuerzo: M total

```text
Fase 6 — Tests y hardening
```
- [ ] **F6-1** · bulkApproveRequestAction: gating EPP, dedupe, scope (TST-4) · Esfuerzo: S
- [ ] **F6-2** · createSubmittedRequest en PGlite (TST-5) · Esfuerzo: S
- [ ] **F6-3** · e2e: asserts reales en repuestos-servicios-oc-flow + subida de cotización + selectQuotation (TST-6); un recorrido directo_faena completo · Esfuerzo: M
- [ ] **F6-4** · Limpiar fixtures con estados retirados (TST-9); renombrar/retirar smoke que sobrevenden (TST-10) · Esfuerzo: XS

## 22. Tests de regresión necesarios

| Hallazgo | Test |
|---|---|
| TST-1 | El existente (`receiving-two-stage`: "no suma la etapa de oficina") — pasa al arreglar el servicio |
| TST-2 | El existente (`trazabilidad-matrix`: "cuenta las alertas de todo el universo") |
| LOG-1 | PGlite: rechazar ítem de reposición → la brecha vuelve a `listReplenishmentSuggestions` |
| LOG-2 | Unit: `approveItemAction` con padre cancelado → `ok:false`; con tipo repuestos → `ok:false`. PGlite: rollup nunca saca a una solicitud de `cancelled` |
| LOG-3 | PGlite: cancelar por ambas puertas produce el mismo estado final (padre + ítems + closedAt) |
| LOG-4 | Postgres-gateado: dos `selectQuotation` concurrentes → exactamente una `selected` (y el unique lo garantiza) |
| LOG-5 | Unit/PGlite: entregar > recibido-faena → error aunque haya stock |
| LOG-6 | Postgres-gateado: recepción‖entrega concurrentes nunca regreden `partially_delivered` |
| LOG-7 | PGlite: cerrar OC con saldo solo-oficina → bloqueado o trazado, nunca re-compra silenciosa |
| LOG-9 | Unit: persistDraft rechaza archivo sin magic-bytes válidos |
| SEC-1 | Unit: crear solicitud con workerId de otra faena → `ok:false` |
| UX-1 | RTL: doble click con action pendiente despacha una sola vez |
| DAT-6 | PGlite: delete concurrente con submit → 0 filas, error de conflicto |
| DAT-8 | Sonda post-migración: 0 OCs draft con sent_at |

## 23. Riesgos que permanecerían

1. **Invariantes solo-app** (Σ recepciones vs contadores, oficina-antes-que-faena, un ítem por OC viva): correctas hoy por writer único + locks, pero sin red de BD; cualquier escritura manual o servicio nuevo puede romperlas sin ruido. Mitigación futura: triggers o checks diferidos si el equipo crece.
2. **El rollup sin traza** (si en F5 se decide no trazarlo): el historial del padre seguirá siendo reconstruible solo desde los ítems.
3. **Concurrencia real solo verificada en CI** (tests Postgres env-gated): un desarrollador local no la ejercita; las regresiones de locks se verían tarde.
4. **La conciliación factura↔OC es informativa por diseño**: una OC puede cerrarse con facturas que no cuadran (con advertencia + ack). Riesgo aceptado explícitamente por el negocio.
5. **`purchasing:view` global como invariante implícito** (SEC-2): si algún día se otorga a un rol de faena, el DTE queda expuesto org-wide.
6. **PGlite vs Postgres**: el harness no ve catálogos de secuencias (TST-3); cualquier feature futura que dependa de catálogos del sistema necesitará el proyecto Postgres-gateado.

## 24. Conclusión

El rediseño del 2026-08-07 dejó el flujo de adquisiciones **más simple y más sólido de lo que estaba**: la máquina de estados es explícita, los caminos calientes tienen disciplina de concurrencia ejemplar, la autorización no tiene huecos reales, y la migración drena los estados retirados con traza. La deuda que esta auditoría encontró es específica y acotada: dos bugs pre-existentes con test rojo que ya están en producción (TST-1/TST-2), una familia TOCTOU en los caminos secundarios que el núcleo ya sabe resolver, los caminos de muerte que no liberan reservas (EPP, saldo de oficina, canceladas), y el camino de cotizaciones de repuestos/servicios a medio coser en UX. Nada de esto es estructural: las causas sistémicas (§19) tienen fixes que eliminan clases enteras de errores con helpers de pocas líneas.

**Lo primero:** los cinco puntos de la Fase 0 antes de commitear el rediseño (la corrección de 0141 es gratis hoy y cara mañana), y las Fases 1-2 en el mismo tren de trabajo. Con eso el flujo queda, con evidencia, listo para producción sin reservas.

```text
LISTO PARA PRODUCCIÓN CON CORRECCIONES MENORES
NOTA GLOBAL: 7,4/10
```
