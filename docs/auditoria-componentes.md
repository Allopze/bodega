# Auditoría de componentes reutilizables — cierre de pendientes

Fecha de actualización: 2026-08-25
Alcance: `app/(app)/`, `components/` y `lib/`. Esta nota describe el estado del
árbol de trabajo después de aplicar el plan de cierre; no constituye evidencia
de despliegue ni de validación en producción.

## Estado ejecutivo

Los pendientes de implementación A1–A3, B1–B11, C2, C5, C6 y D5–D11 quedan
resueltos en el código actual. D6 queda marcado como implementado: la pantalla
de respuestas usa `useDebouncedAutosave` y conserva su mensaje de “Guardado
HH:MM”. C4 y C1b también quedan implementados en las superficies incluidas en
el plan.

La validación de esta actualización es local. Los cambios WIP ajenos siguen
presentes en el árbol y no se deben interpretar como parte de esta auditoría.
No se hicieron migraciones, cambios de schema, despliegues ni cambios de
contratos de servidor.

## Implementado

### Fase 1 — paginación y componentes pequeños

- Las paginaciones adicionales de trazabilidad, consumo detallado, cargas de
  combustible y facturas usan `ServerPagination` con `resolvePagination` y
  `buildPaginationHref`. Evidencia: `app/(app)/trazabilidad/page.tsx:9,165`,
  `app/(app)/combustibles/consumption-detail-table.tsx:10,105`,
  `app/(app)/combustibles/fuel-load-table.tsx:10,107` y
  `app/(app)/facturacion/facturas/page.tsx:3,243`.
- Los enlaces se construyen desde los parámetros actuales; los filtros no se
  descartan al cambiar de página. Las paginaciones históricas de anomalías,
  TAE, historial TAE y corridas de inspección permanecen en sus componentes
  compartidos ya existentes.
- `dashboard-charts.tsx` usa `formatCompactCLP` (`:31,521,564,811,932`) y no
  declara `compactCLPTick` local.
- El vocabulario de anomalías vive en
  `lib/combustibles/anomaly-labels.ts:7-37`, sin importar Drizzle/DB; el
  servicio conserva re-exportes server-side en
  `lib/combustibles/anomaly-cases.ts:18-29`.
- `scatter-charts.tsx` usa `ChartEmpty` (`:5,63-69`) y conserva icono, altura,
  borde y copy de cada estado vacío.
- Los tres skeletons lazy (`combustibles/consumption-charts-lazy.tsx`,
  `combustibles/operations-charts-lazy.tsx` y
  `combustibles/analisis/analysis-charts-lazy.tsx`) conservan sólo su geometría
  específica y heredan color, animación y radio de `Skeleton`.
- Mantenciones centraliza label y variant en
  `lib/validation/maintenance.ts:38`, con regresión en
  `lib/__tests__/maintenance-validation.test.ts:41-47`; las tres superficies
  (`maintenance-table.tsx`, `maintenance-order-workbench.tsx` y sus filtros)
  consumen el mismo helper.

### Fase 2 — filtros de listas server-side

- `components/ui/server-list-filters.tsx:25-188` reemplaza el componente legacy
  y soporta búsqueda `q` con debounce de 350 ms, selects configurables,
  chips de factura/solicitud/período, limpieza total, `SavedViews`, export y
  acciones de página.
- `lib/hooks/use-url-filters.ts:13-49` permite resetear `page` y `pendientes`
  junto con cualquier filtro nuevo.
- El componente se usa en compras, solicitudes, aprobaciones y recepción;
  los cuatro consumidores importan `ServerListFilters` y
  `ServerListFilterOption` desde el hogar canónico.
- `components/ui/list-filters.tsx` ya no existe en el árbol de trabajo y no
  quedan imports ni referencias funcionales a `LIST_FILTER_PARAMS`.

Las superficies de consumos, mantenciones y TAE quedan como excepciones
intencionales: tienen copy, filtros de contexto o contratos GET propios que no
son equivalentes a las listas de adquisiciones.

### Fase 3 — tablas

Las tablas raw de facturación, bodega, compras, administración, pendientes,
prevención/PDTP y combustibles fueron migradas a `Table`/`TableRoot`, con
`TableHeader`, `TableBody`, captions accesibles donde correspondía y sin tocar
queries, permisos, ordenamiento ni exportaciones. Ejemplos de evidencia:

- Facturación: `facturacion/page.tsx:23`, `cobranza/page.tsx:26`,
  `pendientes/page.tsx:21`, `propuestas/page.tsx:21` y las tablas de
  facturas/clientes/sincronización.
- Bodega: `bodega/kardex-table.tsx:9`, `stock-table.tsx:18` y
  `documentos/documents-table.tsx:9`; se mantiene la vista móvil especializada.
- Compras: `compras/dte/page.tsx:16`, `compras/[id]/oc-detail-items.tsx:4` y
  `invoice-reconciliation-card.tsx:21`.
- Administración: `admin/backups/backup-list.tsx:7`, `admin/dte/dte-sync-list.tsx:5`,
  `admin/flota-catalogos/estanques-combustible/storage-catalog.tsx:11` y
  `admin/suplencias/suplencias-client.tsx:27`.
- Prevención y combustibles: `prevencion/campanas/campanas-client.tsx:20`,
  tabs PDTP, `combustibles/sellos/page.tsx:20`, `analisis/page.tsx:21` y
  `ciclo/page.tsx:20`.

Se conserva `DataTable` sólo cuando la superficie es una lista tabular con
columnas, búsqueda y paginación compatibles. Las celdas combinadas, acciones
complejas, agrupaciones por faena y layouts móviles siguen en `Table` o en el
componente especializado. La búsqueda `rg -n '<table' 'app/(app)' components
--glob '*.tsx'` deja únicamente la implementación compartida de
`components/ui/table.tsx` y un comentario no ejecutable.

### Fase 4 — imports de combustibles

- Los dos wrappers mantienen sus interfaces públicas y sus schemas, payloads,
  acciones server, columnas, permisos, URLs y reglas de dominio separadas.
- Se extrajeron primitivas pequeñas para errores y descarga, confirmación de
  duplicados y selección/arrastre de archivo:
  `app/(app)/combustibles/importar/import-wizard-primitives.tsx:15-116`.
- Se compartieron badge y filtro de estado del historial en
  `import-history-primitives.tsx:6-19`.
- `ImportWizard` y `OperationsImportWizard` consumen esas primitivas en sus
  pasos `form → preview → done`, sin convertirlos en un componente monolítico.

### Fase 5 — identidad y documentación

`usePpaIdentity` y `useTaeIdentity` permanecen como adaptadores separados sobre
`useRutIdentity`: sus backends, caché offline, mensajes y efectos de dominio no
son intercambiables. Esta es una excepción intencional, no deuda pendiente.

## Pendientes y excepciones restantes

- Las tres superficies de filtros custom indicadas en Fase 2 no se migran al
  contrato de listas server-side.
- No se unifican los adapters públicos PPA/TAE ni las reglas específicas de sus
  importaciones.
- La equivalencia visual en escritorio y móvil requiere ejecutar el harness de
  navegador/capturas. El código está preparado para esa verificación, pero una
  captura local no demuestra el estado de producción.
- Los archivos WIP ajenos a esta ola se conservan sin rebasar ni limpiar.

## Evidencia de verificación

Ejecutar y registrar en el cierre de la sesión:

```bash
npm run lint
npm run typecheck
npm run test:fast
npm run build
```

Además, la validación funcional debe cubrir filtros y paginación de compras,
solicitudes, aprobaciones, recepción y trazabilidad; tablas de bodega,
facturación, compras y administración; imports de combustibles; y regresión de
PPA/TAE. La revisión browser debe comprobar desktop y móvil, consola sin
errores, teclado, captions, estados vacíos y overflow horizontal usando
almacenamiento disposable.

## Relación con el inventario original

Los hallazgos A1–A3, B1–B11, C2, C5, C6 y D5–D11 ya no se reportan como
pendientes. C1b, C3, C4, C8 y D13 se cerraron en las superficies descritas en
este documento. D6 se implementó conservando el comportamiento de feedback.
Las únicas diferencias deliberadas son los filtros custom y los adapters
PPA/TAE, documentados arriba como excepciones de contrato.
