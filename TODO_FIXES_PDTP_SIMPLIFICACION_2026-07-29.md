# TODO — Cierre de auditoría: programa anual PDTP

Fecha: 2026-07-29  
Estado inicial: **NO-GO**  
Estado tras fixes: **GO técnico del código / NO-GO operativo**, hasta publicar
la revisión Base con digest v8 y desplegar las migraciones.

Este checklist recoge todos los hallazgos confirmados durante la auditoría de
la simplificación del programa anual PDTP. Un ítem solo se marca como cerrado
cuando existe implementación y prueba proporcional al riesgo.

## P0 — Autorización e integridad operacional

- [x] Eliminar la mutación heredada `setPdtpActivityWorksiteParamsAction` y
      enrutar toda edición por `setPdtpActivityWorksiteAdjustment`.
- [x] Exigir alcance de faena, membresía del programa, estado editable,
      actividad activa y bitácora en cada ajuste por faena.
- [x] Revalidar actividad, programa, revisión, faena activa y membresía dentro
      de la misma transacción bloqueada que escribe el ajuste.
- [x] Reservar el reemplazo de la cobertura global de faenas a usuarios con
      alcance global; los usuarios acotados conservan los ajustes de sus faenas.
- [x] Impedir ejecuciones nuevas para actividades excluidas en la faena.
- [x] Impedir ejecuciones posteriores al retiro efectivo de una actividad.
- [x] Impedir que actividades retiradas generen planificación, cumplimiento o
      recordatorios posteriores a `effectiveFrom`.

## P1 — Retiro, historial y contenido firmado

- [x] Hacer atómico el retiro junto con su entrada de bitácora.
- [x] Aplicar `effectiveFrom` por período, conservando planificación,
      ejecuciones e informes anteriores a la fecha.
- [x] Incluir actor y fecha de retiro en el digest firmado.
- [x] Materializar correctamente plantillas que contengan actividades retiradas,
      remapeando la fecha al año destino y satisfaciendo constraints.
- [x] Mantener visibles los resultados históricos de actividades retiradas.

## P1 — Base 2026 y creación anual

- [x] Crear una publicación administrativa exclusiva para revisiones de Base
      2026, validando año, checksum, 87 actividades, ausencia de 4/8, 821
      celdas, 1.013 unidades y cero ejecuciones.
- [x] Retirar del editor normal la publicación arbitraria de plantillas.
- [x] Impedir que la importación autoritativa deje actividades ajenas a General
      o reactive retiros silenciosamente.
- [x] Mantener las revisiones publicadas físicamente inmutables, incluso durante
      rollback.
- [x] Retirar la API pública antigua `createPdtpProgram` y sus variantes
      blank/copy/template incompatibles con `UNIQUE(year)`.
- [x] Implementar comparación del programa contra su revisión Base 2026,
      incluyendo actividades, retiros y ajustes por faena.

## P1 — Informes y Excel

- [x] Corregir el filtro de responsables para usar claves estables.
- [x] Resolver responsable efectivo por faena en pantalla y Excel.
- [x] Incorporar filtro por actividad.
- [x] Conservar historial de retiradas sin contabilizar planificación posterior
      al retiro.

## P1 — Migración

- [x] Convertir el reconciliador anual en preflight obligatorio antes de
      `db:migrate`.
- [x] Detectar filas `internal_objective` antes de aplicar el nuevo CHECK y
      entregar un error accionable.
- [x] Confirmar que 0129/0130 fueron generadas desde el esquema, que el único
      backfill custom de `display_order` es idempotente y está anexado a la
      migración nueva, sin alterar ninguna migración histórica ni el journal a
      mano.

## P2 — UI y mantenibilidad

- [x] Reemplazar estado manual `pending/error` por `useOperation` en el panel de
      ajustes.
- [x] Usar `Field` para el checkbox de exclusión.
- [x] Generar y mostrar fechas con utilidades locales (`todayLocalISO`,
      `formatDate`).
- [x] Recuperar cobertura equivalente a los cinco E2E eliminados: E2E para
      retiro, herencia, ceros explícitos, exclusión y revisión Base; PGlite
      negativo para errores de alcance.
- [x] Proponer una fecha de retiro dentro del período de programas futuros,
      limitar el DatePicker al período y anunciar campo + valor a tecnologías
      asistivas.

## Validación de cierre

- [x] Tests unitarios/focalizados PDTP: 60/60.
- [x] Tests PostgreSQL/PGlite de autorización, retiro, Base e informes: 16/16
      focalizados y 60/60 del contrato integral.
- [x] E2E PDTP relevantes: cero explícito/herencia, exclusión/reinclusión,
      comparación Base y retiro.
- [x] `npm run db:generate` sin cambios pendientes.
- [x] `npm run db:verify-migrations`: 131 entradas hasta 0130.
- [x] `npx tsc --noEmit`.
- [x] ESLint focalizado.
- [x] `npx react-doctor@latest --verbose --scope changed` ejecutado; el gate
      queda rojo únicamente por la deuda externa detallada abajo.
- [x] Build de producción ejecutado por el servidor E2E de Playwright.
- [x] `git diff --check`.

## Deudas no bloqueantes y decisiones posteriores

- [ ] Publicar una nueva revisión Base 2026 con `schemaVersion: 8`. Las
      revisiones locales v1/v2 fueron publicadas con digest v7 antes de añadir
      actor y fecha de retiro al contenido firmado.
- [ ] Resolver explícitamente el pin del programa fuente `pdtp-2026-v1`: hoy
      tiene `sourceTemplateVersionId = null`. Definir si el programa fuente es
      una excepción documentada o si se enlaza a la nueva revisión después de
      publicarla; los programas futuros sí se fijan automáticamente.
- [ ] Respaldar la base objetivo, desplegar, ejecutar el preflight y
      `db:migrate`, y comprobar los invariantes nuevamente en el entorno de
      destino. La validación actual corresponde a desarrollo/E2E.
- [ ] Revisar/aceptar o reemplazar `pdfjs-dist@6.1.200`: React Doctor le asigna
      31/100 en el eje de cadena de suministro de Socket. No reporta una
      vulnerabilidad conocida y cambiar el motor PDF requiere una evaluación
      separada de compatibilidad.

### Inventario React Doctor pendiente

- [ ] **Necesita perfilado — 2 awaits aparentemente independientes:** revisar
      `lib/services/pdtp/content-digest.ts:113,213`. El `QueryClient` también
      puede ser una transacción; no aplicar `Promise.all` sin probar ese camino.
- [ ] **Necesita revisión de orden/atomicidad — 23 awaits en loops:** revisar
      `activities.ts`, `catalog.ts`, `imports.ts`, `reminders.ts`, `sheets.ts`,
      `templates.ts` y `worksites.ts`. Varios generan IDs, escriben bitácora o
      materializan filas en orden, por lo que no son paralelizables a ciegas.
- [ ] **P2 UI — estado derivado/sincronizado:** revisar `metadata-tab.tsx`,
      `nuevo/create-form.tsx`, `guided-activity-form.tsx` y
      `aplicabilidad/pdtp-aplicabilidad-client.tsx`; incluye el redirect tras
      borrado y la recomendación de agrupar estado con `useReducer`.
- [ ] **P2 rendimiento local:** sustituir búsquedas repetidas y cadenas
      `map/filter` solo donde el perfil lo justifique en `metadata-tab.tsx`,
      `[programId]/page.tsx`, `revision-tab.tsx`, `actions/activities.ts`,
      `imports.ts`, `management-report.ts`, `obligations.ts`, `reminders.ts`,
      `sheets.ts`, `templates.ts` y `worksites.ts`.
- [ ] **P2 mantenibilidad:** extraer la función pura local de `pdtp/page.tsx`,
      estabilizar defaults vacíos de `pdtp-add-activity-form.tsx` y dividir
      `PdtpDashboardPage`/`PdtpSheetTable` solo en una refactorización con
      regresión visual y funcional propia.
- [ ] **Fuera del alcance PDTP:** revisar avisos de propagación de estado en
      `app/(app)/solicitudes/use-request-form.ts` y el formato Zod heredado en
      `lib/validation/prevention-module/risk-legal.ts`; esos avisos no se
      abordaron como parte de estos fixes.
