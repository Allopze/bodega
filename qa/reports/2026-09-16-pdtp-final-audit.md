# Auditoría final de cambios PDTP v+1

Fecha: 2026-09-16  
Alcance: revisión de los cambios del programa preventivo PDTP frente al plan de implementación: revisiones v+1, linaje, cobertura y ejecutores, acreditación temporal, tablero, planilla, móvil, permisos y migraciones. Se excluyeron modificaciones ajenas al módulo PDTP presentes en el worktree.

## Resultado ejecutivo

No se confirmó un bug S0/S1 nuevo en el lote: las compuertas de revisión/activación, la clonación sin ejecuciones ni firmas, la concurrencia de v+1, el alcance por faena y el corte temporal v1→v2 pasan las pruebas focalizadas. El estado no es una certificación de release porque la UAT autenticada de PDTP sigue redirigiendo a `/dashboard` y la suite PGlite completa conserva fallos SST ajenos al lote.

Se mantienen tres hallazgos de producto/UX de severidad media-baja y una deuda de compatibilidad que requiere inventario de datos antes de cerrarse.

## Hallazgos

| ID | Severidad / clasificación | Evidencia actual | Impacto y mejora recomendada |
| --- | --- | --- | --- |
| PDTP-F01 | **S2 · inconsistencia funcional confirmada** | `lib/services/pdtp/base-comparison.ts:132-148` calcula `worksiteAdjustments` como el tamaño de la unión de filas de la revisión y de la Base, `worksiteExclusions` sólo como el total actual y `retiredActivities` como todas las retiradas actuales. `revision-tab.tsx:93-99` los presenta como “cambios”. Una revisión que conserva exactamente los mismos ajustes puede mostrar un número distinto de cero. | El operador puede creer que hay diferencias pendientes cuando sólo hay configuración compartida. Calcular deltas simétricos por identidad/valor y separar “total configurado” de “cambios”. |
| PDTP-F02 | **S3 · oportunidad UX confirmada** | `editar/revision-diff-decisions.tsx:46-57` sólo muestra “Conservada” cuando la decisión es `kept`; una decisión `applied` no tiene estado visible y los dos botones siguen disponibles después de guardar. | No se pierde la decisión, pero el operador no recibe confirmación persistente de “Aplicada”. Mostrar ambos estados, deshabilitar la opción vigente y conservar un CTA explícito para revertir si el contrato lo permite. |
| PDTP-F03 | **S3 · gap de contrato/UI** | `lib/services/pdtp/fulfillment.ts:634-645` no contiene un estado positivo `segregated_valid`. `engancheDestinationPermissionFor` devuelve `null` para flujos segregados (`:758-767`) y el panel sólo puede inferirlos desde el texto genérico de “listas”. | Se respeta la segregación y no se concede un permiso incompatible, pero la cobertura no comunica el estado explícito pedido por el plan. Añadir `segregated_valid` y mostrarlo como grupo verificable, separado de “ready”. |
| PDTP-F04 | **S2 · riesgo de compatibilidad, no confirmado sin inventario** | `content-digest.ts:463-472` usa la versión actual cuando `reviewSnapshotJson` no trae `schemaVersion`. Los snapshots creados antes de que esa marca existiera podrían compararse con una forma incorrecta. Las pruebas cubren v13 y un esquema no reconstruible v10, pero no una firma histórica sin la marca. | Antes de liberar, inventariar programas firmados con snapshot sin versión. Si existen, asignar la forma histórica de manera explícita o marcarlos como no verificables; no asumir v15. |
| PDTP-F05 | **S3 · rendimiento/mantenibilidad** | React Doctor quedó en **83/100**, con 13 avisos: 8 funciones complejas y un componente grande; `backlog.ts:91-94` hace `includes` dentro de un recorrido y `revision-diff-decisions.ts:382-415` hace `await` secuencial y `find` dentro de un loop. | No hubo fallo funcional ni regresión en las suites, pero el coste crece con el número de faenas/dimensiones. Usar `Set`/`Map` y extraer subcomponentes; mantener las escrituras secuenciales si la transacción exige orden y medir antes de paralelizarlas. |

## Comprobaciones realizadas después de todos los cambios

- `git diff --check` — OK.
- `npm run typecheck` — OK.
- `npm run lint` — OK.
- `npm run check:secrets` — OK.
- `npm run db:verify-migrations` — OK: 301 entradas, checksums verificados.
- Suites PGlite focalizadas: 8 archivos, **261/261 pruebas OK**.
- Suites UI/acciones PDTP focalizadas: 7 archivos, **95/95 pruebas OK**.
- `npm run test:fast`: **710 archivos OK**, 30 omitidos; **7.340 pruebas OK**, 314 omitidas. Permanecieron sólo warnings conocidos de `punycode` y resolución de imágenes.
- React Doctor: 83/100; diagnóstico registrado como oportunidad, no como fallo funcional.

## Cobertura que queda pendiente

- La corrida completa de `npm run test:pglite` no se certifica: la ejecución previa se detuvo tras 11 fallos de `lib/__tests__/sst-delete-evaluation.test.ts`, fuera del alcance PDTP. Las suites PDTP focalizadas sí pasan.
- No hubo UAT visual autenticada del módulo: la sesión disponible redirige `/prevencion/pdtp` a `/dashboard`. Las capturas de esa limitación están en `qa/reports/2026-09-16-pdtp-implementation/capturas/`.
- No se verificaron en navegador estados cero, CTA de revisión, ranking, plan/ejecutado ni scroll móvil en la ruta real.
- Se mantiene la excepción contractual de ejecutores para v1 en borrador; v+1 y activos sí bloquean cuando falta ejecutor o permiso.

## Recomendaciones priorizadas

1. Corregir el cálculo de deltas del diff (PDTP-F01).
2. Inventariar snapshots firmados sin `schemaVersion` y cerrar la política de compatibilidad (PDTP-F04).
3. Hacer visible `applied` y modelar `segregated_valid` en la cobertura (PDTP-F02/F03).
4. Optimizar los avisos de React Doctor cuando se planifique la siguiente iteración, sin convertirlos en cambios de comportamiento sin medición.

