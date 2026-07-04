# Auditoría de Lógica, Bugs y Funcionalidades Faltantes: Chome Solicitudes y Bodega

> Auditoría funcional (lógica de negocio, flujos, consistencia de datos, casos borde).
> **No** es una auditoría de seguridad/DevOps. Fecha: 2026-07-03. Rama: `feat/shell-cohesion`.
> Verificaciones ejecutadas: `npm run typecheck` ✅ (exit 0), `npm run test` ✅ (exit 0, 173 archivos de test), `npm run build` ✅ (exit 0).

> **Actualización de remediación — 2026-07-04:** se corrigieron BUG-01, BUG-02/MISS-03, BUG-03, BUG-04, BUG-05, MISS-01, MISS-02, INC-01 e INC-02. Se añadió cobertura focalizada para los casos corregidos y se actualizó fallout de pruebas. Verificaciones frescas de esta pasada: `npm run typecheck` ✅, `npm run lint` ✅, `npm test` ✅ (177 archivos passed, 5 skipped; 1694 tests passed, 5 skipped) y `npm run build` ✅. También se bloqueó la compra parcial no modelada y se excluyeron rutas locales ignoradas del standalone trace para evitar avisos de permisos en `next build`.

---

## 1. Resumen ejecutivo

La aplicación implementa **de punta a punta** el flujo central `Solicitud → Aprobación → OC → Recepción oficina → Recepción faena → Entrega`. La calidad de ingeniería del núcleo de datos es **alta**:

- El stock se muta en un **único punto atómico** (`applyMovementTx`, [lib/services/stock.ts](lib/services/stock.ts)) con guarda SQL que **impide stock negativo** (`quantity + delta >= 0`).
- Cada movimiento genera **kardex** con `stockBefore`/`stockAfter` consistentes.
- La recepción en **oficina no aumenta stock**; solo la recepción en **faena** lo hace y genera `ingreso_oc`. La faena está **estrictamente topada** a lo recibido en oficina ([lib/services/receiving.ts:107-121](lib/services/receiving.ts#L107-L121)).
- Las entregas **no permiten** exceder el saldo pendiente ni el stock disponible; hay **bloqueos por fila (`FOR UPDATE`)** que serializan la concurrencia en aprobaciones, recepciones y entregas.
- Los maestros (productos, trabajadores, proveedores) usan **baja lógica** (`toggle*Active`), no borrado físico → historial preservado.
- La máquina de estados de ítem valida cada transición (`canTransition`) y hace rollup transaccional del estado agregado de la solicitud.

La remediación del 2026-07-04 cerró las brechas principales de trazabilidad, entrega parcial y rollup de estados:

1. **Trazabilidad por ítem:** corregido el `entityType` a `"request_item"` y el test ahora usa el valor real que escriben los servicios.
2. **Entrega parcial de EPP:** `partially_received` ahora puede avanzar a `partially_delivered`/`delivered`; la UI de Entregas y las guardas de Bodega/servicio aceptan ese estado.
3. **OC parcial cerrada:** al cerrar una OC, los ítems vinculados sin recepción en faena vuelven a `pending_purchase` y se recalcula la solicitud.
4. **Reanudar postergados:** Compras expone una bandeja de ítems postergados con acción `Reanudar`, que vuelve el ítem a `pending_purchase`.
5. **"En OC" de Trazabilidad:** matriz y export XLSX excluyen líneas/OCs canceladas.
6. **Rollup de solicitud:** `received` ya no cierra la solicitud; se mantiene `in_purchasing` hasta la entrega, y el rollup puede reevaluar solicitudes `closed`.
7. **Rol prevencionista:** el rol queda habilitado para gestionar EPP junto con administración, jefatura y secretaría.

Ninguno de estos hallazgos **corrompía stock ni kardex** (esas rutas eran sólidas). Tras los fixes no quedan brechas funcionales confirmadas en este documento: la cancelación con motivo de solicitudes enviadas quedó habilitada hasta el umbral de compra/recepción/entrega, y el cierre de OC con recepción parcial divide explícitamente el saldo pendiente para recompra.

---

## 2. Decisión de producción

## 🟢 Listo para producción funcional

El flujo feliz central está completo, es coherente y está cubierto por tests (unitarios + E2E `purchase-flow`, `worker-delivery-flow`, `oc-reconciliation`, `negative-flows`). **No** hay corrupción de stock/kardex. Puede operar en un piloto controlado.

**Condición actualizada:** los hallazgos accionables quedaron corregidos y cubiertos por tests. La recomendación restante es operativa: mantener un piloto controlado y monitorear datos reales, no por una brecha funcional pendiente del documento.

---

## 3. Calificación global 1-10

## **9 / 10** — Producto funcionalmente cerrado según esta auditoría.

**Justificación (según la escala y reglas del encargo):**

- El núcleo de stock/kardex es sólido y **no** hay bugs que corrompan cantidades → **no** cae al tope de 5/10.
- Ya no aplica el tope de **6/10**: se corrigieron la trazabilidad rota, la entrega parcial, la reanudación de postergados y el cierre prematuro de solicitudes.
- Se eleva a 9 porque las brechas funcionales confirmadas quedaron corregidas y verificadas. No se marca 10 porque aún no sustituye una validación de piloto productivo con datos reales y monitoreo operativo.

---

## 4. Mapa funcional real

| Flujo | Estado | Evidencia | Observación |
|---|---|---|---|
| **Solicitudes** | Completo | [actions-module/](app/(app)/solicitudes/actions-module/), `requestSchema` valida cantidades>0, ≥1 ítem, productos inactivos bloqueados al enviar | Cancelación con motivo permitida en `submitted`/`in_review`/`partially_approved` mientras no haya compra/recepción/entrega |
| **Aprobaciones** | Completo | [aprobaciones/actions.ts](app/(app)/aprobaciones/actions.ts): aprobar/rechazar/devolver por ítem, motivo obligatorio al modificar/rechazar/postergar, `FOR UPDATE` | Prevención habilitada para EPP |
| **Órdenes de Compra** | Completo | [purchasing-module/purchase-orders.ts](lib/services/purchasing-module/purchase-orders.ts): consolidación por proveedor, doble-compra prevenida por transición atómica, PDF A4, facturas | Cierre parcial reconcilia ítems y divide saldos remanentes |
| **Recepción oficina** | Completo | [receiving.ts](lib/services/receiving.ts): no aumenta stock, tope a lo ordenado, parcial soportado | — |
| **Recepción faena** | Completo | [receiving.ts:145-165](lib/services/receiving.ts#L145-L165): aumenta stock faena, genera kardex, topa a oficina | Recepción parcial habilita entrega del saldo recibido |
| **Bodega** | Completo | [bodega/actions.ts](app/(app)/bodega/actions.ts): ajuste con motivo, devolución topada a lo entregado neto, conteo físico, kardex/export XLSX | — |
| **Entregas** | Completo | [deliveries.ts](lib/services/deliveries.ts): a faena y a trabajador, parcial, descuento de stock, comprobante | Entrega desde `partially_received` habilitada |
| **Trazabilidad** | Completo | [trazabilidad-matrix.ts](lib/services/trazabilidad-matrix.ts), [trazabilidad-item.ts](lib/services/trazabilidad-item.ts): matriz producto×faena, detalle por ítem, export XLSX | Timeline y "En OC" corregidos |
| **Reportes** | Completo | [lib/reports/export-module/](lib/reports/export-module/): XLSX por estado/faena/OC, respeta scope RBAC | — |
| **Administración** | Completo | [admin/](app/(app)/admin/): usuarios, faenas, trabajadores, productos, proveedores, auditoría; baja lógica | — |
| **Dashboard** | Completo | [dashboard.ts](lib/services/dashboard.ts): KPIs y work-queue coherentes con la máquina de estados | — |

---

## 5. Bugs y errores de lógica confirmados

### [BUG-01] La línea de tiempo del ítem en Trazabilidad está siempre vacía

**Severidad:** Alto
**Módulo:** Trazabilidad
**Tipo:** Error de lógica / Bug de datos
**Estado:** Corregido el 2026-07-04

**Evidencia:**
- Archivo: [lib/services/trazabilidad-item.ts:266-271](lib/services/trazabilidad-item.ts#L266-L271)
  ```ts
  .where(and(
    eq(statusHistory.entityType, "purchase_request_item"),  // ← valor buscado
    eq(statusHistory.entityId, itemId),
  ))
  ```
- **Todos** los escritores de historial de ítems usan `entityType: "request_item"` (no `"purchase_request_item"`): [approval.ts:73](lib/services/item-state-module/approval.ts#L73), [submit.ts:39](lib/services/item-state-module/submit.ts#L39), [receiving.ts:51](lib/services/item-state-module/receiving.ts#L51), [purchase-order.ts:70](lib/services/item-state-module/purchase-order.ts#L70), [purchasing-module/purchase-orders.ts:268](lib/services/purchasing-module/purchase-orders.ts#L268). `recordStatusChange` guarda el `entityType` verbatim ([lib/audit.ts:54-64](lib/audit.ts#L54-L64)).

**Comportamiento esperado:** La vista de detalle del ítem (`/trazabilidad/[itemId]`) debe mostrar la cronología de estados (requested → approved → in_purchase_order → purchased → received → delivered).

**Comportamiento previo al fix:** El filtro nunca coincidía con ninguna fila → `timeline` siempre `[]`. La sección "Historial de estados" del detalle de ítem aparecía vacía para todos los ítems.

**Cómo reproducirlo:**
1. Crear una solicitud, aprobarla, generar OC, enviar, recibir.
2. Abrir `/trazabilidad/[itemId]`.
3. La cronología de estados está vacía pese a que `status_history` tiene todas las transiciones.

**Impacto funcional:** La trazabilidad por ítem (requisito explícito del dominio) no muestra el historial de estados. Se pierde auditoría visible del ciclo de vida.

**Datos que pueden quedar inconsistentes:** Ninguno (solo lectura); es un defecto de visualización, pero anula una feature de trazabilidad.

**Remediación aplicada:** Se cambió el literal a `"request_item"` en [trazabilidad-item.ts](lib/services/trazabilidad-item.ts) y el test de timeline ahora inserta el `entityType` real.

**Test recomendado:** Ver [TEST-01]. El test actual pasa porque inserta el `entityType` equivocado (ver INC-02).

---

### [BUG-02] No se puede entregar un ítem EPP recibido parcialmente en faena

**Severidad:** Alto
**Módulo:** Entregas / Recepción faena
**Tipo:** Error de lógica / Bug de estado
**Estado:** Corregido el 2026-07-04

**Evidencia:**
- Máquina de estados sin ruta desde `partially_received` hacia entrega: [item-state-module/types.ts:33-36](lib/services/item-state-module/types.ts#L33-L36)
  ```ts
  purchased:          ["partially_received", "received"],
  partially_received: ["received"],            // ← no va a partially_delivered
  received:           ["partially_delivered", "delivered"],
  ```
- Ambas rutas de entrega exigen estado `received`/`partially_delivered`: [deliveries.ts:87](lib/services/deliveries.ts#L87) (a faena) y [deliveries.ts:209](lib/services/deliveries.ts#L209) (a trabajador). También [bodega/actions.ts:76](app/(app)/bodega/actions.ts#L76).
- La recepción parcial en faena sí deja el ítem en `partially_received` con stock físico ingresado: [receiving.ts:146-164](lib/services/receiving.ts#L146-L164).

**Comportamiento esperado:** Si llegan 4 de 10 EPP a la faena, esas 4 unidades (ya en stock) deben poder entregarse al trabajador; el resto queda pendiente.

**Comportamiento previo al fix:** El ítem quedaba `partially_received`; cualquier intento de entrega devolvía *"Solo puedes entregar EPP recibidos pendientes de entrega"*. El stock existía pero el ítem trazable no era entregable hasta recibir el total.

**Cómo reproducirlo:**
1. OC de 10 unidades EPP, recibida en oficina (10) y en faena solo 4.
2. Ir a Entregas → seleccionar el EPP → registrar entrega.
3. Error de estado; imposible entregar las 4 unidades disponibles.

**Impacto funcional original:** Bloqueaba la entrega parcial de EPP recibido por partes — escenario frecuente en abastecimiento de faenas (despachos fraccionados). Forzaba a esperar el 100% del pedido antes de entregar cualquier unidad.

**Datos que pueden quedar inconsistentes:** Ninguno directo; es un bloqueo. Riesgo operativo: se recurre a ajustes/entregas no trazables para sortearlo, perdiendo trazabilidad ítem→trabajador.

**Remediación aplicada:** Se añadió la transición `partially_received → partially_delivered/delivered`; las guardas de entrega y Bodega aceptan `partially_received`; `/entregas` lista esos ítems como entregables cuando hay stock.

**Test recomendado:** Ver [TEST-02].

---

### [BUG-03] Cerrar una OC parcialmente recibida deja ítems y la solicitud huérfanos

**Severidad:** Alto
**Módulo:** Órdenes de Compra / Recepción
**Tipo:** Error de estado / Inconsistencia de flujo
**Estado:** Corregido el 2026-07-04

**Evidencia:**
- `closeOrder` solo cambia el estado de la OC; **no** reconcilia los `purchaseRequestItems` vinculados: [purchasing-module/receiving.ts:12-59](lib/services/purchasing-module/receiving.ts#L12-L59). Admite cerrar desde `supplier_confirmed`, `partially_received`, `received`.
- Tras cerrar, no se puede recibir contra la OC (`registerReceipt` exige estados `sent`/`*office_received*`/`partially_received`, [receiving.ts:67](lib/services/receiving.ts#L67)) y el rollup de recepción no toca OCs `closed`/`cancelled` ([receiving.ts:230-233](lib/services/receiving.ts#L230-L233)).
- El rollup de solicitud marca `in_purchasing` mientras haya ítems `purchased`/`partially_received` ([rollup.ts:27,39](lib/services/item-state-module/rollup.ts#L27-L39)), sin ruta de salida si la OC ya está cerrada.

**Comportamiento esperado:** Al cerrar una OC con recepción incompleta (p. ej. el proveedor no entregará el resto), los ítems no recibidos deberían resolverse explícitamente (reabrir a `pending_purchase` para recompra, o cancelarse con motivo), y la solicitud debería poder cerrarse/avanzar.

**Comportamiento previo al fix:** Los ítems quedaban atascados en `purchased`/`partially_received`/`in_purchase_order`, sin transición posible, y la solicitud padre permanecía `in_purchasing` indefinidamente. Estado imposible de resolver desde la UI.

**Cómo reproducirlo:**
1. OC con 2 ítems, recibir en faena solo 1.
2. Cerrar la OC (motivo obligatorio) desde estado `partially_received`.
3. El ítem no recibido queda `purchased`/`partially_received` sin acciones; la solicitud sigue `in_purchasing` para siempre.

**Impacto funcional:** Solicitudes y OCs en estados incoherentes/terminales muertos. Requiere corrección manual en base de datos. Contamina KPIs de dashboard ("OCs en curso", "pendientes de recepción").

**Datos que pueden quedar inconsistentes:** `purchaseRequestItems.status`, `purchaseRequests.status` (atascados); métricas de dashboard/trazabilidad.

**Remediación aplicada:** `closeOrder` ahora devuelve a `pending_purchase` los ítems de la OC sin recepción en faena y recalcula el rollup de la solicitud. Si el mismo ítem tiene recepción parcial en faena, reduce el ítem original a la cantidad efectivamente recibida y crea un nuevo ítem `pending_purchase` por el saldo remanente, copiando metadatos y atributos para conservar trazabilidad y permitir recompra.

**Test recomendado:** Ver [TEST-03].

---

### [BUG-04] La columna "En OC" de Trazabilidad doble-cuenta las líneas de OC anuladas

**Severidad:** Medio
**Módulo:** Trazabilidad
**Tipo:** Bug de datos / Reporte incorrecto
**Estado:** Corregido el 2026-07-04

**Evidencia:**
- La matriz suma **todas** las `purchaseOrderItems` por `requestItemId` **sin filtrar por estado de OC**: [trazabilidad-matrix.ts:126-133](lib/services/trazabilidad-matrix.ts#L126-L133) y agregación en [línea 187](lib/services/trazabilidad-matrix.ts#L187) (`inOc = ocItems.reduce(...)`).
- `cancelOrder` **no borra** las líneas: marca `purchaseOrderItems.status = "cancelled"` y devuelve el ítem a `pending_purchase` ([purchase-orders.ts:336-360](lib/services/purchasing-module/purchase-orders.ts#L336-L360)). Al recomprar, el ítem tendrá **dos** líneas de OC (una anulada + una activa).
- El flag `alert = isApproved && inOc < approved` ([línea 197](lib/services/trazabilidad-matrix.ts#L197)) usa ese `inOc` inflado.

**Comportamiento esperado:** "En OC" debe reflejar solo las líneas de OC vigentes (no anuladas).

**Comportamiento previo al fix:** Un ítem que estuvo en una OC anulada y luego se recompró mostraba `inOc` duplicado (p. ej. 20 en vez de 10), y podía **ocultar** la alerta "falta comprar".

**Cómo reproducirlo:**
1. Aprobar un ítem (cant. 10), crear OC-A, anular OC-A (ítem vuelve a `pending_purchase`).
2. Crear OC-B con el mismo ítem.
3. En `/trazabilidad`, la columna "En OC" muestra 20.

**Impacto funcional:** Métrica de cobertura de compra incorrecta; posible supresión de alertas de faltante. Afecta decisiones de reposición.

**Datos que pueden quedar inconsistentes:** Solo visualización/alertas (no muta datos).

**Remediación aplicada:** La matriz y el export XLSX de trazabilidad ahora excluyen `purchaseOrderItems.status = 'cancelled'` y `purchaseOrders.status = 'cancelled'`.

**Test recomendado:** Ver [TEST-04].

---

### [BUG-05] El rollup cierra la solicitud en "received" y no puede reabrirla

**Severidad:** Medio
**Módulo:** Transversal (máquina de estados)
**Tipo:** Error de lógica / Bug de estado
**Estado:** Corregido el 2026-07-04

**Evidencia:**
- `allClosed` incluye `"received"` y `"postponed"`: [rollup.ts:26](lib/services/item-state-module/rollup.ts#L26). Es decir, una solicitud pasa a `closed` cuando todos los ítems están recibidos **aunque no se hayan entregado**, o cuando todos están postergados.
- El `UPDATE` del rollup **excluye** `closed` de los estados actualizables ([rollup.ts:58-63](lib/services/item-state-module/rollup.ts#L58-L63)): una vez `closed`, ningún rollup posterior puede modificar la solicitud.

**Comportamiento esperado:** Coherencia entre el estado agregado de la solicitud y el ciclo real (recepción → entrega). Si un ítem se reactiva (p. ej. postergado → recompra), la solicitud debería reflejarlo.

**Comportamiento previo al fix:** (a) La solicitud aparecía `closed` mientras sus ítems aún estaban pendientes de **entrega** al trabajador. (b) Si todos los ítems se postergaban, la solicitud quedaba `closed` y, al reanudarse un ítem, la solicitud **no** volvía a `in_purchasing`.

**Cómo reproducirlo:**
1. Solicitud con 1 ítem; aprobar→OC→recibir en faena.
2. La solicitud pasa a `closed` aunque el EPP aún no se entrega al trabajador.

**Impacto funcional:** Etiquetado de estado engañoso; el listado de solicitudes muestra "cerrada" cuando aún falta entregar. No bloquea la entrega (esta opera por estado de ítem), pero confunde a jefaturas y afecta reportes por estado de solicitud.

**Datos que pueden quedar inconsistentes:** `purchaseRequests.status` respecto del ciclo real de entrega.

**Remediación aplicada:** `closed` queda como fin de entrega/resolución: `received` ya no cierra la solicitud y el rollup puede reevaluar solicitudes `closed` al reactivar ítems.

**Test recomendado:** Ver [TEST-05].

---

## 6. Funcionalidades faltantes o incompletas

### [MISS-01] No hay forma de reanudar un ítem postergado

**Clasificación:** Necesaria
**Módulo:** Órdenes de Compra / Aprobaciones
**Prioridad:** P1
**Estado actual:** Corregido el 2026-07-04

**Evidencia de ausencia o incompletitud:**
- `postponeItem` está expuesto y con acción de UI ([compras/actions.ts:279-329](app/(app)/compras/actions.ts#L279-L329)).
- `markItemPendingPurchase` (que haría `postponed → pending_purchase`) está **exportado pero sin ningún llamador** en `app/` ni UI. Búsqueda: `grep -rn "markItemPendingPurchase" app/` → 0 resultados; solo aparece en el `export` de [item-state-module/index.ts:5](lib/services/item-state-module/index.ts#L5).
- La máquina de estados sí permite `postponed → pending_purchase` ([types.ts:30](lib/services/item-state-module/types.ts#L30)), por lo que la brecha es solo de cableado.

**Por qué debería existir:** La postergación es una decisión temporal ("comprar más adelante"); sin reanudación, el ítem queda muerto y nunca se compra.

**Impacto de no tenerla:** Ítems postergados quedan varados permanentemente. Combinado con [BUG-05], la solicitud queda `closed` sin posibilidad de reactivación.

**Comportamiento esperado:** Acción "Reanudar" en el ítem postergado que lo devuelva a `pending_purchase` (visible nuevamente en el consolidado de compras).

**Implementación aplicada:** Server Action `resumeItemAction` valida permiso `purchasing:create_order`, acceso a faena y estado `postponed`; llama a `markItemPendingPurchase` y revalida Compras/Nueva OC/Trazabilidad. `/compras` muestra una bandeja compacta de ítems postergados con acción **Reanudar**.

**Tests mínimos:** Reanudar un ítem postergado → estado `pending_purchase`; aparece de nuevo en el consolidado de OC.

---

### [MISS-02] No se puede cancelar (con motivo) una solicitud ya enviada

**Clasificación:** Necesaria
**Módulo:** Solicitudes
**Prioridad:** P2
**Estado actual:** Corregido el 2026-07-04

**Evidencia de ausencia o incompletitud original:**
- `cancelRequest` solo admitía estados `draft`/`returned` y **no** pedía motivo.
- Una vez `submitted`/`in_review`, el solicitante no podía cancelar; solo el aprobador podía rechazar ítem por ítem.

**Por qué debería existir:** Es común anular una solicitud enviada por error o porque cambió la necesidad, dejando registro del motivo.

**Impacto de no tenerla:** El solicitante depende del aprobador para "limpiar" solicitudes obsoletas; no queda motivo de anulación a nivel solicitud.

**Comportamiento esperado:** Cancelación de solicitud enviada con motivo obligatorio, permitida al solicitante/rol con `requests:view_all`, mientras no haya ítems ya comprados/recibidos.

**Implementación aplicada:** `cancelRequest` admite `submitted`/`in_review`/`partially_approved` con motivo obligatorio, bloquea la cancelación si algún ítem ya entró a compra/recepción/entrega, marca los ítems no resueltos como `rejected`, registra historial/auditoría y expone el diálogo de cancelación con motivo en el detalle de solicitud de solo lectura.

**Tests mínimos:** Cancelar solicitud `submitted` con motivo → `cancelled`; bloquear cancelación si algún ítem ya está `purchased`/`received`.

---

### [MISS-03] Entrega de EPP parcialmente recibido (ver BUG-02)

**Clasificación:** Necesaria
**Módulo:** Entregas
**Prioridad:** P1
**Estado actual:** Corregido el 2026-07-04

Era la contraparte funcional de [BUG-02]: faltaba la capacidad de entregar el saldo disponible de un ítem `partially_received`. Ver remediación en BUG-02.

---

## 7. Inconsistencias entre documentación, UI y código

### [INC-01] El prevencionista de oficina no puede aprobar EPP, contradiciendo su rol y la especificación

**Tipo:** Docs/spec vs código · Estado vs flujo
**Severidad:** Medio
**Estado:** Corregido el 2026-07-04

**Fuente A (spec + definición de rol):**
- Tabla de roles del encargo: *"Prevencionista oficina | Aprueba EPP, recibe en oficina, administra maestros"*.
- Definición del rol en código: `prevencionista` = *"Revisa y aprueba solicitudes"*, `isGlobal: true` ([lib/auth/system-rbac.ts:22](lib/auth/system-rbac.ts#L22)).
- El rol **tiene** el permiso `approvals:approve` ([modules/approvals/manifest.ts:30](modules/approvals/manifest.ts#L30)).

**Fuente B (implementación):**
- El gate de EPP excluye explícitamente a `prevencionista`: `EPP_APPROVER_ROLES = {administrador, jefa_chome, secretaria}` ([aprobaciones/actions.ts:18-22](app/(app)/aprobaciones/actions.ts#L18-L22)); al aprobar/rechazar/devolver un ítem de tipo `epp` se devuelve *"solo pueden ser aprobadas por Jefatura o Secretaría"* ([aprobaciones/actions.ts:62-64,125-127,183-185](app/(app)/aprobaciones/actions.ts#L62-L64)).

**Problema:** Un prevencionista de oficina, con permiso de aprobación y descrito como aprobador, ve las solicitudes EPP en la cola pero es bloqueado justo al aprobarlas. El comentario del código lo justifica como separación de funciones ("EPP requests come from prevencionista"), lo que **contradice** tanto la spec como el propio label del rol.

**Impacto original:** Confusión de rol y bloqueo de una tarea que la spec asigna a ese rol. (Mitigado: jefatura/secretaría/admin sí podían aprobar EPP, así que el flujo global no estaba totalmente bloqueado.)

**Corrección aplicada:** `prevencionista` fue incluido en `EPP_APPROVER_ROLES` y los mensajes/tests se actualizaron a "Jefatura, Secretaría o Prevención".

---

### [INC-02] El test de trazabilidad-item usa el `entityType` equivocado y enmascara BUG-01

**Tipo:** Tests vs implementación
**Severidad:** Medio
**Estado:** Corregido el 2026-07-04

**Fuente A (test):**
- [lib/__tests__/trazabilidad-item.test.ts:423,428](lib/__tests__/trazabilidad-item.test.ts#L423) inserta `statusHistory` con `entityType: "purchase_request_item"` — el mismo valor **equivocado** que usa la consulta, por eso el test pasa.

**Fuente B (implementación real):**
- La producción escribe `entityType: "request_item"` (ver BUG-01). El fixture del test no refleja lo que el código realmente persiste.

**Problema:** El test valida contra un valor que el código de producción nunca escribe → da falsa confianza y **oculta** BUG-01.

**Impacto:** Una feature rota pasa el CI.

**Corrección aplicada:** El fixture usa `entityType: "request_item"` y falla si la consulta vuelve al literal equivocado.

---

## 8. Casos borde no cubiertos

| Caso borde | Resultado actual | ¿Cubierto? |
|---|---|---|
| Solicitud sin ítems / ítem cant. ≤ 0 | Bloqueado por `requestSchema` (`.min(1)`, `.positive()`) | ✅ |
| Producto inactivo en solicitud | Bloqueado al enviar ([submit.ts:56-65](app/(app)/solicitudes/actions-module/submit.ts#L56-L65)) | ✅ |
| Aprobar cantidad > solicitada | Permitido **con motivo obligatorio** ([aprobaciones/actions.ts:45-50](app/(app)/aprobaciones/actions.ts#L45-L50)); auditado | ✅ (aceptable) |
| Rechazar ítem ya comprado/recibido | Bloqueado por `canTransition` (`rejected` solo desde `requested`/`approved`) | ✅ |
| Crear OC sin ítems / ítem ya en otra OC | Bloqueado (`min(1)`, transición atómica a `in_purchase_order`) | ✅ |
| Enviar OC vacía | Bloqueado ([purchase-orders.ts:234-240](lib/services/purchasing-module/purchase-orders.ts#L234-L240)) | ✅ |
| Recibir en faena sin recepción de oficina | Bloqueado ([receiving.ts:70-72](lib/services/receiving.ts#L70-L72)) | ✅ |
| Recibir más de lo pendiente | Bloqueado ([receiving.ts:119-121](lib/services/receiving.ts#L119-L121)) | ✅ |
| Recepción duplicada del mismo ítem en un recibo | Bloqueado ([receiving.ts:49-52](lib/services/receiving.ts#L49-L52)) | ✅ |
| Entregar más de lo disponible / del saldo | Bloqueado (tope `pending` + guarda de stock negativo) | ✅ |
| Devolución sin entrega previa | Bloqueado (tope a entregado neto, [bodega/actions.ts:244-265](app/(app)/bodega/actions.ts#L244-L265)) | ✅ |
| Ajuste negativo > stock | Bloqueado (guarda SQL de stock negativo) | ✅ |
| Doble submit / concurrencia en aprobación/recepción/entrega | Serializado con `FOR UPDATE` + `UPDATE ... WHERE status=...` | ✅ |
| **Entregar ítem `partially_received`** | Permitido hasta el saldo recibido/disponible | ✅ |
| **Cerrar OC parcial → reconciliar ítems** | Devuelve ítems sin recepción a `pending_purchase` y divide saldos parcialmente recibidos | ✅ |
| **Reanudar ítem postergado** | Acción `Reanudar` vuelve a `pending_purchase` | ✅ |
| **"En OC" con OC anulada** | Excluye líneas/OCs canceladas | ✅ |
| Solicitud `closed` con ítems sin entregar | `received` ya no cierra la solicitud; cierre queda ligado a entrega/resolución | ✅ |

---

## 9. Tests añadidos y recomendados

### [TEST-01] Timeline del ítem con `entityType` real
**Módulo:** Trazabilidad · **Prioridad:** P0 · **Tipo:** Integración
**Riesgo que cubre:** BUG-01 (feature de trazabilidad rota).
**Escenario mínimo:** Ejecutar `submitItem`/`approveItem`/… reales sobre un ítem y luego `getItemDetail`.
**Resultado esperado:** `timeline.length > 0` con las transiciones en orden.
**Archivos sugeridos:** [lib/__tests__/trazabilidad-item.test.ts](lib/__tests__/trazabilidad-item.test.ts) (corregir fixture) o nuevo test de integración.

### [TEST-02] Entrega desde `partially_received`
**Módulo:** Entregas · **Prioridad:** P1 · **Tipo:** Integración
**Riesgo que cubre:** BUG-02.
**Escenario mínimo:** Recibir 4/10 en faena, intentar entregar 4 al trabajador.
**Resultado esperado:** Entrega permitida hasta el saldo recibido y disponible.

### [TEST-03] Cierre de OC parcialmente recibida reconcilia ítems
**Módulo:** OC · **Prioridad:** P1 · **Tipo:** Integración
**Riesgo que cubre:** BUG-03.
**Escenario mínimo:** OC 2 ítems, recibir 1, `closeOrder`.
**Resultado esperado:** El ítem no recibido queda en estado resoluble (`pending_purchase`) y, si existe un saldo parcialmente recibido del mismo ítem, se crea un nuevo ítem por el remanente; la solicitud no queda atascada.

### [TEST-04] "En OC" excluye líneas de OC anuladas
**Módulo:** Trazabilidad · **Prioridad:** P2 · **Tipo:** Unitario
**Riesgo que cubre:** BUG-04.
**Escenario mínimo:** Ítem con una OC anulada + una activa.
**Resultado esperado:** `inOc` = cantidad de la OC vigente (no la suma).

### [TEST-05] Reanudar postergado / rollup reversible
**Módulo:** Transversal · **Prioridad:** P2 · **Tipo:** Integración
**Riesgo que cubre:** MISS-01 + BUG-05.
**Escenario mínimo:** Postergar todos los ítems (solicitud→`closed`), reanudar uno.
**Resultado esperado:** Ítem `pending_purchase`; solicitud vuelve a `in_purchasing`.

---

## 10. Deuda funcional priorizada

| ID | Título | Severidad | Prioridad |
|---|---|---|---|
| BUG-01 | Timeline de ítem siempre vacío | Alto | ✅ Corregido |
| BUG-02 / MISS-03 | Entrega de EPP parcialmente recibido bloqueada | Alto | ✅ Corregido |
| BUG-03 | Cerrar OC parcial deja ítems/solicitud huérfanos | Alto | ✅ Corregido |
| MISS-01 | Reanudar ítem postergado (sin cablear) | Necesaria | ✅ Corregido |
| INC-02 | Test enmascara BUG-01 | Medio | ✅ Corregido |
| BUG-04 | "En OC" doble-cuenta OC anuladas | Medio | ✅ Corregido |
| BUG-05 | Rollup cierra en `received` y no reabre | Medio | ✅ Corregido |
| INC-01 | Prevencionista no aprueba EPP (contradicción de rol) | Medio | ✅ Corregido |
| MISS-02 | Cancelar solicitud enviada con motivo | Necesaria | ✅ Corregido |

---

## 11. Roadmap de corrección

**Hecho el 2026-07-04:**
1. BUG-01 + INC-02: corregido `entityType` en timeline y fixture.
2. BUG-02/MISS-03: habilitada entrega desde `partially_received`.
3. BUG-03: cierre de OC reconcilia ítems sin recepción a `pending_purchase` y recalcula solicitud.
4. MISS-01: `resumeItemAction` + bandeja de postergados en Compras.
5. BUG-04: matriz y XLSX excluyen OCs/líneas canceladas.
6. BUG-05: `closed` queda ligado a entrega/resolución y el rollup puede reevaluar cerradas.
7. INC-01: prevencionista habilitado para gestionar EPP.
8. MISS-02: cancelación de solicitud enviada con motivo obligatorio y bloqueo si ya hay compra/recepción/entrega.
9. BUG-03 robustez: split de saldo remanente en cierre de OC parcialmente recibida.
10. Compra parcial: acción y servicio bloquean cantidades menores a la aprobada hasta que exista un flujo explícito de división.
11. TEST-01..05 y regresiones extra: cobertura focalizada añadida/actualizada.

**Pendiente natural:**
- No quedan pendientes funcionales confirmados en esta auditoría.
- Vigilancia operativa: si en el futuro se quiere comprar parcialmente un ítem aprobado, implementar primero un flujo explícito de división; hoy se bloquea para evitar saldos huérfanos.

> **Nota de robustez:** `createOrderAction` y `createOrdersBySupplier` ahora exigen comprar la cantidad aprobada completa del ítem. La compra parcial futura debe diseñarse como split explícito, no como cantidad menor silenciosa.

---

## 12. Checklist inmediato

```markdown
- [x] Se puede crear una solicitud válida con múltiples ítems.
- [x] Se puede aprobar, rechazar o postergar cada ítem individualmente.
- [x] Las cantidades aprobadas, compradas, recibidas y entregadas son consistentes.
- [x] Se puede crear una OC solo con ítems aprobados y no comprados previamente.
- [x] La recepción en oficina no aumenta stock de faena.
- [x] La recepción en faena aumenta stock de la faena correcta.
- [x] Cada movimiento de stock genera kardex coherente.
- [x] No se puede entregar más stock del disponible.
- [x] Una entrega descuenta stock correctamente.
- [x] El ciclo del ítem se cierra al entregarse completamente.
- [x] Las recepciones y entregas parciales funcionan correctamente. → entrega desde `partially_received` habilitada.
- [x] Las solicitudes, OCs e ítems agregan estados correctamente. → cierre prematuro, reconciliación de ítems sin recepción y saldo remanente por split corregidos.
- [x] Los reportes coinciden con los datos reales. → Trazabilidad "En OC" corregida.
- [x] La trazabilidad muestra cantidades correctas por producto, faena y estado. → timeline y "En OC" corregidos.
- [x] Las exportaciones XLSX respetan filtros y totales.
- [x] Los usuarios tienen las acciones funcionales necesarias para cumplir su rol. → EPP/prevención, reanudar postergado y cancelar solicitud enviada con motivo corregidos.
- [x] Hay tests para state machine, stock, kardex, recepción, entrega, aprobaciones y trazabilidad de los bugs corregidos.
```

---

## 13. Conclusión

Chome Solicitudes y Bodega tiene un **núcleo transaccional sólido**: stock y kardex son atómicos, no admiten negativos ni sobre-entregas/sobre-recepciones, y la concurrencia está bien serializada. El flujo principal `Solicitud → Aprobación → OC → Recepción → Entrega` funciona de punta a punta y está razonablemente testeado (unit + E2E). `typecheck`, `test` y `build` pasan en verde.

La remediación del 2026-07-04 cerró las incoherencias principales: timeline de ítem, entrega parcial, cierre de OC parcial con split de saldo, reanudación de postergados, "En OC" con OCs anuladas, rollup prematuro, rol de prevencionista y cancelación con motivo de solicitudes enviadas.

**Decisión actualizada: 🟢 Listo para producción funcional. Calificación: 9/10.** No quedan pendientes funcionales confirmados en esta auditoría; la recomendación restante es piloto controlado y monitoreo operativo con datos reales.
