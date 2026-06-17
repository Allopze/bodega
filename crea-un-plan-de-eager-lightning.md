# Plan: Proveedor automático para EPP + Unificación de tipos de solicitud

## Contexto

Dos necesidades del usuario, ambas centradas en **la creación de la solicitud** (`/solicitudes`):

1. **Proveedor automático para EPP.** Los EPP (productos con `isEpp=true`) ya tienen proveedores asociados vía `productSuppliers` con un flag `isPreferred`, pero ese flag **hoy no se usa en ningún punto del flujo**: al crear una solicitud, el solicitante debe elegir el "Proveedor sugerido" a mano por cada ítem. Se quiere que, al seleccionar un EPP, ese campo se autocomplete solo con su proveedor preferido (editable).

2. **Unificar los tipos de solicitud.** Hoy el selector de tipo ofrece `EPP / Stock / Mantención / Otro`, y "Repuestos" y "Servicios" viven como **verticales separadas** (`/repuestos`, `/servicios`) con su propio flujo de cotizaciones PDF y una aprobación distinta (elegir cotización ganadora en la pantalla de detalle, no en `/aprobaciones`). Se quiere: **quitar Stock y Mantención**, y dejar **EPP, Repuestos, Servicios, Otros**, todos creados dentro de `/solicitudes` con el mismo formulario de ítems + (para repuestos/servicios) una sección de cotizaciones. La aprobación se centraliza en `/aprobaciones`.

Resultado esperado: una sola experiencia de "Solicitudes" con 4 tipos y un solo hub de aprobación, reutilizando al máximo la infraestructura existente (factory de cotizaciones, storage, conversión a OC).

## Decisiones confirmadas con el usuario

- **Feature A:** autocompletar `suggestedSupplierId` con el proveedor preferido **solo para EPP**, **editable**.
- **Tipos finales del selector:** EPP, Repuestos, Servicios, Otros (se quitan Stock y Mantención).
- **Repuestos/Servicios** se crean dentro de `/solicitudes` (form de ítems + cotizaciones PDF). Las verticales dejan de ser el lugar de creación.
- **Aprobación:** cola única en `/aprobaciones`. EPP/Otros = por ítem (como hoy). Repuestos/Servicios = ver las 3 cotizaciones y elegir la ganadora ahí mismo (reusa `selectQuotation`; se conserva la regla de mínimo 3 cotizaciones o justificación).
- **Quién elige la ganadora:** jefa_chome y secretaria.

## Hallazgos clave que habilitan el plan

- **No se requiere migración de DB para los tipos.** El CHECK de `purchase_requests` (`db/schema/requests.ts:34-41`) ya admite los 6 tipos. El enum a cambiar es solo de validación (Zod, `lib/validation/operations.ts:38`).
- **El factory ya hace el trabajo pesado.** `selectQuotation` (`lib/requests/request-service.ts:385-498`) marca una cotización `selected`, el resto `rejected`, propaga `winningSupplierId` → `suggestedSupplierId` de todos los ítems y los deja `approved`. La conversión a OC (`app/(app)/compras/nueva/page.tsx:31`) ya recoge ítems `approved/pending_purchase` sin filtrar por tipo. La regla de ≥3 cotizaciones vive en `request-service.ts:336-340`.
- **`lib/services/repuestos.ts` / `servicios.ts`** ya exportan `persistRepuestoDraft`, `submitRepuestoRequest`, `selectRepuestoQuotation`, `addQuotation`, `getQuotationsForRequest`, etc. → la delegación por rama de tipo es directa y respeta AGENTS.md (reusar el factory vivo, no recrear `modules/*/services`).
- **Permisos:** `rol-sec` (secretaria) tiene `repuestos/servicios: create/own/all/submit` pero **no** `p-rep-approve`/`p-srv-approve` (`lib/auth/system-rbac.ts:89-103`). La jefatura sí. Hay que agregar los dos `approve` a secretaria.

## Enfoque recomendado

### Fase 0 — Constante central de tipos
Crear `lib/request-types.ts` con la fuente única (hoy duplicada en 3 lugares):
- `REQUEST_TYPE_OPTS` = solo `[epp, repuestos, servicios, otro]` (para el selector).
- `REQUEST_TYPE_LABELS` y `REQUEST_TYPE_VARIANTS` = incluyen también `stock`/`mantencion` (para mostrar legacy en listados/detalle).
- `QUOTATION_TYPES = new Set(["repuestos","servicios"])` (helper para decidir UI por tipo).
Consumir en `solicitudes/request-form.tsx:29-34`, `solicitudes/request-list.tsx:51-67`, `aprobaciones/approval-panel.tsx:22-34`.
Actualizar el enum en `lib/validation/operations.ts:38` a `z.enum(["epp","repuestos","servicios","otro"])`.

### Fase A — Proveedor automático EPP (independiente; hacer primero)
1. `app/(app)/solicitudes/nueva/page.tsx` y `[id]/page.tsx`: agregar consulta a `productSuppliers` y calcular `preferredSupplierId` por producto con la **regla de desempate**: hay preferido → ese; sin preferido y exactamente 1 proveedor → ese; varios sin preferido → `null`; sin proveedor → `null`.
2. `app/(app)/solicitudes/request-form.types.ts:7-16`: agregar `preferredSupplierId: string | null` a `ProductOption`.
3. `app/(app)/solicitudes/request-form.tsx:244-261` (`selectProduct`): si `prod.isEpp && prod.preferredSupplierId`, setear `suggestedSupplierId: prod.preferredSupplierId`. Campo sigue editable (no se toca el `<Select>` de `item-editor.tsx`).

### Fase B — Form unificado de creación
1. `request-form.tsx`: selector desde `REQUEST_TYPE_OPTS`. Default sigue `epp`. Para repuestos/servicios, los ítems van como texto libre (sin catálogo) y se muestran campos open-field por tipo.
2. `item-editor.tsx`: renderizar campos open-field condicionados por `requestType` (repuestos: N° parte, equipo, patente/código, marca, modelo; servicios: ubicación [req], equipo, patente, marca, modelo). Persistirlos como `requestItemAttributes` usando exactamente `REPUESTO_ATTRIBUTE_NAMES`/`SERVICE_ATTRIBUTE_NAMES` (así el detalle existente los sigue leyendo).
3. `app/(app)/solicitudes/actions.ts` (`saveDraft`/`submitRequest`): **rama por tipo, delegando en el factory**:
   - `epp`/`otro` → lógica propia actual (prefijo `SOL`), **sin** regla de ≥3 cotizaciones.
   - `repuestos` → `persistRepuestoDraft`/`submitRepuestoRequest` (prefijo `REP`).
   - `servicios` → equivalentes de servicios (prefijo `SER`).
   - Conservar prefijos por tipo. El tipo se fija al guardar el borrador (no regenerar `code` al cambiarlo después).

### Fase B — Cotizaciones en 2 pasos (mantener)
`addQuotation`/`uploadQuotationAction` requieren un `requestId` persistido. En `/solicitudes/nueva` con tipo rep/serv y sin borrador guardado, mostrar aviso "Guarda el borrador para adjuntar cotizaciones". El panel de cotizaciones aparece en el detalle.

### Fase B — Detalle unificado `/solicitudes/[id]`
1. Quitar el `redirect` de repuestos/servicios (`[id]/page.tsx:44-46`).
2. Cargar siempre ítems + atributos; si `QUOTATION_TYPES.has(requestType)`, cargar también cotizaciones (`getQuotationsForRequest` del service correspondiente) y renderizar el panel de cotizaciones con `canUpload = isOwner && (draft|returned)` y selección de ganadora **deshabilitada** (eso va en `/aprobaciones`).
3. Extraer `app/(app)/repuestos/[id]/quotation-panel.tsx` a un componente compartido `components/requests/quotation-panel.tsx` con prop `downloadBase` (hoy tiene hardcodeado `/api/repuestos/quotaciones/${q.id}` vs `/api/servicios/cotizaciones/${q.id}`).
4. `request-list.tsx:70-77`: quitar `DETAIL_BASE` → todo enlaza a `/solicitudes/[id]`.

### Fase B — Aprobaciones (hub único)
1. `aprobaciones/page.tsx:41`: quitar la exclusión `requestType != 'repuestos'`. Filtrar la **cola por-ítem** a `requestType ∈ {epp, otro}` (esto corrige de paso la inconsistencia actual de servicios, que hoy se cuela en la cola por-ítem).
2. Cargar aparte las solicitudes `repuestos/servicios` en estado `submitted|in_review` con sus cotizaciones `pending`.
3. `approval-panel.tsx`: renderizar sub-vista por tipo — `RequestGroup` por-ítem (epp/otro) y una tarjeta de selección de cotización (rep/serv) que reusa la UI de selección.
4. `aprobaciones/actions.ts`: agregar `selectQuotationAction` que delega en `selectRepuestoQuotation`/`selectServiceQuotation`, con gating `repuestos:approve`/`servicios:approve`.

### Fase B — Permisos
- `lib/auth/system-rbac.ts`: agregar `p-rep-approve` a `REPUESTOS_SECRETARIA_PERMISSION_IDS` y `p-srv-approve` a `SERVICIOS_SECRETARIA_PERMISSION_IDS`.
- Reflejar el mismo grant en los `defaultGrants` de `modules/repuestos/manifest.ts` y `modules/servicios/manifest.ts` (parity tests).
- Re-seed RBAC en el deploy (`ensureSystemRbac`).

### Fase B — Navegación y redirects de verticales
- Vaciar el `nav` de `modules/repuestos/manifest.ts` y `modules/servicios/manifest.ts` (conservar permisos/grants).
- Convertir las páginas de las verticales (`repuestos/page.tsx`, `repuestos/nueva/page.tsx`, `repuestos/[id]/page.tsx` y equivalentes de servicios) en `redirect` a `/solicitudes` o `/solicitudes/[id]` (mantiene vivos enlaces y notificaciones antiguas).
- **Conservar** las APIs de descarga `/api/repuestos/quotaciones/[id]` y `/api/servicios/cotizaciones/[id]` (las usa el panel compartido).

## Archivos críticos
- `app/(app)/solicitudes/actions.ts` — rama por tipo delegando en el factory.
- `app/(app)/solicitudes/request-form.tsx` + `item-editor.tsx` + `request-form.types.ts` — selector, campos open-field, proveedor EPP.
- `app/(app)/solicitudes/nueva/page.tsx` + `[id]/page.tsx` — carga de `productSuppliers`, detalle unificado.
- `app/(app)/aprobaciones/page.tsx` + `approval-panel.tsx` + `actions.ts` — hub único.
- `lib/requests/request-service.ts` — `selectQuotation` (se reusa tal cual).
- `lib/auth/system-rbac.ts` + manifests de repuestos/servicios — permisos secretaria + nav.
- `lib/request-types.ts` (nuevo) + `lib/validation/operations.ts` — tipos centralizados + enum.
- `components/requests/quotation-panel.tsx` (extraído) + redirects de verticales.

## Riesgos y casos borde
- **Datos legacy `stock`/`mantencion`:** el CHECK los conserva; mantener sus labels en `REQUEST_TYPE_LABELS`. Al editar un borrador legacy, incluir su tipo como opción solo-lectura o bloquear el cambio de tipo.
- **Repuestos/servicios ya creados en las verticales:** siguen vivos vía redirect; cotizaciones intactas (mismas tablas). Las `submitted` ahora aparecen en `/aprobaciones` — verificar que el panel las resuelva.
- **Sin re-seed**, secretaria no verá el botón de selección de ganadora.
- **Factory usa `any`:** al delegar desde `solicitudes/actions.ts`, mantener el patrón ya aceptado en las actions de rep/serv.
- **Regla de ≥3 cotizaciones** solo debe aplicarse en la rama rep/serv, nunca en epp/otro.

## Verificación end-to-end
- **Tests a ajustar/correr:** `operations-validation.test.ts` (enum), `auth-bootstrap-permissions.test.ts` + `integration-rbac-sequences.test.ts` + `auth-rbac.test.ts` (grant approve de secretaria), `navigation.test.ts` (nav sin verticales), `full-flow-integration.test.ts`, `code-sequences.test.ts` (prefijos). e2e `purchase-flow.spec.ts`.
- **Tests nuevos:** desempate de `preferredSupplierId`; rama por tipo en `solicitudes/actions`; regla de 3 cotizaciones vía `/solicitudes`; `selectQuotation` invocado desde `/aprobaciones`.
- **Manual (con la app corriendo):**
  1. Crear solicitud EPP → al elegir un EPP, el "Proveedor sugerido" se autocompleta y sigue editable.
  2. Crear solicitud Repuestos en `/solicitudes` → guardar borrador → subir 3 PDFs → enviar.
  3. Como jefa y como secretaria: en `/aprobaciones` ver la solicitud, comparar cotizaciones, elegir la ganadora → ítems quedan `approved` con el proveedor ganador.
  4. En `/compras/nueva` los ítems aparecen agrupados por proveedor.
  5. Verificar que `/repuestos` y `/servicios` redirigen y que las descargas de PDF siguen funcionando.
  6. Confirmar que el selector ya no ofrece Stock/Mantención y que una solicitud legacy de esos tipos aún se visualiza bien.
