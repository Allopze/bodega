# Plan de Implementación — Consolidación de Componentes Reutilizables

**Proyecto:** Plataforma Chome — Bodega
**Fecha:** 2026-07-24
**Base:** Auditoría fresca sobre el estado actual del repositorio (la auditoría `AUDITORIA_REUTILIZACION_Y_CONSISTENCIA_VISUAL.md` del 2026-07-23 está parcialmente resuelta; este plan refleja lo que **realmente queda vivo**).

---

## 0. Resumen ejecutivo

El proyecto ya pasó por una primera ola de consolidación que **resolvió los hallazgos más graves** de la auditoría previa (form-kits, QuotationPanel, export buttons, fechas). Lo que queda vivo es más acotado y se concentra en dos frentes:

1. **Fragmentación de componentes de KPI/métricas** — existen **4 patrones** para lo que deberían ser **2**. `SummaryBar` ya implementa la "tira editorial" pero dos módulos la reimplementan; `KpiCard` está bien diseñado pero vive en una carpeta de feature y un módulo lo ignora y rolla el suyo.
2. **Filtros ad-hoc en módulos de prevención** — `FilterToolbar` existe y es bueno, pero solo se usa en 2 módulos. ~13 listas de prevención reconstruyen filas de `<Select>` inline, violando la regla A2 de `AGENTS.md`.

Adicionalmente quedan dos frentes de adopción parcial (DataTable vs Table raw, y un par de deudas menores) que se abordan en fases posteriores.

**Inversión total estimada:** 2 sprints (≈6-8 días de ingeniería).
**Riesgo:** Bajo — todo es refactor mecánico con cobertura de tests existente.

---

## 1. Estado verificado de los hallazgos previos

Re-auditoría sobre el árbol actual (2026-07-24). Cada hallazgo se marca con su estado real:

| # | Hallazgo (auditoría 2026-07-23) | Estado real hoy | Evidencia |
|---|---|---|---|
| H-01 | 8 copias de `form-kit.tsx` | ✅ **RESUELTO** | 0 archivos `*form-kit*`. `lib/hooks/use-operation.ts` existe (21 consumidores). `Field` de `components/ui/field.tsx` se usa en 115 archivos. |
| H-02 | `QuotationPanel` duplicado | ✅ **RESUELTO** | `components/quotation-panel.tsx` centralizado. `servicios/` y `repuestos/` son wrappers delgados (~40 líneas) que solo aportan config — aceptable. |
| H-03 | ~9 export buttons divergentes | ✅ **RESUELTO** | Los locales ahora envuelven `ExportButton`/`ExportDialog` de `components/`. Solo `components/prevention/export-button.tsx` (16 líneas, patrón anchor) queda como variante legítima simple. |
| H-04 | `toLocaleDateString` (35 archivos) | ✅ **RESUELTO** | Queda **1 archivo**. Migración completada. |
| H-05 | `FilterToolbar` infrautilizado (2/15) | ✅ **RESUELTO** | 10 consumidores: flota, combustibles, + 8 módulos prevención (Fase 2 + Fase 4). |
| H-06 | Tablas raw vs `DataTable` | ⚠️ **EN PROGRESO** | 5 listas migradas a DataTable (change-list, competency-gap-list, incident-list, work-permit-list, emergency-list). Quedan ~90 imports de `ui/table`. |
| H-07 | Pocas `loading.tsx` | ✅ **RESUELTO** | 87 `loading.tsx` / 145 rutas (60%). Suficiente. |
| H-08 | `SubmitButton` vs `Button loading` | ⚠️ Menor | Pendiente, sin urgencia. |
| H-09 | `OnboardingHint` re-export | ⚠️ Menor | Pendiente, sin urgencia. |

---

## 2. Hallazgos nuevos (no cubiertos en la auditoría previa)

### N-1: Fragmentación de componentes de KPI/métricas (4 patrones → 2)

**Severidad:** Alta · **Categoría:** Reutilización / Consistencia visual

**Solución:**
1. **Promover** `KpiCard` de `app/(app)/analitica/` → `components/ui/kpi-card.tsx`. Reexportar desde analitica para no romper imports existentes.
2. **Extender** `SummaryBar` con dos slots opcionales que cubren lo que frena a A′/A″: `progress?: number` y `secondary?: string` por celda, más `compact?: boolean` para A‴.
3. **Migrar** `dashboard/metric-bar.tsx` → componer `SummaryBar`.
4. **Migrar** `ppa-metric-bar.tsx` → usar `SummaryBar` con `progress`/`secondary`.
5. **Migrar** `bodega-header-metrics.tsx` → `<SummaryBar compact>`.
6. **Migrar** `fuel-kpis.tsx` → usar `KpiCard` (eliminar `Kpi` local).

### N-2: Filtros ad-hoc en listas de prevención (instancia concreta de H-05)

**Severidad:** Alta · **Categoría:** Reutilización / Regla A2 de `AGENTS.md`

**Solución (por módulo, priorizando los más cargados):**
1. Para cada lista del listado, reemplazar la fila de `<Select>` inline por `<FilterToolbar>`.
2. Conectar los filtros a `useUrlFilters` para que el estado viva en la URL.
3. Empezar por los 4 más cargados (training-session, capa, inspecciones, epp-gap) como piloto.

---

## 3. Hallazgos que siguen vivos de la auditoría previa

### H-06 (revisitado): Tablas raw vs `DataTable`

**Severidad:** Media · **Estado:** 4 listas migradas, ~90 restantes.

Las 4 primeras listas migradas demuestran el patrón. El resto se puede migrar incrementalmente.

---

## 4. Fases de implementación

### Fase 0 — Verificación cero-daño (0.5 día)
- [x] Correr `npm run typecheck && npm run lint && npm run test` y registrar baseline.
- [x] Confirmar que `grep -r "border-y border-\[var(--color-border)\]" app components` solo devuelve `summary-bar.tsx` + los 2 duplicados conocidos.
- [x] Confirmar los 21 consumidores de `useOperation` y los 115 de `Field` (regresión de H-01).

### Fase 1 — Consolidación de KPI/métricas (2 días) · **prioridad alta**
- [x] **Promover** `KpiCard` a `components/ui/kpi-card.tsx` (reexport desde `analitica/`).
- [x] **Extender** `SummaryBar` con `progress`, `secondary`, `compact` (slots opcionales, sin breaking).
- [x] **Migrar** `dashboard/metric-bar.tsx` a componer `SummaryBar` (permisos + `formatCLP` quedan en el wrapper; `critical` → `hint`).
- [x] **Migrar** `ppa-metric-bar.tsx` a `SummaryBar` (`progress`/`secondary`).
- [x] **Migrar** `bodega-header-metrics.tsx` a `<SummaryBar compact>`.
- [x] **Migrar** `fuel-kpis.tsx` a `KpiCard` (eliminado `Kpi` local).
- [x] typecheck + lint + test + verificación visual de las 5 pantallas.

### Fase 2 — FilterToolbar piloto en prevención (2 días) · **prioridad alta**
- [x] Migrar los 4 módulos más cargados: `training-session-list`, `capa-list`, `inspection-run-list`, `epp-gap-list`.
- [x] Conectar cada uno a `useUrlFilters` (estado en URL).
- [x] Validar regla A2 (≤6 filtros primarios visibles).
- [x] Fix typecheck `training-session-list.tsx` (clearFilters wrapper para compatibilidad onClick).
- [x] typecheck + lint + test.

### Fase 3 — Adopción de DataTable en listas de prevención (1.5 días) · **prioridad media**
- [x] Migrar `change-list.tsx` a DataTable (searchKeys: code, title, worksiteName).
- [x] Migrar `competency-gap-list.tsx` a DataTable (searchKeys: workerName, courseName, position).
- [x] Migrar `incident-list.tsx` a DataTable (searchKeys: code, companyName, worksiteName, location, eventTypeLabel).
- [x] Migrar `work-permit-list.tsx` a DataTable (searchKeys: code, typeName, taskDescription, location, worksiteName).
- [x] Migrar `emergency-list.tsx` a DataTable — plans tab (disableInternalSearch + pagination server-side externa) + drills tab (searchKeys: planTitle, worksiteName, scenarioType).
- [x] Fix `incident-list.tsx` eventTypeLabel para búsqueda por etiqueta legible.
- [x] typecheck + lint + test.
- ⏭️ `ppa-list.tsx` descartado — filtrado server-side con reducer propio, DateRangePicker, mobile cards, quick-tabs con conteos del server; no es candidato viable para DataTable.

### Fase 4 — Replicar Fase 2 en el resto de módulos (2 días) · **prioridad media**
- [x] Migrar `incident-list.tsx` — 3 Selects (status, eventType, worksite) → FilterToolbar + useUrlFilters.
- [x] Migrar `work-permit-list.tsx` — 2 Selects (status, worksite) → FilterToolbar + useUrlFilters + actions slot.
- [x] Migrar `competency-matrix.tsx` — 1 Select (status) → FilterToolbar + useUrlFilters. Eliminado `useSafeShellHeader`.
- [x] Migrar `committee-list.tsx` — tab state (3 tabs) → useUrlFilters. Mantenido `useSafeShellHeader` (raw Table).
- [x] Migrar `emergency-list.tsx` — tab state (plans/drills) → useUrlFilters. Eliminado `useRouter`.
- [x] typecheck + lint + test.

### Fase 5 — Deudas menores (0.5 día) · **prioridad baja**
- [x] Eliminar `components/adquisiciones/onboarding-hint.tsx` — ya eliminado en sesión previa.
- [x] Migrar el último `toLocaleDateString` en `app/(print)/entregas/[id]/print/page.tsx` → `formatDate()`.
- [x] Eliminar `components/prevention/export-button.tsx` — 0 consumidores, código muerto.
- ⏭️ `SubmitButton` (H-08) — 92 consumidores, demasiado grande para deuda menor. Dejar para refactor dedicado.

---

## 5. Fuera de alcance (explícito)

- **`Table` raw vs `DataTable`** como decisión general — ambos coexisten legítimamente.
- **`SummaryBar` vs `HeaderSignals`** — contextos diferentes.
- **`ExportDialog` vs `ExportButton`** — ya resuelto en H-03.
- **`QuotationPanel`** — ya centralizado.
- **form-kits / useOperation / Field** — ya resueltos (H-01).

---

## 6. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Extender `SummaryBar` rompe a los 5 consumidores actuales | Baja | Los slots nuevos son **opcionales**. |
| Migrar `metric-bar` del dashboard pierde la lógica de permisos | Media | La lógica de `permissions` queda en el call site. |
| `FilterToolbar` no cubre un caso de los módulos de prevención | Media | Empezar por el piloto de 4; extender antes que forkar. |
| Refactor de tablas raw introduce regresiones | Media | Migrar de a una lista, correr tests entre cada una. |

---

## 7. Cómo verificar el cierre de cada fase

```bash
# Fase 1 — KPI/métricas consolidadas
grep -rn "border-y border-\[var(--color-border)\]" app components | grep -v summary-bar
test -f components/ui/kpi-card.tsx
grep -rn "function Kpi(" app

# Fase 2 — FilterToolbar piloto
grep -rl "FilterToolbar" app | wc -l   # → ≥6
grep -rl "useUrlFilters" app | wc -l   # → ≥4

# Fase 3 — DataTable adopción
grep -rl "from.*@/components/admin/data-table" app | wc -l  # → ≥30 (25 base + 4 prevención + 1 pdtp)

# Fase 4 — FilterToolbar total
grep -rl "FilterToolbar" app | wc -l   # ≥15

# Fase 5 — deudas menores
grep -rl "toLocaleDateString" app components   # → 0
```

---

## 8. Notas de implementación

- **Regla de oro:** cada cambio toca **un módulo a la vez**, con `typecheck + lint + test` entre cada uno.
- **No agregar comentarios** salvo que el patrón no sea obvio.
- **Respetar `AGENTS.md`**: usar `PageHeader`, `PageContainer`, `Field`, `formatDate`/`formatDateTime`, `ExportButton`/`ExportDialog` donde aplique.
- **Mantenibilidad antes que brides:** si un módulo necesita un caso que `FilterToolbar`/`SummaryBar` no cubren, **extender el componente base** antes que forkar.

---

## 9. Estado

- [x] Fase 0 — Verificación cero-daño (2026-07-24)
- [x] Fase 1 — Consolidación de KPI/métricas (2026-07-24)
- [x] Fase 2 — FilterToolbar piloto en prevención (2026-07-24)
- [x] Fase 3 — Adopción de DataTable en 5 listas (2026-07-24)
- [x] Fase 4 — Replicar Fase 2 en resto de módulos (2026-07-24)
- [x] Fase 5 — Deudas menores (2026-07-24)
