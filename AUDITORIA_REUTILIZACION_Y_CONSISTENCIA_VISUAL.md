# Auditoría de Reutilización, Estandarización y Consistencia Visual

**Proyecto:** Plataforma Chome — Bodega  
**Fecha:** 2026-07-23  
**Stack:** Next.js 16 · React 19 · Tailwind CSS 4 · Radix UI · Phosphor Icons · Drizzle ORM · PostgreSQL  
**Arquitectura:** App Router con Server Actions, ~1058 archivos `.tsx`/`.ts` en `app/` y `components/`  

---

## 1. Resumen Ejecutivo

### Estado general

La Plataforma Chome es una aplicación empresarial madura con **22 módulos funcionales** (`app/(app)/`), un sistema de diseño **en estado intermedio de consolidación** y una base de componentes UI razonablemente sólida (39 componentes en `components/ui/`). El proyecto ha crecido rápidamente —particularmente el módulo de Prevención con ~15 submódulos— y este crecimiento acelerado ha producido patrones de duplicación significativos, aunque no críticos.

### Nivel de consistencia visual: **7/10**

El proyecto tiene un sistema de tokens bien definido (`globals.css`), una paleta de colores coherente basada en oklch, y componentes UI base que usan estos tokens consistentemente. Sin embargo, la consistencia se degrada en los módulos de dominio donde se repiten patrones sin usar las abstracciones centralizadas.

### Nivel de reutilización: **6/10**

Los componentes base (`Button`, `Badge`, `Input`, `Select`, `Dialog`, `Sheet`, `Table`, `DataTable`, `EmptyState`, `Skeleton`) están bien diseñados y se reutilizan extensamente. El problema principal es la duplicación de **patrones intermedios**: form-kits, export buttons, lógica de operaciones asíncronas, y filtros ad-hoc que se reimplementan en cada módulo.

### Nivel de estandarización: **6.5/10**

Existen convenciones documentadas (`AGENTS.md`, `DESIGN.md`, `STYLING.md`) que cubren layout, búsqueda y densidad de pantalla. Estas se respetan en la mayoría de módulos recientes, pero los módulos más antiguos o de crecimiento rápido (prevención, combustibles) tienen desviaciones.

### Principales riesgos

1. **8 copias idénticas de `form-kit.tsx`** en prevención — cambiar el patrón de operación requiere editar 8 archivos.
2. **~9 export buttons** con lógica similar pero implementaciones divergentes — algunos usan `ExportDialog`, otros son botones directos, otros usan server actions con base64.
3. **~35 archivos** usan `toLocaleDateString` en lugar de las utilidades centralizadas `formatDate`/`formatDateTime`.
4. **Dos módulos casi idénticos** (`servicios` y `repuestos`) con `quotation-panel.tsx` duplicado (diferencia: 10 líneas de 310).
5. **FilterToolbar existe pero solo se usa en 2 de ~15 módulos con filtros**.

### Principales oportunidades

1. Consolidar `form-kit` → un único `useOperation` hook en `lib/hooks/`.
2. Unificar export buttons en un patrón estándar basado en `ExportDialog`.
3. Migrar `toLocaleDateString` → `formatDate`/`formatDateTime` centralizados.
4. Adoptar `FilterToolbar` en todos los módulos con filtros estructurados.
5. Fusionar `servicios/quotation-panel.tsx` y `repuestos/quotation-panel.tsx`.

### Conclusión sobre mantenibilidad

El proyecto está en un punto de inflexión saludable: la infraestructura de diseño es sólida y las convenciones están documentadas, pero la velocidad de desarrollo ha superado la disciplina de reutilización en áreas específicas. La deuda técnica es **manejable y localizada**, no sistémica. Una inversión de 2-3 sprints de consolidación reduciría significativamente el costo de mantenimiento futuro.

---

## 2. Calificación General

| Dimensión | Nota | Justificación |
|---|---:|---|
| Reutilización de componentes | 6 | Buenos componentes base, pero patrones intermedios duplicados en módulos de dominio |
| Estandarización | 6.5 | Convenciones documentadas y respetadas parcialmente; form-kits y exports no estandarizados |
| Consistencia visual | 7 | Tokens oklch bien definidos, tipografía con utilidades, pero `toLocaleDateString` vs `formatDate` en fechas |
| Experiencia de usuario | 7 | Patrones UX coherentes (PageHeader, DataTable, EmptyState, ConfirmDialog), estados vacíos con CTA |
| Accesibilidad | 6.5 | Focus rings, sr-only labels, aria-sort en tablas; falta ARIA en filtros ad-hoc y algunos tooltips |
| Responsive | 7 | DataTable con `renderMobileCard`, shell adaptativa, pero tablas raw sin adaptación móvil |
| Mantenibilidad | 6 | Buena separación de concerns (lib/services, lib/validation, app/actions), penalizada por duplicación |
| Arquitectura frontend | 7.5 | App Router bien estructurado, Server Actions consistentes, ShellHeaderContext elegante |
| Coherencia general | 6.5 | Sólida en la base, frágil en los bordes de cada módulo |

### **Nota global: 6.7 / 10**

El proyecto tiene una base arquitectónica sólida y un sistema de diseño emergente bien pensado. La nota refleja que la infraestructura es buena (tokens, componentes base, convenciones) pero la adopción es incompleta, con duplicación significativa en la capa de módulos de dominio.

---

## 3. Mapa de Componentes y Patrones

| Patrón o componente | Implementaciones encontradas | Ubicaciones | Estado | Acción recomendada |
|---|---:|---|---|---|
| Button | 1 | `components/ui/button.tsx` | Correctamente reutilizado | Conservar |
| Badge | 1 | `components/ui/badge.tsx` | Correctamente reutilizado | Conservar |
| StateBadge | 1 | `components/states/state-badge.tsx` | Correctamente reutilizado | Conservar |
| Input | 1 | `components/ui/input.tsx` | Correctamente reutilizado | Conservar |
| Select | 1 | `components/ui/select.tsx` (con searchable) | Correctamente reutilizado | Conservar |
| Field / Label | 1 + 8 duplicados | `components/ui/field.tsx` + 8× `form-kit.tsx` | Duplicado | Eliminar form-kits, usar Field de ui/ |
| Dialog | 1 | `components/ui/dialog.tsx` | Correctamente reutilizado | Conservar |
| Sheet | 1 | `components/admin/sheet.tsx` | Correctamente reutilizado | Conservar |
| ConfirmDialog | 1 | `components/ui/confirm-dialog.tsx` | Correctamente reutilizado (~20 usos) | Conservar |
| DataTable | 1 | `components/admin/data-table.tsx` | Reutilización parcial | Ampliar adopción (ver hallazgo) |
| Table (raw) | 1 | `components/ui/table.tsx` | Reutilización parcial | Migrar más tablas a DataTable |
| EmptyState | 1 | `components/ui/empty-state.tsx` | Correctamente reutilizado | Conservar |
| Skeleton / SkeletonRow | 1 | `components/ui/skeleton.tsx` | Correctamente reutilizado | Conservar |
| Pagination | 1 | `components/ui/pagination.tsx` | Correctamente reutilizado | Conservar |
| ServerPagination | 1 | `components/ui/server-pagination.tsx` | Reutilización parcial | Evaluar consolidación con Pagination |
| PageHeader | 1 | `components/ui/page-header.tsx` | Correctamente reutilizado | Conservar |
| PageContainer | 1 | `components/ui/page-container.tsx` | Correctamente reutilizado | Conservar |
| FilterToolbar | 1 | `components/ui/filter-toolbar.tsx` | Infrautilizado (2 usos) | Ampliar adopción |
| SummaryBar | 1 | `components/ui/summary-bar.tsx` | Correctamente reutilizado | Conservar |
| HeaderSignals | 1 | `components/ui/header-signals.tsx` | Correctamente reutilizado | Conservar |
| DatePicker | 1 | `components/ui/date-picker.tsx` | Correctamente reutilizado | Conservar |
| DateRangePicker | 1 | `components/ui/date-range-picker.tsx` | Correctamente reutilizado | Conservar |
| Tooltip | 1 | `components/ui/tooltip.tsx` | Reutilización parcial | Conservar |
| ExportDialog | 1 | `components/export-dialog.tsx` | Reutilización parcial | Ampliar adopción |
| Export Button | 9+ | 9 archivos distintos en app/ | Duplicado | Consolidar en 1-2 patrones |
| Form-kit (useOperation) | 8 | 8× `*-form-kit.tsx` en prevención | Duplicado | Extraer a `lib/hooks/use-operation.ts` |
| QuotationPanel | 2 | `servicios/` y `repuestos/` | Duplicado | Fusionar con prop de tipo |
| Formateo de fechas | 2 patrones | `formatDate` vs `toLocaleDateString` | Inconsistente | Migrar todo a `formatDate`/`formatDateTime` |
| Iconografía | 1 librería | Phosphor Icons exclusivamente | Correctamente reutilizado | Conservar |
| Toast | 1 | `lib/toast.ts` (wrapper sobre sonner) | Correctamente reutilizado | Conservar |
| Loading states | 2 patrones | `loading.tsx` (Next.js) + `SkeletonPage` | Reutilización parcial | Estandarizar loading.tsx |
| useUrlFilters | 1 | `lib/hooks/use-url-filters.ts` | Reutilización parcial | Ampliar adopción |
| WorksiteSelect | 1 | `components/ui/worksite-select.tsx` | Correctamente reutilizado | Conservar |
| Tabs | 1 | `components/ui/tabs.tsx` | Correctamente reutilizado | Conservar |
| SegmentedControl | 1 | `components/ui/segmented-control.tsx` | Reutilización parcial | Conservar |
| Card | 1 | `components/ui/card.tsx` | Correctamente reutilizado | Conservar |
| OnboardingHint | 2 | `components/ui/` + `components/adquisiciones/` (re-export) | Reutilización parcial | Eliminar re-export innecesario |
| FileDropzone | 1 | `components/ui/file-dropzone.tsx` | Correctamente reutilizado | Conservar |
| SignaturePad | 1 | `components/ui/signature-pad.tsx` | Correctamente reutilizado | Conservar |
| SubmitButton | 1 | `components/admin/submit-button.tsx` | Reutilización parcial | Evaluar si Button loading es suficiente |

---

## 4. Hallazgos Críticos y de Alta Prioridad

### H-01: 8 copias idénticas de form-kit.tsx

**Severidad:** Alta  
**Categoría:** Lógica duplicada / Reutilización  

**Ubicación:**
- `app/(app)/prevencion/capacitacion/form-kit.tsx`
- `app/(app)/prevencion/cphs/cphs-form-kit.tsx`
- `app/(app)/prevencion/emergencias/emergencias-form-kit.tsx`
- `app/(app)/prevencion/epp-preventivo/epp-form-kit.tsx`
- `app/(app)/prevencion/gestion-cambio/change-form-kit.tsx`
- `app/(app)/prevencion/higiene/hygiene-form-kit.tsx`
- `app/(app)/prevencion/inspecciones/inspection-form-kit.tsx`
- `app/(app)/prevencion/permisos/permit-form-kit.tsx`

**Evidencia:**  
Los 8 archivos contienen código **idéntico** (34-47 líneas cada uno). Exportan:
- `useOperation()` — hook que envuelve `useTransition` + mensaje de resultado
- `Field` — componente label+children+hint (duplica `components/ui/field.tsx`)
- `toLocalInputValue` — formatea Date para `datetime-local`

La única diferencia entre ellos es el comentario JSDoc que menciona el nombre del módulo ("capacitación", "CPHS", etc.).

**Comparación:**  
```tsx
// form-kit.tsx (capacitación) — IDÉNTICO a cphs-form-kit.tsx
export function useOperation() {
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState("")
  function run(operation: () => Promise<Result>, onSuccess?: () => void) {
    setMessage("")
    startTransition(async () => {
      const result = await operation()
      setMessage(result.ok ? "Guardado correctamente." : result.message ?? "No se pudo completar la acción.")
      if (result.ok) onSuccess?.()
    })
  }
  return { pending, message, run }
}
```

Además, el `Field` local **compite** con `components/ui/field.tsx` que es más completo (tiene `error`, `required`, `aria-describedby`, `aria-invalid`).

**Impacto:**
- Mantenibilidad: cambiar el patrón de feedback requiere editar 8 archivos.
- Riesgo: si se mejora `Field` en `ui/`, las 8 copias quedan desactualizadas.
- Accesibilidad: el `Field` local carece de `aria-describedby` y `aria-invalid`.

**Causa probable:**  
Cada submódulo de prevención se desarrolló como unidad independiente, copiando el "kit de formulario" del primero.

**Solución recomendada:**

1. Extraer `useOperation` a `lib/hooks/use-operation.ts`.
2. Extraer `toLocalInputValue` a `lib/utils.ts`.
3. Reemplazar los 8 `Field` locales por el `Field` de `components/ui/field.tsx`.
4. Eliminar los 8 archivos `*-form-kit.tsx`.
5. Actualizar las ~15 importaciones en los módulos de prevención.

**Ejemplo de implementación:**

```tsx
// lib/hooks/use-operation.ts
"use client"
import * as React from "react"

type Result = { ok: boolean; message?: string }

export function useOperation() {
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState("")
  function run(operation: () => Promise<Result>, onSuccess?: () => void) {
    setMessage("")
    startTransition(async () => {
      const result = await operation()
      setMessage(result.ok ? "Guardado correctamente." : result.message ?? "No se pudo completar la acción.")
      if (result.ok) onSuccess?.()
    })
  }
  return { pending, message, run }
}

// lib/utils.ts (añadir)
export function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
```

**Prioridad:** Inmediatamente  
**Esfuerzo:** Bajo (refactor mecánico)

---

### H-02: QuotationPanel duplicado entre servicios y repuestos

**Severidad:** Alta  
**Categoría:** Reutilización / Mantenibilidad  

**Ubicación:**
- `app/(app)/servicios/quotation-panel.tsx` (~310 líneas)
- `app/(app)/repuestos/quotation-panel.tsx` (~310 líneas)

**Evidencia:**  
`diff` muestra solo **10 líneas diferentes** de 310:
- Nombre del tipo (`ServiceQuotationRow` vs `QuotationRow`)
- Ruta del endpoint de descarga (`/api/servicios/cotizaciones/` vs `/api/repuestos/quotaciones/`)
- Textos de microcopy ("Servicios listos para orden de compra" vs "Ítems listos para orden de compra")
- Placeholder de textarea ("plazo de ejecución" vs "plazo de entrega")

El import de validación difiere (`lib/validation/servicios` vs `lib/validation/repuestos`), pero los esquemas son casi idénticos.

**Impacto:**
- Mantenibilidad: cualquier fix o mejora UX debe aplicarse en ambos archivos.
- Riesgo de divergencia: uno puede mejorar mientras el otro queda atrás.

**Causa probable:**  
El módulo de repuestos se creó copiando el de servicios con mínimas adaptaciones.

**Solución recomendada:**  
Crear un `QuotationPanel` genérico con props para:
- `entityType: "servicios" | "repuestos"`
- `downloadEndpoint: string`
- `labels: { approvedMessage, paymentPlaceholder, confirmMessage }`

**Prioridad:** Antes de producción  
**Esfuerzo:** Bajo

---

### H-03: ~9 Export Buttons con implementaciones divergentes

**Severidad:** Alta  
**Categoría:** Reutilización / Estandarización  

**Ubicación:**
- `components/export-dialog.tsx` — versión centralizada con filtros (Dialog)
- `components/prevention/export-button.tsx` — wrapper simple (anchor + Button)
- `app/(app)/combustibles/export-button.tsx` — server action + base64 download
- `app/(app)/bodega/stock-export-button.tsx`
- `app/(app)/bodega/kardex-export-button.tsx`
- `app/(app)/combustibles/bitacora/export-button.tsx`
- `app/(app)/combustibles/tae/tae-export-button.tsx`
- `app/(app)/combustibles/tae/conciliacion/export-button.tsx`
- `app/(app)/prevencion/ppa/ppa-export-button.tsx`
- `app/(app)/prevencion/indicadores/indicadores-export-button.tsx`
- `app/(app)/prevencion/indicadores-material-ambiental/material-environmental-export-button.tsx`

**Evidencia:**  
Se identifican **3 patrones de exportación** coexistentes:

| Patrón | Mecanismo | Archivos |
|---|---|---|
| A. `ExportDialog` | Abre dialog con filtros → `<a href download>` | `components/export-dialog.tsx` |
| B. Anchor directo | `<Button asChild><a href download>` | `components/prevention/export-button.tsx` |
| C. Server action + base64 | `await action()` → `document.createElement("a")` con data URL | `combustibles/export-button.tsx` y variantes |

El patrón C duplica la lógica de: `setLoading(true)` → `try/catch` → `toast.success/error` → `document.createElement("a").click()` en cada instancia.

**Impacto:**
- Experiencia de usuario inconsistente: algunos exports abren dialog de filtros, otros descargan directo.
- Mantenibilidad: cambios en el flujo de descarga (e.g., streaming en lugar de base64) requieren editar múltiples archivos.

**Solución recomendada:**

1. **Exports sin filtros**: Estandarizar en un `ExportButton` genérico con prop `action` (server action) que maneje loading/toast/download internamente.
2. **Exports con filtros**: Usar `ExportDialog` existente.
3. Eliminar las 9+ implementaciones ad-hoc.

**Ejemplo:**
```tsx
// components/ui/export-button.tsx
export function ExportButton({ action, label = "Exportar Excel", filters }: {
  action: (filters?: Record<string, string>) => Promise<{ ok: boolean; data?: { base64: string; filename: string; truncated?: boolean; rowLimit?: number }; message?: string }>
  label?: string
  filters?: Record<string, string | undefined>
}) {
  const [loading, setLoading] = useState(false)
  async function handleExport() {
    setLoading(true)
    try {
      const result = await action(filters)
      if (result.ok && result.data) {
        downloadBase64(result.data.base64, result.data.filename)
        if (result.data.truncated) toast.warning(`Límite de ${result.data.rowLimit?.toLocaleString("es-CL")} filas`)
        else toast.success("Archivo exportado")
      } else {
        toast.error(result.message ?? "Error al exportar")
      }
    } catch { toast.error("Error al exportar") }
    finally { setLoading(false) }
  }
  return (
    <Button variant="secondary" size="sm" onClick={handleExport} loading={loading}>
      <DownloadSimple size={14} className="mr-1" />
      {label}
    </Button>
  )
}
```

**Prioridad:** En el próximo ciclo  
**Esfuerzo:** Medio

---

### H-04: Formateo de fechas inconsistente

**Severidad:** Alta  
**Categoría:** Estandarización / Consistencia visual  

**Ubicación:**  
~35 archivos en `app/(app)/` usan `toLocaleDateString` directamente, mientras que ~90 archivos usan las funciones centralizadas `formatDate`/`formatDateTime` de `lib/utils.ts`.

**Evidencia:**  
Ejemplos de uso directo:
- `combustibles/tae/[id]/page.tsx`
- `prevencion/indicadores/indicadores-dashboard.tsx`
- `admin/suplencias/suplencias-client.tsx`
- `combustibles/sellos/page.tsx`
- `bodega/bodega-header-metrics.tsx`
- `admin/folios/sequence-list.tsx`
- ...y ~29 más

El problema no es solo estético: `toLocaleDateString` depende del locale del navegador del usuario, produciendo formatos como "7/23/2026" (en-US) o "23/7/2026" (es-CL) según configuración. `formatDate` siempre produce "23-07-2026" (DD-MM-YYYY).

**Impacto:**
- Coherencia visual: fechas con formato diferente en distintas pantallas.
- Internacionalización: formato dependiente del locale del navegador.
- Pruebas: comportamiento no determinista en tests.

**Solución recomendada:**  
Migración mecánica de `toLocaleDateString("es-CL", ...)` → `formatDate(...)` o `formatDateTime(...)`. Buscar y reemplazar con revisión manual de cada caso.

**Prioridad:** Antes de producción  
**Esfuerzo:** Bajo (búsqueda y reemplazo mecánico)

---

### H-05: FilterToolbar infrautilizado (2 de ~15 módulos)

**Severidad:** Alta  
**Categoría:** Reutilización / Estandarización  

**Ubicación:**  
`components/ui/filter-toolbar.tsx` existe y es un componente bien diseñado (chips removibles, "Más filtros" overflow sheet, contador de activos), pero solo se usa en:
- `app/(app)/flota/fleet-filters.tsx`
- `app/(app)/combustibles/fuel-filters.tsx`

Módulos que implementan filtros ad-hoc sin usar `FilterToolbar`:
- `prevencion/capacitacion/training-session-list.tsx` — filtros inline
- `prevencion/permisos/work-permit-list.tsx` — filtros inline
- `prevencion/inspecciones/inspection-run-list.tsx` — filtros inline
- `prevencion/emergencias/emergency-list.tsx` — filtros inline
- `prevencion/requisitos-legales/` — filtros inline
- `prevencion/higiene/` — filtros inline
- `admin/productos/product-list.tsx` — filtros inline
- `bodega/stock-table.tsx` — filtros inline
- Y varios más

**Impacto:**
- Inconsistencia UX: cada módulo implementa filtros con layout, espaciado y comportamiento diferentes.
- Violación de regla A2 (AGENTS.md): "Máximo 4-6 filtros primarios visibles, el resto en 'Más filtros'."

**Solución recomendada:**  
Migración gradual de filtros ad-hoc → `FilterToolbar` + `useUrlFilters`. Comenzar por los módulos más críticos (prevención capacitación, inspecciones, permisos).

**Prioridad:** En el próximo ciclo  
**Esfuerzo:** Medio (requiere refactor por módulo)

---

## 5. Hallazgos de Prioridad Media y Baja

### H-06: Tablas raw vs DataTable — adopción parcial

**Severidad:** Media  
**Categoría:** Reutilización  

**Evidencia:**  
Muchos módulos de prevención usan tablas raw (`Table`, `TableHead`, `TableBody`, `TableCell`) reconstruyendo manualmente la lógica de:
- Búsqueda/filtrado client-side
- Ordenamiento
- Paginación
- Estados vacíos y de carga

`DataTable` ya resuelve todo esto de forma estandarizada y se conecta automáticamente al TopBar search.

**Ubicación:** Múltiples archivos en `prevencion/capacitacion/`, `prevencion/cphs/`, `prevencion/emergencias/`, etc.

**Impacto:** Lógica de filtrado/paginación repetida, comportamiento inconsistente entre módulos.

**Solución:** Migrar tablas que cumplen el patrón lista-con-búsqueda a `DataTable`. No todas las tablas deben migrar — las tablas de detalle con layout específico (filas expandibles, agrupamiento) deben seguir usando `Table` raw.

**Prioridad:** Mejora futura  
**Esfuerzo:** Alto (requiere revisión por tabla)

---

### H-07: Pocas loading.tsx en rutas

**Severidad:** Media  
**Categoría:** Experiencia de usuario  

**Evidencia:**  
Con ~80+ páginas en `app/(app)/`, solo se encontraron pocas `loading.tsx`. Esto significa que la mayoría de navegaciones muestran un flash blanco o la pantalla anterior hasta que la nueva se renderiza completamente.

**Impacto:** Percepción de lentitud en navegaciones entre módulos.

**Solución:** Crear `loading.tsx` con `SkeletonPage` en las rutas principales. El componente ya existe en `components/ui/skeleton.tsx`.

**Prioridad:** En el próximo ciclo  
**Esfuerzo:** Bajo (archivo de 5 líneas por ruta)

---

### H-08: SubmitButton vs Button loading

**Severidad:** Baja  
**Categoría:** Reutilización  

**Ubicación:**
- `components/admin/submit-button.tsx` (7 líneas)
- `components/ui/button.tsx` (ya tiene prop `loading`)

**Evidencia:**  
`SubmitButton` es un thin wrapper que probablemente antecede a la adición de `loading` a `Button`. Ambos resuelven el mismo problema.

**Solución:** Evaluar si `SubmitButton` agrega valor; si no, deprecar a favor de `<Button type="submit" loading={...}>`.

**Prioridad:** Mejora futura  
**Esfuerzo:** Bajo

---

### H-09: OnboardingHint re-export innecesario

**Severidad:** Baja  
**Categoría:** Mantenibilidad  

**Ubicación:**
- `components/ui/onboarding-hint.tsx` (componente real)
- `components/adquisiciones/onboarding-hint.tsx` (91 bytes — re-export)

**Evidencia:**  
El archivo en `adquisiciones/` es solo `export { OnboardingHint } from "@/components/ui/onboarding-hint"`. Los consumidores deberían importar directamente de `ui/`.

**Prioridad:** Mejora futura  
**Esfuerzo:** Bajo

---

### H-10: Form Field local vs components/ui/field.tsx

**Severidad:** Media  
**Categoría:** Reutilización / Accesibilidad  

**Evidencia:**  
Los 8 form-kits de prevención exportan un `Field` simplificado:
```tsx
export function Field({ label, hint, children }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--color-text-subtle)]">{hint}</span>}
    </label>
  )
}
```

Mientras que `components/ui/field.tsx` tiene:
- `error` prop con `role="alert"`
- `required` indicator con asterisco
- `aria-describedby` automático
- `aria-invalid` automático
- `aria-labelledby` automático

**Impacto:** Los formularios de prevención carecen de mensajes de error accesibles y de indicadores de campo obligatorio.

**Solución:** Reemplazar por `Field` de `components/ui/field.tsx` al consolidar form-kits (H-01).

**Prioridad:** Inmediatamente (junto con H-01)  
**Esfuerzo:** Bajo

---

## 6. Componentes que Deberían Consolidarse

| Implementaciones actuales | Componente propuesto | Variantes necesarias | Archivos a migrar | Beneficio |
|---|---|---|---|---|
| 8× `*-form-kit.tsx` (useOperation + Field + toLocalInputValue) | `lib/hooks/use-operation.ts` + usar `Field` de ui/ + mover `toLocalInputValue` a `lib/utils.ts` | Ninguna — son idénticos | 8 form-kits + ~15 importadores | Elimina 320 líneas duplicadas, centraliza mejoras |
| 2× `quotation-panel.tsx` (servicios + repuestos) | `components/quotation-panel.tsx` genérico | `entityType: "servicios" \| "repuestos"`, labels de microcopy | 2 archivos | Elimina 300 líneas duplicadas |
| 9× export buttons | `ExportButton` (server action) + `ExportDialog` (con filtros) | `action` prop vs `endpoint` prop | 9 archivos | Unifica UX de exportación, centraliza manejo de errores |
| Filtros ad-hoc en ~13 módulos | Adopción de `FilterToolbar` existente | Ya soporta `children` + `overflowFilters` + chips | ~13 archivos de lista | Consistencia UX en filtros |

---

## 7. Componentes o Patrones que No Deben Unificarse

### Table raw vs DataTable

`Table` (components/ui/table.tsx) y `DataTable` (components/admin/data-table.tsx) resuelven problemas diferentes:

- **DataTable**: para listas homogéneas con búsqueda, ordenamiento y paginación automáticos. Ideal para: catálogos, listas de registros, logs.
- **Table raw**: para tablas de detalle con layout específico (celdas mergeadas, filas expandibles, subtotales, agrupamiento visual). Ideal para: detalle de OC, resumen de recepción, matrices de trazabilidad.

Unificarlos forzaría a `DataTable` a manejar casos demasiado complejos. **Mantener ambos** con guía clara sobre cuándo usar cada uno.

### SummaryBar vs HeaderSignals

Ambos muestran métricas compactas pero en contextos diferentes:

- **HeaderSignals**: señales accionables en el TopBar sticky (desktop). Solo `value > 0`.
- **SummaryBar**: banda editorial entre PageHeader y tabla. Muestra todos los valores incluyendo ceros.

Unificarlos degradaría la experiencia en ambos contextos.

### ExportDialog vs ExportButton

Deben coexistir:
- **ExportDialog**: cuando el usuario necesita filtrar antes de exportar (fecha, faena, estado).
- **ExportButton**: cuando el export usa los filtros ya aplicados en la página.

---

## 8. Inconsistencias Visuales

### Tipografía

| Hallazgo | Severidad | Detalle |
|---|---|---|
| Utilidades tipográficas bien definidas | ✅ | `text-h1`, `text-h2`, `text-h3`, `text-eyebrow`, `text-sub`, `text-display` en globals.css |
| Adopción extensa pero no total | Media | La mayoría de páginas usan las utilidades, pero algunas construyen estilos inline equivalentes |
| Fuentes consistentes | ✅ | Exo (display/headings) + Myriad Pro (body) + Geist Mono (datos) |
| Escala tipográfica documentada | ✅ | 7 niveles: `text-xs` (12px) a `text-3xl` (36px) |

### Colores

| Hallazgo | Severidad | Detalle |
|---|---|---|
| Sistema de tokens oklch completo | ✅ | Brand (esmeralda), Signal (naranja), Accent (amber), Info, Success, Warning, Danger + neutrales |
| Uso consistente de tokens | ✅ | Componentes base usan `var(--color-*)` en lugar de valores hardcoded |
| Sin colores arbitrarios en componentes base | ✅ | Button, Badge, Card, Dialog todos usan tokens |

### Espaciado y alineación

| Hallazgo | Severidad | Detalle |
|---|---|---|
| `PageContainer` estandariza padding | ✅ | `px-4 md:px-8 py-2 md:py-3` con 4 anchos (wide/form/workbench/full) |
| Espaciado entre secciones variado | Media | Se encuentran `gap-2`, `gap-3`, `gap-4`, `gap-6` sin criterio claro entre módulos |
| `FieldGroup` estandariza gap de formularios | ✅ | `gap-4` consistente |

### Botones y acciones

| Hallazgo | Severidad | Detalle |
|---|---|---|
| 6 variantes bien definidas | ✅ | primary, secondary, ghost, destructive, signal, link |
| 7 tamaños incluyendo mobile-friendly | ✅ | sm, default, lg, icon, icon-sm, icon-mobile, icon-mobile-sm |
| Touch targets correctos | ✅ | `icon-mobile` = 44×44px en mobile, 32×32px en desktop |
| Loading state integrado | ✅ | Prop `loading` con spinner y `aria-busy` |
| Press feedback | ✅ | `active:scale-[0.97]` |
| Orden de acciones consistente | ✅ | Cancelar (secondary) → Confirmar (primary) en DialogFooter/SheetFooter |

### Formularios

| Hallazgo | Severidad | Detalle |
|---|---|---|
| `Field` centralizado con accesibilidad | ✅ | aria-describedby, aria-invalid, error role="alert" |
| Input con estados error/disabled/readonly | ✅ | Estilos para focus, hover, disabled, readonly, error |
| `Select` con búsqueda integrada | ✅ | Prop `searchable` con filtrado client-side |
| 8× `Field` local sin accesibilidad | Alta | Los form-kits de prevención (ver H-01) |
| `useActionState` dominante (61 archivos) | ✅ | Patrón consistente para server actions |

### Tablas y listados

| Hallazgo | Severidad | Detalle |
|---|---|---|
| DataTable con SearchContext automático | ✅ | Se conecta al TopBar search via `useSafeShellHeader` |
| SkeletonRow para loading | ✅ | DataTable y tablas raw usan `SkeletonRow` |
| EmptyState integrado | ✅ | DataTable renderiza `EmptyState` automáticamente |
| Sort accesible con aria-sort | ✅ | DataTable implementa `aria-sort` y labels de ordenamiento |
| Mobile cards opcionales | ✅ | DataTable soporta `renderMobileCard` para responsive |

### Modales, diálogos y confirmaciones

| Hallazgo | Severidad | Detalle |
|---|---|---|
| Dialog vs Sheet bien diferenciados | ✅ | Dialog = centrado/compacto; Sheet = full-screen mobile → modal desktop |
| ConfirmDialog centralizado y adoptado (~20 usos) | ✅ | 3 variantes: destructive, warning, default |
| Overlay y animaciones consistentes | ✅ | Backdrop blur, zoom-in/out, fade, duración via tokens |
| Close button con sr-only "Cerrar" | ✅ | Tanto Dialog como Sheet |
| No se usa `window.confirm()` nativo | ✅ | Solo 2 funciones llamadas `confirm()` (locales, no el nativo) |

### Navegación y estructura

| Hallazgo | Severidad | Detalle |
|---|---|---|
| Shell L-shaped consistente | ✅ | AppShell → sidebar desktop + mobile nav + TopBar |
| Breadcrumbs via PageHeader | ✅ | Se renderizan en TopBar via ShellHeaderContext |
| CommandPalette (⌘K) | ✅ | Búsqueda global funcional |
| Áreas de navegación bien estructuradas | ✅ | `layout/areas.ts` define áreas; `nav-items.ts` define ítems |

### Iconografía

| Hallazgo | Severidad | Detalle |
|---|---|---|
| Phosphor Icons exclusivamente | ✅ | 0 archivos usan Lucide o Heroicons — consistencia total |
| ~282 archivos usan Phosphor | ✅ | Adopción uniforme en toda la app |
| Weights consistentes | ✅ | `weight="bold"` para acciones, default para decorativo |

### Mensajes y microcopy

| Hallazgo | Severidad | Detalle |
|---|---|---|
| Toast wrapper centralizado | ✅ | `lib/toast.ts` con duración configurable y progress bar |
| StateBadge con vocabulario unificado | ✅ | Mapeo estado→label en español para 6 entidades |
| Mensajes de error en español | ✅ | Servicios retornan mensajes descriptivos |
| "Guardado correctamente" / "No se pudo completar la acción" | ✅ | Consistente en los 8 form-kits |

### Estados de interfaz

| Hallazgo | Severidad | Detalle |
|---|---|---|
| EmptyState con tono, CTA y heading semántico | ✅ | 4 tonos, compact mode, align configurable |
| ConfirmDialog para acciones destructivas | ✅ | Ampliamente adoptado |
| Loading en buttons | ✅ | Spinner + `aria-busy` |
| Skeleton shimmer | ✅ | Componente con sweep gradient animado |
| Error global (`error.tsx`) | ✅ | Existe en `app/(app)/error.tsx` y `app/global-error.tsx` |
| Not-found personalizado | ✅ | `app/(app)/not-found.tsx` |

### Responsive y adaptabilidad

| Hallazgo | Severidad | Detalle |
|---|---|---|
| DataTable con mobile cards | ✅ | `renderMobileCard` oculta tabla y muestra cards en `md:hidden` |
| Sheet full-screen en mobile | ✅ | `inset-0` mobile → centered modal desktop |
| PageHeader `lg:sr-only` en desktop | ✅ | TopBar muestra el contenido en desktop |
| Tablas raw sin adaptación móvil | Media | Tablas que no usan DataTable dependen de scroll horizontal |

### Accesibilidad visual e interactiva

| Hallazgo | Severidad | Detalle |
|---|---|---|
| Focus ring global (`:focus-visible`) | ✅ | 2px solid primary con offset |
| `aria-sort` en sort columns | ✅ | DataTable implementa correctamente |
| `sr-only` en close buttons | ✅ | "Cerrar" en Dialog y Sheet |
| `role="alert"` en errores de campo | ✅ | En `components/ui/field.tsx` (pero no en form-kits locales) |
| `aria-label` en search inputs | ✅ | "Buscar en la tabla", "Buscar en opciones" |
| Reduced motion support | ✅ | `prefers-reduced-motion` desactiva animaciones |
| `aria-invalid` en inputs con error | ✅ | Input y Select tienen prop `error` |
| Contrast colors con oklch | ✅ | `text-subtle` L=0.500, `text-faint` L=0.560 — WCAG AA documentado |

---

## 9. Propuesta de Sistema de Diseño

### Estado actual

El proyecto **ya tiene un sistema de diseño emergente** bien fundamentado en `globals.css`. La propuesta no es crear uno nuevo sino formalizar y cerrar los gaps.

### Tokens de color (ya definidos ✅)

```
Brand:   --color-primary (esmeralda) + tint/line/ink/strong/deep
Signal:  --color-signal (naranja Chome) + tint/line/ink — reservado para "pendiente"
Accent:  --color-accent (amber) + tint/line/ink
Semantic: info/success/warning/danger + tint/line/ink cada uno
Neutral: bg/surface/surface-2/surface-3/border/border-strong/rule
Text:    text/text-muted/text-subtle/text-faint
Chrome:  chrome/chrome-hover (shell L-shaped)
```

**Estado:** Completo y bien documentado. No requiere cambios.

### Escala tipográfica (ya definida ✅)

```
text-xs:   12px — labels, micro
text-sm:   13px — UI, table cells
text-base: 15px — body
text-lg:   17px — section heads
text-xl:   22px — page heads
text-2xl:  28px — display
text-3xl:  36px — brand moment
```

Con utilidades compuestas: `text-h1`, `text-h2`, `text-h3`, `text-eyebrow`, `text-sub`, `text-display`.

**Estado:** Completo. Gap: ~35 archivos usan `toLocaleDateString` en lugar de los formatos centralizados.

### Escala de espaciado (Tailwind default ✅)

```
Uso dominante: gap-2 (8px), gap-3 (12px), gap-4 (16px), gap-6 (24px)
PageContainer padding: px-4 md:px-8 py-2 md:py-3
FieldGroup: gap-4
```

**Estado:** Razonable. No necesita tokens custom.

### Radios (ya definidos ✅)

```
radius-xs:   2px  — badges
radius-sm:   4px  — cells
radius:      6px  — buttons, inputs
radius-md:   8px  — cards, popovers
radius-lg:   10px — large cards
radius-xl:   12px — content well
radius-2xl:  16px — major containers
radius-full: pills
```

### Sombras (ya definidas ✅)

```
shadow-xs   — subtle lift
shadow-sm   — minor elevation
shadow-card — cards
shadow-md   — popovers, dropdowns
shadow-lg   — modals, dialogs
```

### Tamaños de controles (ya definidos ✅)

```
Button:  h-7 (sm), h-8 (default), h-9 (lg)
Input:   h-9
Select:  h-9
Icon:    h-8 w-8 (default), h-7 w-7 (sm), h-11 w-11 (mobile touch target)
```

### Variantes de botones (ya definidas ✅)

primary, secondary, ghost, destructive, signal, link — con 7 tamaños.

### Estados semánticos (ya definidos ✅)

Via `StateBadge`: item, request, oc, feedback, ppa, fuel_log, fleet, prevention.

### Iconografía (ya estandarizada ✅)

Phosphor Icons exclusivamente. No hay mezcla de librerías.

### Convenciones de layout (documentadas en AGENTS.md ✅)

- `PageContainer` → `PageHeader` → contenido
- TopBar search automático
- `width` variants: wide/form/workbench/full

### Gaps a cerrar

1. **Documentar cuándo usar DataTable vs Table raw.**
2. **Documentar cuándo usar FilterToolbar vs filtros inline.**
3. **Extraer useOperation como patrón estándar para server actions en formularios.**
4. **Documentar patrones de exportación (ExportDialog vs ExportButton).**

---

## 10. Biblioteca de Componentes Recomendada

### Ya existen y funcionan correctamente ✅

| Componente | Archivo |
|---|---|
| Button | `components/ui/button.tsx` |
| Badge | `components/ui/badge.tsx` |
| StateBadge | `components/states/state-badge.tsx` |
| Input | `components/ui/input.tsx` |
| Textarea | `components/ui/textarea.tsx` |
| Checkbox | `components/ui/checkbox.tsx` |
| Switch | `components/ui/switch.tsx` |
| Select (con searchable) | `components/ui/select.tsx` |
| Field / Label / FieldGroup | `components/ui/field.tsx` |
| DatePicker | `components/ui/date-picker.tsx` |
| DateRangePicker | `components/ui/date-range-picker.tsx` |
| Dialog | `components/ui/dialog.tsx` |
| Sheet | `components/admin/sheet.tsx` |
| ConfirmDialog | `components/ui/confirm-dialog.tsx` |
| DropdownMenu | `components/ui/dropdown-menu.tsx` |
| Popover | `components/ui/popover.tsx` |
| Tooltip | `components/ui/tooltip.tsx` |
| Tabs | `components/ui/tabs.tsx` |
| SegmentedControl | `components/ui/segmented-control.tsx` |
| Card | `components/ui/card.tsx` |
| Table / TableRoot | `components/ui/table.tsx` |
| DataTable | `components/admin/data-table.tsx` |
| Pagination | `components/ui/pagination.tsx` |
| ServerPagination | `components/ui/server-pagination.tsx` |
| EmptyState | `components/ui/empty-state.tsx` |
| Skeleton / SkeletonRow / SkeletonPage | `components/ui/skeleton.tsx` |
| Avatar | `components/ui/avatar.tsx` |
| PageHeader / Breadcrumbs | `components/ui/page-header.tsx` |
| PageContainer | `components/ui/page-container.tsx` |
| SummaryBar | `components/ui/summary-bar.tsx` |
| HeaderSignals | `components/ui/header-signals.tsx` |
| FilterToolbar | `components/ui/filter-toolbar.tsx` |
| ExportDialog | `components/export-dialog.tsx` |
| FileDropzone | `components/ui/file-dropzone.tsx` |
| FileInput | `components/ui/file-input.tsx` |
| SignaturePad | `components/ui/signature-pad.tsx` |
| WorksiteSelect | `components/ui/worksite-select.tsx` |
| OnboardingHint | `components/ui/onboarding-hint.tsx` |
| CrossFilterCell | `components/ui/cross-filter-cell.tsx` |

### Deben refactorizarse

| Componente | Acción |
|---|---|
| Sheet | Mover de `components/admin/` a `components/ui/` (es un componente genérico, no de admin) |
| SubmitButton | Evaluar deprecación a favor de `Button loading` |
| `adquisiciones/onboarding-hint.tsx` | Eliminar re-export |

### Deben crearse

| Componente | Justificación |
|---|---|
| `ExportButton` (server action pattern) | Unificar 9 export buttons dispersos |
| `useOperation` hook | Centralizar el patrón de 8 form-kits |

### Deben fusionarse

| Componentes actuales | Componente resultante |
|---|---|
| `servicios/quotation-panel.tsx` + `repuestos/quotation-panel.tsx` | `QuotationPanel` genérico con prop `entityType` |
| 8× `*-form-kit.tsx` | `lib/hooks/use-operation.ts` + `lib/utils.ts` (toLocalInputValue) |

### Deben eliminarse

| Componente | Razón |
|---|---|
| 8× `*-form-kit.tsx` | Reemplazados por `use-operation` + `Field` de ui |
| `components/adquisiciones/onboarding-hint.tsx` | Re-export innecesario |
| 1 de los 2 `quotation-panel.tsx` | Fusionado en componente genérico |

---

## 11. Plan de Refactorización

### Fase 1: Correcciones Críticas (Sprint 1)

**Objetivo:** Eliminar duplicación de código idéntico.

**Acciones:**
1. Crear `lib/hooks/use-operation.ts` con el hook `useOperation`.
2. Mover `toLocalInputValue` a `lib/utils.ts`.
3. Actualizar 15+ archivos de prevención para importar desde las nuevas ubicaciones.
4. Eliminar los 8 `*-form-kit.tsx`.
5. Reemplazar `Field` local por `Field` de `components/ui/field.tsx` en los módulos de prevención.

**Archivos afectados:** 8 form-kits + ~15 consumidores en prevención.  
**Dependencias:** Ninguna.  
**Riesgos:** Bajo — refactor mecánico. Verificar que los formularios de prevención sigan funcionando.  
**Criterios de finalización:** 0 archivos `*-form-kit.tsx` en el repo. Todos los formularios de prevención usan `useOperation` de `lib/hooks/` y `Field` de `components/ui/`.

### Fase 2: Consolidación de Componentes (Sprint 2)

**Objetivo:** Reducir duplicación de componentes de dominio.

**Acciones:**
1. Fusionar `servicios/quotation-panel.tsx` + `repuestos/quotation-panel.tsx`.
2. Crear `ExportButton` genérico para server actions.
3. Migrar los 9 export buttons ad-hoc al nuevo componente.
4. Mover `Sheet` de `components/admin/` a `components/ui/`.
5. Eliminar `components/adquisiciones/onboarding-hint.tsx`.

**Archivos afectados:** ~15 archivos.  
**Dependencias:** Ninguna.  
**Riesgos:** Medio — la fusión de `QuotationPanel` requiere prueba manual del flujo de cotizaciones.  
**Criterios de finalización:** 1 `QuotationPanel`, 1 `ExportButton`, 0 re-exports innecesarios.

### Fase 3: Estandarización de Patrones (Sprint 3)

**Objetivo:** Uniformar filtros y formateo de fechas.

**Acciones:**
1. Migrar `toLocaleDateString` → `formatDate`/`formatDateTime` en ~35 archivos.
2. Adoptar `FilterToolbar` en 3-4 módulos prioritarios (capacitación, inspecciones, permisos, productos).
3. Adoptar `useUrlFilters` para persistir filtros en URL en módulos que lo necesiten.
4. Crear `loading.tsx` en rutas principales que no lo tengan.

**Archivos afectados:** ~50 archivos.  
**Dependencias:** Fase 2 completada para export buttons.  
**Riesgos:** Medio — cambios de formato de fecha pueden afectar expectativas del usuario.  
**Criterios de finalización:** 0 usos de `toLocaleDateString` en `app/(app)/`. `FilterToolbar` en al menos 6 módulos.

### Fase 4: Migración Gradual (Sprint 4-5)

**Objetivo:** Ampliar adopción de `DataTable` y completar `loading.tsx`.

**Acciones:**
1. Identificar tablas raw que se beneficiarían de `DataTable` (search, sort, pagination automáticos).
2. Migrar tablas candidatas.
3. Completar `loading.tsx` en todas las rutas.
4. Documentar guía de cuándo usar `DataTable` vs `Table` raw.

**Archivos afectados:** Variable.  
**Dependencias:** Ninguna.  
**Riesgos:** Medio — cada migración de tabla requiere verificar que la UX específica se preserva.  
**Criterios de finalización:** Documentación publicada. `loading.tsx` en todas las rutas principales.

### Fase 5: Validación y Prevención de Regresiones (Continuo)

**Objetivo:** Asegurar que no se reintroduzca la duplicación.

**Acciones:**
1. Agregar regla ESLint para prohibir imports de `*-form-kit.tsx` (o detectar archivos con ese patrón).
2. Documentar patrones aprobados en `AGENTS.md` (ya tiene secciones de layout y búsqueda — agregar sección de formularios y exportación).
3. Revisar PRs que agreguen archivos `*-form-kit.tsx` o `export-button.tsx` a nivel de módulo.
4. Considerar pruebas visuales con Playwright para detectar regresiones de layout.

**Criterios de finalización:** Reglas documentadas y aplicadas en CI.

---

## 12. Reglas para Evitar Nuevas Inconsistencias

### Convenciones documentadas (ampliar AGENTS.md)

Agregar secciones para:

1. **Patrón de formulario**: usar `useOperation` de `lib/hooks/`, `Field` de `components/ui/field.tsx`, `useActionState` para server actions.
2. **Patrón de exportación**: usar `ExportButton` para server actions, `ExportDialog` cuando se necesitan filtros previos.
3. **Patrón de tabla**: `DataTable` para listas con search/sort/pagination; `Table` raw para detalle/matrices.
4. **Patrón de filtros**: `FilterToolbar` + `useUrlFilters` para filtros persistentes en URL.
5. **Formateo de datos**: siempre `formatDate`/`formatDateTime`/`formatCLP`/`formatQty` de `lib/utils.ts`. Nunca `toLocaleDateString`.

### Linting

- ESLint rule: prohibir `import` de archivos `*-form-kit.tsx` y de `sonner` directamente (usar `lib/toast.ts`).
- ESLint rule: advertir sobre `toLocaleDateString` en archivos `.tsx`.

### Tokens centralizados (ya implementados ✅)

Los tokens en `globals.css` cubren colores, tipografía, espaciado, radios, sombras y motion. No se requiere acción adicional.

### Restricción de estilos arbitrarios

- Preferir tokens del sistema (`var(--color-*)`, `var(--radius-*)`, `var(--shadow-*)`) sobre valores hardcoded.
- Los componentes en `components/ui/` ya siguen esta regla. Reforzar en code review para componentes de módulo.

### Plantilla de nuevos módulos

Todo módulo nuevo debería comenzar con:
```tsx
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { DataTable } from "@/components/admin/data-table"
import { FilterToolbar } from "@/components/ui/filter-toolbar"
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button" // tras consolidación
```

### Checklist de interfaz para PRs

- [ ] ¿Usa `PageContainer` con `width` apropiado?
- [ ] ¿Usa `PageHeader` para título y acciones?
- [ ] ¿Las fechas se formatean con `formatDate`/`formatDateTime`?
- [ ] ¿Los filtros usan `FilterToolbar` o están justificados como inline?
- [ ] ¿Los estados vacíos usan `EmptyState` con CTA?
- [ ] ¿Las tablas usan `DataTable` o hay justificación para `Table` raw?
- [ ] ¿La exportación usa `ExportButton` o `ExportDialog`?
- [ ] ¿Los formularios usan `Field` de `components/ui/`?
- [ ] ¿Las confirmaciones usan `ConfirmDialog`?
- [ ] ¿No hay `toLocaleDateString` en el diff?

---

## 13. Lista Priorizada de Acciones

| # | Acción | Impacto | Esfuerzo | Archivos o módulos |
|---:|---|---|---|---|
| 1 | Extraer `useOperation` a `lib/hooks/use-operation.ts` y eliminar 8 form-kits | Alto | Bajo | 8 form-kits + 15 consumidores en prevención |
| 2 | Reemplazar `Field` local por `Field` de `components/ui/field.tsx` en prevención | Alto | Bajo | Mismos 15 consumidores que #1 |
| 3 | Mover `toLocalInputValue` a `lib/utils.ts` | Medio | Bajo | `lib/utils.ts` + 8 importadores |
| 4 | Fusionar `servicios/quotation-panel.tsx` + `repuestos/quotation-panel.tsx` | Alto | Bajo | 2 archivos + 2 páginas consumidoras |
| 5 | Migrar `toLocaleDateString` → `formatDate`/`formatDateTime` | Medio | Bajo | ~35 archivos en `app/(app)/` |
| 6 | Crear `ExportButton` genérico y migrar 9 implementaciones | Alto | Medio | 9 export buttons + nuevo componente |
| 7 | Adoptar `FilterToolbar` en módulos de prevención | Medio | Medio | ~8 listas en prevención |
| 8 | Crear `loading.tsx` en rutas principales | Medio | Bajo | ~15 rutas principales |
| 9 | Mover `Sheet` de `admin/` a `ui/` | Bajo | Bajo | 1 archivo + actualizar imports |
| 10 | Eliminar re-export `adquisiciones/onboarding-hint.tsx` | Bajo | Bajo | 1 archivo |
| 11 | Documentar guía DataTable vs Table en AGENTS.md | Medio | Bajo | 1 archivo de documentación |
| 12 | Documentar patrones de formulario y exportación en AGENTS.md | Medio | Bajo | 1 archivo de documentación |
| 13 | Migrar tablas raw candidatas a DataTable | Medio | Alto | Variable (~10 tablas candidatas) |
| 14 | Agregar regla ESLint para `toLocaleDateString` | Bajo | Bajo | `eslint.config.mjs` |
| 15 | Evaluar deprecación de `SubmitButton` | Bajo | Bajo | 1 componente + consumidores |

---

## 14. Veredicto Final

### ¿El proyecto tiene un sistema visual coherente?

**Sí, en su base.** El sistema de tokens en `globals.css` es completo, bien pensado y coherente. Los componentes base de `components/ui/` lo respetan fielmente. La coherencia se degrada en los módulos de dominio donde patrones intermedios se reimplementan, pero esto es una cuestión de **adopción**, no de diseño del sistema.

### ¿Los componentes se reutilizan correctamente?

**Parcialmente.** Los componentes primitivos (Button, Input, Badge, Dialog) se reutilizan extensamente y correctamente. Los componentes de patrón intermedio (filtros, export, form-kit) están infrautilizados o duplicados. La duplicación es localizada y no sistémica.

### ¿Existe duplicación significativa?

**Sí, pero localizada.** Los 3 focos principales son:
1. 8× form-kit idénticos en prevención (~320 líneas duplicadas)
2. 2× quotation-panel casi idénticos (~300 líneas duplicadas)
3. 9× export button con patrones similares (~400 líneas duplicadas)

Total: ~1020 líneas de duplicación identificada, de un proyecto de ~50.000+ líneas. Es significativo pero manejable.

### ¿La arquitectura actual facilita o dificulta la estandarización?

**La facilita significativamente.** La estructura de `components/ui/` como biblioteca centralizada, `lib/hooks/` para lógica compartida, `lib/utils.ts` para utilidades, y las convenciones documentadas en `AGENTS.md` proporcionan una base sólida. El problema no es arquitectónico sino de disciplina de adopción durante el crecimiento rápido.

### ¿Qué debe corregirse antes de continuar agregando módulos?

1. **Obligatorio:** Consolidar form-kits (H-01) — cada nuevo submódulo de prevención copiará el patrón roto.
2. **Altamente recomendado:** Documentar patrones aprobados de formulario, exportación y filtros.
3. **Recomendado:** Migrar `toLocaleDateString` antes de que más módulos copien el patrón.

### ¿Qué puede esperar?

- Migración de tablas raw a DataTable (requiere revisión caso por caso).
- Adopción de FilterToolbar en módulos menos críticos.
- Evaluación de SubmitButton vs Button loading.

### ¿Está el proyecto preparado para crecer sin aumentar rápidamente la deuda técnica?

**Sí, con las correcciones de Fase 1-2.** La arquitectura es sólida, las convenciones existen, y los componentes base son maduros. Lo que falta es cerrar los gaps de adopción para que los nuevos módulos tengan un camino claro de reutilización sin necesidad de "copiar y adaptar" de módulos existentes.

### ¿Está listo para producción desde el punto de vista de consistencia y mantenibilidad visual?

**Sí, con reservas menores.** El sistema visual es coherente y profesional. Las inconsistencias detectadas (formato de fechas, filtros ad-hoc) son sutiles y no afectan la funcionalidad. La duplicación de form-kits es el riesgo más urgente: si se agregan 3 submódulos más sin consolidar, se tendrán 11 copias idénticas.

---

## Apéndice: Lo Que Está Bien Implementado y Debe Conservarse

| Elemento | Por qué es bueno |
|---|---|
| Sistema de tokens oklch | Paleta coherente, semántica, con tints/inks para cada color. No usa hex arbitrarios. |
| Button con CVA | Variantes y tamaños bien diseñados, loading y press feedback integrados. |
| StateBadge con vocabulario unificado | Mapeo centralizado de estados para 6 entidades. Evita que cada módulo invente sus propias etiquetas. |
| ShellHeaderContext | Patrón elegante donde PageHeader "inyecta" título y acciones en el TopBar via context. |
| DataTable + TopBar search | Se conecta automáticamente a la búsqueda global. Reduce código boilerplate significativamente. |
| ConfirmDialog centralizado | 3 variantes, loading state, adoptado en ~20 sitios. Reemplaza los `window.confirm()`. |
| EmptyState con tonos y CTA | No solo dice "sin datos" — explica el contexto y ofrece una acción. |
| Phosphor Icons exclusivamente | Cero mezcla de librerías. Coherencia visual total en iconografía. |
| Toast wrapper con progress bar | Mejora sobre sonner raw: errores tienen duración configurable y barra visual. |
| Reduced motion support | Respeta `prefers-reduced-motion` desactivando animaciones y transiciones. |
| FilterToolbar (el componente en sí) | Bien diseñado: chips removibles, overflow sheet, contador. Solo falta adopción. |
| SummaryBar / HeaderSignals | Dos componentes complementarios para métricas: editorial (body) vs señales (header). |
| Field con accesibilidad | `aria-describedby`, `aria-invalid`, `role="alert"` — accesibilidad real, no decorativa. |
| useUrlFilters | Hook bien abstraído para persistir filtros en URL con debounce y clear. |
| Convenciones en AGENTS.md | Reglas de layout, búsqueda, densidad de pantalla documentadas y aplicadas. |
