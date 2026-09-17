# Cierre de fixes de auditoría PDTP

Fecha: 2026-09-16  
Alcance: remediación de los hallazgos PDTP-A01–A13 de `2026-09-16-pdtp-changes-audit.md`.

## Cambios aplicados

- Las huellas de contenido ahora versionan el canonizador: la forma actual es v15, conserva la forma histórica v12/v13/v14 y añade el alcance corporativo explícito (`appliesToAllWorksites`) sin invalidar firmas existentes. Backlog, aprobación y activación verifican la forma almacenada.
- El preflight anual reconoce `año + versión`; ya no elimina una v2 legítima ni elige arbitrariamente por año. El preflight de cableado prioriza el programa activo y luego la revisión más reciente.
- El diff v+1 compara la actividad y su programación, hojas, checklists, vínculos, exclusiones, ejecutores, parámetros y overrides. “Aplicar Base” sincroniza esas dimensiones, conserva el padrón operativo no firmado y actualiza el número de actividad; las ejecuciones no se tocan.
- La clonación de revisión conserva metadatos documentales, leyenda de roles, vínculos/checklists activos e históricos, parámetros, overrides, exclusiones y ejecutores, sin copiar ejecuciones, firmas ni decisiones.
- v1 usa comparación histórica sin controles de decisión; sólo una revisión v+1 muestra “Aplicar Base/Conservar”. Las decisiones de acciones se validan también en runtime.
- Cobertura separa bloqueos de pendientes no bloqueantes, muestra roles y permisos en lenguaje operativo, limita las CTAs de revisión a un punto contextual y conserva la administración de roles sólo para `admin:roles`.
- El tablero decide el estado vacío por visualización (tendencia, faena y eje), muestra el ranking responsive y aclara que la comparación por faena usa el alcance autorizado. La planilla consolidada y la vista anual explicitan `Plan` y `ejecutado` por faena; el aviso de scroll móvil permanece accesible.
- La cobertura de ejecutores muestra permisos legibles (inspecciones, capacitación, constancias, PDTP y emergencias), y el backlog no duplica “Crear revisión v+1” cuando ya existe la CTA contextual de cobertura.
- El editor declara explícitamente el alcance corporativo al guardar sin faenas; esa decisión forma parte de la huella v15 y las formas v14 o anteriores conservan su semántica histórica.
- Las operaciones de revisión, ejecutores y creación de v+1 usan `useOperation`; las listas y selectores muestran la versión (`v1`, `v2`).
- El editor toma la sección solicitada por URL desde su primer render y remonta por sección; así se elimina el ajuste de estado posterior a un cambio de prop sin perder la restauración de pestaña desde `sessionStorage`.

## Validación ejecutada después de todos los cambios

- `npm run typecheck` — OK.
- `npm run lint` — OK.
- `npm run db:verify-migrations` — OK: 301 entradas, checksums válidos.
- `npm run check:secrets` — OK.
- `git diff --check` — OK.
- Suite PDTP focalizada con PGlite (`prevention-pdtp`, `pdtp-accreditation`, `pdtp-fulfillment`, `pdtp-revision-diff-decisions`) — 4 archivos, 196 pruebas OK; incluye huella v15, alcance corporativo y corte temporal v1→v2.
- Suite UI focalizada (`pdtp-indicators-panel`, `pdtp-sheet-table`, `coverage-report-panel`, `worksite-scope-panel`) — 4 archivos, 28 pruebas OK.
- Suite de acciones PDTP (`prevencion-pdtp-actions`) — 1 archivo, 56 pruebas OK; incluye validación del origen de revisión v+1 y revalidación de rutas.
- `npm run test:fast` — 710 archivos OK, 30 omitidos; 7.340 pruebas OK, 314 omitidas.
- La corrida completa de `npm run test:pglite` no se certifica: se interrumpió después de observar 11 fallos preexistentes en `lib/__tests__/sst-delete-evaluation.test.ts`; los cuatro archivos PDTP focalizados quedaron verdes. No se atribuyen esos fallos al lote PDTP.
- `npx react-doctor@latest --verbose --scope changed` — 83/100. La advertencia de ajuste de estado en `builder-tabs.tsx` quedó resuelta. El diagnóstico actual registra 8 avisos de complejidad, 1 componente grande y 4 oportunidades de rendimiento (`Set`/`Map` y escrituras secuenciales dentro de una transacción); no produjo fallos funcionales, pero queda reportado como deuda de mantenimiento.

La auditoría final posterior a este cierre está en [`2026-09-16-pdtp-final-audit.md`](2026-09-16-pdtp-final-audit.md). Ese informe reemplaza la lectura de este documento para el estado actual de riesgos; este archivo conserva el cierre del lote de remediación.

## Cobertura pendiente

La sesión autenticada disponible continúa redirigiendo `/prevencion/pdtp` a `/dashboard`, por lo que no se pudo completar UAT visual autenticada de v+1, cobertura, estados cero, diffs ni móvil. Las capturas de la limitación están en `qa/reports/2026-09-16-pdtp-implementation/capturas/`. El warning de hidratación y el bloqueo externo del avatar permanecen fuera de alcance.

La regla de ejecutores mantiene la excepción histórica para una v1 en borrador; las versiones v+1 y los programas activos sí quedan bloqueados cuando falta ejecutor o permiso. Si el contrato cambia para exigir cobertura también al primer borrador v1, falta cerrar esa decisión y ajustar sus fixtures. La activación por fecha efectiva ya está cubierta: hechos anteriores al corte permanecen en v1 y los posteriores acreditan v2, incluso si el evento anterior se reintenta después.

## Riesgos y oportunidades remanentes

- Repetir UAT autenticada cuando la sesión tenga permiso efectivo para `/prevencion/pdtp`; hoy no hay evidencia visual de v+1, cobertura, estados cero, ranking ni scroll móvil en la ruta real.
- Separar y resolver los 11 fallos de `sst-delete-evaluation.test.ts` para poder certificar la suite PGlite completa; permanecen fuera del alcance funcional PDTP, pero dejan el gate global incompleto.
- Considerar una asignación nominal a persona además de roles cuando el contrato operativo requiera distinguir turnos; el lote actual acredita por roles RBAC, como define el plan.
