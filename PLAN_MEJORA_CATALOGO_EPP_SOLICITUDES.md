# Plan: Mejora del Catálogo EPP y del Creador de Solicitudes

> Auditoría + roadmap de implementación derivado del análisis del flujo
> `catálogo EPP → selección de variantes → ítem de solicitud`.
> Apunta a blindar el modelo de tallas, mejorar la UX del selector de variantes
> y reducir errores humanos al pedir EPPs.

---

## 0. Contexto del estado actual

### 0.1 Modelo de datos vigente (resumen)

```
productCategories (isEpp, requiresPrevencion)
  └─ eppProductFamilies (canonicalName, identityKey, eppType, brand, model)
       └─ products (sku, name, isEpp, familyId, unitOfMeasure, referencePrice)
            ├─ productAttributes (name, type, options=JSON, isRequired)   ← talla/color viven acá
            └─ productSuppliers (unitPrice, isPreferred)

purchaseRequests (requestType, status, urgency, requiredDate, deliveryMode)
  └─ purchaseRequestItems (productId | productNameFree, quantity, unitOfMeasure, workerId, urgency)
       └─ requestItemAttributes (attributeId, attributeName denorm., value)
```

### 0.2 Lo que ya funciona bien

- Presets canónicos en `EPP_ATTRIBUTE_PRESETS` (`app/(app)/admin/productos/product-form.tsx`):
  `Talla` (XS–3XL), `Talla calzado` (36–46), `Color` (8 colores).
- Variantes agrupadas por `familyId` con `groupProductVariants()` y
  `formatProductVariant()` en `lib/products/variant-grouping.ts`.
- Importador XLSX (`lib/services/epp-import.types.ts`) detecta multi-talla /
  multi-color separados por coma.
- Validación Zod en `lib/validation/operations.ts` bloquea el envío si faltan
  atributos `isRequired`.

### 0.3 Brechas detectadas (resumen)

| # | Brecha | Severidad |
|---|---|---|
| 1 | Sin validación SQL: `requestItemAttributes.value` puede no estar en `options` | Alta |
| 2 | Sin catálogo canónico de tallas; cada producto redefine su lista | Alta |
| 3 | Sin unicidad `(requestItemId, attributeName)` | Alta |
| 4 | Sin CHECK de EPP sin atributos de talla | Media |
| 5 | Atributos ocultos tras disclosure (`item-editor-attributes.tsx`) | Media |
| 6 | Cantidad global, no por variante | Media |
| 7 | `eppProductFamilies.eppType` libre; sin norma / vida útil / pictograma | Media |
| 8 | `workers` no tiene talla propia | Media |
| 9 | Sin sugerencia "lo que pediste la última vez" | Baja |
| 10 | Sin vista `/admin/epps` dedicada | Baja |

---

## 1. Hoja de ruta por prioridades

### P0 — Blinda el modelo de tallas (semanas 1–2)

> Objetivo: que la base de datos haga respetar las reglas de tallas, hoy
> solo garantizadas por el `<Select>` del cliente.

#### P0.1 — Catálogo canónico de tallas

**Qué:** nueva tabla `size_catalog` con valores canónicos reutilizables
(ropa, calzado, guantes, cascos).

```sql
-- db/schema/sizes.ts
size_catalog
  id           text pk
  family       text not null          -- 'ropa' | 'calzado' | 'guantes' | 'casco' | ...
  code         text not null          -- 'M', '42', 'XL', '10.5'
  display_order integer not null
  unique (family, code)
```

**Seed:** `scripts/seed-size-catalog.ts` con:
- Ropa: `XS, S, M, L, XL, 2XL, 3XL`
- Calzado: `36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46`
- Guantes: `S, M, L, XL`
- Casco: `Única`

**UI admin:** nueva pestaña "Tallas canónicas" en
`/admin/productos` (modo lectura + activar/desactivar). Sólo lectura para
usuarios normales.

**Migración:** `0088_size_catalog.sql` (generada con `npm run db:generate`,
no editar a mano).

---

#### P0.2 — Vincular `productAttributes` al catálogo + CHECK constraint

**Qué:** dos cambios en `productAttributes`:

1. Nueva columna opcional `size_family` (`text references size_catalog.family`).
2. CHECK constraint a nivel SQL:
   ```sql
   check_product_attribute_value_in_options
     value-only attribute: length(value) <= 64
     select attribute: value debe estar contenido en options
   ```
   Implementado vía trigger `BEFORE INSERT/UPDATE` en `request_item_attributes`
   que resuelve `attribute_id → product_attributes` y compara `value` con el
   JSON de `options` (si el atributo es `select`).

**Detalle de implementación:**
- Migración `0089_product_attribute_size_family.sql` añade la columna.
- Migración `0090_check_request_item_attribute_value.sql` añade el trigger.
- Mantener compat: atributos sin `size_family` siguen funcionando con opciones
  libres; sólo cambia el contrato de validación.

**Reglas de validación:**
- `value` no vacío (`length(value) > 0`).
- `length(value) <= 64`.
- Si `attribute.type = 'select'` y `attribute.options` parseable: `value` debe
  coincidir con alguna opción.
- Atributos `text` / `number`: `length(value) <= 64`, `value` no vacío.

**Tareas:**
- [ ] Definir `db/schema/sizes.ts` con `size_catalog`.
- [ ] Migración 0088 + seed.
- [ ] Migración 0089: añadir `product_attributes.size_family`.
- [ ] Migración 0090: trigger en `request_item_attributes`.
- [ ] Backfill: actualizar presets (`EPP_ATTRIBUTE_PRESETS`) para referenciar
      `size_family` cuando aplique.
- [ ] Tests: `tests/sizes.test.ts` y `tests/request-item-attribute-constraint.test.ts`
      con patrón try/catch sobre PGlite (ver `taste.md` → Testing).

---

#### P0.3 — Unicidad `(requestItemId, attributeName)`

**Qué:** un ítem no puede tener dos filas con el mismo `attributeName`.

```sql
alter table request_item_attributes
  add constraint uq_request_item_attributes_name
  unique (request_item_id, attribute_name);
```

**Backfill:** deduplicar antes (mantener el último). Migración defensiva
`0091_unique_request_item_attribute_name.sql` con bloque PL/pgSQL que
conserva el `id` de mayor `createdAt`.

**Tareas:**
- [ ] Migración 0091 con dedupe defensivo.
- [ ] Test de regresión: intentar insertar dos veces → falla con constraint.

---

### P1 — UX del selector de variantes en la solicitud (semanas 3–4)

> Objetivo: que pedir 10 EPPs de tallas distintas no requiera 10 clicks
> extra ni conocimiento previo del SKU.

#### P1.1 — Atributos siempre visibles cuando son `isRequired`

**Qué:** quitar el disclosure "Completar/Ocultar detalles" para atributos
obligatorios. Mantenerlo solo para los opcionales.

**Archivos a tocar:**
- `app/(app)/solicitudes/item-editor-attributes.tsx`
- `app/(app)/solicitudes/item-editor-attributes.helpers.ts`

**Cambios:**
- Si `editableAttributes` contiene algún `isRequired`, render expandido
  por defecto y esconder el botón toggle para esos campos.
- Los opcionales siguen detrás del toggle.
- Animación: `transition-all duration-(--duration-fast)` para que abra
  sin saltos visuales.

**Tareas:**
- [ ] Refactor `item-editor-attributes.tsx` con la regla nueva.
- [ ] Tests de comportamiento con React Testing Library.

---

#### P1.2 — Selector visual de variantes con chips

**Qué:** cuando un producto EPP tiene variantes (otros productos hermanos
en la misma `familyId`), el `ProductPicker` debe mostrar un selector tipo:

```
[Casco 3M H-700]    Talla:  [S] [M] [L] [XL]
                     Color:  [Blanco] [Amarillo] [Azul]
                     Cantidad: [  2  ] por variante
```

**Diseño:**
- Chips por opción, seleccionables.
- Cantidad por variante (introduce `quantityByVariant: Record<productId, number>`).
- Validación: la suma de cantidades debe coincidir con `quantity` total del ítem
  (o se elimina `quantity` escalar cuando hay variantes).

**Archivos:**
- `app/(app)/solicitudes/product-picker.tsx` — añadir vista "variantes" cuando
  la familia tiene >1 hermano.
- Nuevo componente `app/(app)/solicitudes/variant-quantity-grid.tsx`.
- `app/(app)/solicitudes/request-form.types.ts` — añadir
  `variantQuantities: Record<string, number>` al `ItemRow`.
- `app/(app)/solicitudes/use-request-form.ts` — sincronizar
  `variantQuantities` con `quantity` global (o reemplazarlo).
- `lib/services/requests-draft.ts` — al persistir, si hay variantes, expandir
  en N filas de `purchase_request_items` (una por variante con su
  `quantity` real). Mantener una fila "resumen" opcional para no romper la UI
  existente que itera sobre ítems.

**Tareas:**
- [ ] Diseño Figma del grid (o wireframe en código).
- [ ] `variant-quantity-grid.tsx`.
- [ ] Sincronización con `use-request-form`.
- [ ] Expansión en N ítems en `persistRequestWithDiff`.
- [ ] Tests: el botón "Enviar" debe estar disabled si la suma de variantes ≠
      la cantidad declarada (o cualquier variante sin cantidad).

---

#### P1.3 — Cantidad por variante real en BD

**Decisión arquitectónica:** ¿una fila por variante o una fila con JSON?

| Opción | Pro | Contra |
|---|---|---|
| A. N filas en `purchase_request_items` | Compatible con todo lo existente; reportes siguen funcionando | Más filas; índices crecen |
| B. JSON `quantities` en `purchase_request_items` | Una sola fila | Rompe queries existentes de stock, OC, entregas |

**Decisión recomendada: Opción A.** El modelo actual de stock/entrega/
OC trabaja con `productId + quantity`; partir en N filas es la
**vía de menor fricción**. El costo (más filas) es aceptable: las
solicitudes típicas tienen <10 ítems.

**Schema change:** nada nuevo; sólo un cambio de lógica en
`persistRequestWithDiff` que itera `variantQuantities` y crea N items
con `productId` específico y `quantity` real.

**Backwards compat:** ítems sin variantes siguen siendo una sola fila
(comportamiento actual).

---

### P2 — Catálogo EPP enriquecido (semanas 5–7)

> Objetivo: que el catálogo de EPPs sea consultable, filtrable y útil
> para reportes de prevención.

#### P2.1 — Tipo de EPP canónico

**Qué:** `eppProductFamilies.eppType` deja de ser texto libre y pasa a
referenciar una nueva tabla `epp_types`.

```sql
epp_types
  id           text pk
  code         text unique     -- 'cabeza' | 'ojos_cara' | 'auditiva' |
                                -- 'respiratoria' | 'manos' | 'pies' |
                                -- 'caidas' | 'cuerpo' | 'altura'
  label        text not null
  sort_order   integer
```

**Seed:** 8 tipos basados en la clasificación típica de EPP.

**UI:** select en `family-form` (nuevo) o en el form de familia al editar.
Filtro "Tipo de EPP" en `/admin/epps`.

---

#### P2.2 — Norma / certificación / vida útil

**Qué:** columnas nuevas en `eppProductFamilies`:

```sql
epp_product_families
  + certification     text     -- 'EN 397', 'ANSI Z89.1', etc.
  + lifespan_months   integer  -- vida útil recomendada
  + pictogram_url     text     -- ícono representativo
  + epp_type_id       text references epp_types.id   -- (en lugar de eppType text)
```

**UI admin:** campos opcionales en el form de familia (cuando exista).

---

#### P2.3 — Vista `/admin/epps` dedicada

**Qué:** nueva página en `app/(app)/admin/epps/page.tsx` que muestre:

- Filtros: tipo de EPP, marca, certificación, "stock bajo", "sin stock".
- Tabla consolidada por familia con sus variantes y stock agregado.
- Botón "Crear familia EPP" → flow nuevo.

**No reemplaza** `/admin/productos` — la complementa.

**Tareas:**
- [ ] Server action `listEppFamilies(filter)`.
- [ ] Página con DataTable.
- [ ] Registro en `modules/registry.ts` y `modules/manifest-types.ts`.
- [ ] Permisos en `modules/permissions.ts`.

---

### P3 — Talla del trabajador + sugerencias (semanas 8–10)

> Objetivo: que pedir una reposición sea casi automático.

#### P3.1 — Talla en `workers`

**Qué:** columnas nuevas en `workers`:

```sql
workers
  + size_top        text     -- 'M'
  + size_bottom     text     -- '42'
  + size_shoe       text     -- '42'
  + size_gloves     text
  + size_helmet     text
```

Opcionales. Sin CHECK (pueden no tener talla registrada).

**UI:** tab "Datos físicos" en `/admin/trabajadores/[id]`.

**Migración:** `0092_worker_sizes.sql`.

---

#### P3.2 — Cruzar solicitud ↔ talla del trabajador

**Qué:** cuando un ítem de solicitud tiene `workerId` y es EPP con
atributo Talla, sugerir automáticamente la talla del trabajador.

**Comportamiento:**
- Al elegir el producto, si hay `workerId` y el producto tiene atributo
  `Talla` o `Talla calzado`, precargar `value` desde `workers.size_top` /
  `size_shoe`.
- El usuario puede override (con razón opcional).
- Mostrar un hint visual: "Usando talla M registrada para Juan Pérez".

**Archivos:**
- `lib/services/worker-size.ts` — helper `getSuggestedSize(workerId, attributeName)`.
- `app/(app)/solicitudes/item-editor-attributes.tsx` — usar el helper al
  construir `AttrRow` inicial.

---

#### P3.3 — Sugerencia "lo que pediste la última vez"

**Qué:** en el `ProductPicker`, sección "Pedidos recientes" que muestra
las últimas 5 solicitudes del usuario con el mismo `productId` o
`familyId`, con la cantidad típica.

**Server action:** `recentRequestsForProducts(productIds, requesterId, limit)`.

**UI:** lista colapsable con chips "Reutilizar".

---

### P4 — Robustez y cobertura de tests (paralelo)

- [ ] Tests unitarios de `parseAttributeOptions`, `buildAttrsFromProduct`,
      `formatProductVariant`.
- [ ] Tests de los constraints CHECK (PGlite + try/catch).
- [ ] Tests e2e del flow "crear solicitud con tallas múltiples" extendido.
- [ ] Tests del importador XLSX con tallas US (9.5, 10.5) — hoy caen en
      "ropa" por la heurística de 2 dígitos.

---

## 2. Convenciones de implementación

### 2.1 Migraciones

> **Recordatorio AGENTS.md** — nunca editar a mano `meta/_journal.json`
> ni timestamps; siempre `npm run db:generate` para crear la migración.

Cada cambio de schema va en su propia migración. Si la migración incluye
custom SQL (triggers, seed inicial no-RBAC), se **concatena al final** del
archivo `.sql` generado, separado por `--> statement-breakpoint`.

RBAC **nunca** en migración — siempre vía `npm run db:seed`.

### 2.2 Tests

Patrón ya establecido (ver `taste.md` → Testing):
- PGlite in-memory + `migratePGlite` en `beforeEach`.
- `try/catch` para inspeccionar `error.cause` y validar que el CHECK
  constraint saltó.
- `onConflictDoNothing()` en inserts de FK repetidos.

### 2.3 UX / diseño

Reglas de `AGENTS.md` (page-layout) que aplican:
- `PageContainer` + `PageHeader` + `actions` en el header — nunca toolbar
  inline dentro de listas.
- Selector de variantes: chips visualmente claros, hint visible de la
  variante seleccionada, validación de suma de cantidades al borde.
- Empty states con CTA real, no rutas pegadas como texto.

### 2.4 Estructura de archivos

Nuevos archivos esperados:

```
db/schema/sizes.ts                     # P0.1
scripts/seed-size-catalog.ts            # P0.1
app/(app)/admin/productos/sizes/        # P0.1 (admin page)
app/(app)/solicitudes/variant-quantity-grid.tsx   # P1.2
lib/services/worker-size.ts             # P3.2
app/(app)/admin/epps/                   # P2.3
db/schema/epp-types.ts                  # P2.1
tests/sizes.test.ts                     # P0
tests/request-item-attribute-constraint.test.ts
tests/variant-quantity-grid.test.tsx    # P1.2
```

---

## 3. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Trigger en `request_item_attributes` rompe inserts legacy | Backfill primero: para cada fila existente, validar `value ∈ options`. Si hay inválidos, mover a `request_item_attribute_legacy_values` antes de activar el trigger. |
| N filas por variante inflan `purchase_request_items` | Doc explícito en `request-form.types.ts`. UI agrupa visualmente para el usuario; backend ve N filas. |
| Cambios rompen reportes / OC / entregas existentes | Feature flag por familia (`family.allowVariants`). Activar por familia, no global. |
| Backwards compat de `eppProductFamilies.eppType` | Migración: copiar `eppType` (texto) a `epp_types` por similitud, crear el FK y dejar `eppType` deprecado por una versión antes de eliminarlo. |
| Performance del trigger en inserts masivos | Trigger sólo en `BEFORE INSERT/UPDATE`; la validación es un `IN` con array JSON parseado — barato para N atributos por ítem (<10). |

---

## 4. Orden de ejecución sugerido

```
Semana 1  ─►  P0.1 (size_catalog + seed + UI admin)
            P0.3 (unicidad, defensivo, sin producto todavía)

Semana 2  ─►  P0.2 (size_family + CHECK + trigger)
            Tests P0

Semana 3  ─►  P1.1 (atributos siempre visibles)
            P1.2 (variant-quantity-grid) — wireframe + componente

Semana 4  ─►  P1.3 (N filas en purchase_request_items)
            Tests P1 + e2e

Semana 5  ─►  P2.1 (epp_types)
            P2.2 (certificación / vida útil)

Semana 6  ─►  P2.3 (vista /admin/epps)
            Permisos + registry

Semana 7  ─►  P3.1 (workers.size_*)

Semana 8  ─►  P3.2 (sugerencia talla del trabajador)
            P3.3 (recientes en product picker)

Semana 9  ─►  P4 (tests, e2e, cobertura)

Semana 10 ─►  Documentación, auditoría final, deploy progresivo
```

---

## 5. Métricas de éxito

- **% de ítems EPP con atributos `isRequired` completos** al enviar →
  objetivo >99% (hoy depende del disclosure).
- **% de solicitudes con tallas válidas en DB** → 100% post-P0.2.
- **Clicks para pedir 5 EPPs distintos** → bajar de ~25 a ~10.
- **Tickets "recibí talla equivocada"** → bajar 50% en 2 meses.
- **Tests del módulo EPP** → subir a >80% cobertura en
  `lib/services/epp-import*` y `lib/products/variant-grouping`.

---

## 6. Fuera de alcance (explícito)

- Editor visual de variantes drag-and-drop en el form de admin (P2.x
  futura).
- Sugerencias automáticas con ML / IA.
- Sincronización con proveedores externos (catálogo Achs, Mutual).
- App móvil.
- Integración con código de barras / QR por unidad.

---

## 7. Progreso de implementación (2026-07-20)

### ✅ Completado — Primera sesión

| Prioridad | Feature | Archivos clave |
|---|---|---|
| P0.1 | Catálogo canónico `size_catalog` + seed | `db/schema/sizes.ts`, migración `0088` |
| P0.3 | Unicidad `(requestItemId, attributeName)` con dedupe | `db/schema/requests.ts`, migración `0089` |
| P0.2 | `sizeFamily` + value_length CHECK + trigger `value ∈ options` | `db/schema/products.ts`, `db/schema/requests.ts`, migración `0090` |
| P1.1 | Atributos `isRequired` siempre visibles | `app/(app)/solicitudes/item-editor-attributes.tsx` |
| P1.2 | Grid de variantes con cantidad por variante | `app/(app)/solicitudes/variant-quantity-grid.tsx`, `item-editor.tsx`, tipos |
| P1.3 | Expansión N filas `purchase_request_items` por variante | `app/(app)/solicitudes/use-request-form.ts` |
| P2.1 | `epp_types` canónico + seed | `db/schema/epp-types.ts`, migración `0091` |
| P2.2 | Certificación / vida útil / pictograma / `eppTypeId` | `db/schema/products.ts`, migración `0091` |
| P2.3 | Vista `/admin/epps` dedicada | `app/(app)/admin/epps/page.tsx`, `epp-family-list.tsx` |
| P3.1 | `workers.size_*` (top, bottom, shoe, gloves, helmet) | `db/schema/worksites.ts`, migración `0092` |
| P3.2 | Helper `getSuggestedSize` en `lib/services/worker-size.ts` | `lib/services/worker-size.ts` |

### ✅ Completado — Segunda sesión

| Feature | Archivos clave |
|---|---|
| **P3.2 UI: Worker picker + auto-sugerencia** | `app/(app)/solicitudes/use-request-form.ts` (suggestSize, updateItemWorker), `item-editor.tsx` (Select de trabajador), `request-form.tsx` (prop drilling), `nueva/page.tsx` (carga workers con sizes), `requests-draft-create.ts` + `requests-draft-update.ts` (workerId null → item.workerId) |
| **UI talla trabajador** | `app/(app)/admin/trabajadores/worker-form.tsx` (SizeSelect con presets), `actions.ts` (persist size_*), `page.tsx` + `worker-list.tsx` (WorkerRow con size props), `lib/validation/masters.ts` (size_* en workerSchema) |
| **Backfill presets sizeFamily** | `app/(app)/admin/productos/product-form.tsx` (+ nuevo preset "Talla guantes"), `product-form.types.ts` (sizeFamily opcional), `actions.ts` (persist sizeFamily), `lib/validation/masters.ts` (sizeFamily en productAttributeSchema) |
| **Tests** | `lib/__tests__/epp-sizes-constraints.test.ts` (7 tests: size_catalog, value_length CHECK, unique constraint), `lib/__tests__/epp-variant-helpers.test.ts` (8 tests: parseAttributeOptions, buildAttrsFromProduct, formatProductVariant, groupProductVariants) |

**Migrations nuevas:** `0088_warm_lilandra` · `0089_acoustic_kinsey_walden` · `0090_vengeful_gladiator` · `0091_low_alice` · `0092_tranquil_ender_wiggin`
**Typecheck:** ✅ limpio | **Lint:** ✅ limpio | **Tests:** 15 nuevos, todos ✅

### ✅ Completado — Tercera sesión

| Feature | Archivos clave |
|---|---|
| **e2e: solicitud EPP con variantes** | `e2e/epp-variant-request-flow.spec.ts` — flujo completo: login → crear solicitud EPP → combobox picker → grid variantes con cantidades → guardar borrador → enviar a aprobación. `e2e/setup-db.ts` — fixtures: familia EPP + 3 productos variantes (S/M/L) con atributos y proveedor. |

### ⚠️ Pendiente accionable

| Feature | Qué falta | Complejidad |
|---|---|---|
| **P3.3 Pedidos recientes** | Server action + UI en `ProductPicker` para "lo que pediste la última vez" | Alta (fuera de alcance solicitado por el usuario) |

**Nada más pendiente.** Todas las features del plan están implementadas.

### 🔴 Bloqueantes para deploy

1. **Ejecutar migraciones** `0088`–`0092` en el entorno destino (`npm run db:migrate`).
2. **Verificar que no hay duplicados** en `request_item_attributes` antes de 0089 (el dedupe lo maneja, pero revisar).
3. **Verificar valores existentes vs trigger**: si hay `request_item_attributes` con `attribute.type = 'select'` cuyo `value` no está en `options`, inserts/updates futuros fallarán.
