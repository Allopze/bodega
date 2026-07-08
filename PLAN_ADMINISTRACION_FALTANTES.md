# Administración Faltante Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current Administración panel into the central place for all administrative catalogs, permissions, operational parameters, support diagnostics, and module-specific master data that are currently missing or hidden in operational modules.

**Architecture:** Keep the repo's current rule: business logic lives in `lib/` and route-level server actions live in `app/(app)/**`. `modules/admin/manifest.ts` remains only the permission/manifest surface; do not create `modules/admin/services` or revive removed modular scaffolding. New admin pages should use `PageContainer`, `PageHeader`, existing admin forms/tables, server actions, audit logging, and faena-scoped guards where relevant.

**Tech Stack:** Next.js App Router, React Server Components, Server Actions, Drizzle ORM, PostgreSQL, Vitest, Testing Library, existing `DataTable`, `PageHeader`, `PageContainer`, `Sheet`/dialog patterns, and XLSX-only exports where exports are added.

---

## Current State

The current `/admin` panel exposes only these categories:

- `Usuarios` -> `/admin/usuarios`
- `Faenas` -> `/admin/faenas`
- `Trabajadores` -> `/admin/trabajadores`
- `Productos` -> `/admin/productos`
- `Proveedores` -> `/admin/proveedores`
- `Configuración` -> `/admin/configuracion`
- `Log de Auditoría` -> `/admin/auditoria`
- `Correo SMTP` -> `/admin/correo-smtp`
- `Plantillas de correo` -> `/admin/plantillas`

The missing administrative areas are:

- Centros de costo
- Roles
- Taxonomía documental SST
- Catálogos auxiliares de productos
- Numeradores / folios
- Seguridad y bloqueos
- Parámetros operativos del sistema
- Catálogos PDTP / Prevención
- Catálogos de vehículos y mantenciones
- Mantenimiento de notificaciones

## Cross-Cutting Rules

- Every authenticated page under `app/(app)/admin/**` must use `PageContainer` and `PageHeader`.
- Do not add standalone text-search inputs when the table can use the TopBar search through `DataTable searchKeys`.
- Every mutation must call `requirePermission(...)`.
- Every mutation that changes a business/admin object must call `recordAudit(...)`.
- Use soft delete or `isActive = false` for catalogs that can be referenced by operational history.
- Use XLSX, not CSV, for every export.
- Generate migrations through `npm run db:generate`; do not hand-edit `db/migrations/meta/_journal.json`.
- Keep commits scoped by task, because this plan touches several independent subsystems.

## New Admin Permissions

Modify `modules/admin/manifest.ts` first so every new page has a dedicated permission.

Add these permissions:

```ts
"admin:roles",
"admin:cost_centers",
"admin:product_catalogs",
"admin:document_taxonomy",
"admin:pdtp_catalog",
"admin:fleet_catalog",
"admin:security",
"admin:folios",
"admin:notifications",
"admin:ops_settings",
```

Add these descriptions:

```ts
"admin:roles":             { id: "p-adm-roles", description: "Gestionar roles y permisos base" },
"admin:cost_centers":      { id: "p-adm-cost",  description: "Gestionar centros de costo" },
"admin:product_catalogs":  { id: "p-adm-pcat",  description: "Gestionar catálogos auxiliares de productos" },
"admin:document_taxonomy": { id: "p-adm-docx",  description: "Gestionar taxonomía documental SST" },
"admin:pdtp_catalog":      { id: "p-adm-pdtp",  description: "Gestionar catálogos base del programa preventivo" },
"admin:fleet_catalog":     { id: "p-adm-fleet", description: "Gestionar catálogos administrativos de flota" },
"admin:security":          { id: "p-adm-sec",   description: "Gestionar bloqueos y controles de seguridad" },
"admin:folios":            { id: "p-adm-fol",   description: "Ver y corregir folios operativos" },
"admin:notifications":     { id: "p-adm-notif", description: "Administrar notificaciones del sistema" },
"admin:ops_settings":      { id: "p-adm-ops",   description: "Gestionar parámetros operativos avanzados" },
```

Default grants:

- `administrador`: all new `admin:*` permissions.
- `jefa_chome`: `admin:cost_centers`, `admin:product_catalogs`, `admin:pdtp_catalog`, `admin:fleet_catalog`, `admin:notifications`.
- `secretaria`: `admin:cost_centers`, `admin:product_catalogs`.
- `prevencionista`: `admin:document_taxonomy`, `admin:pdtp_catalog`.
- `jefe_mantencion`: `admin:fleet_catalog`.

Run after editing:

```bash
npx eslint modules/admin/manifest.ts
npm test -- lib/__tests__/auth-bootstrap-permissions.test.ts
```

Expected:

```text
0 problems
PASS lib/__tests__/auth-bootstrap-permissions.test.ts
```

## Proposed Admin Page Groups

Modify `app/(app)/admin/page.tsx` and keep the current grouped-card model.

Final groups:

- `Personas y acceso`: Usuarios, Roles, Faenas, Trabajadores
- `Catálogos operativos`: Productos, Catálogos de productos, Proveedores, Centros de costo
- `Prevención`: Taxonomía documental SST, Catálogos PDTP
- `Vehículos`: Catálogos de flota
- `Control del sistema`: Configuración, Parámetros operativos, Folios, Seguridad y bloqueos, Notificaciones, Log de Auditoría
- `Correo SMTP`: Correo SMTP, Plantillas de correo

The admin landing should still filter cards by permission with `can(session, permission)`.

---

## Task 1: Add Admin Permissions And Landing Cards

**Files:**

- Modify: `modules/admin/manifest.ts`
- Modify: `app/(app)/admin/page.tsx`
- Test: `lib/__tests__/auth-bootstrap-permissions.test.ts`
- Test: add `app/(app)/admin/admin-page-config.test.ts` if no current test covers card metadata

- [ ] **Step 1: Write/extend permission parity test**

Add expectations that every new permission exists in the manifest and in bootstrap-derived permission sync.

```ts
const expectedAdminPermissions = [
  "admin:roles",
  "admin:cost_centers",
  "admin:product_catalogs",
  "admin:document_taxonomy",
  "admin:pdtp_catalog",
  "admin:fleet_catalog",
  "admin:security",
  "admin:folios",
  "admin:notifications",
  "admin:ops_settings",
]

for (const permission of expectedAdminPermissions) {
  expect(adminModule.permissions).toContain(permission)
  expect(adminModule.permissionMeta[permission]).toBeDefined()
}
```

- [ ] **Step 2: Run the targeted test and confirm failure**

Run:

```bash
npm test -- lib/__tests__/auth-bootstrap-permissions.test.ts
```

Expected failure before implementation:

```text
expected [...] to contain "admin:roles"
```

- [ ] **Step 3: Add permissions to `modules/admin/manifest.ts`**

Add the permission strings, metadata, and grants described in "New Admin Permissions".

- [ ] **Step 4: Add cards and groups to `app/(app)/admin/page.tsx`**

Use existing Phosphor SSR icons already used in this page. Suggested mapping:

```ts
{
  title: "Roles",
  description: "Gestionar roles base, alcance global y permisos incluidos por rol.",
  href: "/admin/roles",
  icon: ShieldCheck,
  permission: "admin:roles",
  group: "personas",
},
{
  title: "Centros de costo",
  description: "Crear y mantener centros de costo asociados a faenas e imputaciones.",
  href: "/admin/centros-costo",
  icon: Buildings,
  permission: "admin:cost_centers",
  group: "catalogos",
},
{
  title: "Catálogos de productos",
  description: "Unidades de medida, atributos reutilizables y reglas auxiliares del catálogo.",
  href: "/admin/catalogos-productos",
  icon: Cube,
  permission: "admin:product_catalogs",
  group: "catalogos",
},
{
  title: "Taxonomía documental SST",
  description: "Categorías, tipos, vigencias y reglas de documentos preventivos.",
  href: "/admin/taxonomia-sst",
  icon: FileText,
  permission: "admin:document_taxonomy",
  group: "prevencion",
},
{
  title: "Catálogos PDTP",
  description: "Responsables, hojas, actividades base y plantillas del programa preventivo.",
  href: "/admin/pdtp-catalogos",
  icon: FileText,
  permission: "admin:pdtp_catalog",
  group: "prevencion",
},
{
  title: "Catálogos de flota",
  description: "Vehículos, proveedores de combustible, documentos y tipos de mantención.",
  href: "/admin/flota-catalogos",
  icon: Gear,
  permission: "admin:fleet_catalog",
  group: "vehiculos",
},
{
  title: "Parámetros operativos",
  description: "Límites de exportación, carga de archivos, retención y limpieza operativa.",
  href: "/admin/parametros-operativos",
  icon: Gear,
  permission: "admin:ops_settings",
  group: "gobierno",
},
{
  title: "Folios",
  description: "Revisar secuencias de códigos y registrar correcciones controladas.",
  href: "/admin/folios",
  icon: FileText,
  permission: "admin:folios",
  group: "gobierno",
},
{
  title: "Seguridad y bloqueos",
  description: "Ver y liberar bloqueos por intentos fallidos en login y formularios públicos.",
  href: "/admin/seguridad",
  icon: ShieldCheck,
  permission: "admin:security",
  group: "gobierno",
},
{
  title: "Notificaciones",
  description: "Auditar, limpiar y diagnosticar notificaciones internas del sistema.",
  href: "/admin/notificaciones",
  icon: EnvelopeSimple,
  permission: "admin:notifications",
  group: "gobierno",
},
```

Add group metadata:

```ts
{
  key: "prevencion",
  title: "Prevención",
  description: "Catálogos maestros para documentación, SST y programa preventivo.",
},
{
  key: "vehiculos",
  title: "Vehículos",
  description: "Datos maestros de flota, combustible y mantenciones.",
},
```

- [ ] **Step 5: Run verification**

Run:

```bash
npx eslint modules/admin/manifest.ts 'app/(app)/admin/page.tsx'
npm test -- lib/__tests__/auth-bootstrap-permissions.test.ts
```

Expected:

```text
0 problems
PASS lib/__tests__/auth-bootstrap-permissions.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add modules/admin/manifest.ts 'app/(app)/admin/page.tsx' lib/__tests__/auth-bootstrap-permissions.test.ts
git commit -m "feat(admin): add missing administration areas"
```

---

## Task 2: Centros De Costo

**Files:**

- Create: `app/(app)/admin/centros-costo/page.tsx`
- Create: `app/(app)/admin/centros-costo/actions.ts`
- Create: `app/(app)/admin/centros-costo/cost-center-form.tsx`
- Create: `app/(app)/admin/centros-costo/cost-center-list.tsx`
- Create: `app/(app)/admin/centros-costo/actions.test.ts`
- Create or extend: `lib/validation/cost-centers.ts`
- Use existing schema: `db/schema/cost-centers.ts`

- [ ] **Step 1: Write action tests**

Test required behavior:

```ts
it("creates a cost center with code, name and optional faena", async () => {
  mockRequirePermission.mockResolvedValue(makeAdminSession(["admin:cost_centers"]))
  const form = new FormData()
  form.set("code", "CC-OPER-001")
  form.set("name", "Operaciones Zona Norte")
  form.set("worksiteId", "ws-1")
  form.set("description", "Centro de costo para imputaciones operativas")

  const result = await createCostCenterAction({ ok: false }, form)

  expect(result.ok).toBe(true)
  expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
    code: "CC-OPER-001",
    name: "Operaciones Zona Norte",
    worksiteId: "ws-1",
    isActive: true,
  }))
  expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: "create",
    entityType: "cost_center",
  }))
})

it("soft deactivates a cost center instead of deleting it", async () => {
  mockRequirePermission.mockResolvedValue(makeAdminSession(["admin:cost_centers"]))

  const result = await deactivateCostCenterAction("cc-1")

  expect(result.ok).toBe(true)
  expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }))
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npm test -- 'app/(app)/admin/centros-costo/actions.test.ts'
```

Expected:

```text
Cannot find module './actions'
```

- [ ] **Step 3: Add validation**

Create `lib/validation/cost-centers.ts`:

```ts
import { z } from "zod"

const optionalText = z.string().trim().optional().transform((v) => v || undefined)

export const costCenterFormSchema = z.object({
  id: z.string().trim().optional(),
  code: z.string().trim().min(2, "Ingresa un código").max(40, "Máximo 40 caracteres"),
  name: z.string().trim().min(2, "Ingresa un nombre").max(160, "Máximo 160 caracteres"),
  worksiteId: optionalText,
  description: optionalText,
  isActive: z.coerce.boolean().default(true),
})

export type CostCenterFormInput = z.infer<typeof costCenterFormSchema>
```

- [ ] **Step 4: Add server actions**

Create actions with:

- `createCostCenterAction`
- `updateCostCenterAction`
- `deactivateCostCenterAction`
- `reactivateCostCenterAction`

Implementation rules:

- `await requirePermission("admin:cost_centers")`
- validate through `costCenterFormSchema`
- insert/update `costCenters`
- use `revalidatePath("/admin/centros-costo")`
- audit `entityType: "cost_center"`
- return the repo's existing `ActionState`

- [ ] **Step 5: Add page and UI**

`page.tsx` should:

- require `admin:cost_centers`
- load cost centers with `worksite`
- load worksites for the select
- render `PageHeader` with `actions={<CostCenterForm mode="create" worksites={...} />}`
- render `CostCenterList`

`CostCenterList` should:

- use `DataTable`
- search keys: `["code", "name", "worksiteName", "description"]`
- show status badge
- expose edit, deactivate, reactivate actions

- [ ] **Step 6: Run targeted verification**

```bash
npx eslint 'app/(app)/admin/centros-costo' lib/validation/cost-centers.ts
npm test -- 'app/(app)/admin/centros-costo/actions.test.ts'
```

Expected:

```text
0 problems
PASS app/(app)/admin/centros-costo/actions.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add 'app/(app)/admin/centros-costo' lib/validation/cost-centers.ts
git commit -m "feat(admin): manage cost centers"
```

---

## Task 3: Roles And Role Permissions

**Files:**

- Create: `app/(app)/admin/roles/page.tsx`
- Create: `app/(app)/admin/roles/actions.ts`
- Create: `app/(app)/admin/roles/role-form.tsx`
- Create: `app/(app)/admin/roles/role-list.tsx`
- Create: `app/(app)/admin/roles/actions.test.ts`
- Modify or create: `lib/services/admin-roles.ts`
- Use existing schema: `db/schema/users.ts`

- [ ] **Step 1: Define role service interface**

Create `lib/services/admin-roles.ts` with these exported functions:

```ts
export async function listRolesWithPermissions() { /* returns roles with permission names */ }
export async function createRoleWithPermissions(input: RoleInput, actor: AdminActor) { /* inserts role and role_permissions */ }
export async function updateRoleWithPermissions(id: string, input: RoleInput, actor: AdminActor) { /* updates role and replaces role_permissions transactionally */ }
export async function assertRoleCanBeModified(roleId: string) { /* rejects missing role and protected bootstrap roles when needed */ }
```

Protected roles:

```ts
export const PROTECTED_ROLE_SLUGS = new Set(["administrador"])
```

The `administrador` role may be edited only by a user with the `administrador` role and direct `admin:roles`; it must not be deleted.

- [ ] **Step 2: Write tests**

Tests must cover:

- creating a role with `isGlobal = false`
- assigning permissions from the registry-derived permission table
- replacing permissions on edit
- rejecting removal of all permissions from `administrador`
- auditing create/update

Example assertion:

```ts
expect(mockRolePermissionInsert).toHaveBeenCalledWith([
  { roleId: "role-jefe-bodega", permissionId: "p-wh-stock" },
  { roleId: "role-jefe-bodega", permissionId: "p-wh-mov" },
])
```

- [ ] **Step 3: Implement page**

`page.tsx` should:

- require `admin:roles`
- fetch roles, permissions, and permission metadata grouped by module
- render `PageHeader` with action to create role
- show each role's slug, label, description, global/faena-scoped badge, and permission count

- [ ] **Step 4: Implement role form**

Reuse patterns from `app/(app)/admin/usuarios/permission-section.tsx`.

The form should expose:

- role slug/name
- display label
- description
- global scope switch
- permission checklist grouped by module
- warning copy for `administrador`

- [ ] **Step 5: Run verification**

```bash
npx eslint 'app/(app)/admin/roles' lib/services/admin-roles.ts
npm test -- 'app/(app)/admin/roles/actions.test.ts' 'app/(app)/admin/usuarios/actions-permissions.test.ts'
```

Expected:

```text
0 problems
PASS app/(app)/admin/roles/actions.test.ts
PASS app/(app)/admin/usuarios/actions-permissions.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add 'app/(app)/admin/roles' lib/services/admin-roles.ts
git commit -m "feat(admin): manage roles and role permissions"
```

---

## Task 4: SST Document Taxonomy

**Files:**

- Create: `app/(app)/admin/taxonomia-sst/page.tsx`
- Create: `app/(app)/admin/taxonomia-sst/actions.ts`
- Create: `app/(app)/admin/taxonomia-sst/category-form.tsx`
- Create: `app/(app)/admin/taxonomia-sst/type-form.tsx`
- Create: `app/(app)/admin/taxonomia-sst/taxonomy-list.tsx`
- Create: `app/(app)/admin/taxonomia-sst/actions.test.ts`
- Modify: `lib/services/prevention-documents/taxonomy.ts`
- Use existing schema: `db/schema/prevention/library.ts`

- [ ] **Step 1: Extend taxonomy service safely**

Use existing `upsertDocumentCategory` and `upsertDocumentType`.

Add explicit deactivation functions:

```ts
export async function setDocumentCategoryActive(slug: string, isActive: boolean) {
  const now = new Date().toISOString()
  const [row] = await db.update(sstDocumentCategories)
    .set({ isActive, updatedAt: now })
    .where(eq(sstDocumentCategories.slug, slug))
    .returning()
  if (!row) throw new Error("Categoría documental no encontrada")
  return row
}

export async function setDocumentTypeActive(id: string, isActive: boolean) {
  const now = new Date().toISOString()
  const [row] = await db.update(sstDocumentTypes)
    .set({ isActive, updatedAt: now })
    .where(eq(sstDocumentTypes.id, id))
    .returning()
  if (!row) throw new Error("Tipo documental no encontrado")
  return row
}
```

- [ ] **Step 2: Write action tests**

Cover:

- upsert category
- upsert type
- deactivate category
- deactivate type
- require `admin:document_taxonomy`
- audit with `entityType: "sst_document_category"` and `entityType: "sst_document_type"`

- [ ] **Step 3: Implement actions**

Actions:

- `saveDocumentCategoryAction`
- `saveDocumentTypeAction`
- `setDocumentCategoryStatusAction`
- `setDocumentTypeStatusAction`
- `seedDefaultDocumentCategoriesAction`

`seedDefaultDocumentCategoriesAction` may call `seedDefaultCategories()` but must audit the action as `entityType: "sst_document_taxonomy"`.

- [ ] **Step 4: Implement UI**

Page layout:

- left section: categories table
- right section: types table filtered by selected category through URL param `?category=...`
- header action: create category
- secondary action: seed defaults

Do not duplicate text search; use TopBar search through `DataTable`.

- [ ] **Step 5: Verify**

```bash
npx eslint 'app/(app)/admin/taxonomia-sst' lib/services/prevention-documents/taxonomy.ts
npm test -- 'app/(app)/admin/taxonomia-sst/actions.test.ts'
```

Expected:

```text
0 problems
PASS app/(app)/admin/taxonomia-sst/actions.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add 'app/(app)/admin/taxonomia-sst' lib/services/prevention-documents/taxonomy.ts
git commit -m "feat(admin): manage SST document taxonomy"
```

---

## Task 5: Product Auxiliary Catalogs

**Files:**

- Modify: `db/schema/products.ts`
- Create: generated migration from Drizzle
- Create: `lib/validation/product-catalogs.ts`
- Create: `app/(app)/admin/catalogos-productos/page.tsx`
- Create: `app/(app)/admin/catalogos-productos/actions.ts`
- Create: `app/(app)/admin/catalogos-productos/product-unit-form.tsx`
- Create: `app/(app)/admin/catalogos-productos/attribute-template-form.tsx`
- Create: `app/(app)/admin/catalogos-productos/catalog-list.tsx`
- Create: `app/(app)/admin/catalogos-productos/actions.test.ts`

- [ ] **Step 1: Add schema tables**

Add to `db/schema/products.ts`:

```ts
export const productUnits = pgTable("product_units", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

export const productAttributeTemplates = pgTable("product_attribute_templates", {
  id: text("id").primaryKey(),
  categoryId: text("category_id").references(() => productCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  options: text("options"),
  isRequired: boolean("is_required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})
```

Add relations for both tables.

- [ ] **Step 2: Generate migration**

Run:

```bash
npm run db:generate
npm run db:generate
```

Expected after second run:

```text
No schema changes
```

- [ ] **Step 3: Write action tests**

Cover:

- create/update/deactivate unit
- create/update/deactivate attribute template
- reject invalid attribute type outside `text`, `select`, `number`
- validate select options as newline-separated values converted to JSON array string

- [ ] **Step 4: Add validation**

`lib/validation/product-catalogs.ts`:

```ts
import { z } from "zod"

const optionalText = z.string().trim().optional().transform((v) => v || undefined)

export const productUnitSchema = z.object({
  id: optionalText,
  code: z.string().trim().min(1, "Ingresa un código").max(24),
  label: z.string().trim().min(1, "Ingresa una etiqueta").max(80),
  description: optionalText,
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.coerce.boolean().default(true),
})

export const attributeTemplateSchema = z.object({
  id: optionalText,
  categoryId: optionalText,
  name: z.string().trim().min(1, "Ingresa un nombre").max(80),
  type: z.enum(["text", "select", "number"]),
  optionsText: optionalText,
  isRequired: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.coerce.boolean().default(true),
})
```

- [ ] **Step 5: Implement UI**

Page tabs:

- `Unidades`
- `Atributos reutilizables`

The units tab must show current plain-text units in products as a helper list so admins can normalize the catalog.

- [ ] **Step 6: Integrate unit catalog into product form**

Modify `app/(app)/admin/productos/product-form.tsx` and `page.tsx` to pass active units.

Keep compatibility:

- existing `unitOfMeasure` remains text in `products`
- selected unit writes its `code` into `unitOfMeasure`
- if an existing product has a unit not in `productUnits`, show it as a disabled legacy option labeled `Actual: <value>`

- [ ] **Step 7: Verify**

```bash
npx eslint db/schema/products.ts lib/validation/product-catalogs.ts 'app/(app)/admin/catalogos-productos' 'app/(app)/admin/productos'
npm test -- 'app/(app)/admin/catalogos-productos/actions.test.ts'
npm run db:generate
```

Expected:

```text
0 problems
PASS app/(app)/admin/catalogos-productos/actions.test.ts
No schema changes
```

- [ ] **Step 8: Commit**

```bash
git add db/schema/products.ts db/migrations lib/validation/product-catalogs.ts 'app/(app)/admin/catalogos-productos' 'app/(app)/admin/productos'
git commit -m "feat(admin): add product auxiliary catalogs"
```

---

## Task 6: Security And Rate-Limit Administration

**Files:**

- Create: `app/(app)/admin/seguridad/page.tsx`
- Create: `app/(app)/admin/seguridad/actions.ts`
- Create: `app/(app)/admin/seguridad/rate-limit-list.tsx`
- Create: `app/(app)/admin/seguridad/actions.test.ts`
- Modify: `lib/services/rate-limit.ts`
- Use existing schema: `db/schema/rate-limits.ts`

- [ ] **Step 1: Add service functions**

Add to `lib/services/rate-limit.ts`:

```ts
export async function listRateLimitRecords() {
  return db.query.rateLimits.findMany({
    orderBy: [desc(rateLimits.updatedAt)],
    limit: 500,
  })
}

export async function clearRateLimitRecord(key: string) {
  await db.delete(rateLimits).where(eq(rateLimits.key, key))
}
```

If imports are missing, add `desc` and `eq` from `drizzle-orm`.

- [ ] **Step 2: Write tests**

Cover:

- listing requires `admin:security`
- clearing one key requires `admin:security`
- clearing all expired locks requires `admin:security`
- action audits `entityType: "rate_limit"`

- [ ] **Step 3: Implement page**

Page should show:

- key
- failed count
- successful telemetry count
- lock status
- lock-until as local date
- updatedAt
- action: clear key

Do not expose raw IP-only sorting as a special user-facing category; show the key exactly because existing keys may include `ip:` or `email:`.

- [ ] **Step 4: Verify**

```bash
npx eslint 'app/(app)/admin/seguridad' lib/services/rate-limit.ts
npm test -- 'app/(app)/admin/seguridad/actions.test.ts' lib/__tests__/rate-limit-concurrency-postgres.test.ts
```

Expected:

```text
0 problems
PASS app/(app)/admin/seguridad/actions.test.ts
```

The Postgres concurrency test may skip if its environment gate is disabled; record the actual output in the implementation summary.

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/admin/seguridad' lib/services/rate-limit.ts
git commit -m "feat(admin): manage security lockouts"
```

---

## Task 7: Folios And Code Sequences

**Files:**

- Create: `app/(app)/admin/folios/page.tsx`
- Create: `app/(app)/admin/folios/actions.ts`
- Create: `app/(app)/admin/folios/sequence-list.tsx`
- Create: `app/(app)/admin/folios/actions.test.ts`
- Modify: `lib/code-sequences.ts`
- Use existing schema: `db/schema/code-sequences.ts`

- [ ] **Step 1: Add read/correction service**

Add functions:

```ts
export async function listCodeSequences() {
  return db.query.codeSequences.findMany({
    orderBy: [codeSequences.prefix, codeSequences.year],
  })
}

export async function setCodeSequenceNextValue(input: {
  prefix: string
  year: number
  nextValue: number
}) {
  if (input.nextValue < 1) throw new Error("El siguiente folio debe ser mayor o igual a 1")
  const now = new Date().toISOString()
  await db.insert(codeSequences).values({
    prefix: input.prefix,
    year: input.year,
    nextValue: input.nextValue,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [codeSequences.prefix, codeSequences.year],
    set: { nextValue: input.nextValue, updatedAt: now },
  })
}
```

- [ ] **Step 2: Write tests**

Cover:

- list requires `admin:folios`
- correction requires `admin:folios`
- rejects `nextValue < 1`
- audits before and after values

- [ ] **Step 3: Implement UI**

Page should be conservative:

- show current prefix/year/nextValue
- correction action opens confirmation dialog
- require typed confirmation equal to `<prefix>-<year>`
- show warning: "Usar solo para corregir desincronizaciones de folio; no modifica documentos ya emitidos."

- [ ] **Step 4: Verify**

```bash
npx eslint 'app/(app)/admin/folios' lib/code-sequences.ts
npm test -- 'app/(app)/admin/folios/actions.test.ts'
```

Expected:

```text
0 problems
PASS app/(app)/admin/folios/actions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/admin/folios' lib/code-sequences.ts
git commit -m "feat(admin): add folio sequence diagnostics"
```

---

## Task 8: Operational Parameters

**Files:**

- Create: `app/(app)/admin/parametros-operativos/page.tsx`
- Create: `app/(app)/admin/parametros-operativos/actions.ts`
- Create: `app/(app)/admin/parametros-operativos/ops-settings-form.tsx`
- Create: `app/(app)/admin/parametros-operativos/actions.test.ts`
- Modify: `lib/services/system-settings.ts`
- Use existing schema: `db/schema/system-settings.ts`

- [ ] **Step 1: Define setting keys**

Add keys to `lib/services/system-settings.ts`:

```ts
export const OPS_SETTING_KEYS = {
  exportMaxRows: "ops.export.max_rows",
  notificationRetentionDays: "ops.notifications.retention_days",
  feedbackAttachmentMaxMb: "ops.feedback.attachment_max_mb",
  pdtpEvidenceMaxMb: "ops.pdtp.evidence_max_mb",
  pdtpEvidenceRetentionDays: "ops.pdtp.evidence_retention_days",
} as const
```

Defaults:

```ts
export const DEFAULT_OPS_SETTINGS = {
  exportMaxRows: 10000,
  notificationRetentionDays: 90,
  feedbackAttachmentMaxMb: 20,
  pdtpEvidenceMaxMb: 25,
  pdtpEvidenceRetentionDays: 365,
}
```

- [ ] **Step 2: Add typed getters**

Add:

```ts
export async function getOperationalSettings() { /* returns defaults merged with persisted values */ }
export async function updateOperationalSettings(input: unknown, actor: AuditActor) { /* validates and writes keys */ }
```

Validation rules:

- `exportMaxRows`: integer 100 to 100000
- `notificationRetentionDays`: integer 7 to 3650
- `feedbackAttachmentMaxMb`: integer 1 to 100
- `pdtpEvidenceMaxMb`: integer 1 to 100
- `pdtpEvidenceRetentionDays`: integer 30 to 3650

- [ ] **Step 3: Write tests**

Cover defaults, invalid values, persistence, and audit.

- [ ] **Step 4: Implement page**

Page sections:

- Exportaciones
- Notificaciones
- Adjuntos de soporte
- Evidencias PDTP

Do not move the existing company-profile settings from `/admin/configuracion`.

- [ ] **Step 5: Wire settings into consumers in a follow-up task**

After the admin page exists, replace hard-coded constants in:

- `app/api/reportes/export/route.ts`
- `app/api/trazabilidad/export/route.ts`
- `app/api/bodega/stock/export/route.ts`
- `app/api/bodega/kardex/export/route.ts`
- `app/(app)/soporte/actions.ts`
- `app/api/prevencion/pdtp/evidence/route.ts`
- `lib/services/notification-read.ts`

Each replacement should call the typed getter and preserve current defaults if settings are missing.

- [ ] **Step 6: Verify**

```bash
npx eslint 'app/(app)/admin/parametros-operativos' lib/services/system-settings.ts app/api/reportes/export/route.ts app/api/trazabilidad/export/route.ts app/api/bodega/stock/export/route.ts app/api/bodega/kardex/export/route.ts 'app/(app)/soporte/actions.ts' app/api/prevencion/pdtp/evidence/route.ts lib/services/notification-read.ts
npm test -- lib/__tests__/system-settings.test.ts 'app/(app)/admin/parametros-operativos/actions.test.ts'
```

Expected:

```text
0 problems
PASS lib/__tests__/system-settings.test.ts
PASS app/(app)/admin/parametros-operativos/actions.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add 'app/(app)/admin/parametros-operativos' lib/services/system-settings.ts app/api/reportes/export/route.ts app/api/trazabilidad/export/route.ts app/api/bodega/stock/export/route.ts app/api/bodega/kardex/export/route.ts 'app/(app)/soporte/actions.ts' app/api/prevencion/pdtp/evidence/route.ts lib/services/notification-read.ts
git commit -m "feat(admin): manage operational parameters"
```

---

## Task 9: PDTP Catalog Administration

**Files:**

- Create: `app/(app)/admin/pdtp-catalogos/page.tsx`
- Create: `app/(app)/admin/pdtp-catalogos/actions.ts`
- Create: `app/(app)/admin/pdtp-catalogos/responsible-form.tsx`
- Create: `app/(app)/admin/pdtp-catalogos/sheet-form.tsx`
- Create: `app/(app)/admin/pdtp-catalogos/catalog-tabs.tsx`
- Create: `app/(app)/admin/pdtp-catalogos/actions.test.ts`
- Modify or create: `lib/services/pdtp/admin-catalogs.ts`
- Use existing schema: `db/schema/prevention/pdtp.ts`

- [ ] **Step 1: Add PDTP admin service**

Service functions:

```ts
export async function listPdtpAdminCatalogs(programId?: string) { /* responsible catalog + sheets */ }
export async function upsertPdtpResponsible(input: PdtpResponsibleInput) { /* slug/displayName/roleName/kind/notes */ }
export async function upsertPdtpSheet(input: PdtpSheetInput) { /* code/programId/label/area/defaultScopeRoles */ }
```

Use `pdtpResponsibleCatalog` and `pdtpSheets`.

- [ ] **Step 2: Write tests**

Cover:

- responsible create/update
- sheet create/update
- `defaultScopeRoles` JSON parsing from selected role slugs
- require `admin:pdtp_catalog`
- audit entity types `pdtp_responsible` and `pdtp_sheet`

- [ ] **Step 3: Implement UI**

Tabs:

- `Responsables`
- `Hojas del programa`
- `Programas activos`

The `Programas activos` tab is read-only and links to existing `/prevencion/pdtp/[programId]` and edit pages when permissions allow.

- [ ] **Step 4: Verify**

```bash
npx eslint 'app/(app)/admin/pdtp-catalogos' lib/services/pdtp/admin-catalogs.ts
npm test -- 'app/(app)/admin/pdtp-catalogos/actions.test.ts' lib/__tests__/prevencion-pdtp-actions.test.ts
```

Expected:

```text
0 problems
PASS app/(app)/admin/pdtp-catalogos/actions.test.ts
PASS lib/__tests__/prevencion-pdtp-actions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/admin/pdtp-catalogos' lib/services/pdtp/admin-catalogs.ts
git commit -m "feat(admin): manage PDTP catalogs"
```

---

## Task 10: Fleet Catalog Administration

**Files:**

- Create: `app/(app)/admin/flota-catalogos/page.tsx`
- Create: `app/(app)/admin/flota-catalogos/catalog-links.tsx`
- Create: `app/(app)/admin/flota-catalogos/fleet-admin-settings.tsx`
- Create: `app/(app)/admin/flota-catalogos/actions.ts`
- Create: `app/(app)/admin/flota-catalogos/actions.test.ts`
- Modify: `app/(app)/combustibles/vehiculos/page.tsx`
- Modify: `app/(app)/combustibles/proveedores-combustible/page.tsx`
- Modify: `app/(app)/flota/page.tsx`
- Modify: `app/(app)/mantenciones/page.tsx`

- [ ] **Step 1: Create admin hub instead of duplicating existing CRUD**

`/admin/flota-catalogos` should link to existing operational CRUD:

- `/combustibles/vehiculos`
- `/combustibles/proveedores-combustible`
- `/flota`
- `/mantenciones`

This avoids duplicating vehicle and supplier forms that already exist.

- [ ] **Step 2: Add administrative context back-links**

On the existing pages, add breadcrumb items that can originate from Admin when `?from=admin` is present:

```ts
const fromAdmin = searchParams.from === "admin"
const breadcrumb = fromAdmin
  ? [{ label: "Administración", href: "/admin" }, { label: "Catálogos de flota", href: "/admin/flota-catalogos" }, { label: "Vehículos" }]
  : [{ label: "Combustibles", href: "/combustibles" }, { label: "Vehículos" }]
```

- [ ] **Step 3: Add small settings section**

Store these keys through `system_settings`:

- `fleet.document.warning_days` default `30`
- `fleet.default_vehicle_status` default `operativo`

Actions require `admin:fleet_catalog` and audit `entityType: "fleet_admin_setting"`.

- [ ] **Step 4: Verify**

```bash
npx eslint 'app/(app)/admin/flota-catalogos' 'app/(app)/combustibles/vehiculos/page.tsx' 'app/(app)/combustibles/proveedores-combustible/page.tsx' 'app/(app)/flota/page.tsx' 'app/(app)/mantenciones/page.tsx'
npm test -- 'app/(app)/admin/flota-catalogos/actions.test.ts' 'app/(app)/combustibles/actions-vehicles.test.ts' 'app/(app)/mantenciones/actions.test.ts'
```

Expected:

```text
0 problems
PASS app/(app)/admin/flota-catalogos/actions.test.ts
PASS app/(app)/combustibles/actions-vehicles.test.ts
PASS app/(app)/mantenciones/actions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/admin/flota-catalogos' 'app/(app)/combustibles/vehiculos/page.tsx' 'app/(app)/combustibles/proveedores-combustible/page.tsx' 'app/(app)/flota/page.tsx' 'app/(app)/mantenciones/page.tsx'
git commit -m "feat(admin): centralize fleet catalogs"
```

---

## Task 11: Notifications Maintenance

**Files:**

- Create: `app/(app)/admin/notificaciones/page.tsx`
- Create: `app/(app)/admin/notificaciones/actions.ts`
- Create: `app/(app)/admin/notificaciones/notification-admin-list.tsx`
- Create: `app/(app)/admin/notificaciones/actions.test.ts`
- Modify: `lib/services/notification-read.ts`
- Use existing schema: `db/schema/audit.ts`

- [ ] **Step 1: Add admin notification services**

Add:

```ts
export async function listNotificationsForAdmin(filters: {
  userId?: string
  isRead?: boolean
  limit?: number
}) { /* latest 500 with user relation */ }

export async function deleteReadNotificationsOlderThan(days: number) {
  return cleanupOldNotifications(days)
}
```

- [ ] **Step 2: Write tests**

Cover:

- listing requires `admin:notifications`
- cleanup requires `admin:notifications`
- cleanup uses retention days from `getOperationalSettings()`
- audit `entityType: "notification"`

- [ ] **Step 3: Implement UI**

Page should show:

- unread count
- total recent count
- oldest read notification date
- table of latest notifications
- action to clean read notifications older than configured retention

Do not allow deleting unread notifications from the admin page.

- [ ] **Step 4: Verify**

```bash
npx eslint 'app/(app)/admin/notificaciones' lib/services/notification-read.ts
npm test -- 'app/(app)/admin/notificaciones/actions.test.ts' lib/__tests__/notification-service.test.ts
```

Expected:

```text
0 problems
PASS app/(app)/admin/notificaciones/actions.test.ts
PASS lib/__tests__/notification-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/admin/notificaciones' lib/services/notification-read.ts
git commit -m "feat(admin): add notification maintenance"
```

---

## Task 12: Polish, Documentation, And Full Verification

**Files:**

- Modify: `README.md` only if it currently lists admin capabilities
- Modify or create: `manual/administracion.md` if the manual tree contains admin user guidance
- Modify: root audit/report docs only if they mention the old admin scope

- [ ] **Step 1: Run route scan**

```bash
find 'app/(app)/admin' -maxdepth 2 -type f | sort
```

Expected new page folders:

```text
app/(app)/admin/catalogos-productos/...
app/(app)/admin/centros-costo/...
app/(app)/admin/flota-catalogos/...
app/(app)/admin/folios/...
app/(app)/admin/notificaciones/...
app/(app)/admin/parametros-operativos/...
app/(app)/admin/pdtp-catalogos/...
app/(app)/admin/roles/...
app/(app)/admin/seguridad/...
app/(app)/admin/taxonomia-sst/...
```

- [ ] **Step 2: Run focused admin lint**

```bash
npx eslint 'app/(app)/admin' modules/admin/manifest.ts lib/services/admin-roles.ts lib/validation/cost-centers.ts lib/validation/product-catalogs.ts
```

Expected:

```text
0 problems
```

- [ ] **Step 3: Run targeted tests**

```bash
npm test -- \
  'app/(app)/admin/centros-costo/actions.test.ts' \
  'app/(app)/admin/roles/actions.test.ts' \
  'app/(app)/admin/taxonomia-sst/actions.test.ts' \
  'app/(app)/admin/catalogos-productos/actions.test.ts' \
  'app/(app)/admin/seguridad/actions.test.ts' \
  'app/(app)/admin/folios/actions.test.ts' \
  'app/(app)/admin/parametros-operativos/actions.test.ts' \
  'app/(app)/admin/pdtp-catalogos/actions.test.ts' \
  'app/(app)/admin/flota-catalogos/actions.test.ts' \
  'app/(app)/admin/notificaciones/actions.test.ts'
```

Expected:

```text
PASS
```

- [ ] **Step 4: Run repo-level safety checks**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected:

```text
lint passes
typecheck passes
test suite passes
build succeeds
```

- [ ] **Step 5: Manual browser verification**

Start the app:

```bash
npm run dev
```

Verify as an admin user:

- `/admin` shows all new cards.
- `/admin/centros-costo` can create, edit, deactivate and reactivate a center.
- `/admin/roles` can create a non-global role and edit its permissions.
- `/admin/taxonomia-sst` can create a document category and type.
- `/admin/catalogos-productos` can create a unit and attribute template.
- `/admin/seguridad` can clear a synthetic lock.
- `/admin/folios` shows sequences and requires confirmation for correction.
- `/admin/parametros-operativos` persists values and preserves defaults.
- `/admin/pdtp-catalogos` shows responsables and sheets.
- `/admin/flota-catalogos` links to the existing vehicle/fuel/maintenance screens.
- `/admin/notificaciones` lists recent notifications and cleans only read old notifications.

- [ ] **Step 6: Commit final docs and polish**

```bash
git add README.md manual/administracion.md
git commit -m "docs(admin): document expanded administration panel"
```

Skip this commit if no documentation file required changes after checking live labels.

---

## Rollout Order

Implement in this order:

1. Task 1: permissions and landing cards
2. Task 2: centros de costo
3. Task 3: roles
4. Task 4: SST taxonomy
5. Task 6: security lockouts
6. Task 7: folios
7. Task 8: operational parameters
8. Task 11: notifications maintenance
9. Task 10: fleet admin hub
10. Task 9: PDTP catalogs
11. Task 5: product auxiliary catalogs
12. Task 12: final verification/docs

Reasoning:

- Centros de costo and roles are the highest operational/admin value.
- Security, folios, parameters and notifications are support surfaces with limited UI complexity.
- Fleet can reuse existing CRUD and should not duplicate forms.
- Product auxiliary catalogs is the only task requiring new schema and migration, so it should be isolated.

## Regression Risks

- Permission drift: adding `admin:*` permissions without bootstrap parity can hide routes from seeded roles.
- Faena scope leak: centros de costo and fleet catalogs must respect worksite scope for non-global admins.
- Duplicate admin/business routes: fleet catalog should link to existing operational pages instead of creating competing CRUD.
- Migration drift: product auxiliary catalogs must use generated Drizzle migration and second `npm run db:generate` must report no changes.
- Search duplication: new admin tables should rely on TopBar/DataTable search unless a page explicitly needs server-side search.
- Over-broad commits: keep each task committed independently to make rollback practical.

## Completion Criteria

The project is complete when:

- Every missing area listed in "Current State" has a visible `/admin` category or an intentional admin hub link.
- Every new category has a dedicated permission in `modules/admin/manifest.ts`.
- Every mutation is permission-gated, validated, audited and covered by targeted tests.
- Existing operational pages still work and no duplicate standalone search inputs were added.
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass or any unrelated pre-existing failures are documented with exact output.
