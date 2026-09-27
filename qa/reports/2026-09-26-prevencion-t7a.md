# Tanda T7a: integridad y operación (2026-09-26)

T7a es la parte de integridad y operación de la tanda T7 del plan de pendientes de la auditoría de Prevención (plan en `/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`, sección T7; auditoría `2026-09-26-prevencion-production-readiness.md`, hallazgos M04, M06, M09, I13). Rama `prevencion/t7a-integridad`, sobre `a533f9d8` (integración de la ola 2, migraciones hasta 0332). **Migración M-3 = `0333_narrow_namorita`.**

Fuera de alcance: **I12** (rendimiento de `compliance.ts`), que va en otra tanda. Tampoco se tocaron `compliance.ts`, `period.ts`, `accreditation.ts` ni `prevention-program-slots.ts`, porque T6 trabaja en paralelo sobre ellos.

Decisiones aplicadas con su valor por defecto:
- **D13:** el GC corre primero en modo de prueba y después borra.
- **D26:** un borrador se borra sólo si no tiene ejecuciones aprobadas ni cierres.
- **D27:** el acuse se admite sólo en estados no terminales, sin TTL.
- **D28:** las alertas son sólo logs.

## Qué se corrigió

| ID | Cambio | Archivos |
|---|---|---|
| M04 | Migración 0333: `ON DELETE RESTRICT` en `pdtp_executions.activity_id`, `pdtp_execution_deviations.activity_id` y `pdtp_period_closures.program_id` (antes CASCADE). Un `DELETE` manual de una actividad o de un programa ya no arrastra ejecuciones aprobadas, desvíos revisados ni cierres firmados: Postgres lo rechaza con `23001`. Cada `DROP` lleva `IF EXISTS` y los checksums están registrados. Después, `db:generate` responde "No schema changes" | `db/schema/prevention/pdtp.ts`, `db/migrations/0333_narrow_namorita.sql`, `meta/*` |
| M04 / D26 | `deletePdtpProgram` se niega si el borrador tiene ejecuciones **aprobadas** ("tiene 1 ejecución aprobada…") o **cierres**. Lo demás se borra explícitamente en la misma transacción: ejecuciones no aprobadas (con `status <> 'approved'`, así que si una aprobación entra en carrera, la RESTRICT aborta) y desvíos. Después viene el `DELETE` del programa, que cascadea el resto | `lib/services/pdtp/programs.ts` |
| M04 / D26 | `rollbackPdtpImportBatch` corre `assertPdtpImportBatchReversible` dentro de la transacción, con el lote y el programa bloqueados. Se niega en tres casos: si el lote trajo ejecuciones ya aprobadas (las aprobaciones no escriben en el change log, así que la guarda de "cambios posteriores" no las veía); si el programa tiene cierres en la faena del lote (o en cualquiera, si el lote no tiene faena); y si las actividades que el lote creó tienen ejecuciones de otro origen o desvíos. Sin esta última guarda, la RESTRICT daría un error de FK ilegible | `lib/services/pdtp/imports.ts` |
| M09 | Índices nuevos `pdtp_executions_activity_worksite_year_idx (activity_id, worksite_id, year)` y `pdtp_obligations_activity_worksite_idx (activity_id, worksite_id)`. Se retira `pdtp_executions_scheduled_instance_idx`, redundante: el único `pdtp_executions_scheduled_instance_unique` sobre la misma columna se queda, y la prueba lo verifica. El índice nuevo de ejecuciones es además el que usa la verificación de la FK RESTRICT (ver EXPLAIN) | idem |
| M06 / D27 | `permitCrewAckWindow(status)` deriva la ventana de `PERMIT_TRANSITIONS`: un estado sin salida es terminal. Queda abierta en borrador, pendiente, aprobado, vigente y suspendido, y cerrada en cerrado, rechazado y cancelado. **Sin TTL.** La vista pública (`eligible`/`ineligibleReason`, que antes era `true` siempre) y las dos vías de acuse (con cuenta y por enlace) usan la misma función. Las dos vías leen el integrante y el permiso con `FOR UPDATE`; la vía con cuenta usa `FOR UPDATE OF` las dos tablas, porque `users` va en LEFT JOIN y Postgres no bloquea el lado anulable. Un acuse ya dado se sigue mostrando como dado aunque el permiso termine. El formulario público ya mostraba `ineligibleReason` y no cambió | `lib/prevention/permits.ts`, `lib/services/prevention-permits.ts`, `lib/services/prevention-ack-public.ts` |
| W5-GC | `sweepOrphans` deja una fila en `audit_log` (`entity_type = 'storage_orphan_sweep'`, `entity_code` = directorio) por cada corrida que encuentra huérfanos o fallas. La fila lleva el modo (`dryRun`), `olderThanMs`, los conteos, hasta 500 nombres y `truncated`; en modo de prueba, `deleted` es lo que *se habría* borrado. Una corrida sin huérfanos no escribe. Si la auditoría falla, queda en el log con nivel `error` sin revertir el barrido. `resolveOrphanAgeMs` eleva cualquier ventana a **≥ 1 h** (antes `olderThanMs=0` borraba un upload en curso). Aplica a PDTP y a planos de riesgo, y también a inspecciones, que comparten el barrido pero no están agendadas | `lib/services/pdtp/evidence-gc.ts` |
| W5-GC / D13 | `pdtp-evidence-gc` queda agendado **a diario a las 04:30**, después del respaldo de las 03:00 UTC, en `cron-runner.mjs` y en el crontab. La ruta adopta el contrato `PREVENTION_CRON_` (`outcome`/`code`), responde con conteos por directorio y una muestra de 20 nombres (cabe en los 32 KiB del runner) y devuelve 400 si `olderThanMs` es menor a 1 h. **Corre en modo de prueba salvo `PDTP_EVIDENCE_GC_DELETE=true` en `app`**; `?dryRun=true` gana siempre. El compose inyecta la variable en `app` (la whitelist del respaldo la guarda). El endpoint admin `POST /api/prevencion/pdtp/evidence/gc`, que borraba por omisión, obedece la misma llave y anota a la persona en la auditoría. Paridad: `deploy-workflow.test.ts` (ya no exige que el GC falte, exige la variable en `app` y que no aparezca asignada en el crontab), contrato de crons y `module-toggles` (el prefijo ya existía) | `app/api/cron/pdtp-evidence-gc/route.ts`, `app/api/prevencion/pdtp/evidence/gc/route.ts`, `scripts/cron-runner.mjs`, `docker-compose.yml`, `scripts/backup-orchestrator.sh` |
| I13-D | `backup-orchestrator.sh` cuenta los archivos de `STORAGE_PATH` (sin `.health-*.tmp`) **antes del `pg_dump`**. Si no hay ninguno, o el directorio no existe, sale con 1 y deja `BACKUP_FAILED_STEP=storage_precondition`. El escape es `BACKUP_ALLOW_EMPTY_STORAGE=true`. El manifiesto declara `components.storage.file_count`, contado sobre el tar (incluye los documentos SST de Cloudreve). `backup-storage.sh` sale con 1 sin `RCLONE_DEST` y también sin origen (ver decisiones) | `scripts/backup-orchestrator.sh`, `scripts/backup-storage.sh` |
| I13-E | `backup-restore-drill.sh` verifica el `storage.tar.gz` del último snapshot aunque no haya base de ensayo. Es **CRITICAL** si falta el tar o el manifiesto, si el sha256 no coincide con el manifiesto, si `tar -tzf` falla o si el conteo difiere de `file_count`. Es **WARNING** si el manifiesto declara el storage omitido. Con la base restaurada, cruza las rutas `storage/…` que referencian ejecuciones (URL y fotos), la evidencia CAPA, las instancias, los planos y la evidencia de inspecciones contra la lista del tar; lo que falta es WARNING, con conteo y hasta 5 rutas. `restore-drill.json` gana el bloque `storage`. El texto de WARNING de `backup-verify.sh` ya no dice sólo "no pudo ejecutarse" | `scripts/backup-restore-drill.sh`, `scripts/backup-verify.sh` |
| Docs | `DESPLIEGUE_PREVENCION_2026-09.md`: la verificación ya no dice que el GC "no debe aparecer", y la nueva sección 6 explica el modo de prueba, la consulta de revisión, el criterio para encender el borrado tras 1–2 semanas revisadas, cómo encenderlo y cómo volver atrás. `RUNBOOK.md` y `RESPALDOS_Y_RESTAURACION.md` explican la precondición de storage, `file_count` y la tabla de comprobaciones del ensayo | `docs/deploy/*` |

## Caminos de borrado que dependían de la cascada

Se revisaron todos los `delete(pdtpPrograms|pdtpActivities)` y los `delete from pdtp_activities`:

- **Servicios.** `deletePdtpProgram` y el rollback se corrigieron arriba. `revision-diff-decisions.ts:273` borra una actividad de una revisión en borrador, que no tiene ejecuciones; con RESTRICT, si alguna vez las tuviera, el borrado falla en vez de llevárselas. No se cambió.
- **PGlite.** La corrida completa de `test:pglite` después de la migración dejó 4 suites cuyo `beforeEach` confiaba en la cascada: `pdtp-coverage-r2`, `prevention-cgrd`, `pdtp-re36-document` y `prevention-incidents-re20`. Ahora limpian antes ejecuciones, desvíos o cierres. Las demás ya borraban ejecuciones primero.
- **E2E.** Los `afterAll` de `pdtp-*.spec.ts` ya borran ejecuciones, desvíos y cierres antes de las actividades, y la corrida E2E lo confirma (ver abajo). `e2e/setup-db.ts` reconstruye el esquema y no borra programas.

## Evidencia rojo → verde (TDD)

| Prueba | Rojo (antes del código) | Verde |
|---|---|---|
| `lib/__tests__/pdtp-delete-restrict.test.ts` (nueva, PGlite, registrada) | 10 fallan, 2 pasan. Las 2 son los caminos felices, "borrador sin aprobadas" y "lote sin aprobadas", que ya funcionaban y quedan como caracterización. Las 4 de FK recibían `undefined` porque la cascada borraba; las de índices, `null`; las guardas se negaban por otra razón o no se negaban | 12/12 |
| `lib/prevention/permit-ack-window.test.ts` (nueva) | 2 fallan (`permitCrewAckWindow is not a function`) | 3/3 |
| `prevention-acuse-sin-cuenta.test.ts` (+3 casos M06) | 2 fallan: el permiso cancelado era `eligible: true` y el enlace acusaba. "Borrador admite acuse" pasaba y queda como caracterización | 5/5 (+3 de `permit-crew-ack-blocker`) |
| `pdtp-evidence-gc.test.ts` (+5 casos) | 4 fallan: sin fila de auditoría y `olderThanMs: 0` borraba un huérfano de 30 min. "Sin huérfanos no audita" pasaba (caracterización) | 9/9 |
| `prevention-cron-contract.test.ts` (+`pdtp-evidence-gc` en la tabla y 5 casos) | 8 fallan. Con la ruta nueva siguieron 2 rojos, porque el runner no conocía el job, hasta agregarlo | 42/42 |
| `app/api/prevencion/pdtp/evidence/gc/route.test.ts` (nueva) | 2 fallan: el endpoint borraba sin la variable y aceptaba 1 s | 4/4 |
| `deploy-workflow.test.ts` (paridad invertida y variable en `app`) | 2 fallan | verde |
| `scripts/backup-storage-integrity.test.ts` (nueva) | 13 fallan. Con I13-D pasaron 6; con I13-E, 13 | 13/13 |

**Escritas o ajustadas después del código** (adaptaciones, no comportamiento nuevo):
- los `beforeEach` de las 4 suites PGlite de arriba;
- el helper `makeBackupDir` de `scripts/backup-restore-drill.test.ts`, que ahora crea un snapshot con tar y manifiesto coherentes (sin eso, "sin base desechable" pasaba a CRITICAL por falta de tar);
- el caso `?dryRun=true gana` del endpoint admin, que pasaba desde el principio.

## EXPLAIN (M09)

Base desechable `bodega_t7a_explain_test` en 127.0.0.1:55432, migrada hasta 0332. Datos sintéticos: 10 faenas, 3 programas (2024–2026) de 100 actividades, 48.000 ejecuciones y 18.000 obligaciones, con `ANALYZE`. Después se aplicó 0333 y se volvió a correr con `EXPLAIN (ANALYZE, BUFFERS)`.

| Consulta | Antes | Después |
|---|---|---|
| Q2 `executions.ts:739`, enviadas de faena/año para un conjunto de actividades | BitmapAnd de `worksite_period_idx` y `status_idx`, 303 filas descartadas, **280 buffers**, 0,42 ms | Index Scan en `pdtp_executions_activity_worksite_year_idx`, **25 buffers**, 0,05 ms |
| Q3 verificación de la FK al borrar una actividad (lo que ejecuta RESTRICT) | **Seq Scan** de las 48.000 filas, **870 buffers**, 3,8 ms por actividad | Index Only Scan, **3 buffers**, 0,02 ms |
| Q4 `obligations.ts:463`, obligación abierta de una actividad en una faena | Bitmap sobre `scope_status_due_idx`, 897 filas descartadas, **141 buffers** | Bitmap sobre `pdtp_obligations_activity_worksite_idx`, **4 buffers**, 0,03 ms |
| Q1 `helpers.ts:220`, todas las actividades de un programa en una faena/año | Hash Join con `worksite_period_idx`, 302 buffers | Sin cambio: con el programa completo, el planificador prefiere el índice por faena, y está bien |
| Q5 `compliance.ts:150`, obligaciones de 20 actividades en 2 faenas | Hash Join con `scope_status_due_idx`, 190 buffers | Sin cambio (mismo motivo). El resto de `compliance.ts` es I12 |

La salida completa quedó en el scratchpad de la sesión (`explain-before.txt` / `explain-after.txt`). Los datos son sintéticos: el volumen real de producción no se midió.

## Ensayo real del drill (I13-E)

Además de las pruebas con binarios de mentira, se corrió `backup-restore-drill.sh` de verdad:
- el `pg_dump -Fc` de la base desechable de EXPLAIN, restaurado en `bodega_t7a_drill_test`;
- un tar de storage con 1 de los 2 archivos que la base referencia;
- un manifiesto con su sha.

Resultado: sha OK, `tar -tzf` 1 archivo, 361 tablas, **WARNING** "1 de 2 archivos referenciados por la base no están en el tar de storage (muestra: pdtp-evidence/ausente.jpg)" y salida 1. La consulta de referencias corre contra el esquema real. La base del ensayo se eliminó.

## Decisiones fuera de los valores por defecto

- **El endpoint admin del GC también queda en modo de prueba.** Con el cron en prueba y el endpoint manual borrando por omisión, D13 se saltaba con un clic. Las dos puertas obedecen `PDTP_EVIDENCE_GC_DELETE`.
- **Horario 04:30**, después del respaldo nocturno: cuando se encienda el borrado, lo borrado sigue en el snapshot de esa noche.
- **El GC sólo audita cuando hay algo.** Una fila diaria vacía sería ruido; `cron_runs` ya prueba que corrió.
- **`backup-storage.sh` sale con 1 también sin origen**, no sólo sin destino: los dos casos significan que no hubo copia.
- **Referencias faltantes en el tar = WARNING, no CRITICAL.** Pueden faltar ya en el storage vivo, cosa que alerta `pdtp-evidence-integrity`, y entonces ningún respaldo las tendría. Un tar ilegible, con otro sha o con otro conteo sí es CRITICAL. El cruce no mira las rutas históricas del `audit_log` (intentos de envío anteriores), sólo las vigentes.
- **Guarda extra en el rollback:** rechaza si las actividades que creó el lote tienen trabajo registrado fuera de él. Es la única forma de que RESTRICT no se convierta en un error de FK ilegible.
- **La ventana del acuse se deriva de la tabla de transiciones** y no de una lista de estados. La auditoría pedía "sin depender del estado": se leyó como "sin una lista de estados copiada en cada llamador", con la misma regla para la vista y la mutación.

## Puertas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (lo corre el hook pre-commit en cada uno de los 4 commits) |
| `npm run test:fast` | **10.079 PASS**, 292 omitidas (773 archivos) |
| `npm run test:pglite` | **2.568 PASS** (211 archivos) |
| `npm run db:verify-migrations` | PASS: 334 entradas hasta 0333, checksums verificados. `db:generate` dice "No schema changes" |
| `*-postgres` (contenedor :55432) | `pdtp-year-close-concurrency` 1/1 PASS; `pdtp-accreditation-year-close` 1/1 PASS; `prevention-permits-postgres` 21/22: el acuse con cuenta bajo `FOR UPDATE OF` pasa en Postgres real. La que falla, "lists every blocker at once", espera 4 bloqueadores y recibe 5 (el quinto es `crew_ack_missing`, de PER-001). Ninguno de estos commits toca `evaluatePermitReadiness`, así que es **preexistente**, pero no se comprobó corriendo la base sin cambios |
| E2E `pdtp-*` + `prevencion-*` (servidor propio en :3300, base `bodega_t7a_e2e`, config temporal) | **163 PASS, 1 omitida** (6,6 min). Los `afterAll` que borran actividades conviven con RESTRICT, y el log del servidor no tiene ningún `23001` / `violates RESTRICT`. Servidor detenido al terminar |

## Sin hacer / sin verificar

- **I12** (rendimiento de `compliance.ts`) queda para su tanda. Tampoco se hizo `pg_stat_statements` con 10 faenas ni el bloque PDTP de `perf:queries`.
- El EXPLAIN es sobre datos sintéticos. Antes del deploy hay que repetir el EXPLAIN de los índices nuevos en una copia (consulta de solo lectura del plan).
- Tiempo de la migración en producción: `ADD CONSTRAINT … FOREIGN KEY` valida todas las filas existentes y `CREATE INDEX` no es `CONCURRENTLY` (drizzle migra en transacción). Con los volúmenes actuales debería durar segundos, pero no se midió sobre datos reales.
- No se corrió el cron del GC en el contenedor real, ni el orquestador contra un storage o una base reales (por diseño, sólo directorios temporales y bases desechables).
- No se corrieron `test:e2e` completo, las demás suites `*-postgres` ni `npm run doctor`.
- No hay recorrido de navegador de la página pública `/acuse` con un permiso cerrado. El formulario ya pintaba `ineligibleReason`, así que la cobertura es de servicio.

## Conflictos de merge esperables

- **Migraciones:** si T6 genera su propia 0333, chocan `_journal.json`, `_sql-checksums.json` y el snapshot. Quien integre segundo debe descartar su migración, rebasar sobre la otra y volver a correr `npm run db:generate` y `--update-checksums`, sin editar el journal a mano.
- `tests/pglite-files.ts` (una línea nueva junto a `pdtp-evidence-gc`).
- `docker-compose.yml`, `scripts/cron-runner.mjs` y `lib/__tests__/deploy-workflow.test.ts`, si otra tanda agrega crons: la paridad se actualiza junta.
- `lib/services/pdtp/programs.ts` (`deletePdtpProgram`) e `imports.ts` (rollback).
- `docs/deploy/DESPLIEGUE_PREVENCION_2026-09.md` (sección 4 y nueva sección 6) y `RUNBOOK.md`.
- Los `beforeEach` de `pdtp-coverage-r2`, `prevention-cgrd`, `pdtp-re36-document` y `prevention-incidents-re20`. Además, **cualquier suite nueva de otra tanda que borre actividades o programas sin limpiar antes ejecuciones, desvíos o cierres fallará con `23001` después de este merge.**
