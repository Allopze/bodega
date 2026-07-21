# Plan de Migración UI — Consistencia del Sistema de Diseño

**Versión:** 1.0  
**Basado en:** `AUDITORIA_CONSISTENCIA_UI.md`  
**Objetivo:** Estandarizar todos los componentes UI de la plataforma usando los wrappers de Radix del design system.

---

## Resumen

- **87 archivos** ya usan el `<Select>` de Radix correctamente ✅
- **52 archivos** ya usan el `Dialog` de Radix correctamente ✅
- **~88 `<select>` nativos** por migrar a `<Select>` (Radix)
- **4 archivos** con Radix primitives usados directamente (sin wrapper)
- **1 animación** inconsistente entre Dialog y Sheet ✅ *(ya corregido)*

---

## Fase 1 — Migraciones chicas y puntuales (prioridad alta)

### 1.1 `command-palette.tsx` → usar `Dialog` de la plataforma

**Archivo:** `components/layout/command-palette.tsx`  
**Estimación:** ~15 líneas modificadas  
**Riesgo:** Bajo (componente aislado, sin dependencias externas)

**Qué hacer:**
- Reemplazar `import * as Dialog from "@radix-ui/react-dialog"` por los componentes de `@/components/ui/dialog`
- Usar `DialogContent`, `DialogOverlay`, `DialogTitle` en vez de `Dialog.Content`, `Dialog.Overlay`, etc.
- Mantener `VisuallyHidden` de Radix (no hay wrapper)
- Mantener la lógica y estilos específicos del command palette (posición, input, lista)

**Archivos impactados:** 1

---

### 1.2 `notification-bell.tsx` → usar `Popover` de la plataforma

**Archivo:** `components/layout/notification-bell.tsx`  
**Estimación:** ~5 líneas modificadas  
**Riesgo:** Bajo (componente aislado)

**Qué hacer:**
- Reemplazar `import * as PopoverPrimitive from "@radix-ui/react-popover"` por `@/components/ui/popover`
- Usar `Popover`, `PopoverTrigger`, `PopoverContent`

**Archivos impactados:** 1

---

### 1.3 `desktop-nav-areas.tsx` → usar `Popover` de la plataforma

**Archivo:** `components/layout/desktop-nav-areas.tsx`  
**Estimación:** ~5 líneas modificadas  
**Riesgo:** Bajo

**Qué hacer:**
- Reemplazar `import * as Popover from "@radix-ui/react-popover"` por `@/components/ui/popover`
- `Collapsible` se deja como está (no hay wrapper)

**Archivos impactados:** 1

---

## Fase 2 — Diálogos inline con `<select>` nativo (prioridad alta)

Estos 3 archivos mezclan `Dialog` de la plataforma con `<select>` nativo en el interior.  
El Dialog ya está bien, solo hay que migrar los selects interiores.

### 2.1 `legal-requirements-workbench.tsx`

**Archivo:** `app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx`  
**Selects nativos:** 4 (en 3 diálogos inline distintos)  
**Estimación:** ~30 líneas modificadas  
**Riesgo:** Medio (3 diálogos, formularios con lógica)

**Contexto:** Los 3 diálogos están definidos como funciones inline:
- `NewRequirementDialog` (1 select nativo: sourceType)
- `ApplicabilityDialog` (3 selects nativos: worksiteId, processId, status)
- `ComplianceDialog` (2 selects nativos: status, priority)

**Archivos impactados:** 1

---

### 2.2 `pdtp-coverage-workbench.tsx`

**Archivo:** `app/(app)/prevencion/pdtp/cobertura/pdtp-coverage-workbench.tsx`  
**Selects nativos:** 3  
**Estimación:** ~20 líneas modificadas  
**Riesgo:** Medio

**Qué hacer:** Migrar los 3 `<select>` a `<Select>` manteniendo la lógica de dependencias (worksiteId cambia las opciones de sourceId).

**Archivos impactados:** 1

---

### 2.3 `miper-workbench.tsx`

**Archivo:** `app/(app)/prevencion/miper/miper-workbench.tsx`  
**Selects nativos:** 3  
**Estimación:** ~20 líneas modificadas  
**Riesgo:** Medio

**Qué hacer:** Migrar los 3 `<select>` a `<Select>`.

**Archivos impactados:** 1

---

## Fase 3 — Migración masiva de `<select>` nativo a `<Select>` Radix en Prevención (prioridad alta)

### 3.1 Arquitectura de migración

Cada sub-módulo de Prevención sigue este patrón:

```
cphs/
  ├── cphs-form-kit.tsx         → define selectClass
  ├── cphs-dialogs.tsx          → usa Dialog + <select nativo>
  └── [committeeId]/
      └── committee-detail.tsx  → usa Dialog + <select nativo>
```

La migración consiste en:
1. **Importar** `Select, SelectTrigger, SelectValue, SelectContent, SelectItem` en cada archivo
2. **Reemplazar** `<select className={selectClass}>` por `<Select>` (Radix)
3. **Eliminar** la dependencia de `selectClass` del form-kit (o mantenerla para inputs no-select)
4. **Agregar** `onValueChange` + estado local/ref para los selects controlados

### 3.2 Tabla de migración por sub-módulo

| Sub-módulo | Archivos con selects nativos | Selects | Depende de form-kit | Prioridad |
|---|---|---|---|---|
| `capacitacion/` | `training-catalog.tsx`, `training-session-list.tsx`, `session-detail.tsx` | 14 | `capacitacion/form-kit.tsx` | 🔴 Alta |
| `cphs/` | `cphs-dialogs.tsx`, `committee-detail.tsx` | 12 | `cphs/cphs-form-kit.tsx` | 🔴 Alta |
| `emergencias/` | `emergencias-dialogs.tsx`, `plan-detail.tsx` | 6 | `emergencias/emergencias-form-kit.tsx` | 🔴 Alta |
| `inspecciones/` | `inspection-run-list.tsx`, `inspection-catalog.tsx`, `inspection-run-detail.tsx` | 6 | `inspecciones/inspection-form-kit.tsx` | 🟡 Media |
| `permisos/` | `permit-dialogs.tsx`, `permit-detail.tsx` | 7 | `permisos/permit-form-kit.tsx` | 🔴 Alta |
| `higiene/` | `hygiene-dialogs.tsx`, `group-detail.tsx`, `program-detail.tsx` | 7 | `higiene/hygiene-form-kit.tsx` | 🟡 Media |
| `epp-preventivo/` | `epp-dialogs.tsx` | 5 | `epp-preventivo/epp-form-kit.tsx` | 🟡 Media |
| `gestion-cambio/` | `change-dialogs.tsx`, `change-detail.tsx` | 5 | `gestion-cambio/change-form-kit.tsx` | 🟡 Media |
| **Total Prevención** | **19 archivos** | **~62 selects** | 8 form-kits | |

### 3.3 Archivos que YA usan Select de Radix en Prevención (no tocar)

Estos archivos ya conviven con Radix Select correctamente:
- `prevencion/capacitacion/competencias/competency-matrix.tsx`
- `prevencion/capa/capa-list.tsx`, `capa/[id]/capa-controls.tsx`
- `prevencion/capacitacion/training-session-list.tsx` (solo algunos)
- `prevencion/incidentes/incident-list.tsx`, `incidentes/[id]/incident-workflow-panel.tsx`, `incidentes/reportar/incident-report-form.tsx`
- `prevencion/permisos/work-permit-list.tsx`
- `prevencion/indicadores/` (varios)
- `prevencion/documentacion/` (varios)
- `prevencion/ppa/` (varios)
- `prevencion/pdtp/` (varios)
- `prevencion/inspecciones/inspection-run-list.tsx`
- `prevencion/epp-preventivo/epp-gap-list.tsx`

**Nota importante:** Algunos archivos (como `training-session-list.tsx`, `inspection-run-list.tsx`) ya importan `Select` de Radix **para algunos selects** mientras otros selects en el mismo archivo siguen siendo nativos. Hay que migrar **todos** los del archivo.

---

## Fase 4 — Migración de `<select className="control">` en Combustibles (prioridad media)

### 4.1 Tabla de migración

| Archivo | Selects nativos | Contexto |
|---|---|---|
| `combustibles/bitacora/page.tsx` | 12 | Filtros de bitácora |
| `combustibles/anomalias/page.tsx` | 3 | Filtros de anomalías |
| `combustibles/analisis/page.tsx` | 2 | Filtros de análisis |
| `combustibles/sellos/page.tsx` | 1 | Filtro de faena |
| `combustibles/ciclo/page.tsx` | 2 | Filtros de ciclo |
| `combustibles/ciclo/cycle-workbench.tsx` | 7 | Formulario de eventos de ciclo |
| `combustibles/tae/importar/tae-import-report-form.tsx` | 1 | Mapeo de importación |
| **Total Combustibles** | **~28 selects** | |

**Nota:** Combustibles ya tiene componentes compartidos que SÍ usan Radix Select (`fuel-filters.tsx`, `consumption-filters.tsx`, `new-fuel-load-form.tsx`, etc.). La mayoría de selects nativos están en **páginas de listado/filtros** (`bitacora/page.tsx`, `anomalias/page.tsx`, etc.).

### 4.2 Diferencia clave

Los selects nativos de Combustibles usan `className="control"` (una clase CSS global), no `selectClass`.  
**Requiere verificar** que la clase `control` no se use para otros propósitos antes de eliminarla.

**Archivos impactados:** 7

---

## Fase 5 — Migraciones menores (prioridad baja)

| Archivo | Problema | Acción |
|---|---|---|
| `admin/backups/sa-health-section.tsx` | 1 select nativo | Migrar a `<Select>` Radix |
| `combustibles/tae/importar/[id]/tae-mapping-review.tsx` | Usa `Select` Radix, verificar | Ya migrado ✅ |
| `combustibles/tae/tae-access-panel.tsx` | Usa `Select` Radix | Ya migrado ✅ |

---

## Fase 6 — Limpieza post-migración

### 6.1 Eliminar `selectClass` de form-kits

Una vez migrados todos los `<select>` nativos, se pueden eliminar las definiciones de `selectClass` de los 8 `*-form-kit.tsx`:

- `capacitacion/form-kit.tsx`
- `emergencias/emergencias-form-kit.tsx`
- `inspecciones/inspection-form-kit.tsx`
- `cphs/cphs-form-kit.tsx`
- `epp-preventivo/epp-form-kit.tsx`
- `permisos/permit-form-kit.tsx`
- `gestion-cambio/change-form-kit.tsx`
- `higiene/hygiene-form-kit.tsx`

**Verificar** que ningún otro componente importe `selectClass` de estos archivos.

### 6.2 Eliminar clase `control` de Combustibles

Verificar que la clase CSS `.control` en `globals.css` (o donde esté definida) ya no se usa después de la migración.

---

## Orden sugerido de implementación

```
Fase 1.1 ── command-palette.tsx
    ↓
Fase 1.2 ── notification-bell.tsx
    ↓
Fase 1.3 ── desktop-nav-areas.tsx
    ↓
Fase 2.1 ── legal-requirements-workbench.tsx
    ↓
Fase 2.2 ── pdtp-coverage-workbench.tsx
    ↓
Fase 2.3 ── miper-workbench.tsx
    ↓
Fase 3 ──── Capacitación (14 selects) ← más selects, mejor empezar por el más grande
    ↓
Fase 3 ──── CPHS (12 selects)
    ↓
Fase 3 ──── Permisos (7 selects)
    ↓
Fase 3 ──── Emergencias (6 selects)
    ↓
Fase 3 ──── Higiene (7 selects)
    ↓
Fase 3 ──── Inspecciones (6 selects)
    ↓
Fase 3 ──── EPP Preventivo (5 selects)
    ↓
Fase 3 ──── Gestión de Cambio (5 selects)
    ↓
Fase 4 ──── Combustibles bitácora (12 selects)
    ↓
Fase 4 ──── Combustibles ciclo (7 selects → cycle-workbench.tsx)
    ↓
Fase 4 ──── Combustibles resto (9 selects → anomalías, análisis, sellos, ciclo/page)
    ↓
Fase 5 ──── admin/backups (1 select)
    ↓
Fase 6 ──── Limpieza de selectClass y clase control
```

---

## Estimación total

| Actividad | Archivos | Selects |
|---|---|---|
| Fase 1 — Radix raw → wrapper | 3 | 0 |
| Fase 2 — Dialogs inline | 3 | 10 |
| Fase 3 — Prevención | 19 | ~62 |
| Fase 4 — Combustibles | 7 | ~28 |
| Fase 5 — Admin | 1 | 1 |
| Fase 6 — Limpieza | ~8 form-kits | — |
| **Total** | **~41 archivos** | **~101 selects** |

**Riesgo general:** Medio  
**Pruebas recomendadas por fase:**
- `npx tsc --noEmit` (typecheck)
- Revisión visual de cada diálogo/página migrada
- `npm run test` para tests existentes de componentes afectados
- Verificar flujos de formulario con selects migrados (seleccionar opción, enviar formulario)

---

## Patrón de migración (ejemplo)

**Antes:**
```tsx
import { Dialog, DialogContent } from "@/components/ui/dialog"

const selectClass = "h-10 rounded-md border border-[var(--color-border)] bg-transparent px-3 text-sm"

<Dialog>
  <DialogContent>
    <select name="worksiteId" className={selectClass} required>
      {worksites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </DialogContent>
</Dialog>
```

**Después:**
```tsx
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

const [worksiteId, setWorksiteId] = useState("")

<Dialog>
  <DialogContent>
    <Select name="worksiteId" value={worksiteId || "_none"} onValueChange={(v) => setWorksiteId(v === "_none" ? "" : v)}>
      <SelectTrigger>
        <SelectValue placeholder="Selecciona faena" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="_none">Sin asignar</SelectItem>
        {worksites.map((item) => (
          <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </DialogContent>
</Dialog>
```

**Consideraciones:**
- Radix Select **no soporta** `value=""` — usar un sentinel como `"_none"` o `"_all"`
- Los `<select name="...">` en formularios server-action necesitan un `<input type="hidden">` adicional
- Los selects controlados (`value`+`onChange`) se mapean a `value`+`onValueChange`

---

## Estado actual

| Fase | Estado | Completado |
|---|---|---|
| ✅ Sheet vs Dialog overlay blur + duración | ✅ Hecho | 2026-07-20 |
| Fase 1.1 — command-palette.tsx | ⬜ Pendiente | |
| Fase 1.2 — notification-bell.tsx | ⬜ Pendiente | |
| Fase 1.3 — desktop-nav-areas.tsx | ⬜ Pendiente | |
| Fase 2.1 — legal-requirements-workbench.tsx | ⬜ Pendiente | |
| Fase 2.2 — pdtp-coverage-workbench.tsx | ⬜ Pendiente | |
| Fase 2.3 — miper-workbench.tsx | ⬜ Pendiente | |
| Fase 3 — Prevención | ⬜ Pendiente | |
| Fase 4 — Combustibles | ⬜ Pendiente | |
| Fase 5 — Admin | ⬜ Pendiente | |
| Fase 6 — Limpieza | ⬜ Pendiente | |
