# Módulo PDTP — Constructor de Programas de Trabajo Preventivo

## Qué cambió

El módulo PDTP pasó de ser un **visor pasivo del Excel 2026** a un **sistema donde los usuarios crean, editan y gestionan sus propios programas** de trabajo preventivo año a año.

| Aspecto | Antes | Ahora |
|---|---|---|
| **Origen de datos** | Un solo Excel `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx` cargado vía seed | Los usuarios crean programas desde cero. El Excel queda como opción de importación |
| **Creación de programas** | Imposible desde la UI. Solo existía `pdtp-2026-v1` | Ruta `/prevencion/pdtp/nuevo` con formulario de creación (año, título). Redirige al builder |
| **URLs** | Una sola ruta `/prevencion/pdtp` con searchParams (`?hoja=`, `?faena=`, `?vista=`, `?anio=`) | URLs program-centric: lista, `/nuevo`, `/[programId]` (detalle), `/[programId]/editar` (builder) |
| **Lista de programas** | No existía | `/prevencion/pdtp` muestra cards por programa con año, versión, estado, % cumplimiento |
| **Editor de programa** | Solo un form para agregar actividades sueltas en modo draft | Builder con 5 tabs: Metadatos, Hojas, **Objetivos**, **Actividades**, **Planificación** |
| **Hojas (sheets)** | 8 fijas, globales, definidas en constantes | Las 8 plantilla persisten. Cada programa puede tener hojas custom scoped. Las plantilla se comparten entre programas |
| **Año hardcodeado** | `2026` aparecía en 5+ lugares (queries, formularios, export) | El año se deriva del programa (`program.year`). Sin hardcodeos |
| **Export** | Aceptaba solo `?year=` | Acepta `?programId=` además de `?year=` para backward compat |
| **Importar Excel** | Solo vía seed/script | Upload directo en el tab Metadatos del builder (reemplaza el contenido del programa, no acumula) |
| **Duplicar programa** | No existía | Al crear un programa, se puede elegir uno existente para copiar hojas + actividades + planificación |

## Lo que se mantiene igual

- **Ciclo de vida**: draft → aprobación JDPR → firma Legal → activar → closed
- **Registro de ejecuciones**: semanal, por faena, con evidencia (texto, URL, fotos)
- **Aprobaciones de ejecución**: submitted → approved/rejected con motivo
- **Indicadores de cumplimiento**: mensual, trimestral, anual
- **Control de cambios**: `pdtp_change_log` con entradas por sección
- **Overrides por faena**: cantidades planificadas ajustables por worksite
- **Exportación Excel**: mismo formato, mismo endpoint
- **Recordatorios semanales**: detección de pendientes
- **Permisos**: `prevention:pdtp:view|manage|approve|sign_legal`
- **Scoping por faena**: `resolveWorksiteScope` sin cambios
- **Catálogo de responsables**: `pdtp_responsible_catalog`

## Arquitectura de rutas

```
/prevencion/pdtp                      → Lista de programas (cards)
/prevencion/pdtp/nuevo                → Crear nuevo programa
/prevencion/pdtp/[programId]           → Detalle: visor de hoja, ejecuciones, lifecycle, compliance
/prevencion/pdtp/[programId]/editar    → Builder con tabs (solo drafts)
/prevencion/pdtp/aprobaciones          → Aprobaciones de ejecuciones (+?programId=)
```

## Cómo crear un programa nuevo

1. Ir a `/prevencion/pdtp` → click en **"Nuevo programa"**
2. Elegir año y título, opcionalmente **duplicar la estructura** de un programa existente (hojas + actividades + planificación) → **"Crear programa"**
3. Redirige al builder en `/prevencion/pdtp/[id]/editar`
4. En el tab **Metadatos**: ajustar título y compliance target, o **importar un Excel** para poblar el programa de una vez
5. En el tab **Hojas**: las 8 plantilla están disponibles automáticamente. Se pueden crear hojas custom
6. En el tab **Objetivos**: renombrar el objetivo compartido por cada grupo (1-8)
7. En el tab **Actividades**: editar, reordenar (↑/↓) o eliminar actividades ya creadas
8. En el tab **Planificación**: matriz semanal editable (mes × 4 semanas) por actividad, con "Rellenar" para fijar una cantidad en las 48 semanas de una fila antes de guardar
9. Volver al detalle del programa y usar **"Agregar actividad"** para sumar actividades nuevas
10. Cuando el programa esté listo: **Aprobar (JDPR)** → **Firmar (Legal)** → **Activar programa**
11. Con el programa activo, se pueden registrar ejecuciones semanales por faena

## Flujo de ejecución semanal

1. Seleccionar programa, hoja, faena y vista (semanal/anual) en el detalle
2. Para cada actividad del mes actual: registrar cantidad ejecutada + evidencia
3. Las ejecuciones quedan en `submitted` → un aprobador las aprueba o rechaza en `/aprobaciones`
4. Los indicadores de cumplimiento se actualizan automáticamente

## Cambios en base de datos

- `pdtp_sheets`: nueva PK `id` (texto), columna `program_id` (FK → pdtp_programs, **ON DELETE CASCADE**, nullable). Template sheets tienen `program_id = NULL`
- `pdtp_sheet_activities`: nueva columna `sheet_id` (FK → pdtp_sheets.id). `sheet_code` se conserva como dato
- `pdtp_programs`: check `year BETWEEN 2024 AND 2100`
- Migraciones: `db/migrations/0024_strong_polaris.sql` (PK swap de hojas), `db/migrations/0025_fast_cammi.sql` (cascade en `pdtp_sheets.program_id` — habilita borrar programas —, check de año, y limpieza de un índice `pdtp_sheets_label_unique` que había quedado huérfano desde 0024 y bloqueaba crear un segundo programa por año)

## Servicios nuevos

| Archivo | Propósito |
|---|---|
| `lib/services/pdtp/programs.ts` | `createPdtpProgram` (con duplicación completa vía `copySheetsFromProgramId`), `updatePdtpProgram`, `listPdtpPrograms`, `getPdtpProgram`, `deletePdtpProgram`, `importPdtpFromExcel` (reemplaza actividades del programa, no acumula) |
| `lib/services/pdtp/sheet-management.ts` | `createPdtpSheet`, `deletePdtpSheet`, `listPdtpProgramSheets` |
| `lib/services/pdtp/activities.ts` | `updatePdtpActivity`, `addPdtpActivity`, `deletePdtpActivity`, `reorderPdtpActivities` (atómico), `listPdtpProgramActivities`, `renamePdtpObjective` (rename masivo por grupo 1-8) |
| `lib/services/pdtp/sheets.ts` | `getPdtpSheetViewByProgram(programId, ...)`, `getPdtpSheetView(year, ...)` como wrapper backward-compatible, `resolveSheetForProgram` (resolución determinista template vs. program-scoped) |
| `lib/services/pdtp/compliance.ts` | `getPdtpComplianceIndicators` acepta `programId \| year` |
| `lib/services/pdtp/catalog.ts` | +`listPdtpResponsibleCatalog` (alimenta los `Select` de responsables) |
| `app/api/prevencion/pdtp/import/route.ts` | Import de Excel vía API route (no Server Action: el workbook real pesa varios MB y excede el límite de 1 MB de los Server Actions) |

## Pendiente (próximas iteraciones)

- **Tab Objetivos**: hoy es edición de texto por grupo (1-8); sin drag & drop para reordenar los grupos (no hay un concepto de "orden de objetivo" libre, solo el 1-8 fijo del catálogo)
- **Tab Actividades**: la edición inline no incluye responsables (`responsibleSlugs`/`responsibleDisplay`) para evitar colapsar accidentalmente una actividad con varios responsables a uno solo; se agregan/editan responsables al crear la actividad
- **Tab Planificación**: la matriz es semanal (mes × 4 semanas) por fila; sin selección de rango multi-fila para "rellenar" varias actividades a la vez (el rellenar actual es por fila)
