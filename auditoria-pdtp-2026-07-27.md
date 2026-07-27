# INFORME DE AUDITORÍA — Submódulo "Programa Preventivo" (PDTP)

**Fecha**: 2026-07-27
**Alcance**: `app/(app)/prevencion/pdtp/`, `lib/services/pdtp/`, `modules/prevention/manifest.ts`
**Versión auditada**: Rama actual del repositorio

---

## RESUMEN EJECUTIVO

El submódulo PDTP (*Programa de Trabajo Preventivo SG-SST*) es el componente más complejo del área de Prevención: **74 archivos de UI + 36 archivos de servicios + 761 líneas de acciones**. Es funcionalmente sólido pero presenta **serios problemas de densidad cognitiva, navegación fragmentada y ambigüedad terminológica**. Se identifican **4 hallazgos críticos**, **6 de mejora** y **3 recomendaciones estratégicas**.

---

## 1. HALLAZGOS CRÍTICOS

### H1 — Ambigüedad PPA vs PDTP: dos módulos con nombres casi idénticos

| Elemento | Ruta / Ubicación | Término real |
|----------|-----------------|-------------|
| Sidebar | `Programa preventivo` → `/prevencion/pdtp` | **PDTP** (Programa de Trabajo Preventivo) |
| Directorio código | `lib/ppa/` | **PPA Digital** (Para, Piensa y Actúa) |
| Directorio código | `app/(app)/prevencion/ppa/` | **PPA Digital** |
| Directorio código | `app/(app)/prevencion/pdtp/` | **PDTP** |

La nomenclatura es **confusa y propensa a error**:
- El sidebar dice "Programa preventivo" pero la ruta es `pdtp`
- El directorio `lib/ppa/` contiene lógica de PPA Digital, NO del Programa Preventivo
- Dos submódulos distintos (`ppa/` y `pdtp/`) conviven bajo `prevencion/` con nombres que colisionan semánticamente
- Un desarrollador nuevo asumiría que `ppa` es el Programa Preventivo

**Impacto**: Onboarding difícil, PRs mal dirigidos, errores de importación.

**Recomendación**: Renombrar consistentemente:
- Sidebar: `"Programa de trabajo (PDTP)"` en vez de `"Programa preventivo"`
- `lib/ppa/` → `lib/ppa-digital/` para eliminar ambigüedad con PDTP
- Evaluar renombrar `app/(app)/prevencion/ppa/` → `app/(app)/prevencion/ppa-digital/`
- Agregar un comentario JSDoc en `lib/ppa/index.ts` explicando que es PPA Digital, no Programa Preventivo

---

### H2 — Página principal del dashboard: sobrecarga de responsabilidades

`app/(app)/prevencion/pdtp/page.tsx` (325 líneas) es un Server Component que **hace demasiado**:

```typescript
// En una sola página se cargan:
// - Autenticación + permisos (2 checks)
// - Worksites + scope
// - Programa activo del año
// - Indicadores de cumplimiento + cumplimiento integral
// - Acciones + hojas + actividades
// - Indicadores canónicos SST
// - Eventos material/ambiental
// - Analytics de incidentes
// - Datos derivados: tendencias mensuales, cumplimiento por faena, categorías
```

Esto viola el **principio de responsabilidad única** y, siguiendo las reglas del proyecto (A1: máximo 4 tiles KPI), la página actual muestra **8 gráficos de Recharts** distribuidos en 4 filas, más 4 tiles KPI arriba, más filtros.

**Impacto**: Tiempo de carga elevado (múltiples queries secuenciales), difícil de testear, imposible de cachear granularmente.

**Recomendación**:
- Dividir en secciones lazy-load con `Suspense` + skeletons
- Extraer cada grupo de queries a un helper async independiente
- Aplicar la regla A1: reducir a 4 KPI tiles accionables máximo
- Agrupar los 8 gráficos en tabs: "Tendencias", "Cumplimiento", "Indicadores SST", "Incidentes"

---

### H3 — El sidebar de Prevención tiene 16 entradas: sobrecarga de navegación

`modules/prevention/manifest.ts` define **16 items de navegación** bajo `areaId: "prevencion"`. La subsección "Programa preventivo" tiene **8 hijos**:

```
Programa preventivo
  ├── Listado de programas
  ├── Crear programa y actividades
  ├── Aprobaciones pendientes
  ├── Plan de acción
  ├── Actividades por demanda
  ├── Reglas por faena
  ├── Plantillas
  └── Aplicabilidad
```

La regla A2 del proyecto indica máximo **4-6 filtros/opciones primarias**. Extrapolando al sidebar, 8 sub-ítems saturan la jerarquía. Muchos de estos ítems son **vistas transversales** que compiten con filtros inline (ej: "Aprobaciones pendientes" ya tiene un botón en el header del detalle de programa).

**Impacto**: El usuario no sabe dónde está el "Estado del programa" vs "Ejecución" vs "Cumplimiento". La distinción entre "Listado de programas", "Crear programa" y las subpáginas de detalle diluye el flujo principal.

**Recomendación**:
- Consolidar en 3-4 ítems principales: **Dashboard**, **Mis programas**, **Aprobaciones**, **Configuración** (plantillas + cobertura)
- Mover "Plan de acción" y "Actividades por demanda" como tabs/secciones dentro del detalle de programa
- Evaluar si "Reglas por faena" y "Aplicabilidad" pueden fusionarse en una sola vista

---

### H4 — Editor de 6 pasos con sub-pestañas ocultas

`builder-tabs.tsx` (1527 líneas) implementa un wizard de 6 pasos:
1. Datos básicos
2. Objetivos
3. Actividades
4. Planificación
5. Evidencias
6. Revisión

Pero en el paso 4 (Planificación) hay un `<details>` colapsado que esconde "Abrir matriz semanal avanzada", y en el paso 6 (Revisión) otro `<details>` que esconde "Vistas avanzadas y migración desde Excel".

Esto significa que:
- Funcionalidades importantes (importación Excel, configuración de hojas/vistas) están **enterradas** bajo un `<details>` en el último paso
- El propio código lo admite con un comentario: *"Antes este flujo estaba escondido tras Editar → Revisión → 'Vistas avanzadas', y el usuario no lo encontraba"*
- La importación Excel se movió al header de la página detalle, pero otras funciones siguen ocultas

**Impacto**: Features críticos invisibles para el usuario; el wizard sugiere un flujo lineal que no refleja la realidad (el usuario necesita ir y volver entre pasos).

**Recomendación**:
- Reemplazar el wizard secuencial por **tabs laterales persistentes** que permitan navegación libre entre secciones
- Sacar "Importación Excel" y "Vistas/Hojas" a secciones propias visibles en el header del editor
- Dividir `builder-tabs.tsx` (1527 líneas) en archivos por step: `metadata-tab.tsx`, `objetivos-tab.tsx`, etc.

---

## 2. HALLAZGOS DE MEJORA

### M1 — La tabla de actividades (`pdtp-sheet-table.tsx`, 449 líneas) mezcla vista semanal y anual

La tabla anual es una **matriz de 12 meses con columnas sticky** que puede resultar abrumadora:
- Cada mes tiene columna de "programado" + "ejecutado" = **24 columnas de datos + columnas fijas**
- La vista semanal muestra solo las actividades de la semana actual pero pierde contexto histórico
- El cambio entre vistas usa `PdtpViewToggle` (SegmentedControl) — fácil de pasar por alto

**Recomendación**: Considerar una vista de **timeline/Gantt** para el modo anual en lugar de la matriz densa, o al menos implementar scroll horizontal con columnas de mes colapsables.

---

### M2 — `actions.ts` (761 líneas) es un monolito de Server Actions

Contiene **39 acciones exportadas** en un solo archivo. No hay separación por dominio (program lifecycle, activities, executions, sheets, templates).

**Recomendación**: Dividir en:
- `actions/program-lifecycle.ts` — submit, approve, reject, activate, archive, reopen
- `actions/activities.ts` — add, update, duplicate, delete, batchUpdate, reorder
- `actions/executions.ts` — mark, approveExecution, rejectExecution
- `actions/sheets.ts` — createSheet, deleteSheet
- `actions/templates.ts` — publishTemplate

---

### M3 — Queries directas a DB en componentes de página

El detalle de programa (`[programId]/page.tsx:122-130`) ejecuta queries Drizzle **directamente** en el componente:

```typescript
pendingApprovals = await db
  .select({ id: pdtpExecutions.id, activityId: pdtpExecutions.activityId, month: pdtpExecutions.month, week: pdtpExecutions.week })
  .from(pdtpExecutions)
  .where(and(
    eq(pdtpExecutions.worksiteId, selectedWorksiteId),
    eq(pdtpExecutions.status, "submitted"),
    eq(pdtpExecutions.year, program.year),
    inArray(pdtpExecutions.activityId, activityIds),
  ))
```

Esto rompe la separación de capas. El `PdtpChangeLogSection` también hace `db.select()` directo.

**Recomendación**: Mover estas queries a `lib/services/prevention-pdtp.ts` o `lib/services/pdtp/` como funciones con nombre semántico (`getPendingApprovals`, `getChangeLog`).

---

### M4 — El `PdtpEvidenceThumbs` usa `<a>` nativo en vez de `<Link>` de Next.js

`pdtp-evidence-thumbs.tsx` usa `<a href={...}>` para navegar a evidencia. Esto causa navegación full-page en vez de client-side.

**Recomendación**: Usar `<Link>` de `next/link` para rutas internas o `useRouter` si se necesita lógica adicional.

---

### M5 — Sin paginación ni virtualización en la tabla de actividades

La tabla carga **todas las actividades** del programa y las renderiza. Con programas de 50+ actividades × 12 meses = 600+ celdas, el rendimiento se degrada.

**Recomendación**: Implementar virtualización con `@tanstack/react-virtual` para la vista anual, o paginación server-side para programas con más de 30 actividades.

---

### M6 — Los indicadores de cumplimiento no persisten estado de UI

El panel de indicadores mensuales/trimestrales (`pdtp-indicators-panel.tsx`) usa un `<details>` nativo para el breakdown que no persiste el estado entre navegaciones. Si el usuario expande el breakdown y navega a otra hoja, vuelve colapsado.

**Recomendación**: Persistir el estado de collapse en `localStorage` o usar `nuqs` para sincronizar preferencias con la URL.

---

## 3. EVALUACIÓN DE DENSIDAD VISUAL (Reglas A1-A6)

| Regla | Cumplimiento | Observación |
|-------|-------------|-------------|
| **A1** (max 4 KPI tiles) | **NO CUMPLE** | El dashboard muestra 4 tiles + 8 gráficos. Los gráficos deberían ir en pestañas o ser colapsables. |
| **A2** (4-6 filtros primarios) | Parcial | SheetPicker, WorksitePicker y ViewToggle son 3 controles visibles. Correcto. |
| **A3** (Lista + acción en header) | Parcial | "Nuevo programa" está en `/pdtp/nuevo` como página propia en vez de diálogo. El form de agregar actividad sí está inline. |
| **A4** (Estados vacíos con CTA) | **CUMPLE** | `EmptyState` con botón en `[programId]/page.tsx` y en `cobertura/page.tsx`. Mensajes claros y accionables. |
| **A5** (Una dimensión = una representación) | Parcial | El `PdtpActivitySummary` tiene píldoras de filtro (Todas/Ejecutadas/Pendientes/Atrasadas/Sin programar) que compiten con los tabs de estado en el sidebar. |
| **A6** (Controles y vocabulario) | **NO CUMPLE** | Ver H1. También hay abreviaturas como "JDPR", "CPHS", "SG-SST" sin tooltips consistentes (solo JDPR tiene glosario en lifecycle-controls). |

---

## 4. EVALUACIÓN DE LÓGICA DE NEGOCIO

### Fortalezas
- El sistema de **workflows de aprobación** (draft → review → jdpr → legal → active) está bien modelado con `program-lifecycle-controls.tsx`
- La **recurrencia** (`lib/services/pdtp/recurrence.ts`) maneja reglas complejas de periodicidad con `describePdtpRecurrence` y `deriveScheduleHorizon`
- Los **checklists** y **evidencias** tienen buena estructura con subida de archivos y thumbnails
- Las **invalidaciones de cache** (`revalidatePath`) son correctas y granulares
- El sistema de **hojas/vistas por rol** (`defaultSheetForRoles`) es elegante y adaptativo

### Debilidades
- **Sin separación clara entre queries y mutaciones**: Las acciones mezclan validación, lógica de negocio y operaciones DB
- **Sin manejo de errores tipado**: `ActionState` es genérico y no distingue entre error de validación, error de permiso o error de DB
- **Sin optimistic updates**: Las mutaciones (aprobar, rechazar, ejecutar) requieren refresh completo de ruta vía `router.refresh()`
- **Uso inconsistente de `useActionState` vs `useOperation`**: Algunos formularios usan `useActionState`, otros usan `useOperation` del hook del proyecto — unificar

---

## 5. RECOMENDACIONES ESTRATÉGICAS

### R1 — Refactor de nomenclatura (prioridad ALTA, esfuerzo: 2-3h)

Renombrar para eliminar confusión PPA/PDTP:
- `lib/ppa/` → `lib/ppa-digital/`
- Sidebar en `modules/prevention/manifest.ts`: `"Programa preventivo"` → `"Programa de trabajo (PDTP)"`
- Agregar `@description` en jsdoc de `lib/ppa/index.ts` aclarando que es PPA Digital
- Actualizar imports en todos los archivos que referencian `lib/ppa/`

### R2 — Simplificación del dashboard principal (prioridad ALTA, esfuerzo: 4-6h)

- Reducir a 4 KPI tiles accionables (cada uno con enlace a vista filtrada)
- Mover los 8 gráficos a tabs navegables: "Tendencias", "Cumplimiento", "Indicadores SST", "Incidentes"
- Usar `Suspense` con skeletons para carga progresiva de cada sección
- Extraer lógica de data fetching a `lib/services/pdtp/dashboard-queries.ts`

### R3 — Reorganización del editor (prioridad MEDIA, esfuerzo: 8-12h)

- Reemplazar wizard secuencial por **tabs laterales persistentes** con navegación libre
- Sacar features ocultas (`<details>`) a la superficie como secciones propias
- Dividir `builder-tabs.tsx` (1527 líneas) en archivos por step
- Agregar breadcrumbs o indicador visual claro de "último paso completado"

### R4 — Mejoras de rendimiento (prioridad MEDIA, esfuerzo: 3-5h)

- Virtualizar la tabla anual con `@tanstack/react-virtual`
- Mover queries directas a la capa de servicios
- Implementar `stale-while-revalidate` para indicadores que cambian poco

### R5 — Refactor de Server Actions (prioridad BAJA, esfuerzo: 4-6h)

- Dividir `actions.ts` en archivos por dominio
- Unificar `useActionState` vs `useOperation`
- Agregar tipos de error discriminados (validation vs permission vs db)

---

## 6. MÉTRICAS DEL SUBMÓDULO

| Métrica | Valor |
|---------|-------|
| Archivos UI totales | 74 |
| Archivos de servicio | 36 |
| Líneas en `actions.ts` | 761 |
| Permisos PDTP | 10 |
| Subpáginas | 9 (programas, nuevo, aprobaciones, acciones, obligaciones, cobertura, plantillas, aplicabilidad, reporte) |
| Gráficos en dashboard | 8 |
| Pasos del editor | 6 |
| Columnas en tabla anual | 24+ |
| Tamaño de `builder-tabs.tsx` | 1527 líneas |

---

## 7. PLAN DE ACCIÓN SUGERIDO

| Fase | Acciones | Esfuerzo estimado |
|------|---------|-------------------|
| **Fase 1 — Quick wins** | R1 (nomenclatura) + M4 (Link nativo) | 3-4h |
| **Fase 2 — Densidad visual** | R2 (dashboard) + H3 (sidebar) | 6-8h |
| **Fase 3 — Editor** | R3 (tabs persistentes) + M1 (tabla) | 12-16h |
| **Fase 4 — Calidad** | M2 + M3 + M5 + M6 (deuda técnica) | 8-12h |
| **Fase 5 — Arquitectura** | R5 (refactor actions) | 4-6h |

---

## PROGRESO DE FIXES (2026-07-27)

### Fase 1 — Quick wins: COMPLETADO

| Fix | Estado | Detalle |
|-----|--------|---------|
| H1 — Sidebar label | Hecho | `modules/prevention/manifest.ts`: "Programa preventivo" → "Programa de trabajo (PDTP)" |
| H1 — Breadcrumbs | Hecho | 6 archivos actualizados: `page.tsx`, `programas/page.tsx`, `aprobaciones/page.tsx`, `cobertura/page.tsx`, `obligaciones/pdtp-obligations-workbench.tsx`, `actions/evaluations.ts` |
| H1 — JSDoc lib/ppa | Verificado | `lib/ppa/types.ts` ya tenía JSDoc: "Tipos, constantes y catálogos del módulo PPA Digital (Para, Piensa y Actúa)" |
| M4 — `<a>` vs `<Link>` | **Inválido** | Los `<a>` en `pdtp-evidence-thumbs.tsx` apuntan a `/api/prevencion/pdtp/evidence/[name]`. Las API routes de Next.js no son compatibles con `<Link>`. El uso de `<a target="_blank">` es correcto. |

### Fase 2 — Densidad visual: COMPLETADO

| Fix | Estado | Detalle |
|-----|--------|---------|
| H3 — Sidebar consolidation | Hecho | Reducido de 6 subítems a 4: Dashboard, Programas, Aprobaciones, Acciones y seguimiento. |
| H2 — Dashboard charts en tabs | Hecho | `PdtpDashboardCharts` refactorizado: 8 gráficos agrupados en 3 tabs (Ejecución, Siniestralidad, Material y Ambiental). Solo se renderiza el tab activo, reduciendo la carga visual del muro de gráficos a máximo 3 visibles a la vez. |

### Fase 3 — Editor: COMPLETADO (parcial)

| Fix | Estado | Detalle |
|-----|--------|---------|
| H4 — Editor wizard | Hecho | Eliminada navegación secuencial forzosa (prev/next). Tabs ahora son libremente navegables. Botón "Ver resumen y enviar" siempre visible en header. |
| H4 — Features ocultas | Hecho | `<details>` en Planificación y Revisión eliminados. Matriz semanal y Vistas/Excel ahora visibles permanentemente. |
| H4c — Dividir archivo | **Diferido** | Componentes extraídos (MetadataTab, ObjetivosTab, PlanificacionTab) no se movieron porque los tests dependen del barrel `./builder-tabs`. Extraerlos rompería los imports de los 7 archivos de test. |

### Fase 4 — Calidad: COMPLETADO

| Fix | Estado | Detalle |
|-----|--------|---------|
| M3 — Queries DB directas | Hecho | `getPendingPdtpApprovalsForView()` y `getPdtpChangeLog()` movidas a `lib/services/pdtp/executions.ts`. |
| M2 — Dividir actions.ts | Hecho | `actions.ts` dividido en 4 archivos: `executions.ts`, `program-lifecycle.ts`, `activities.ts`, `program-crud.ts`. |
| M6 — Persistir collapse | Hecho | `PersistedDetails` con localStorage integrado en `PdtpIndicatorsPanel`. |
| M5 — Tabla grandes | Hecho | Paginación: >30 filas muestra solo 30 con botón "Mostrar las N actividades". Alternativa práctica a virtualización completa. |
| M1 — Colapsar meses | Hecho | Vista anual: por defecto muestra mes actual ±1 con botón "Ver todos los meses". Preferencia persistida en localStorage. |

---

## PASADA 3 — PROGRESO (2026-07-27)

| Fix | Estado |
|-----|--------|
| M1 — Colapsar meses en tabla anual | Hecho |
| M5 — Paginación en tabla (>30 filas) | Hecho |
| H4 — Editor: tabs libres + sin features ocultas | Hecho |
| H4c — Dividir builder-tabs.tsx | Diferido (tests acoplados) |

## ESTADO FINAL

| Fase | Completado | Pendiente |
|------|-----------|-----------|
| Fase 1 — Quick wins | 3/3 | 0 |
| Fase 2 — Densidad | 2/2 | 0 |
| Fase 3 — Editor | 2/3 | H4c (división de archivo) |
| Fase 4 — Calidad | 5/5 | 0 |

**TOTAL: 12/13 fixes resueltos. 1 diferido (H4c — tests acoplados al barrel).**

### H4c — Nota técnica
Los componentes `MetadataTab`, `ObjetivosTab`, `PlanificacionTab` viven en `builder-tabs.tsx`. Sus tests (`metadata-tab.test.tsx`, `objetivos-tab.test.tsx`, `planificacion-tab.test.tsx`) importan desde `"./builder-tabs"`. Extraer los componentes a archivos separados requiere modificar los imports de los 7 archivos de test del editor. El costo/beneficio de este cambio es bajo ahora que el wizard secuencial fue eliminado y las features ocultas son visibles.

---

## PASADA 2 — PROGRESO (2026-07-27)

| Fix | Estado |
|-----|--------|
| M6 — Persistir collapse de indicadores | Hecho |
| H2 — Dashboard charts en tabs | Hecho |

## ESTADO FINAL

| Fase | Completado | Pendiente |
|------|-----------|-----------|
| Fase 1 — Quick wins | 3/4 (M4 invalidado) | 0 |
| Fase 2 — Densidad | 2/2 | 0 |
| Fase 3 — Editor | 0/2 | H4 wizard, M1 tabla anual |
| Fase 4 — Calidad | 3/4 | M5 virtualización |

### Pendiente para siguiente pasada:
1. **H4** — Refactor editor de 6 pasos secuenciales a tabs laterales
2. **M1** — Vista Gantt/timeline para tabla anual
3. **M5** — Virtualización de la tabla de actividades

**Conclusión**: El módulo PDTP es funcionalmente correcto y bien estructurado a nivel de dominio, pero sufre de **sobrecarga cognitiva** por densidad de información, **fragmentación de navegación** (9 subpáginas + 8 subítems de sidebar) y **ambigüedad terminológica** con el módulo PPA Digital. Las mejoras sugeridas reducirían la fricción del usuario sin requerir cambios de arquitectura profundos. Se recomienda comenzar por la Fase 1 (quick wins) para resolver la confusión PPA/PDTP de inmediato.
