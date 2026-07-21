# Auditoría de Consistencia UI — Componentes del Sistema de Diseño

**Fecha:** 2026-07-20  
**Alcance:** Toda la aplicación `app/` + `components/`

---

## Resumen ejecutivo

La plataforma cuenta con un **sistema de diseño basado en Radix UI** con componentes
personalizados consistentes (Dialog, Select, DropdownMenu, Popover, Sheet, etc.).
Sin embargo, la adopción de estos componentes es **parcial y fragmentada**:

- **Módulo Prevención** (el más extenso) usa `<select>` nativo del navegador en
  prácticamente todos sus formularios y diálogos, ignorando el `<Select>` de la
  plataforma.
- **Módulo Combustibles** también usa `<select className="control">` nativo en
  sus páginas de filtros.
- **3 archivos** instancian Radix primitives directamente sin pasar por los
  wrappers del design system, perdiendo animaciones y estilos estandarizados.
- **Dialog y Sheet** tienen animaciones sutilmente inconsistentes.

---

## 1. Inventario del sistema de diseño

### 1.1 Componentes personalizados (wrappers de Radix UI)

| Componente | Archivo | Base primitiva | Estado |
|---|---|---|---|
| `Button` | `components/ui/button.tsx` | `@radix-ui/react-slot` | ✅ |
| `Dialog` | `components/ui/dialog.tsx` | `@radix-ui/react-dialog` | ✅ |
| `Sheet` | `components/admin/sheet.tsx` | `@radix-ui/react-dialog` | ✅ |
| `Select` | `components/ui/select.tsx` | `@radix-ui/react-select` | ✅ |
| `DropdownMenu` | `components/ui/dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` | ✅ |
| `Popover` | `components/ui/popover.tsx` | `@radix-ui/react-popover` | ✅ |
| `Tooltip` | `components/ui/tooltip.tsx` | `@radix-ui/react-tooltip` | ✅ |
| `Tabs` | `components/ui/tabs.tsx` | `@radix-ui/react-tabs` | ✅ |
| `Avatar` | `components/ui/avatar.tsx` | `@radix-ui/react-avatar` | ✅ |
| `Field` | `components/ui/field.tsx` | `@radix-ui/react-label` | ✅ |
| `Switch` | `components/ui/switch.tsx` | (nativo con estilos) | ✅ |
| `Checkbox` | `components/ui/checkbox.tsx` | (nativo con estilos) | ✅ |
| `ConfirmDialog` | `components/ui/confirm-dialog.tsx` | Usa `Dialog` | ✅ |
| `CatalogFormSheet` | `components/admin/catalog-form-sheet.tsx` | Usa `Sheet` | ✅ |
| `ExportDialog` | `components/export-dialog.tsx` | Usa `Dialog` | ✅ |

### 1.2 Radix primitives usados directamente (sin wrapper)

| Archivo | Primitiva | ¿Debe migrar? |
|---|---|---|
| `components/layout/command-palette.tsx` | `@radix-ui/react-dialog` + `VisuallyHidden` | ⚠️ Sí |
| `components/layout/mobile-nav.tsx` | `@radix-ui/react-collapsible` | ❌ No (no hay wrapper) |
| `components/layout/nav-rows.tsx` | `@radix-ui/react-collapsible` | ❌ No (no hay wrapper) |
| `components/layout/desktop-nav-areas.tsx` | `@radix-ui/react-collapsible` + `Popover` | ⚠️ Popover sí |
| `components/layout/notification-bell.tsx` | `@radix-ui/react-popover` | ⚠️ Sí |

---

## 2. Uso de `<select>` nativo del navegador

### 2.1 Cómputo total

Se encontraron **~88 selects nativos** en la aplicación, distribuidos así:

| Módulo | Cantidad de `<select>` nativos |
|---|---|
| `prevencion/capacitacion/` | 14 |
| `prevencion/emergencias/` | 6 |
| `prevencion/inspecciones/` | 6 |
| `prevencion/cphs/` | 12 |
| `prevencion/permisos/` | 7 |
| `prevencion/higiene/` | 7 |
| `prevencion/epp-preventivo/` | 5 |
| `prevencion/requisitos-legales/` | 4 |
| `prevencion/pdtp/` | 3 |
| `prevencion/miper/` | 3 |
| `prevencion/gestion-cambio/` | 5 |
| `combustibles/bitacora/` | 12 |
| `combustibles/anomalias/` | 3 |
| `combustibles/sellos/` | 1 |
| `combustibles/ciclo/` | 1 |
| `combustibles/analisis/` | 2 |
| `combustibles/tae/` | 1 |
| `admin/backups/` | 1 |

### 2.2 Archivos específicos (prevención)

```
app/(app)/prevencion/capacitacion/catalogo/training-catalog.tsx         — 9 selects
app/(app)/prevencion/capacitacion/training-session-list.tsx             — 4 selects
app/(app)/prevencion/capacitacion/[sessionId]/session-detail.tsx        — 1 select
app/(app)/prevencion/emergencias/emergencias-dialogs.tsx                — 1 select
app/(app)/prevencion/emergencias/[planId]/plan-detail.tsx               — 5 selects
app/(app)/prevencion/inspecciones/inspection-run-list.tsx               — 3 selects
app/(app)/prevencion/inspecciones/catalogo/inspection-catalog.tsx       — 3 selects
app/(app)/prevencion/inspecciones/[runId]/inspection-run-detail.tsx     — 2 selects
app/(app)/prevencion/cphs/cphs-dialogs.tsx                              — 5 selects
app/(app)/prevencion/cphs/[committeeId]/committee-detail.tsx            — 7 selects
app/(app)/prevencion/permisos/permit-dialogs.tsx                        — 4 selects
app/(app)/prevencion/permisos/[permitId]/permit-detail.tsx              — 3 selects
app/(app)/prevencion/higiene/hygiene-dialogs.tsx                        — 5 selects
app/(app)/prevencion/higiene/grupos/[groupId]/group-detail.tsx          — 1 select
app/(app)/prevencion/higiene/programas/[programId]/program-detail.tsx   — 2 selects
app/(app)/prevencion/epp-preventivo/epp-dialogs.tsx                     — 5 selects
app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx— 4 selects
app/(app)/prevencion/pdtp/cobertura/pdtp-coverage-workbench.tsx         — 3 selects
app/(app)/prevencion/miper/miper-workbench.tsx                          — 3 selects
app/(app)/prevencion/gestion-cambio/change-dialogs.tsx                  — 3 selects
app/(app)/prevencion/gestion-cambio/[changeId]/change-detail.tsx        — 2 selects
```

### 2.3 Archivos específicos (combustibles)

```
app/(app)/combustibles/bitacora/page.tsx                                — 12 selects
app/(app)/combustibles/anomalias/page.tsx                               — 3 selects
app/(app)/combustibles/analisis/page.tsx                                — 2 selects
app/(app)/combustibles/sellos/page.tsx                                  — 1 select
app/(app)/combustibles/ciclo/page.tsx                                   — 1 select
app/(app)/combustibles/tae/importar/tae-import-report-form.tsx          — 1 select
```

### 2.4 Archivos específicos (otros)

```
app/(app)/admin/backups/sa-health-section.tsx                           — 1 select
```

---

## 3. Análisis de consistencia por tipo de componente

### 3.1 Diálogos / Modales (`Dialog`)

**✅ Bueno:** El `Dialog` custom se usa en toda la app de forma consistente:
`ConfirmDialog`, `ExportDialog`, `PublicFormQrDialog`, `CatalogFormSheet`,
y la mayoría de las páginas importan `@/components/ui/dialog`.

**⚠️ Problemas:**

| Archivo | Problema |
|---|---|
| `components/layout/command-palette.tsx` | Usa `@radix-ui/react-dialog` directamente en vez del `Dialog` de la plataforma. Se pierden animaciones estandarizadas y estilos consistentes. |
| `app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx` | Diálogos inline con `<select>` nativo en su interior en vez del `Select` de la plataforma. Mezcla Radix Dialog + `<select>` nativo. |
| `app/(app)/prevencion/pdtp/cobertura/pdtp-coverage-workbench.tsx` | Mismo patrón: Dialog inline con `<select>` nativo y estilos hardcodeados. |
| `app/(app)/prevencion/miper/miper-workbench.tsx` | Mismo patrón. |

### 3.2 Sheet vs Dialog

Ambos usan `@radix-ui/react-dialog` como base, pero:

| Aspecto | `Dialog` | `Sheet` |
|---|---|---|
| Animación entrada | `duration-[var(--duration-default)]` | `duration-200` |
| Overlay | ✅ `backdrop-blur-sm` | ❌ Sin blur |
| Padding | `p-6` | Header/Body/Footer con padding propio |
| Estructura | Layout libre | Header + Body(scrollable) + Footer |

**Impacto:** menor, pero rompe la consistencia perceptual. El usuario ve dos tipos
de animaciones de "modal" en la misma app.

### 3.3 Select vs `<select>` nativo

| Aspecto | `<Select>` (Radix) | `<select>` nativo |
|---|---|---|
| Apariencia | Consistente (usa CSS vars) | Varía por navegador/SO |
| Búsqueda | ✅ Sí (input de búsqueda integrado) | ❌ No |
| Animación | ✅ Zoom + fade (300ms) | ❌ Ninguna |
| Accesibilidad ARIA | ✅ Built-in (role="listbox") | ✅ Nativo (limitado) |
| Flujo teclado | ↑↓ + Enter + Escape | ↑↓ + Enter + Escape |
| Scroll largo | ✅ Max-height + scroll | ✅ Nativo |
| Responsive móvil | ✅ Portal + popper | ✅ Nativo (formulario) |
| Personalización | ✅ Completa (CSS vars) | ⚠️ Limitada (`appearance: none`) |

### 3.4 Styling de selects nativos

Hay **3 estilos distintos** de `<select>` nativo:

```tsx
// Estilo 1: "control" (combustibles)
<select className="control">
// Clase corta, definida en algún CSS global (probablemente)

// Estilo 2: "selectClass" (prevención)
const selectClass = "h-10 rounded-md border border-[var(--color-border)] bg-transparent px-3 text-sm"
// Variable local copiada en cada archivo (al menos 15 archivos)

// Estilo 3: inline hardcodeado (requisitos-legales, pdtp, miper)
<select className="h-10 rounded-md border bg-transparent px-3">
// Sin border-[var(--color-border)] completa, mezcla colores
```

---

## 4. Inconsistencias encontradas (resumen)

### 🔴 Críticas

1. **88+ `<select>` nativos** en una plataforma que ya tiene un `<Select>` custom
   con búsqueda. El módulo Prevención es el que más aporta (~50 selects).
2. **command-palette.tsx** usa Radix raw en vez del wrapper `Dialog`.

### 🟡 Moderadas

3. **legal-requirements-workbench.tsx**, **pdtp-coverage-workbench.tsx** y
   **miper-workbench.tsx** mezclan Radix Dialog con `<select>` nativo inline.
4. `Sheet` y `Dialog` tienen animaciones con duraciones ligeramente diferentes.
5. **Estilo "control"** vs **estilo "selectClass"** — dos formas de estilar el
   mismo elemento nativo.
6. **notification-bell.tsx** y **desktop-nav-areas.tsx** usan Popover nativo
   de Radix sin pasar por el wrapper `components/ui/popover.tsx`.

### 🟢 Leves

7. `Sheet` no tiene `backdrop-blur-sm` a diferencia de `Dialog`.
8. Algunos selects nativos inline tienen estilos incompletos (sin
   `border-[var(--color-border)]` sino `border` a secas).

---

## 5. Recomendaciones

### Prioridad alta

1. **Migrar selects nativos de Prevención** al `<Select>` de la plataforma:
   - Daría búsqueda instantánea en listas largas (faenas, trabajadores, cursos).
   - Homogeneizaría la experiencia visual.
   - Archivos más impactados: `training-catalog.tsx`, `committee-detail.tsx`,
     `cphs-dialogs.tsx`, `permit-dialogs.tsx`, `plan-detail.tsx`.

2. **Migrar `command-palette.tsx`** a usar el `Dialog` de la plataforma.

### Prioridad media

3. **Estandarizar animaciones** entre `Dialog` y `Sheet`.
4. **Migrar `notification-bell.tsx`** a usar el `Popover` de la plataforma.
5. **Extraer `selectClass`** a una variable/constante global compartida, o
   mejor, migrar al `<Select>` de Radix.

### Prioridad baja

6. **Revisar `legal-requirements-workbench.tsx`, `pdtp-coverage-workbench.tsx`,
   `miper-workbench.tsx`** para que usen componentes del design system.
7. Agregar `backdrop-blur-sm` al overlay de `Sheet`.

---

## 6. Radix UI en package.json

```json
{
  "@radix-ui/react-avatar": "*",
  "@radix-ui/react-collapsible": "*",
  "@radix-ui/react-dialog": "*",
  "@radix-ui/react-dropdown-menu": "*",
  "@radix-ui/react-label": "*",
  "@radix-ui/react-popover": "*",
  "@radix-ui/react-select": "*",
  "@radix-ui/react-slot": "*",
  "@radix-ui/react-tabs": "*",
  "@radix-ui/react-tooltip": "*",
  "@radix-ui/react-visually-hidden": "*"
}
```

---

## 7. Metodología de auditoría

- Búsqueda con ripgrep de patrones `<select className=` en archivos `.tsx`.
- Búsqueda de `@radix-ui/` imports en `components/` y `app/`.
- Revisión manual de componentes en `components/ui/` y `components/admin/`.
- Fecha de auditoría: 2026-07-20.

---

_Documento generado automáticamente mediante auditoría de código._
