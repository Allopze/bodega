# Tanda C07/M02-B: revisión de ocurrencias y registro de subidas (2026-09-27)

Dos parciales que el cierre del plan (`2026-09-27-prevencion-cierre-plan.md`, "Parciales que
siguen abiertos") dejó abiertos: **C07** sobre ocurrencias programadas y **M02-B**. Rama
`prevencion/c07-m02b`, sobre `33a10750` (`prevencion/integracion-final`). Trae la migración
**0334**. Sin push ni merge.

## Qué cambió

### Migración 0334 (`0334_tiresome_bullseye.sql`)

Sólo tablas nuevas; no toca filas existentes ni trae `DROP`.

- `pdtp_scheduled_instance_outcome_requests`: solicitud de "no aplica" o cancelación de una
  ocurrencia (`pending_review | approved | rejected | withdrawn`). Tiene un índice único
  parcial "una pendiente por ocurrencia" y CHECK de motivo ≥ 10, revisor ≠ solicitante,
  rechazo con motivo ≥ 10, revisión con fecha y retiro con fecha. Las FK llevan nombre
  explícito porque las que genera Drizzle superaban los 63 caracteres de Postgres.
- `pdtp_evidence_uploads`: una fila por ruta subida, con quien subió (FK `SET NULL`), faena
  (`CASCADE`), actividad (`SET NULL`), sha256 (CHECK hex de 64), tamaño (> 0), mime y fecha.
- Generada con `npm run db:generate`; el checksum quedó registrado con `--update-checksums`.
  `db:verify-migrations` verificó 335 entradas y `db:generate` después dice "No schema changes".

### C07 sobre ocurrencias (`lib/services/pdtp/scheduled-outcome-review.ts`)

| Regla | Dónde |
|---|---|
| Pedir "no aplica" o cancelar ya no cambia la ocurrencia: se crea una solicitud `pending_review`. La ocurrencia sigue `pending/in_progress/submitted` y **sigue en el denominador**, así que `compliance.ts` y el dorado T7b no se tocaron | `recordPdtpScheduledInstanceOutcome` → `requestPdtpScheduledInstanceOutcome` |
| El "no aplica" no se declara sobre una fecha futura (`scheduledFor > todayInChile()`) | `assertPdtpScheduledOutcomeNotInFuture` |
| Motivo ≥ 10 caracteres (con el mismo validador de antes, ahora en este módulo) y entrada en `pdtp_change_log`, sección `scheduled_instance:{n}` (etiqueta "Ocurrencia programada"), al pedir, revisar y retirar | `assertPdtpScheduledOutcomeReason`, `change-log-labels.ts` |
| Aprueba o rechaza otra persona con `prevention:pdtp:approve`. Quien la pidió no revisa: lo impiden el servicio y el CHECK. Se exige alcance de faena, ventana de la versión (`assertPdtpProgramAcceptsReview`) y mes abierto, al pedir y al revisar. Aprobar exige que la ocurrencia siga sin resultado terminal | `reviewPdtpScheduledInstanceOutcome` |
| Bloqueos: advisory de la ocurrencia → ocurrencia `FOR UPDATE` → solicitud `FOR UPDATE`. La sincronización con el libro (ejecución → ocurrencia) toma la solicitud después de la ocurrencia, así que no se forma un ciclo | módulo nuevo, `scheduled-execution.ts` |
| La retira sólo quien la pidió. No exige mes abierto ni motivo, porque el indicador nunca cambió | `withdrawPdtpScheduledInstanceOutcomeRequest` |
| Una ejecución aprobada que cumple la ocurrencia retira la solicitud pendiente | `syncPdtpScheduledInstanceFromExecution` |
| Un mes con solicitudes pendientes de sus ocurrencias no se cierra (mismo mensaje que el N/A de celda) | `period-closures.ts` |
| Idempotencia: repetir la misma solicitud devuelve la existente. Una ocurrencia que ya estaba `not_applicable`/`cancelled` antes de 0334 no se toca | idem |
| Acciones `reviewPdtpScheduledInstanceOutcomeAction` (`guardPermission("prevention:pdtp:approve")`) y `withdrawPdtpScheduledInstanceOutcomeAction`. La acción de resultado responde `pendingReview` con el mensaje "Quedó en revisión…" | `actions/scheduled-instances.ts` |
| UI: la sección "No aplica por revisar" de `/prevencion/pdtp/aprobaciones` recibe también las solicitudes de ocurrencias: fecha, "No aplica" o "Cancelación", motivo y quién la pidió. Las filas propias no tienen botones de revisión; en las de ocurrencias aparece "Retirar", que pide confirmación (`ConfirmDialog`) | `not-applicable-review-section.tsx`, `aprobaciones/page.tsx` |

**Decisiones**

- **La cancelación también pasa por revisión.** Saca la ocurrencia del denominador igual que el
  "no aplica", y no encontré ninguna razón documentada para eximirla. A diferencia del "no
  aplica", **se admite a futuro**: su uso típico es quitar una ocurrencia duplicada o mal
  programada antes de que llegue.
- **La cancelación automática al retirar una actividad** (`activities.ts`) no cambia. La
  autoriza la edición del programa, deja su propia traza y no es una declaración por ocurrencia.
- **Retirar la solicitud no exige motivo.** El % no cambió nunca. El retiro de un desvío de
  celda sí lo exige, porque deshace un efecto.
- **El permiso para pedir no cambia**: `override:manage` para el "no aplica" y
  `obligation:cancel` para cancelar. La acción de resultado sigue sin UI propia; el único
  lugar con interfaz es la bandeja de revisión.
- **`countPdtpNotApplicable`** (la marca junto al % del panel) sigue contando sólo celdas.

### M02-B (`lib/services/pdtp/evidence-uploads.ts`, `evidence-references.ts`)

- `POST /api/prevencion/pdtp/evidence` escribe la fila de registro después de guardar el
  archivo. Si el registro falla, borra el archivo y responde un 500 genérico. Un
  `activityId` inexistente se guarda como `null`.
- `assertPdtpEvidenceLinkable` recibe ahora `userId`. Lo pasan sus seis llamadores:
  planilla, obligaciones, instancias, seguimiento CAPA del PDTP y CAPA genérica. Para una ruta
  que **no referencia ninguna fila**:
  - la fila de registro tiene que ser de la faena destino. Esto vale aunque quien vincula tenga
    las dos faenas en su alcance, porque el archivo se subió "para" una;
  - y la tiene que vincular **quien lo subió, sin excepción por permiso**. El archivo no está
    en ninguna parte todavía, así que volver a subirlo no le cuesta nada a nadie, y una
    excepción reabriría justo la puerta que se quiere cerrar.
- **Regla heredada.** Un archivo sin registro, subido antes de 0334 o con una ruta inventada,
  sólo se vincula si ya lo referencia la misma faena o una faena del alcance (la regla de la
  revisión final). Si no lo referencia nadie, se rechaza con el mensaje "no tiene registro de
  subida… Vuelve a subirlo desde esta faena".
- Un archivo que **no está en disco** no pasa por la comprobación del registro. El llamador
  mantiene su mensaje "ya no está en el almacenamiento", que es el caso del GC que borró el
  archivo junto con su fila.
- El GC borra la fila de registro de cada archivo que borra, sólo en modo real (en el de prueba
  no toca nada). El escaneo de integridad usa el sha256 del registro cuando ninguna referencia
  guardó uno.

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS. Lo corrió el pre-commit en los tres commits de código; el de docs/E2E usó `--no-verify`, pero su spec se había pasado por `eslint` antes |
| `npm run test:fast` | **774 archivos / 10.112 pruebas PASS**, 32 archivos omitidos (suites `*-postgres`) |
| `npm run test:pglite` | **215 archivos / 2.657 pruebas PASS**, 1 omitida. Incluye el dorado T7b `pdtp-compliance-performance` (10 PASS, 1 omitida, también corrido aparte) |
| `*-postgres` que vinculan evidencia PDTP | `pdtp-revision-window-concurrency` 1/1, `prevention-capa` 4/4 y `prevention-incidents` 4/4 PASS contra bases desechables en :55432 |
| `npm run db:verify-migrations` / `db:generate` | PASS: 335 entradas hasta 0334; "No schema changes" |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado (puerto 3200, base `bodega_c07_e2e` en :55432, build del árbol final) | **174 PASS, 1 omitida** (`pdtp-habilitacion:98`, la omisión condicional de siempre). Incluye la E2E nueva `pdtp-ocurrencia-no-aplica-revision` (3 PASS: aprobar, rechazar una cancelación con motivo, retirar la propia con confirmación) y `pdtp-evidencia-aprobacion` (5 PASS), que sube archivos reales: después de correrla, `pdtp_evidence_uploads` tenía 3 filas con usuario, faena, mime y sha256 de 64 |

**Rojo antes que verde**

- `lib/__tests__/pdtp-scheduled-instance-outcome-review.test.ts` (PGlite, nueva, 20 casos).
  Corrida contra el `scheduled-execution.ts`/`period-closures.ts` anterior: **17 rojos**. Los 3
  que ya pasaban quedan como regresión: motivo ≥ 10, mes cerrado al pedir y un "no aplica"
  heredado idempotente. La primera corrida falló entera porque faltaba el módulo; el caso "año
  cerrado" falló una vez por un fixture que violaba el CHECK de `pdtp_programs` y lo corregí.
- `actions/scheduled-instances.test.ts`: 6 casos nuevos en rojo (acciones inexistentes,
  `pendingReview`).
- `not-applicable-review-section.test.tsx`: 4 casos nuevos de ocurrencias en rojo.
- `pdtp-evidence-link-ownership.test.ts` (6 casos M02-B) y `pdtp-evidence-references.test.ts`
  (registro, GC e integridad): **7 rojos**. Los casos "guarda la fila" y "actividad inexistente →
  null" pasaron en su primera corrida porque escribí `recordPdtpEvidenceUpload` junto con ellos.
  La "regla heredada" pasó antes del cambio porque describe un comportamiento que se conserva.
- `app/api/prevencion/pdtp/evidence/route.test.ts`: 3 casos nuevos en rojo.

**Escritas después del código:** la E2E `pdtp-ocurrencia-no-aplica-revision` y el fixture
`lib/testing/pdtp-evidence-upload-fixture.ts`.

**Pruebas previas ajustadas por el cambio de regla (no por un fallo del código):**
`pdtp-scheduled-instance-integrity` (4 casos esperaban `not_applicable`/`cancelled` inmediato;
ahora aprueba otra persona). 10 suites PGlite vinculaban archivos de prueba sin registro y ahora
siembran su fila: `prevention-pdtp`, `pdtp-execution-integrity`, `pdtp-execution-history`,
`pdtp-deviations`, `pdtp-period-closures`, `pdtp-revision-windows`, `pdtp-worksites`,
`pdtp-constancias`, `pdtp-evidence-link-ownership` y `pdtp-evidence-references`. En la primera
corrida completa fallaron 64 casos por esto. Con la excepción de "archivo que no está en disco"
volvieron a pasar sin cambiar lo que afirman (`pdtp-action-plan` e
`inspection-finding-closure`).

## Pendiente y riesgos

- **Comunicación a usuarios** (agregada en la sección 3 del documento de despliegue). El "no
  aplica" y la cancelación de ocurrencias quedan en revisión. Los archivos subidos antes del
  despliegue que todavía no se enviaron hay que volver a subirlos.
- **Código viejo sobre el esquema 0334** (sección 4 del documento de despliegue). Aplicaría el
  "no aplica" al instante y no escribiría el registro de subidas, así que lo que se suba durante
  una vuelta atrás quedará "sin registro".
- La acción de resultado de ocurrencias sigue **sin UI para pedir**: se pide por la acción (o por
  futuros formularios), y se revisa y retira en Aprobaciones.
- `/pendientes` sigue mostrando la ocurrencia con solicitud pendiente como tarea. Es coherente
  con "cuenta hasta que se apruebe", como el N/A de celda.
- No hay aprobación masiva. Si el volumen de solicitudes es alto, se verá en la bandeja.

## Lo que NO se verificó

- `npm run test:e2e` completo, `npm run doctor`, `check:security-audit` y las demás suites
  `*-postgres`.
- La migración 0334 sólo se aplicó en PGlite, en la base E2E desechable y en las bases de prueba
  de :55432. No se aplicó en desarrollo, staging ni producción.
- WebKit/Safari y el recorrido a 390 px de la sección nueva. La E2E corre a escritorio.
- Concurrencia real (dos revisores a la vez) sobre Postgres: el orden de bloqueos está razonado y
  el índice único lo respalda, pero no tiene prueba de carrera.

## Conflictos esperables al integrar

- `lib/services/pdtp/scheduled-execution.ts`, `period-closures.ts`, `evidence-references.ts` y
  `executions.ts`/`obligations.ts`/`followups.ts`/`prevention-capa.ts` (una línea `userId` cada
  uno) si otra rama los toca. No edité `prevention-inspections.ts`.
- `tests/pglite-files.ts` (una línea nueva) y `qa/reports/latest.md` (fila superior).
- `db/migrations/meta/_journal.json`, `_sql-checksums.json` y el snapshot 0334: si otra rama
  genera una migración, **no** se resuelve a mano; se regenera después de integrar.
- Las suites PGlite con fixture de subida, si otra rama cambia sus helpers `evidenceFile`.
