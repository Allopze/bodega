# Checklist de catálogos de administración

Checklist obligatorio para cualquier catálogo nuevo o migrado bajo `/admin`. Los
catálogos existentes (Faenas, Trabajadores, Proveedores, Centros de costo, Productos,
Vehículos, Proveedores de combustible, Taxonomía SST, PDTP) ya convergieron a este
contrato. Cualquier desviación debe documentarse como ADR.

## Vocabulario unificado

| Concepto | Término | Ejemplo |
|----------|---------|---------|
| Acción de creación | Nuevo/Nueva | Nuevo producto, Nueva faena |
| Acción de edición | Editar | Editar proveedor |
| Acción de guardado | Crear X / Guardar cambios | Crear trabajador, Guardar cambios |
| Acción de desactivación | Desactivar | Desactivar vehículo |
| Acción de reactivación | Reactivar (no "Activar" en UI de fila) | Reactivar proveedor |
| Estado activo | Activo/Activa | Badge success |
| Estado inactivo | Inactivo/Inactiva | Badge default |
| Lista vacía | Sin resultados / Aún no hay registros | — |
| Confirmación | ¿Desactivar X? + descripción de impacto | — |
| Error de permiso | Sin permisos | — |

## Patrón de listado

Cada catálogo debe cumplir:

- [ ] `PageContainer` como wrapper raíz
- [ ] `PageHeader` con `title`, `description`, `breadcrumb`
- [ ] `DataTable` como tabla principal (nunca `<Table>` plano)
- [ ] `searchKeys` declarados (conexión con TopBar automática)
- [ ] Columna Estado con `key: "isActive"` y `Badge` Activo/Inactivo
- [ ] Columna de acciones con `key: ""` (sin label) al final
- [ ] Botón Editar + toggle Activar/Desactivar por fila
- [ ] Botón "Nuevo X" en `DataTable.actions`
- [ ] `emptyTitle` y `emptyDescription` configurados
- [ ] `renderMobileCard` implementado (tarjeta adaptativa)
- [ ] `pageSize` definido (típicamente 20 o 50)
- [ ] Filtros de estado visibles (activo/inactivo/todos) si el volumen lo justifica

## Patrón de formulario

Cada formulario de mantenimiento debe cumplir:

- [ ] Usar `Sheet` + `SheetContent/Header/Body/Footer` (nunca `<Dialog>`)
- [ ] `useActionState` con acción `create`/`update` intercambiable
- [ ] `SheetTitle`: "Nuevo X" o "Editar X"
- [ ] `SheetCloseButton` en el header
- [ ] Campos en `SheetBody` con `FieldGroup`
- [ ] `SubmitButton` en `SheetFooter` con label dinámico
- [ ] Botón Cancelar + `onClose` en el footer
- [ ] Toast `success`/`error` al completar la acción
- [ ] Campo `id` oculto en modo edición (`<input type="hidden" name="id">`)
- [ ] Validación de campos requeridos con `Field.error`
- [ ] `Field.helper` para texto de ayuda en campos no obvios

## Ciclo de vida

Cada entidad maestra debe cumplir:

- [ ] Crear (server action `createXAction`)
- [ ] Editar (server action `updateXAction` o upsert unificado)
- [ ] Activar/desactivar reversible (`toggleXActiveAction`)
- [ ] `isActive` como columna `boolean NOT NULL DEFAULT true` en el esquema
- [ ] Desactivar conserva relaciones históricas
- [ ] Reactivar desde el mismo listado (sin pantalla separada)
- [ ] Sin borrado físico en el flujo normal
- [ ] Confirmación previa a desactivar si el cambio tiene impacto operativo

## Auditoría

Cada acción de mutación debe cumplir:

- [ ] `recordAudit` con `userId`, `userEmail`, `action`, `entityType`, `entityId`
- [ ] `oldState` y `newState` reflejan el estado real (leído de DB, no inferido)
- [ ] `requirePermission` antes de cualquier mutación
- [ ] `revalidatePath` después de mutar

## Permisos

- [ ] Cada catálogo tiene un permiso específico bajo `admin:` (ej. `admin:products`)
- [ ] La página de listado usa `requirePermission` que redirige a `/forbidden`
- [ ] Las acciones de servidor usan `requirePermission` que lanza error
- [ ] Los botones/acciones visibles filtran por `session.user.permissions`
- [ ] Los enlaces del hub `/admin` filtran por permiso real

## Componentes compartidos

Usar cuando sea posible, no duplicar:

| Componente | Ruta | Uso |
|------------|------|-----|
| `CatalogRowActions` | `components/admin/catalog-row-actions.tsx` | Botones Editar + toggle por fila |
| `CatalogFormSheet` | `components/admin/catalog-form-sheet.tsx` | Andamiaje Sheet + form + toast |
| `useCatalogSheet` | `components/admin/use-catalog-sheet.ts` | Hook de estado de sheet + toggle |
| `DataTable` | `components/admin/data-table.tsx` | Tabla con búsqueda, orden, paginación |
| `SubmitButton` | `components/admin/submit-button.tsx` | Botón de envío con loading |
| `Badge` | `components/ui/badge.tsx` | Estado Activo/Inactivo |
| `Field`, `FieldGroup` | `components/ui/field.tsx` | Campos de formulario |
| `PageHeader` | `components/ui/page-header.tsx` | Título, breadcrumb, acciones |
| `PageContainer` | `components/ui/page-container.tsx` | Contenedor con padding consistente |
| `ConfirmDialog` | `components/ui/confirm-dialog.tsx` | Confirmación pre-desactivación |

## Prueba de contrato

Cada catálogo registrado en `catalog-contract.test.ts` exporta `CONTRACT` con:
- [ ] `name: string` — nombre legible
- [ ] `columns: Column[]` — definición de columnas del DataTable
- [ ] `searchKeys: string[]` — campos buscables (no vacío)
- [ ] `hasMobileView: true`
- [ ] Columna `isActive` presente
- [ ] Columna de acciones presente (`key: ""`)
