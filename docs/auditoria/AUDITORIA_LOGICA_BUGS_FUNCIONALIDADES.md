# Auditoría de Lógica, Bugs y Funcionalidades Faltantes: Plataforma Chome

> Auditoría funcional centrada en lógica de negocio, bugs, consistencia de datos
> (stock/kardex/estados) y funcionalidades faltantes. **No** es una auditoría de
> seguridad, DevOps ni performance (esos temas solo se mencionan si afectan la
> lógica funcional).
>
> **Fecha:** 2026-06-22 · **Rama:** `feat/sst-prevencion-module` · **Commit base:** `25f4baf`
> **Método:** lectura directa de `db/schema`, `lib/services`, `lib/auth`,
> `app/(app)/*/actions.ts`, `lib/reports`, páginas server y tests; ejecución de
> `npm run typecheck` y `npm run test`.

---

## 1. Resumen ejecutivo

Plataforma Chome **sí implementa de punta a punta** el flujo central
`Solicitud → Aprobación (por ítem) → Orden de Compra → Recepción oficina →
Recepción faena → Entrega (faena/trabajador)`. La capa de servicios (`lib/services`)
concentra correctamente toda la mutación de estado y stock, con buenas prácticas
de integridad:

- **El stock solo se muta en un único lugar** (`applyMovementTx` en
  [lib/services/stock.ts](lib/services/stock.ts)), de forma atómica, con `FOR UPDATE`
  donde corresponde y con un `WHERE ... quantity + delta >= 0` que **impide stock
  negativo a nivel SQL**.
- Hay **constraints `CHECK` a nivel de base de datos** que blindan estados,
  cantidades positivas y montos no negativos ([db/schema/](db/schema/),
  [db/migrations/0004_operational_state_constraints.sql](db/migrations/0004_operational_state_constraints.sql)).
- La **recepción en dos etapas** (oficina vs faena) está bien modelada: la oficina
  **no** suma stock de faena y la faena está acotada por lo recibido en oficina
  ([lib/services/receiving.ts](lib/services/receiving.ts)).
- La **doble compra** del mismo ítem está prevenida por un índice único parcial
  ([db/migrations/0010_unique_oc_item_per_request.sql](db/migrations/0010_unique_oc_item_per_request.sql)).
- Recepciones y entregas **parciales** funcionan, con kardex coherente.
- Cobertura de tests amplia: **1228 tests pasan**, 4 skip, 1 falla (ver §9).

**Actualización 2026-06-22 — Sprint 0 completado:** los cuatro P1 del Sprint 0 fueron
corregidos en esta sesión: BUG-01 (regresión de estado), BUG-02 (motivo obligatorio al
modificar cantidad), BUG-03 (logger circular — suite verde), MISS-01/INC-02 (ajuste
manual de inventario). La suite pasa con **1229 tests, 0 fallos**.

**Actualización 2026-06-22 — Sprints 1 y 2 completados:** MISS-02/INC-01 (cierre y
confirmación de OC), MISS-03 (re-envío por ítem devuelto), MISS-05 (cap de devolución),
MISS-06 (producto inactivo), INC-03 (helpers muertos) e INC-04 (semántica documentada)
implementados en esta sesión. La suite pasa con **1229 tests, 0 fallos**.

**Actualización 2026-06-22 — MISS-04 resuelto:** el gating de aprobación de EPP ya
estaba implementado (backend + UI) desde Sprints 1-2. La política fue confirmada por
negocio: las solicitudes EPP son creadas por Prevencionista; solo Jefatura, Secretaría
y Administrador pueden aprobar/rechazar/devolver ítems EPP. Se añadieron 11 tests
dedicados (`aprobaciones-actions.test.ts`). La suite pasa con **1240 tests, 0 fallos**.

---

## 2. Decisión de producción

### 🟡 Listo para producción con observaciones

Justificación: los flujos centrales están **completos y razonablemente testeados**,
y **ningún bug corrompe stock ni kardex** (la integridad de inventario está bien
protegida). Pero existe **una inconsistencia confirmada entre el estado del ítem y
el de la solicitud** (BUG-01), funcionalidades de bodega/OC incompletas, y la suite
de pruebas falla (`npm run test` retorna exit 1). Se puede operar en **uso
controlado y supervisado**, corrigiendo P0/P1 antes de operación autónoma.

---

## 3. Calificación global 1-10

### **6 / 10** — "Producto cercano, con bugs relevantes y deuda funcional pendiente"

**Por qué exactamente 6 (no más):**

- Regla de calificación aplicada: *"Si hay inconsistencias graves entre estados de
  ítem, solicitud y orden de compra, la nota máxima es 6/10."* → **BUG-01** es
  precisamente una inconsistencia ítem↔solicitud (la solicitud regresa a `approved`
  cuando sus ítems ya están recibidos y entregándose). Esto **topa la nota en 6**.
- No aplica el techo de 5 (ningún bug confirmado corrompe stock/kardex: el stock
  está blindado a nivel SQL).
- No aplica el techo de 6 por "falta de funcionalidad central del flujo": el flujo
  `Solicitud→Aprobación→OC→Recepción→Entrega` **está completo** (incluyendo parciales).

**Por qué no menos de 6:**

- El flujo principal funciona end-to-end, con transacciones atómicas, locks,
  constraints de BD, kardex coherente y prevención de doble compra/entrega.
- Cobertura de tests alta y significativa sobre state machine, stock, recepción,
  entregas, concurrencia (postgres) y RBAC.

---

## 4. Mapa funcional real

| Flujo | Estado | Evidencia | Observación |
|---|---|---|---|
| **Solicitudes** | Completo | [app/(app)/solicitudes/actions.ts](app/(app)/solicitudes/actions.ts), [lib/services/requests-draft.ts](lib/services/requests-draft.ts) | Multi-ítem, borrador con diff (preserva audit), atributos, urgencia, duplicar como plantilla, envío. Falta validar producto inactivo al crear (MISS-06). |
| **Aprobaciones** | Completo | [app/(app)/aprobaciones/actions.ts](app/(app)/aprobaciones/actions.ts), [lib/services/item-state.ts](lib/services/item-state.ts) | Aprobar/rechazar/devolver/postergar por ítem, motivo obligatorio en rechazo/devolución/postergación, motivo al modificar cantidad (BUG-02 corregido). Gating EPP: solo Jefatura/Secretaría/Admin pueden gestionar ítems EPP, dado que la solicitud proviene de Prevencionista (MISS-04 resuelto). |
| **Órdenes de Compra** | Parcial | [lib/services/purchasing.ts](lib/services/purchasing.ts), [app/(app)/compras/actions.ts](app/(app)/compras/actions.ts) | Consolida por proveedor, evita doble compra, cap de cantidad ≤ aprobada, PDF imprimible, facturas adjuntas. **No existe cierre de OC ni `supplier_confirmed`** (INC-01, MISS-02). |
| **Recepción oficina** | Completo | [lib/services/receiving.ts](lib/services/receiving.ts) L67-144 | Registra llegada admin, **no suma stock de faena**, soporta parcial, exige permiso `receiving:register_office`. |
| **Recepción faena** | Completo | [lib/services/receiving.ts](lib/services/receiving.ts) L145-166 | Suma stock a la faena de la OC, genera kardex `ingreso_oc`, acota a lo recibido en oficina, transiciona ítem. |
| **Bodega** | Parcial | [app/(app)/bodega/actions.ts](app/(app)/bodega/actions.ts), [lib/services/stock.ts](lib/services/stock.ts) | Stock por faena, mínimos, alertas, kardex, devolución (+). **No hay ajuste manual (especialmente negativo) con motivo** aunque el permiso existe (MISS-01, INC-02). Devolución no acotada a entregas previas (MISS-05). |
| **Entregas** | Completo | [lib/services/deliveries.ts](lib/services/deliveries.ts) | Entrega a faena y a trabajador, descuento de stock atómico, kardex `egreso_entrega`, parciales, devolución de EPP viejo, comprobante. Cierre de ítem afectado por BUG-01. |
| **Trazabilidad** | Completo | [app/(app)/trazabilidad/page.tsx](app/(app)/trazabilidad/page.tsx), [lib/services/trazabilidad-export.ts](lib/services/trazabilidad-export.ts) | Matriz producto×faena, solicitado/aprobado/en OC/recibido, alerta `aprobado>OC`, export XLSX. "Recibido" filtra correctamente `locationType='faena'` (sin doble conteo). |
| **Reportes** | Completo | [lib/reports/export.ts](lib/reports/export.ts) | 3 reportes, export XLSX (ExcelJS), respeta scope de faena + filtros de fecha/estado/faena, límite de filas. |
| **Administración** | Completo | [app/(app)/admin/*/actions.ts](app/(app)/admin/) | Usuarios, faenas, trabajadores, productos, proveedores, config, auditoría. Maestros usan **soft-delete (`isActive`)**, no rompen histórico. |

Leyenda: **Completo** = flujo presente y conectado UI↔servicio↔BD; **Parcial** =
flujo presente pero con piezas declaradas/esperadas no implementadas.

---

## 5. Bugs y errores de lógica confirmados

### [BUG-01] La entrega parcial regresa el estado de la solicitud a `approved`

**Severidad:** Alto
**Módulo:** Entregas / Transversal (rollup de estado de solicitud)
**Tipo:** Error de lógica / Bug de estado
**Estado:** ✅ Corregido (2026-06-22)

**Evidencia:**
- Archivo: [lib/services/item-state.ts](lib/services/item-state.ts)
- Función: `rollupRequestStatus` (L326-384), invocada por `deliverItemTx` (L648-696).
- Patrón observado: el conjunto `allClosed` (L345) es
  `["received", "rejected", "delivered", "postponed"]` y **no incluye
  `partially_delivered`**; tampoco está en `anyPurchasing` (L346). Por eso, una
  solicitud cuyos ítems están todos en `partially_delivered`/`delivered` cae a la
  rama L360-366 y se evalúa como `approved`. El `WHERE` de actualización (L377-383)
  **permite escribir desde `closed`/`in_purchasing`**, por lo que la solicitud
  retrocede.

**Comportamiento esperado:**
Tras una entrega parcial de un ítem ya recibido, la solicitud debe permanecer en un
estado coherente con "ya comprada/recibida/entregándose" (`in_purchasing` o `closed`),
nunca volver a `approved` (que significa "aprobada, pendiente de compra").

**Comportamiento actual:**
1. Solicitud de 1 ítem; el ítem llega a `received` → `rollupRequestStatus` la marca
   `closed` (confirmado por el test [lib/__tests__/full-flow-integration.test.ts](lib/__tests__/full-flow-integration.test.ts) L311).
2. Se registra una **entrega parcial** al trabajador → el ítem pasa a
   `partially_delivered`.
3. `rollupRequestStatus` recalcula y obtiene `approved`; el `WHERE` permite el cambio
   desde `closed` → **la solicitud queda en `approved`**.
4. Al completar la entrega (`delivered`), vuelve a `closed` (se auto-sana), pero
   durante toda la ventana de entrega parcial el estado es incorrecto.

Variante multi-ítem: con dos ítems en `partially_delivered`, `anyPurchasing` es
falso y el rollup también produce `approved`.

**Cómo reproducirlo:**
1. Crear y aprobar una solicitud EPP de un producto con `quantity = 2`.
2. Comprar, enviar OC, recibir en oficina y en faena (ítem → `received`, solicitud → `closed`).
3. Entregar al trabajador `quantity = 1` (entrega parcial).
4. Observar `purchase_requests.status` → queda `approved`.

**Impacto funcional:**
La solicitud aparece como "aprobada / pendiente de compra" en listados, filtros y en
cualquier vista que agrupe por `status`, cuando en realidad ya fue comprada, recibida
y está en proceso de entrega. Confunde a Secretaría/Jefatura y ensucia métricas y
reportes basados en estado de solicitud.

**Datos que pueden quedar inconsistentes:**
`purchase_requests.status` desalineado con el estado real de sus ítems. No corrompe
stock ni kardex. Se corrige solo al completar la entrega.

**Remediación concreta:**
En `rollupRequestStatus`, tratar `partially_delivered` como estado "en proceso, ya
comprado": añadirlo al conjunto `anyPurchasing` **o** definir explícitamente que
solicitudes con ítems en `received`/`partially_delivered`/`delivered` permanecen en
`closed`/`in_purchasing`. Adicionalmente, restringir el `WHERE` (L377-383) para que
**no permita regresar desde `closed`** salvo reapertura explícita.

**Test recomendado:**
Integración: solicitud → received (`closed`) → entrega parcial → assert
`request.status === 'closed'` (o `in_purchasing`), no `approved`; y tras entrega total
assert `closed`.

**Corrección aplicada:**

- `anyPurchasing` extendido con `"partially_delivered"` → solicitud permanece en `in_purchasing` durante entregas parciales.
- `"closed"` eliminado del `WHERE` de `rollupRequestStatus` → imposible regresar desde `closed` por rollup.
- Archivo: [lib/services/item-state.ts](lib/services/item-state.ts).

---

### [BUG-02] Modificar la cantidad al aprobar no exige motivo ni valida que supere lo solicitado

**Severidad:** Medio
**Módulo:** Aprobaciones
**Tipo:** Bug de validación / Error de lógica
**Estado:** ✅ Corregido (2026-06-22)

**Evidencia:**
- Archivo: [app/(app)/aprobaciones/actions.ts](app/(app)/aprobaciones/actions.ts) L39-44, L57-61.
- Archivo: [lib/services/item-state.ts](lib/services/item-state.ts) `approveItem` L124-199.
- `approveItemAction` lee `modifiedQty` y solo valida `> 0` (L42-44). No recibe ni
  exige `reason`. `approveItem` inserta `approval_decisions` con `type='modify'` pero
  **`reason: null`** (L170-178). No hay comparación contra `quantity` original.

**Comportamiento esperado:**
Al modificar la cantidad aprobada respecto a la solicitada, el sistema debe **exigir
motivo** (requisito explícito del dominio) y, como mínimo, advertir/validar cuando la
cantidad aprobada **supera** la solicitada.

**Comportamiento actual:**
Un aprobador puede aprobar con `modifiedQty` mayor (o menor) que la cantidad
solicitada, sin registrar ninguna razón. La decisión `modify` queda sin justificación
en el trail.

**Cómo reproducirlo:**
1. Ítem solicitado con `quantity = 5`.
2. Aprobar con `modifiedQty = 50` sin texto de motivo.
3. La aprobación se acepta; `approval_decisions.reason` queda `null`.

**Impacto funcional:**
Pérdida de trazabilidad del "por qué" de un cambio de cantidad (gobernanza/compras);
posibilidad de inflar cantidades aprobadas sin control. La compra posterior sí está
acotada a la cantidad aprobada ([app/(app)/compras/actions.ts](app/(app)/compras/actions.ts) L108-110),
así que el riesgo es de gobernanza/auditoría, no de doble gasto directo.

**Datos que pueden quedar inconsistentes:**
`approval_decisions` con `type='modify'` y `reason=null`; cantidad aprobada > solicitada
sin registro de causa.

**Remediación concreta:**
Hacer `reason` obligatorio cuando `modifiedQty` está presente (en la action y en el
servicio). Añadir validación/confirmación explícita cuando `modifiedQty > quantity`
original.

**Test recomendado:**
Unitario: `approveItemAction` con `modifiedQty` y sin `reason` → `ok:false`. Servicio:
`approveItem({modifiedQty})` exige `reason`; `approval_decisions.reason` queda poblado.

**Corrección aplicada:**

- `approveItem` lanza si `modifiedQty` presente y `reason` ausente.
- `approveItemAction` valida `reason` en la action antes de llamar al servicio.
- UI: campo `reason` aparece condicionalmente cuando el aprobador escribe una cantidad diferente a la solicitada (`ApproveForm` en [approval-panel.tsx](app/(app)/aprobaciones/approval-panel.tsx)).
- Test existente `allows modifiedQty override` actualizado para pasar `reason`.

---

### [BUG-03] `logger.error` lanza excepción ante estructuras circulares (suite en rojo)

**Severidad:** Bajo (funcional) / Alto (CI: la suite no pasa)
**Módulo:** Transversal (logging)
**Tipo:** Bug backend
**Estado:** ✅ Corregido (2026-06-22)

**Evidencia:**
- Archivo: [lib/logger.ts](lib/logger.ts) L132 — `args.map((a) => ... JSON.stringify(a))`.
- Test fallando: [lib/__tests__/logger-redaction.test.ts](lib/__tests__/logger-redaction.test.ts) "detects and redacts circular references" →
  `TypeError: Converting circular structure to JSON`.
- `npm run test` → **`Test Files 1 failed | 115 passed`, `Tests 1 failed | 1228 passed | 4 skipped`, exit 1.**

**Comportamiento esperado:**
El logger debe redactar/serializar de forma segura cualquier objeto, incluso con
referencias circulares, sin lanzar.

**Comportamiento actual:**
`JSON.stringify` sobre un objeto circular lanza; si un Server Action invoca
`logger.error(msg, errorConCircularidad)`, el propio logger explota y puede enmascarar
el error original. Además mantiene la suite en rojo (bloquea un build verde / CI).

**Cómo reproducirlo:**
`npm run test` → falla 1 test; o `logger.error("x", obj)` con `obj.self = obj`.

**Impacto funcional:**
Bajo en operación normal (rara vez se loggean objetos circulares), pero **`npm run
test` no pasa**, lo que invalida el "build verde" exigible antes de producción.

**Remediación concreta:**
Usar un serializador seguro (replacer con `WeakSet` para detectar ciclos) en
[lib/logger.ts](lib/logger.ts) L132.

**Test recomendado:**
El test existente ya cubre el caso; basta hacerlo pasar.

**Corrección aplicada:**

- Path de Sentry en `logger.error` cambiado de `JSON.stringify(a)` a `JSON.stringify(redact(a))` — `redact` ya maneja circulares con `WeakSet`.
- Test `detects and redacts circular references` pasa. Suite: **116 archivos, 1229 tests, 0 fallos**.
- Archivo: [lib/logger.ts](lib/logger.ts).

---

## 6. Funcionalidades faltantes o incompletas

### [MISS-01] Ajuste manual de inventario (especialmente negativo) con motivo obligatorio

**Clasificación:** Necesaria
**Módulo:** Bodega
**Prioridad:** P1
**Estado actual:** ✅ Implementado (2026-06-22)

**Evidencia de ausencia:**
- Tipos de movimiento permitidos: `ingreso_oc`, `egreso_entrega`, `ingreso_devolucion`,
  `egreso_desecho` ([db/schema/stock.ts](db/schema/stock.ts) L41-43; [lib/services/stock.ts](lib/services/stock.ts) L13-17).
- `egreso_desecho` es **record-only** (no cambia stock — [lib/services/stock.ts](lib/services/stock.ts) L65-111).
- Acciones de bodega: solo `dispatchAction`, `setMinStockAction`, `returnStockAction`
  ([app/(app)/bodega/actions.ts](app/(app)/bodega/actions.ts)). No hay acción de ajuste.
- Permiso `warehouse:adjust_stock` (`p-wh-adj`) **declarado** pero **no usado** en
  ninguna parte del código ([lib/auth/system-rbac.ts](lib/auth/system-rbac.ts) L30; sin referencias en `app/`/`lib/`).

**Por qué debería existir:**
Toda bodega real necesita corregir descuadres físicos: mermas, pérdidas, roturas,
recuentos. Hoy **no existe forma de reducir stock** salvo entregar; un descuadre
negativo (sobra en sistema, falta físico) es incorregible.

**Impacto de no tenerla:**
Stock de sistema diverge del físico sin mecanismo de corrección; obliga a "entregas
ficticias" para cuadrar (ensuciando trazabilidad y kardex).

**Comportamiento esperado:**
Movimiento de ajuste `+/-` con motivo obligatorio, que escriba kardex y respete el
no-negativo. Gobernado por `warehouse:adjust_stock`.

**Propuesta de implementación:**
Añadir tipo `ajuste` al `CHECK` y a `MovementType`; acción `adjustStockAction` (motivo
obligatorio) que llame `applyMovement`; conectar el permiso ya existente.

**Tests mínimos:**
Ajuste negativo > stock → error; ajuste con motivo → kardex + saldo correcto; sin
permiso → bloqueado.

**Implementación aplicada:**

- Nuevo tipo `"ajuste"` añadido a `MovementType` y al CHECK de BD ([db/migrations/0023_add_ajuste_movement_type.sql](db/migrations/0023_add_ajuste_movement_type.sql)).
- `applyMovementTx` valida `reason` obligatorio y `quantity !== 0` para `ajuste`; el delta puede ser + o -.
- Schema zod `adjustStockSchema` con campo `direction: enum(ingreso,egreso)`.
- `adjustStockAction` gated por `warehouse:adjust_stock` (permiso ya existente).
- UI: `AdjustPanel` ([app/(app)/bodega/adjust-panel.tsx](app/(app)/bodega/adjust-panel.tsx)) integrado en la página de bodega junto al `ReturnPanel`, visible solo para roles con `warehouse:adjust_stock`.

---

### [MISS-02] Cierre de OC y confirmación de proveedor (`supplier_confirmed`, `closed`)

**Clasificación:** Necesaria
**Módulo:** Órdenes de Compra
**Prioridad:** P2
**Estado actual:** ✅ Implementado (2026-06-22)

**Evidencia de ausencia:**
- El `CHECK` de OC admite `supplier_confirmed` y `closed`
  ([db/schema/purchasing.ts](db/schema/purchasing.ts) L36-42), y el dashboard/reportes los **referencian**
  ([lib/services/dashboard.ts](lib/services/dashboard.ts) L68-71, L268).
- Pero **ninguna transición los asigna**: `purchasing.ts` solo hace
  `draft→issued→sent`, `cancel`, `delete`; `receiving.ts` solo llega hasta `received`
  ([lib/services/receiving.ts](lib/services/receiving.ts) L218-223). No hay `closeOrder` ni `confirmOrder`.

**Por qué debería existir:**
El ciclo esperado de OC (`...→supplier_confirmed→...→received→closed`) requiere un
paso de confirmación del proveedor y un cierre terminal. Sin cierre, una OC con
ítems dañados/rechazados que nunca alcanzan `received` queda **eternamente en
`partially_received`**, sin forma de darla por terminada.

**Impacto de no tenerla:**
OCs "colgadas" en estados intermedios; imposible distinguir "cerrada/finiquitada" de
"a la espera"; el estado `closed` de OC es inalcanzable.

**Comportamiento esperado:**
Acción de cierre manual de OC (con motivo si quedan pendientes) y, opcionalmente,
marca de confirmación de proveedor.

**Propuesta de implementación:**
`closeOrder(orderId, reason)` (estados `received`/`partially_received`→`closed`) y
`confirmOrder` (`sent`→`supplier_confirmed`); incluir en `rollupOrderReceiptStatus`
el respeto al `closed` manual (ya lo respeta vía `notInArray`).

**Tests mínimos:**
Cerrar OC parcialmente recibida con motivo → `closed`; recibir contra OC cerrada → error.

**Implementación aplicada:**

- `confirmOrder` (`sent → supplier_confirmed`) y `closeOrder` (`supplier_confirmed/partially_received/received → closed`, motivo obligatorio) en [lib/services/purchasing.ts](lib/services/purchasing.ts).
- `confirmOrderAction` y `closeOrderAction` en [app/(app)/compras/actions.ts](app/(app)/compras/actions.ts).
- `OcActions` ([app/(app)/compras/[id]/oc-actions.tsx](app/(app)/compras/[id]/oc-actions.tsx)) actualizado: botón "Confirmar proveedor" para `sent`, formulario "Cerrar orden" con motivo para los tres estados closeable.
- `canShowOrderActions` en [app/(app)/compras/[id]/page.tsx](app/(app)/compras/[id]/page.tsx) ampliado para incluir esos tres estados.

---

### [MISS-03] Corrección real por ítem devuelto (`returned`) sin devolver toda la solicitud

**Clasificación:** Necesaria
**Módulo:** Solicitudes / Aprobaciones
**Prioridad:** P2
**Estado actual:** ✅ Implementado (2026-06-22)

**Evidencia:**
- `returnItem` deja el ítem en `returned` ([lib/services/item-state.ts](lib/services/item-state.ts) L266-320).
- La edición de solicitudes solo se permite si la **solicitud** está en `draft` o
  `returned` ([lib/services/requests-draft.ts](lib/services/requests-draft.ts) L120).
- El rollup marca la solicitud `returned` **solo si TODOS los ítems** están `returned`
  ([lib/services/item-state.ts](lib/services/item-state.ts) L344, L354).

**Por qué debería existir:**
"Devolver por ítem" implica que el solicitante pueda corregir **ese** ítem. Pero si
otros ítems siguen `requested`/`approved`, la solicitud queda `in_review` y el
solicitante **no puede editar** el ítem devuelto.

**Impacto de no tenerla:**
La devolución por ítem queda como acción "decorativa": el ítem devuelto se bloquea
hasta que toda la solicitud sea devuelta. Frustra el flujo de corrección.

**Comportamiento esperado:**
Permitir editar/re-enviar el ítem devuelto individualmente aunque la solicitud esté
parcialmente en revisión.

**Propuesta de implementación:**
Permitir edición a nivel ítem para ítems en `returned` aunque la solicitud no esté en
`draft/returned`; re-enviar solo ese ítem (`returned→requested`).

**Tests mínimos:**
Solicitud con 2 ítems (uno `returned`, uno `requested`): editar y re-enviar el devuelto.

**Implementación aplicada:**

- `resubmitReturnedItemAction` en [app/(app)/solicitudes/actions.ts](app/(app)/solicitudes/actions.ts): valida `status === "returned"`, verifica ownership, llama `submitItem` (transición `returned → requested` ya soportada por `ALLOWED_TRANSITIONS`).
- `status` añadido a `EditItem` y `ItemRow` ([request-form.types.ts](app/(app)/solicitudes/request-form.types.ts)) y propagado desde la página de detalle.
- Botón "Re-enviar a aprobación →" en [request-form.tsx](app/(app)/solicitudes/request-form.tsx): visible solo para ítems con `status === "returned"` en modo read-only.

---

### [MISS-04] Gating de aprobación de EPP por prevencionista

**Clasificación:** Necesaria (validar contra política)
**Módulo:** Aprobaciones
**Prioridad:** P2
**Estado actual:** ✅ Implementado (ya existía; confirmado y testeado 2026-06-22)

**Evidencia original:**
- `approveItemAction` solo exige `approvals:approve` ([app/(app)/aprobaciones/actions.ts](app/(app)/aprobaciones/actions.ts) L33),
  sin distinguir `requestType='epp'`.
- Tienen `approvals:approve`: `jefa_chome`, `secretaria` y `prevencionista`
  ([lib/auth/system-rbac.ts](lib/auth/system-rbac.ts) L72, L82-83, L93). No hay control que **exija**
  intervención de prevención para EPP.

**Política confirmada por negocio (2026-06-22):**
Las solicitudes EPP son **creadas por Prevencionista**. La aprobación de ítems EPP
corresponde a **Jefatura o Secretaría** (no al propio Prevencionista). Esto tiene
sentido: quien solicita no debería aprobar su propia solicitud.

**Comportamiento implementado:**
- `approveItemAction`, `rejectItemAction`, `returnItemAction` y `bulkApproveRequestAction`
  verifican `canApproveEpp(session.user.roles)` para solicitudes `requestType === "epp"`.
- Roles autorizados: `administrador`, `jefa_chome`, `secretaria`.
- UI: botones de aprobar/rechazar ocultos para roles no autorizados en ítems EPP;
  mensaje "Requiere Jefatura o Secretaría" visible.
- Datos filtrados en `getApprovalItemsAction` para no mostrar ítems EPP a roles no autorizados.

**Tests aplicados (11 nuevos en `lib/__tests__/aprobaciones-actions.test.ts`):**
- `approveItemAction`: bloquea EPP para `prevencionista`; permite para `jefa_chome`,
  `secretaria`, `administrador`; permite no-EPP para cualquier rol con permiso;
  permite EPP con multi-rol (uno autorizado).
- `rejectItemAction`: bloquea EPP para `prevencionista`; permite para `jefa_chome`.
- `returnItemAction`: bloquea EPP para `prevencionista`; permite para `secretaria`.

---

### [MISS-05] Devolución de stock no acotada a entregas previas

**Clasificación:** Deseable
**Módulo:** Bodega
**Prioridad:** P2
**Estado actual:** ✅ Implementado (2026-06-22)

**Evidencia:**
- `returnStockAction` → `ingreso_devolucion` suma `quantity` arbitraria con motivo,
  **sin verificar** que exista una entrega previa de ese producto/faena
  ([app/(app)/bodega/actions.ts](app/(app)/bodega/actions.ts) L152-201).

**Por qué debería existir:**
Una devolución debería estar acotada a lo efectivamente entregado/retirado; sin tope,
se puede inflar stock con "devoluciones".

**Impacto de no tenerla:**
Stock inflable vía devoluciones; saldo de sistema > realidad.

**Comportamiento esperado:**
Validar que la devolución no exceda lo entregado neto (o requerir referencia a la
entrega original).

**Propuesta de implementación:**
Calcular entregado neto por producto/faena y acotar; o ligar la devolución a un
`deliveryId`.

**Tests mínimos:**
Devolver > entregado → error; devolver ≤ entregado → ok + kardex.

**Implementación aplicada:**

- `returnStockAction` en [app/(app)/bodega/actions.ts](app/(app)/bodega/actions.ts): antes de llamar `applyMovement`, consulta `inventory_movements` por `egreso_entrega` e `ingreso_devolucion` para el producto/faena; rechaza si `quantity > (totalDelivered − totalReturned)`.

---

### [MISS-06] Validación de producto inactivo al crear/duplicar solicitud

**Clasificación:** No crítica
**Módulo:** Solicitudes
**Prioridad:** P3
**Estado actual:** ✅ Implementado (2026-06-22)

**Evidencia:**
- `requestItemSchema` solo valida que `productId` sea string ([lib/validation/operations.ts](lib/validation/operations.ts) L15-32);
  no verifica `products.isActive`. `duplicateRequest` copia `productId` tal cual
  ([app/(app)/solicitudes/actions.ts](app/(app)/solicitudes/actions.ts) L347-364).
- La entrega **sí** valida `product.isActive` ([lib/services/deliveries.ts](lib/services/deliveries.ts) L74, L222).

**Por qué debería existir:**
Se puede solicitar/aprobar/comprar/recibir un producto desactivado (con stock que
luego **no se puede entregar** porque la entrega exige producto activo), dejando stock
"muerto".

**Impacto de no tenerla:**
Inconsistencia menor; stock de producto inactivo recibible pero no entregable.

**Propuesta de implementación:**
Advertir/bloquear ítems de catálogo inactivos al crear/duplicar/enviar.

**Tests mínimos:**
Crear solicitud con producto inactivo → advertencia/bloqueo.

**Implementación aplicada:**

- `submitRequest` en [app/(app)/solicitudes/actions.ts](app/(app)/solicitudes/actions.ts): antes de transicionar, consulta productos del catálogo con `isActive = false` en la solicitud y devuelve error si hay alguno.

---

## 7. Inconsistencias entre documentación, UI y código

### [INC-01] Estados de OC `supplier_confirmed` y `closed` referenciados pero inalcanzables

**Tipo:** Estado vs flujo
**Severidad:** Medio
**Estado:** ✅ Resuelto (2026-06-22, junto con MISS-02)

**Fuente A:** [db/schema/purchasing.ts](db/schema/purchasing.ts) L36-42 (CHECK) y [lib/services/dashboard.ts](lib/services/dashboard.ts) L68-71, L268 — declaran/cuentan ambos estados.
**Fuente B:** [lib/services/purchasing.ts](lib/services/purchasing.ts) y [lib/services/receiving.ts](lib/services/receiving.ts) — ninguna transición los produce.

**Problema:** El modelo y el dashboard asumen estados que el código nunca asigna.
**Impacto:** Métricas que nunca suman por esos estados; OCs sin cierre real (ver MISS-02).
**Corrección:** `confirmOrder` y `closeOrder` implementados (MISS-02). Ahora los estados son alcanzables.

---

### [INC-02] Permiso `warehouse:adjust_stock` declarado sin funcionalidad

**Tipo:** Docs/permiso vs código
**Severidad:** Medio
**Estado:** ✅ Resuelto (2026-06-22, junto con MISS-01)

**Fuente A:** [lib/auth/system-rbac.ts](lib/auth/system-rbac.ts) L30 — permiso "Ajustar stock".
**Fuente B:** No hay acción ni servicio que lo use (sin referencias fuera de la definición).

**Problema:** Permiso sin feature (ver MISS-01).
**Impacto:** Sugiere una capacidad que no existe; ajuste de inventario imposible.
**Corrección:** `adjustStockAction` implementada y gateada por `warehouse:adjust_stock`.

---

### [INC-03] Helpers de dashboard cacheados definidos pero no usados

**Tipo:** Tests/implementación vs uso real
**Severidad:** Bajo
**Estado:** ✅ Resuelto (2026-06-22)

**Fuente A:** [lib/services/dashboard.ts](lib/services/dashboard.ts) L405-415 — `getCachedWorkQueueSnapshot`/`getCachedDashboardData` con tag `dashboard` e instrucción de invalidar con `revalidateTag('dashboard')`.
**Fuente B:** La página usa las variantes **en vivo** `getDashboardData`/`getWorkQueueSnapshot` ([app/(app)/dashboard/page.tsx](app/(app)/dashboard/page.tsx) L31, L74-75); `revalidateTag('dashboard')` **no se llama en ningún lado**.

**Problema:** Código de caché muerto; el comentario describe una invalidación que no existe.
**Impacto:** Ninguno operativo (el dashboard es siempre fresco). Confusión de mantenimiento.
**Corrección:** `getCachedWorkQueueSnapshot`, `getCachedDashboardData` e import de `unstable_cache` eliminados de [lib/services/dashboard.ts](lib/services/dashboard.ts).

---

### [INC-04] La solicitud se "cierra" en `received`, antes de completar la entrega

**Tipo:** Estado vs flujo (decisión de diseño a documentar)
**Severidad:** Bajo
**Estado:** ✅ Documentado (2026-06-22)

**Fuente A:** `rollupRequestStatus` marca `closed` cuando todos los ítems están en
`received`/`rejected`/`delivered`/`postponed` ([lib/services/item-state.ts](lib/services/item-state.ts) L345, L356).
**Fuente B:** El ciclo del ítem continúa `received→partially_delivered→delivered`.

**Problema:** Una solicitud puede figurar `closed` con ítems aún por entregar al
trabajador; y al entregar parcialmente dispara BUG-01.
**Impacto:** Semántica de "cerrada" ambigua (¿compra terminada o entrega terminada?).
**Corrección:** Decisión de diseño registrada: "closed" en la solicitud significa **compra completada** (recibido en faena), no **entrega completada**. Documentado en código con comentario en `rollupRequestStatus`. El ciclo `received→partially_delivered→delivered` es post-cierre y está permitido (BUG-01 ya corregido impide regresar desde `closed`).

---

## 8. Casos borde no cubiertos

| Caso borde | Resultado actual | ¿Manejado? |
|---|---|---|
| Solicitud sin ítems / enviar sin ítems | Bloqueado (`requestSchema.min(1)`, submit valida `items.length>0`) | ✅ |
| Cantidad 0 / negativa en ítem | Bloqueado (`CHECK quantity>0`, zod `positive`) | ✅ |
| Aprobar ítem ya aprobado / rechazar comprado | Bloqueado por `canTransition` | ✅ |
| Aprobar cantidad > solicitada | **Permitido sin motivo** | ❌ (BUG-02) |
| Crear OC sin ítems / con ítem ya en otra OC | Bloqueado (`createOrdersBySupplier` + índice único) | ✅ |
| Comprar cantidad > aprobada | Bloqueado ([compras/actions.ts](app/(app)/compras/actions.ts) L108) | ✅ |
| Proveedor inactivo en OC | Bloqueado ([compras/actions.ts](app/(app)/compras/actions.ts) L127-135) | ✅ |
| Recibir más de lo pendiente (oficina/faena) | Bloqueado (cap `remaining`, [receiving.ts](lib/services/receiving.ts) L107-121) | ✅ |
| Recepción faena sin oficina previa | Bloqueado ([receiving.ts](lib/services/receiving.ts) L70-72) | ✅ |
| Recepción duplicada en un mismo receipt | Bloqueado (dedup ítems, [receiving.ts](lib/services/receiving.ts) L49-52) | ✅ |
| Recibir contra OC cancelada/cerrada | Bloqueado (status check + `notInArray` rollup) | ✅ |
| Entregar > disponible / > pendiente | Bloqueado (stock atómico + pending, [deliveries.ts](lib/services/deliveries.ts)) | ✅ |
| Entregar a trabajador inactivo / de otra faena | Bloqueado ([deliveries.ts](lib/services/deliveries.ts) L196-198) | ✅ |
| Doble submit de entrega trazable | Serializado por `FOR UPDATE` + pending | ✅ |
| Ajuste negativo > stock | **Sin feature de ajuste** | ❌ (MISS-01) |
| Devolución sin entrega previa | **Permitido, sin tope** | ❌ (MISS-05) |
| Producto/ trabajador/ proveedor inactivo (maestros) | Soft-delete, histórico intacto | ✅ |
| Solicitud con ítem de producto inactivo | Permitido (recibible, no entregable) | ❌ (MISS-06) |
| Entrega parcial y estado de solicitud | **Regresa a `approved`** | ❌ (BUG-01) |
| Cierre de OC con dañados/rechazados | OC queda en `partially_received` sin cierre | ❌ (MISS-02) |

---

## 9. Tests faltantes recomendados

> Estado de la suite: **1228 pasan, 4 skip, 1 falla** (`npm run test` → exit 1). El
> fallo es BUG-03 (logger). `npm run typecheck` pasa (exit 0). `npm run build` no se
> ejecutó en esta auditoría (typecheck verde cubre la corrección de tipos).

### [TEST-01] Rollup de estado de solicitud tras entrega parcial
**Módulo:** Entregas / item-state · **Prioridad:** P1 · **Tipo:** Integración
**Riesgo que cubre:** BUG-01.
**Escenario mínimo:** Solicitud recibida (`closed`) → entrega parcial → entrega total.
**Resultado esperado:** Nunca `approved` tras parcial; `closed` tras total.
**Archivos sugeridos:** `lib/__tests__/item-state-rollup-delivery.test.ts`

### [TEST-02] Motivo obligatorio al modificar cantidad aprobada
**Módulo:** Aprobaciones · **Prioridad:** P1 · **Tipo:** Unitario
**Riesgo que cubre:** BUG-02.
**Escenario mínimo:** `approveItemAction({modifiedQty})` sin `reason`.
**Resultado esperado:** `ok:false`; con `reason` → `approval_decisions.reason` poblado.

### [TEST-03] Cierre de OC y recepción contra OC cerrada
**Módulo:** OC · **Prioridad:** P2 · **Tipo:** Integración
**Riesgo que cubre:** MISS-02.
**Escenario mínimo:** Cerrar OC parcialmente recibida; intentar recibir.
**Resultado esperado:** `closed`; recepción posterior bloqueada.

### [TEST-04] Ajuste de inventario negativo con motivo
**Módulo:** Bodega · **Prioridad:** P1 · **Tipo:** Integración
**Riesgo que cubre:** MISS-01.
**Escenario mínimo:** Ajuste `-N` con/ sin stock suficiente y con/ sin motivo.
**Resultado esperado:** Bloqueo si `>stock` o sin motivo; kardex correcto si válido.

### [TEST-05] Devolución acotada a entregas previas
**Módulo:** Bodega · **Prioridad:** P2 · **Tipo:** Integración
**Riesgo que cubre:** MISS-05.

### [TEST-06] Serialización segura del logger (circular)
**Módulo:** Transversal · **Prioridad:** P1 · **Tipo:** Unitario
**Riesgo que cubre:** BUG-03 (ya existe el test; ponerlo verde).

---

## 10. Deuda funcional priorizada

| ID | Título | Severidad | Prioridad | Estado |
| --- | --- | --- | --- | --- |
| BUG-01 | Entrega parcial regresa solicitud a `approved` | Alto | **P1** | ✅ Corregido |
| BUG-03 | `logger.error` lanza con estructuras circulares (suite roja) | Alto (CI) | **P1** | ✅ Corregido |
| MISS-01 | Ajuste manual de inventario (+/-) con motivo | Necesaria | **P1** | ✅ Implementado |
| BUG-02 | Modificar cantidad sin motivo / sin tope | Medio | **P1** | ✅ Corregido |
| INC-02 | Permiso `adjust_stock` sin feature | Medio | P2 | ✅ Resuelto (con MISS-01) |
| MISS-02 | Cierre de OC / `supplier_confirmed` | Necesaria | P2 | ✅ Implementado (2026-06-22) |
| MISS-03 | Corrección por ítem devuelto | Necesaria | P2 | ✅ Implementado (2026-06-22) |
| MISS-04 | Gating de aprobación EPP (validar política) | Necesaria | P2 | ✅ Implementado (2026-06-22, política confirmada) |
| INC-01 | Estados OC inalcanzables | Medio | P2 | ✅ Resuelto (2026-06-22, con MISS-02) |
| MISS-05 | Devolución sin tope | Deseable | P2 | ✅ Implementado (2026-06-22) |
| INC-03 | Helpers cacheados muertos | Bajo | P3 | ✅ Resuelto (2026-06-22) |
| INC-04 | "Cerrada" antes de entregar | Bajo | P3 | ✅ Documentado (2026-06-22) |
| MISS-06 | Producto inactivo en solicitud | No crítica | P3 | ✅ Implementado (2026-06-22) |

---

## 11. Roadmap de corrección

### Sprint 0 — Desbloqueo (P0/P1) — ✅ COMPLETADO 2026-06-22

1. ✅ Corregir `rollupRequestStatus` (BUG-01).
2. ✅ Serialización segura del logger (BUG-03) → suite verde (1229 tests, 0 fallos).
3. ✅ Motivo obligatorio al modificar cantidad (BUG-02).
4. ✅ Ajuste manual de inventario con motivo, ligado a `warehouse:adjust_stock` (MISS-01/INC-02).

### Sprint 1 — Cierre de ciclo de compra (P2) — ✅ COMPLETADO 2026-06-22

1. ✅ Cierre manual de OC y confirmación de proveedor (MISS-02/INC-01): `confirmOrder` + `closeOrder` en `lib/services/purchasing.ts`, acciones en `app/(app)/compras/actions.ts`, UI en `oc-actions.tsx`.
2. ✅ Corrección real por ítem devuelto (MISS-03): `resubmitReturnedItemAction` en `app/(app)/solicitudes/actions.ts`, botón por ítem en `request-form.tsx`.
3. ✅ MISS-04 (EPP gating): implementado — política confirmada: EPP creado por Prevencionista, aprobado por Jefatura/Secretaría/Admin. 11 tests dedicados añadidos.

### Sprint 2 — Robustez y limpieza (P2/P3) — ✅ COMPLETADO 2026-06-22

1. ✅ Acotar devoluciones a entregas previas (MISS-05): cap `egreso_entrega − ingreso_devolucion` en `returnStockAction`.
2. ✅ Validación de producto inactivo en solicitudes (MISS-06): chequeo en `submitRequest` contra `products.isActive`.
3. ✅ Eliminar helpers cacheados muertos (INC-03): removidos `getCachedWorkQueueSnapshot`/`getCachedDashboardData` de `lib/services/dashboard.ts`.
4. ✅ Documentar semántica de "cerrada" (INC-04): comentario en `rollupRequestStatus` (`lib/services/item-state.ts`).

---

## 12. Checklist inmediato

```markdown
- [x] Se puede crear una solicitud válida con múltiples ítems.
- [x] Se puede aprobar, rechazar o postergar cada ítem individualmente.
- [~] Las cantidades aprobadas/compradas/recibidas/entregadas son consistentes.
      (compra ≤ aprobada y recepción ≤ pendiente OK; pero modificar al aprobar
      permite aprobado > solicitado sin motivo — BUG-02)
- [x] Se puede crear una OC solo con ítems aprobados y no comprados previamente.
- [x] La recepción en oficina NO aumenta stock de faena.
- [x] La recepción en faena aumenta stock de la faena correcta.
- [x] Cada movimiento de stock genera kardex coherente.
- [x] No se puede entregar más stock del disponible (bloqueo a nivel SQL).
- [x] Una entrega descuenta stock correctamente.
- [~] El ciclo del ítem se cierra al entregarse completamente.
      (el ítem sí; pero la solicitud regresa a `approved` en entrega parcial — BUG-01)
- [x] Las recepciones y entregas parciales funcionan correctamente.
- [~] Las solicitudes, OCs e ítems agregan estados correctamente.
      (solicitud: BUG-01; OC: nunca alcanza `closed`/`supplier_confirmed` — INC-01)
- [x] Los reportes coinciden con los datos reales (SQL en vivo).
- [x] La trazabilidad muestra cantidades correctas (filtra faena, sin doble conteo).
- [x] Las exportaciones XLSX respetan filtros y scope.
- [~] Los usuarios tienen las acciones funcionales necesarias para su rol.
      (falta ajuste de inventario — MISS-01; corrección por ítem devuelto — MISS-03)
- [~] Hay tests para state machine, stock, kardex, recepción, entrega y aprobaciones.
      (amplia cobertura, pero faltan TEST-01..05 y la suite está roja por BUG-03)
```

Leyenda: `[x]` cumple · `[~]` cumple parcialmente / con observación.

---

## 13. Conclusión

Plataforma Chome es un producto **funcionalmente sólido en su núcleo**: el
flujo de abastecimiento está implementado de extremo a extremo, con una arquitectura
de servicios disciplinada (toda mutación de stock/estado en transacciones atómicas
con locks y constraints de BD), recepción en dos etapas correcta, prevención de doble
compra, parciales en todos los pasos y kardex coherente. La integridad de **stock y
kardex está bien protegida** y la cobertura de pruebas es notable.

No alcanza aún el "listo para producción" pleno por: (1) un **bug de estado
confirmado** que desalinea el estado de la solicitud con el de sus ítems durante la
entrega parcial (BUG-01); (2) **deuda funcional** en bodega (sin ajuste de inventario)
y en OC (sin cierre/confirmación); y (3) una **suite de tests en rojo** por un bug del
logger. Ninguno corrompe inventario, pero sí afectan coherencia de estados, operación
diaria y la confiabilidad del build.

**Decisión: 🟡 Listo para producción con observaciones. Calificación: 6/10.**
Corrigiendo el Sprint 0 (BUG-01, BUG-03, BUG-02, MISS-01) el producto puede subir con
facilidad a 8/10 y a operación autónoma.
