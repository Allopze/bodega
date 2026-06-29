# Rediseño del módulo Operaciones — flujo intuitivo para cualquier usuario

## Progreso de implementación

### ✅ Pasada 1 — Phase 0: Backbone búsqueda/filtros server-side (HECHO)
Elimina la trampa de "filtro por página" y agrega filtros persistentes en la URL.

- **Nuevo** [lib/operaciones/list-query.ts](lib/operaciones/list-query.ts): `parseListParams(sp)` + builders Drizzle (`textSearchSql` con `ilike` y escape de wildcards, `statusSql` con `inArray`, `worksiteEqSql`, `buildListWhere`).
- **Nuevo** [components/operaciones/list-filters.tsx](components/operaciones/list-filters.tsx): barra URL-synced (texto debounced 350ms + select Estado + select Faena + botón Limpiar + slot de acciones). Resetea `page` al cambiar filtro vía `router.replace`.
- **DataTable** [components/admin/data-table.tsx](components/admin/data-table.tsx): nueva prop `disableInternalSearch` que anula el filtro en memoria y oculta su toolbar interno (la búsqueda real es server-side).
- **Filtros server-side aplicados** en las 3 listas (condiciones al `WHERE` antes de `count()` y del `select` paginado; `buildPaginationHref` ya preserva los params):
  - [solicitudes/page.tsx](app/(app)/solicitudes/page.tsx) + [request-list.tsx](app/(app)/solicitudes/request-list.tsx) — texto (código) + estado (de `REQUEST_STATE_META`) + faena.
  - [compras/page.tsx](app/(app)/compras/page.tsx) + [oc-list.tsx](app/(app)/compras/oc-list.tsx) — texto (código) + estado (de `OC_STATE_META`) + faena. **Bonus**: labels de carga "Emitiendo…"/"Enviando…" (antes "...").
  - [recepcion/page.tsx](app/(app)/recepcion/page.tsx) + [recepcion-table.tsx](app/(app)/recepcion/recepcion-table.tsx) — texto (código) + faena (corrige el `searchKeys=["code"]` que impedía filtrar por faena).
- Cada `page.tsx` carga las opciones de faena (worksites activas + scope) para el select.
- **Test** [lib/__tests__/operaciones-list-query.test.ts](lib/__tests__/operaciones-list-query.test.ts) — parseo + builders.
- ✓ `tsc --noEmit` y `eslint` limpios en los archivos tocados (errores tsc restantes son preexistentes en `lib/__tests__/*`).

### ✅ Pasada 2 — Phase 2.1 (Export XLSX en pantalla) + filtro Proveedor (HECHO)
- **Export XLSX en pantalla** en las 3 listas, respetando los filtros activos:
  - [lib/reports/export.ts](lib/reports/export.ts): nuevos tipos `solicitudes`, `compras`, `recepcion` (espejo de las columnas en pantalla), con `q`/`status`/`faena`/`proveedor` y etiquetas en español (reusa `REQUEST_STATE_META`/`OC_STATE_META`); `ExportFilters` ahora incluye `q` y `supplierId`.
  - [app/api/reportes/export/route.ts](app/api/reportes/export/route.ts): mapa `TYPE_PERMISSIONS` que gatea cada export por el permiso de su lista (`requests:view_*` / `purchasing:*` / `receiving:*`) en vez de exigir `reports:view`; lee `q` y `proveedor`.
  - [components/operaciones/list-filters.tsx](components/operaciones/list-filters.tsx): botón **Exportar XLSX** (prop `exportTipo`) que arma la URL con los filtros vigentes.
- **Filtro Proveedor (select)** en Compras y Recepción (resuelve "Recepción no podía filtrar por proveedor"): nuevo param `proveedor` en `parseListParams`/`buildListWhere` (helper `eqFilter`), select en `ListFilters` (`supplierOptions`), opciones de proveedores activos cargadas en [compras/page.tsx](app/(app)/compras/page.tsx) y [recepcion/page.tsx](app/(app)/recepcion/page.tsx), y filtrado tanto en la lista como en el export.
- ✓ `tsc`/`eslint` limpios en lo tocado; `operaciones-list-query.test.ts` 13/13; `report-export.test.ts` 27/27 (sin regresión).

### ⏳ Faltante (siguientes pasadas)
- **Phase 2.3 — Aprobaciones**: filtros por faena/urgencia (la pantalla usa `approval-panel`, no `DataTable`; requiere wiring aparte). Pendiente también el resumen "N ítems en X solicitudes de Y faenas".
- **Búsqueda de texto extendida**: hoy es por código. Añadir producto (solicitudes) y nombre de proveedor/faena (compras/recepción) vía join/subquery. *(El filtro Proveedor por select ya cubre el caso principal.)*
- **Phase 1.2 — Stepper de progreso** `components/operaciones/pipeline-steps.tsx` sobre `buildRequestProgress`.
- **Phase 2.2/2.5 — Microcopy guiado**: ayuda inline en `request-form.tsx` (detour cotización) y encabezado explícito de doble etapa oficina→faena en Recepción.
- **Phase 3 — Onboarding/pulido**: pista de primer uso dismissible, revisión móvil de la barra de filtros, y (stretch) ⌘K salta a registros por código.
- **Polish**: ocultar el buscador del top-bar en rutas de Operaciones (hoy queda inerte en esas listas) o re-cablearlo a la URL.
- **Test e2e/integración del export** de listas (descarga real con filtros) — pendiente de levantar app/DB.

## Context

**Qué es "Operaciones".** No existe `app/(app)/operaciones/`. "Operaciones" es un **área de navegación** (`components/layout/areas.ts:24`, ícono Stack, primer ítem del rail) que agrupa el pipeline de abastecimiento en 4 módulos:

```
Solicitudes → Aprobaciones → Compras (OC) → Recepción
/solicitudes   /aprobaciones   /compras        /recepcion
```

Cada módulo declara `areaId: "operaciones"` en su `modules/*/manifest.ts`; la lógica viva está en `app/(app)/<área>/{page.tsx,actions.ts,*.tsx}` + `lib/services/*` + `lib/work-queue.ts` (per `AGENTS.md`). Secretaría es la usuaria operativa principal: rol **global** (`lib/auth/system-rbac.ts`, `lib/auth/scope.ts`) con permisos sobre todo el pipeline.

**Por qué este cambio.** El código está maduro y bien construido (autosave, banners "never-miss", combobox accesible, máquina de estados sólida en `lib/services/item-state.ts`), pero el flujo diario tiene fricciones que lo hacen poco intuitivo para usuarios no expertos. La decisión del usuario: **rediseño profundo del flujo**, con la meta de que sea **lo más intuitivo posible para cualquier usuario**, **mejorando las pantallas actuales** (sin crear una consola separada y sin tocar la arquitectura de áreas/módulos).

**Problema raíz #1 (trampa de UX confirmada).** El buscador del top-bar ("Filtrar en esta página…", `components/layout/top-bar.tsx:140`) alimenta el filtro **en memoria** de `DataTable` (`components/admin/data-table.tsx:83`), que opera **solo sobre la página ya paginada por el servidor** (`resolvePagination` + `ServerPagination`). Resultado: si buscas una OC/solicitud que está en la página 2+, el sistema responde "sin resultados" aunque exista. Para un rol global con muchos registros, esto rompe la confianza en la herramienta. Es el arreglo de mayor impacto.

**Otras fricciones detectadas.**
- Sin **exportación XLSX en pantalla** en las listas (el `ExportDialog` + ruta `/api/reportes/export` existen pero solo en Reportes).
- **Recepción** busca solo por código (`recepcion-table.tsx:46` `searchKeys={["code"]}`); no por faena ni proveedor pese a ver todas las faenas.
- **Sin filtros visibles por estado/faena**: cada lista mezcla todos los estados; no hay forma rápida de ver "solo lo que requiere mi acción".
- **Etiquetas de carga opacas** ("…") en los botones inline de OC (`compras/oc-list.tsx`).
- **Recepción en dos etapas** (oficina → faena) es un punto de confusión conocido: la etapa "oficina" no mueve stock y la regla "primero oficina" sorprende.
- Vocabulario de estados disperso (existe un buen mapa en `lib/work-queue.ts` pero no se reutiliza en todas las pantallas).

---

## Principios de diseño (lenguaje común del rediseño)

Aplicar de forma consistente a las 4 pantallas, para que aprender una sea aprenderlas todas:

1. **La búsqueda siempre encuentra.** Búsqueda y filtros son server-side y viven en la URL.
2. **Siempre se ve "qué hacer ahora".** Banners de próximo paso + filtros rápidos por "requiere acción".
3. **Un solo vocabulario de estados**, en español claro, con el mismo `StateBadge` en todas partes.
4. **Cada pantalla se autoexplica**: subtítulo de propósito + estados vacíos con una sola CTA obvia.
5. **Sin callejones sin salida**: feedback real en cada acción, confirmaciones y mensajes de error claros.

---

## Phase 0 — Backbone: búsqueda y filtros server-side reales (URL-synced)

Elimina la trampa de filtro-por-página y habilita filtros persistentes. Es la base de todo lo demás.

**0.1 — Componente de filtros reutilizable.** Nuevo `components/operaciones/list-filters.tsx` (client): barra bajo el `PageHeader` con búsqueda de texto (debounced), chips/select de **estado**, select de **faena**, y botón **Exportar**. Sincroniza a la URL (`?q=&estado=&faena=&page=1`) vía `useRouter().replace` (resetea `page` al cambiar un filtro). Reutiliza `Select` (`components/ui/select`), `DatePicker` y patrón de `components/export-dialog.tsx`.

**0.2 — Helper de parseo.** Nuevo `lib/operaciones/list-query.ts` (o ampliar `lib/pagination.ts`): `parseListParams(sp)` → `{ q, estado, faena }` normalizados, y constructores de condiciones Drizzle reutilizables (texto sobre `code`/producto/proveedor según entidad; `inArray(status)`; `eq(worksiteId)`), respetando el scope ya existente (`worksiteScopeSql`, `visibleWorksiteIds`).

**0.3 — Aplicar filtros en el servidor.** En cada `page.tsx` de lista, agregar las condiciones al `WHERE` **antes** del `count()` y del `select` paginado:
- `app/(app)/solicitudes/page.tsx` (texto sobre `code`; estado; faena).
- `app/(app)/compras/page.tsx` (texto sobre `code`/proveedor; estado; faena).
- `app/(app)/recepcion/page.tsx` (texto sobre `code`/proveedor; faena; etapa).
- `app/(app)/aprobaciones/page.tsx` (faena; urgencia).

`buildPaginationHref` (`lib/pagination.ts:58`) **ya preserva** todos los params salvo `page`, así que la paginación respeta los filtros sin cambios.

**0.4 — Desacoplar `DataTable` del filtro global.** En las listas migradas, pasar `search=""` explícito a `DataTable` (usa la rama `hasExplicitSearch`, `data-table.tsx:76`) para que **deje de re-filtrar** el page server-side; conserva solo el ordenamiento por columna. La búsqueda real es la barra de 0.1. (Opcional: ocultar el input del top-bar en rutas de Operaciones para no duplicar buscadores.)

**Resultado:** buscar "OC-0123" lo encuentra esté en la página que esté; los filtros de estado/faena persisten al paginar y son compartibles por URL.

---

## Phase 1 — Vocabulario de estados y progreso unificados

Hace el pipeline legible para cualquiera sin conocer la jerga interna.

**1.1 — Fuente única de etiquetas.** Reutilizar los mapas ya existentes `requestStatusLabel` / `itemStatusLabel` / `itemStageLabel` de `lib/work-queue.ts` en todas las listas y detalles (hoy conviven con `StateBadge`). Si hace falta, extraerlos a `lib/operaciones/labels.ts` y que `components/states/state-badge.tsx` los consuma, garantizando que "returned" se lea igual ("Requiere corrección") en Solicitudes, Aprobaciones y Dashboard.

**1.2 — Stepper de progreso reutilizable.** `buildRequestProgress` (`lib/work-queue.ts:241`) ya calcula etapa actual/siguiente acción. Exponer su salida como un componente visual `components/operaciones/pipeline-steps.tsx` (Solicitado · Aprobación · Compra · Recepción · Entrega) y usarlo en el detalle de solicitud y, condensado, en las filas/cards. Da a cualquier usuario un "¿dónde va esto y qué sigue?" inmediato.

---

## Phase 2 — Rediseño por pantalla (mismo patrón en las 4)

Cada lista adopta: **subtítulo de propósito → barra de filtros (Phase 0) → banner de próximo paso → tabla con vocabulario unificado → estado vacío con una CTA → Exportar**.

**2.1 — Exportación XLSX en pantalla (transversal).** Extender `lib/reports/export.ts` (`getReportData`, `REPORT_TYPES`) y la ruta `app/api/reportes/export/route.ts` con tipos de lista: `solicitudes`, `compras`, `recepcion`, reusando `ExportFilters` (`fromDate/toDate/worksiteId/status`) + el nuevo `q`. Cada export se **gatea por el permiso de la propia lista** (`requests:view_*`, `purchasing:view`, `receiving:view`) en vez de exigir `reports:view`, para que "si lo ves, lo puedes exportar". El botón Exportar de `list-filters.tsx` arma la URL con los filtros activos (mismo patrón que `components/export-dialog.tsx:33`). Sigue siendo **XLSX** vía `buildXlsxBuffer` (regla del repo: nunca CSV).

**2.2 — Solicitudes.** Filtros por estado (Borrador/En revisión/Devuelta/Aprobada/…), faena y texto (código/producto). Destacar **"Devueltas"** como filtro rápido (requieren acción del solicitante). En el formulario (`request-form.tsx`, ya fuerte con autosave + resumen pegajoso), agregar **ayuda inline por sección** y aclarar el detour "guarda primero para adjuntar cotización" en tipos quotation con un texto guía en el punto exacto.

**2.3 — Aprobaciones.** Ya tiene inline approve/reject + "Aprobar todos". Agregar **filtro por faena y urgencia** y un resumen "N ítems en X solicitudes de Y faenas". Mantener la regla EPP (`EPP_APPROVER_ROLES`) pero suavizar el ruido visual del gate cuando el usuario sí tiene permiso.

**2.4 — Compras.** Filtros por estado/faena/proveedor. **Arreglar etiquetas de carga opacas** ("…") de Emitir/Marcar enviada (`oc-list.tsx:150,162`) con `SubmitButton` (`label`/`loadingLabel`, p. ej. "Emitiendo…"). Conservar el banner verde de auto-split por proveedor y el aviso amarillo "N ítems aprobados sin OC".

**2.5 — Recepción.** Búsqueda por **código + faena + proveedor** (corrige `searchKeys`). Hacer **explícita la doble etapa**: encabezado que explique "Paso 1: llegada a oficina → Paso 2: distribución a faena", reusar el badge de "en tránsito" (`gapMap`) como señal y mostrar claramente por qué la etapa faena está deshabilitada hasta tener recepción en oficina (ya enforced en `receipt-form.tsx` y `lib/services/receiving.ts`).

---

## Phase 3 — Onboarding, ayuda contextual y pulido transversal

**3.1 — Microcopy y estados vacíos.** Cada pantalla con una línea de propósito y vacíos con una sola CTA obvia (reusar `EmptyState`).
**3.2 — Pista de primer uso dismissible** por pantalla (qué es y el primer paso), persistida en `localStorage`.
**3.3 — Mobile y a11y consistentes.** Verificar la barra de filtros + `renderMobileCard` en móvil; mantener `aria-sort`, filas con teclado y combobox accesible ya existentes.
**3.4 — (Stretch) ⌘K salta a registros.** Extender `components/layout/command-palette.tsx` (hoy solo navegación) para resolver códigos `SOL-…`/`OC-…` y abrir el detalle. Marcado como opcional por ser más profundo.

---

## Critical files

**Nuevos**
- `components/operaciones/list-filters.tsx` — barra de filtros URL-synced + Exportar.
- `lib/operaciones/list-query.ts` — parseo de params + condiciones Drizzle.
- `components/operaciones/pipeline-steps.tsx` — stepper visual (sobre `buildRequestProgress`).
- `lib/operaciones/labels.ts` (si se extraen los mapas de estado).

**Modificados (patrón repetido)**
- `app/(app)/{solicitudes,compras,recepcion,aprobaciones}/page.tsx` — aplicar filtros server-side + montar barra.
- `app/(app)/{solicitudes/request-list,compras/oc-list,recepcion/recepcion-table}.tsx` — `search=""` a `DataTable`, `searchKeys` ampliados, etiquetas unificadas; `oc-list.tsx` botones con `SubmitButton`.
- `app/api/reportes/export/route.ts` + `lib/reports/export.ts` — tipos de lista + gateo por permiso de lista.
- `components/states/state-badge.tsx` — consumir labels unificados (si aplica 1.1).

## Reuse (no reinventar)
- Paginación: `lib/pagination.ts` (`resolvePagination`, `buildPaginationHref` ya preserva filtros), `components/ui/server-pagination.tsx`.
- Export: `lib/reports/export.ts` (`buildXlsxBuffer`, `ExportFilters`), patrón de `components/export-dialog.tsx`.
- Estados/progreso: `lib/work-queue.ts` (`requestStatusLabel`, `itemStatusLabel`, `itemStageLabel`, `buildRequestProgress`).
- Scope: `lib/auth/scope.ts` (`worksiteScopeSql`, `visibleWorksiteIds`, `isGlobalRole`).
- UI: `components/admin/data-table.tsx`, `components/admin/submit-button.tsx`, `components/ui/{select,date-picker,empty-state,badge}`, `components/states/state-badge.tsx`, `lib/toast.ts`.

## Verification

1. **Build/lint/tipos:** `npm run lint` y `npx tsc --noEmit` (o el check del repo).
2. **Tests:** correr la suite existente (`lib/__tests__/*`) y agregar unit tests para `lib/operaciones/list-query.ts` (parseo + condiciones) y para los nuevos tipos de export en `lib/reports/export.ts`.
3. **Trampa de búsqueda (la prueba clave):** con datos de seed (`db/seed.ts`) que generen 2+ páginas, buscar por código un registro de la página 2 y confirmar que **aparece**; verificar que estado/faena persisten al paginar y al recargar (URL).
4. **Export en pantalla:** descargar XLSX desde cada lista con filtros activos y confirmar que el archivo respeta los filtros (abrir el `.xlsx`).
5. **End-to-end del pipeline (rol secretaría):** crear solicitud → enviar → aprobar (incl. "Aprobar todos") → crear OC (auto-split por proveedor) → emitir/enviar (con labels de carga correctos) → recepción oficina → recepción faena (stock sube). Correr la app con el skill `run`; para e2e usar `PGHOST=/var/run/postgresql` (memoria [[e2e-pghost-socket]]).
6. **Intuitividad/a11y:** recorrido en móvil de las 4 pantallas; navegación por teclado en tablas y combobox; toasts de error vía `@/lib/toast` (memoria [[toast-wrapper-convention]]).
