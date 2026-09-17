# Auditoría de cambios PDTP v+1

Fecha: 2026-09-17  
Alcance: revisión estática y determinista de los cambios PDTP frente a `origin/main`: ciclo v+1, comparación contra Base, cobertura/ejecutores, acreditación temporal, tablero, planilla, móvil y acciones server-side.

## Resultado ejecutivo

No quedan fallos deterministas reproducibles en el alcance ejercitado. La auditoría encontró y corrigió un bug de idempotencia en las decisiones del comparativo: repetir «Aplicar Base» después de una aplicación exitosa podía volver a ejecutar la sincronización y registrar bitácora duplicada. Ahora la decisión persistida se consulta antes de exigir que el ítem siga visible en el diff; repetir la misma decisión es un no-op y una decisión opuesta se rechaza. También se acotó el informe de cobertura al alcance autorizado de la sesión, evitando revelar nombres de faenas fuera de permiso. En las últimas tandas se corrigieron además la selección de versión en scripts de despliegue, la carrera concurrente de decisiones, la trazabilidad del `programId` resuelto por fecha, el estado vacío de aplicabilidad, el contraste del KPI y la semántica histórica de la planilla.

La implementación conserva una frontera deliberada: las v1 históricas no reciben ejecutores inventados; la compuerta exige ejecutor y permiso para v+1 y para un programa ya activo, y el activo se muestra como riesgo con CTA de revisión. Esa compatibilidad debe mantenerse explícita al desplegar.

## Hallazgos y estado

| ID | Clasificación | Estado | Evidencia / impacto |
| --- | --- | --- | --- |
| PDTP-A14 | S2 · bug funcional | **Corregido** | `lib/services/pdtp/revision-diff-decisions.ts`: una decisión existente se resuelve antes de buscar el ítem actual; no se repite la aplicación ni la bitácora. Regresión en `lib/__tests__/prevention-pdtp.test.ts`. |
| PDTP-A15 | S2 · cobertura de navegador | **Corregido y recorrido** | La UAT local autenticada creó v2, recorrió «Conservar» en el comparativo (87 diferencias), envió la versión a revisión, aprobó JDPR y Legal con actores segregados y activó v2. La base cerró v1 sin borrar su evidencia; no hubo errores de consola. El permiso `prevention:training:record` se sincronizó antes desde el manifiesto mediante el script idempotente `db:sync-rbac`, sin concederlo desde PDTP ni desde una migración. |
| PDTP-A16 | S3 · mantenibilidad | **Oportunidad** | React Doctor queda en 84/100 con 10 avisos de mantenibilidad: nueve funciones de alta complejidad y un componente grande. Conviene extraer subcomponentes en una tanda separada para no mezclar refactor con control de integridad PDTP. |
| PDTP-A17 | S3 · compatibilidad histórica | **Riesgo controlado** | La condición `version > 1 || status === "active"` en `lib/services/pdtp/fulfillment.ts` evita inventar ejecutores para históricos. Si el negocio interpreta «versión nueva» como también el primer v1, debe cambiarse el contrato y sus fixtures; hoy la excepción está documentada y cubierta. |
| PDTP-A18 | S3 · cobertura de datos | **Pendiente** | El inventario de snapshots firmados se hizo sólo en la base local: 1 firmado, 0 sin `schemaVersion`, 1 activo. Falta repetirlo en staging/producción antes de cerrar la política de históricos. |
| PDTP-A19 | S3 · mejora de modelo | **Oportunidad** | `PdtpRevisionDiff` decide por identidad de actividad y sus filas asociadas. Metadatos de vista/programa, alcance global y pasos de aprobación no aparecen como diferencias independientes; si deben decidirse por separado, requieren una dimensión de diff de programa, no un parche en la actividad. |
| PDTP-A20 | S2 · privacidad/UX | **Corregido** | El detalle y el editor podían construir motivos de cobertura con nombres de faenas fuera del alcance del usuario. `getPdtpCoverageReport` y `assertPdtpFulfillmentCoverage` aceptan el alcance visible; las compuertas transaccionales siguen evaluando el programa completo. |
| PDTP-A21 | S3 · consistencia operativa | **Corregido** | Las acciones imperativas de ciclo de vida ya usan `useOperation` y refrescan el estado después de éxito. La CTA de revisión v+1 ahora vive en el `PageHeader`; cobertura y libro sólo explican el riesgo, sin duplicar la acción. |
| PDTP-A22 | S2 · preparación RBAC | **Corregido** | Una base poblada no recibe permisos nuevos sólo al cambiar el manifiesto. El despliegue ahora ejecuta `sync-rbac` después de migrar y antes de publicar la imagen; `migrate-to-new-server.sh` y `apply-pdtp-data.sh` conservan el mismo paso idempotente. La UAT local necesitó sincronizar una base histórica, pero el flujo operativo ya lo contempla. |
| PDTP-A23 | S2 · integridad del libro | **Corregido** | `countPdtpFulfillmentBacklog` trataba un programa corporativo (`appliesToAllWorksites=true`) como sin alcance y contaba eventos de cualquier faena. Ahora limita ese caso al universo de faenas activas, intersectado con el alcance visible de la sesión; la regresión cubre una faena desactivada. |
| PDTP-A24 | S2 · integridad de despliegue | **Corregido** | Los scripts de datos podían elegir una v1 activa por una heurística no ordenada o preferirla a una revisión v+1 abierta. Ahora ordenan por versión descendente, prefieren el borrador y los pasos que editan contenido respetan `assertPdtpProgramEditableState`; un programa firmado se informa en sólo lectura y exige revisión nueva. |
| PDTP-A25 | S2 · concurrencia del comparativo | **Corregido** | El pre-chequeo de una decisión no era suficiente ante dos operadores simultáneos: ambos podían llegar al índice único. `upsertDecision` usa `ON CONFLICT DO NOTHING`, relee la decisión ganadora y deja la misma decisión como no-op; una decisión opuesta sigue siendo conflicto explícito. |
| PDTP-A26 | S2 · trazabilidad temporal | **Corregido** | El libro de cumplimiento podía guardar el `programId` que sugirió el conector, aunque el motor resolviera otra versión por fecha, o quedar nulo al reconciliar. `AccreditationResult.resolvedProgramId` es ahora la única fuente para persistir la versión efectivamente acreditada; la regresión rechaza un id sugerido distinto. |
| PDTP-A27 | S3 · consistencia de lectura | **Corregido** | La planilla anual ofrece «Histórico completo» y «Exigible desde activación» con una explicación visible; la preferencia persiste al cambiar de faena. Ambas lecturas respetan la aplicabilidad declarada; el desglose agregado y el Excel exponen las dos lecturas sin sobreescribir evidencia histórica. |
| PDTP-A28 | S3 · accesibilidad visual | **Corregido** | El icono de «Atrasadas» del tablero usaba el token de superficie `--color-info`; se cambió a `--color-info-ink`, coherente con el contrato de contraste para texto e iconos. |

Los hallazgos anteriores A01–A13 del informe del 16-09 quedan cerrados o re-clasificados en el código actual: compatibilidad de huellas con esquema explícito, preflight consciente de año+versión, aplicación de filas asociadas, ocultamiento de decisiones para v1, estados de cobertura legibles, labels de versión, validación runtime de acciones y resolución temporal pre/post corte.

## Cambios auditados

- Clonación v+1 transaccional con linaje, metadatos de cumplimiento/pesos, faenas, actividades, agenda, overrides, exclusiones, parámetros, ejecutores, checklists, hojas, vínculos y referencias documentales; no clona ejecuciones, eventos de cumplimiento, firmas ni decisiones.
- Comparativo contra Base vigente por identidad de catálogo con caída segura al número legado; no presenta una actividad histórica como alta y baja simultáneas.
- Decisiones `Aplicar Base`/`Conservar` inmutables, idempotentes y con controles deshabilitados después de decidir.
- Cobertura con estados explícitos (`executor_required`, `executor_permission_gap`, `segregated_valid`, `destination_not_configured`), rol/módulo legibles y CTA contextual sin conceder permisos.
- Informe de cobertura filtrado por alcance autorizado en las vistas autenticadas; el preflight y las acciones de ciclo de vida mantienen la evaluación global.
- Libro de cumplimiento corporativo limitado a faenas activas; los programas con membresía siguen usando sus faenas declaradas.
- Scripts de datos y siembra que respetan año + versión: una revisión borrador recibe los cambios; la versión activa firmada no se muta automáticamente.
- El libro guarda la versión de programa resuelta por fecha efectiva, no un id sugerido por el conector.
- Tablero con estado cero accionable, ranking responsive, planilla con `Plan / ejecutado` y ayuda accesible para scroll horizontal.
- La planilla distingue cifras históricas y exigibles desde activación, conserva el par `Plan / ejecutado` para cada faena y exporta ambas lecturas con encabezados explícitos.
- Aplicabilidad sin programa activo con `EmptyState` y CTA contextual para crear programa.
- No se generó migración en esta tanda; la cadena existente permanece intacta.

## Verificación ejecutada después de todos los cambios

- `npm run test:pglite` — **171 archivos OK**, **1.939 pruebas OK** (incluye corte temporal v1/v2, trazabilidad de versión resuelta, aislamiento de nombres de faena por alcance y semántica histórica/exigible por faena).
- Pruebas UI focalizadas de la última tanda — **15/15 OK** (cobertura, ciclo de vida y CTA); la tanda anterior había dejado 17/17.
- `npm run test:fast` — **711 archivos OK**, 30 omitidos; **7.344 pruebas OK**, 314 omitidas.
- `npm run typecheck` — OK.
- `npm run lint` — OK.
- `npm run check:secrets` — OK.
- `npm run check:security-audit` — OK; allowlist documentado con próxima revisión 2026-10-28.
- `npm run db:verify-migrations` — OK: 301 entradas hasta 0300, checksums válidos.
- `git diff --check` — OK.
- La verificación focalizada de planilla cubre el selector de semántica, el desglose por faena y las columnas históricas/exigibles del Excel.
- `npx react-doctor@latest --verbose --scope changed` — **84/100**: 10 avisos de mantenibilidad (9 funciones de alta complejidad y 1 componente grande) y 1 aviso de bugs sobre `server-sequential-independent-await`. Este último es un falso positivo del detector: la página ya usa `Promise.all` para `submitBlockers` y `coverageReport`; no se suprimió ni se modificó el diagnóstico.

## Evidencia visual y límites

La UAT autenticada local verificó rutas de detalle, edición, actividades, programas y cobertura en escritorio/móvil; confirmó `6/81 listas`, el riesgo de ejecutor, el estado `Aún no hay ejecuciones acreditadas`, `Plan / ejecutado` y el aviso de scroll móvil. En el recorrido de mutación se creó v2, se mostraron 87 decisiones del comparativo y se conservó una diferencia; luego se enviaron, aprobaron y activaron los cambios con actores segregados. También se comprobó que la CTA de revisión aparece una sola vez en el `PageHeader` del activo y no dentro del panel de cobertura. Capturas: `qa/reports/2026-09-17-pdtp-desktop-detail.png`, `qa/reports/2026-09-17-pdtp-mobile-detail.png`, `qa/reports/2026-09-17-pdtp-desktop-actividades-anual.png`, `qa/reports/2026-09-17-pdtp-mobile-actividades-anual.png`, `qa/reports/2026-09-17-pdtp-mobile-dashboard.png`, `qa/reports/2026-09-17-pdtp-v2-created.png`, `qa/reports/2026-09-17-pdtp-v2-decision.png`, `qa/reports/2026-09-17-pdtp-header-revision-cta.png`, `qa/reports/2026-09-17-pdtp-v2-in-review.png`, `qa/reports/2026-09-17-pdtp-v2-jdpr-approved.png` y `qa/reports/2026-09-17-pdtp-v2-activated.png`.

La verificación visual post-fix autenticada abrió `/prevencion/pdtp/actividades` con HTTP 200 en escritorio y móvil, mostró los controles «Histórico completo»/«Exigible desde activación», activó el segundo modo y comprobó que no hubo errores de consola ni de página. El único request fallido fue el avatar externo de DiceBear bloqueado por ORB, ya conocido y fuera del alcance. Capturas nuevas: `qa/reports/2026-09-17-pdtp-planilla-historico-desktop.png`, `qa/reports/2026-09-17-pdtp-planilla-historico-mobile.png`, `qa/reports/2026-09-17-pdtp-planilla-exigible-desktop.png` y `qa/reports/2026-09-17-pdtp-planilla-exigible-mobile.png`.

La activación produjo además un reintento de reconciliación sobre un evento histórico de una faena que no pertenecía a v1; el motor lo dejó en el libro de cumplimiento y no hizo fallar la activación. Debe revisarse operativamente ese backlog antes de cerrar la evidencia del ambiente objetivo. La suite PGlite completa quedó verde en esta tanda; la corrida previa con 11 fallos ajenos en `lib/__tests__/sst-delete-evaluation.test.ts` queda como antecedente histórico, no como resultado actual. El warning de hidratación y el bloqueo ORB del avatar externo permanecen fuera del alcance.

Este informe es evidencia del alcance indicado, no una certificación global de release ni de staging/producción.
