# Tanda T4: evidencia e historial (2026-09-26)

T4 es la tanda del plan de pendientes de la auditoría de Prevención que cierra la trazabilidad de la evidencia (plan en `/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`, sección T4). Rama `prevencion/t4-evidencia`, sobre `e47d9b7a` (integración T0+T1+T5). **Sin migración**: D10 (historial en `audit_log`) se cumplió sin tablas ni columnas nuevas.

Decisiones aplicadas con su valor por defecto: **D10** historial en `audit_log`, **D11** M02-B (registro de subidas con dueño) diferido, **D12** la evidencia de integración se abre en el módulo de origen y aquí se muestra como un chip sin enlace. Para la alerta del escaneo se usó **D28** (sólo logs).

## Qué se corrigió

| ID | Cambio | Archivos |
|---|---|---|
| M02-A | La extensión del archivo subido sale del MIME que detectan los bytes mágicos (`QUOTATION_EXTENSION_BY_MIME`), no del nombre del cliente: un PNG llamado `acta.pdf` ya no se guarda ni se sirve como PDF. La descarga busca al dueño por **igualdad exacta** de la ruta (`findPdtpEvidenceOwner`, con `@>` jsonb para las fotos) en vez de `LIKE %name%` | `app/api/prevencion/pdtp/evidence/route.ts`, `evidence/[name]/route.ts`, `lib/services/pdtp/evidence-references.ts` |
| I04 | Enviar, reenviar, aprobar, rechazar y revertir escriben una fila `pdtp:execution` en `audit_log` (`recordModuleHistory`), **en la misma transacción**, con el estado anterior, el nuevo, el número de intento, el motivo y las rutas de la evidencia de ese momento. También el reporte de una obligación, que es un envío más. El detalle de verificación muestra la sección **"Historial de envíos"** | `execution-history.ts`, `executions.ts`, `obligations.ts`, `accreditation.ts`, `ejecucion/[executionId]/submission-history.tsx` |
| W5-SHA | El sha256 de cada archivo se calcula **en el servidor** al vincularlo (no se confía en el del formulario) y queda en `source_metadata_json.evidenceSha256` por ruta, sin migración. Un reenvío suma el del archivo nuevo y conserva el de los anteriores. El contador de intentos vive en el mismo jsonb (`submissionAttempt`) | `evidence-files.ts`, `execution-history.ts` |
| B03 (obligaciones) | `reportPdtpObligation` reutiliza `mergePdtpEvidence` (ahora exportada de `executions.ts`): el reporte rechazado ya no pierde su archivo al reportar de nuevo | `obligations.ts`, `executions.ts` |
| I05 | `pdtpEvidenceHref` (puro) decide el destino de cada referencia: `pdtp`, módulo de origen, externa (sólo http/https), nota o nada. Las miniaturas muestran el chip **"En el módulo de origen"** para la evidencia de capacitación, alcotest o simulacros en vez de un enlace que daba 404. La descarga PDTP autoriza también la evidencia del plan de acción del PDTP (`capaEsDelPdtp`) y la de las instancias programadas | `evidence-href.ts`, `pdtp-evidence-thumbs.tsx`, `evidence-references.ts` |
| I13-C | `collectPdtpEvidenceReferences` es la fuente única de referencias (ejecuciones, CAPA, historial de envíos e instancias). La usan el escaneo nuevo `scanPdtpEvidenceIntegrity` (archivo ausente o sha256 distinto) y el GC, que antes no miraba instancias ni historial. Cron diario **`pdtp-evidence-integrity`** (05:15) en `cron-runner.mjs` y en el crontab de `docker-compose.yml`, con el contrato `PREVENTION_CRON_` y la paridad cubierta por `deploy-workflow.test.ts`. Encontrar pérdidas no es una falla del cron: responde `success` con conteos y una muestra de 20 rutas; la alerta es la línea `[pdtp/evidence-integrity]` con nivel `error`. RUNBOOK actualizado | `evidence-integrity.ts`, `evidence-gc.ts`, `app/api/cron/pdtp-evidence-integrity/route.ts`, `scripts/cron-runner.mjs`, `docker-compose.yml`, `lib/services/module-toggles.ts`, `docs/deploy/RUNBOOK.md` |
| M08 | Pruebas de segregación (el autor no aprueba, tampoco por obligación; tras un reenvío del administrador, el bloqueo sigue al nuevo autor). `pdtp-scheduled-start.test.ts` para `startPdtpScheduledInstance`. Guardián `tests/pglite-files.test.ts`: falla si una suite instancia PGlite sin estar registrada, o si el registro tiene archivos borrados o duplicados; encontró **siete** suites fuera (la auditoría nombró dos) y quedaron registradas. E2E `pdtp-evidencia-aprobacion.spec.ts` | `lib/__tests__/pdtp-execution-history.test.ts`, `pdtp-scheduled-start.test.ts`, `tests/pglite-files*.ts`, `e2e/pdtp-evidencia-aprobacion.spec.ts` |

### Defecto que encontraron las pruebas nuevas

`startPdtpScheduledInstance` devolvía `created: false` siempre: comparaba el `startedAt` que devuelve la base (texto en formato Postgres) con un ISO de JavaScript. Ningún llamador lo lee hoy, pero la API lo prometía. Ahora se decide dentro de la transacción, con la fila bloqueada.

## Decisiones fuera de los valores por defecto

- **Dónde vive el sha256 y el intento.** El plan pedía no migrar y detenerse si hacía falta una columna. No hizo falta: `pdtp_executions.source_metadata_json` (jsonb) ya existía. El historial copia ambos datos, así que la traza no depende de la fila mutable.
- **El reporte de obligaciones también deja historia.** El plan listaba submit, reenvío, aprobar, rechazar y revocar; el reporte de una obligación es un envío por otra puerta y quedaba fuera.
- **El GC usa la fuente única.** No estaba en el alcance literal, pero dejarlo con su lista propia era dejarlo borrar evidencia que sólo el historial o una instancia referencian.
- **El cron responde `success` aunque encuentre pérdidas.** Sigue el precedente del cron de integridad operacional (`integrity-cron-contract.ts`): detectar problemas es que el cron funciona. Con D28 la alerta es el log.
- **La descarga no autoriza por el historial.** Los archivos de intentos anteriores siguen en `evidence_photos` gracias a la fusión append-only, así que el historial no agrega ningún archivo descargable nuevo; autorizar por `audit_log` habría sumado una consulta sin cambiar el resultado.
- **Se registraron las siete suites PGlite huérfanas**, no sólo las dos que nombró la auditoría. `prevention-incidents-re20` también está en el alcance de T3 (D4): el merge es trivial.

## Evidencia de TDD (rojo → verde)

| Prueba | Rojo observado | Verde |
|---|---|---|
| `evidence/route.test.ts` (M02-A extensión) | 3 de 15 fallaban contra el código anterior | 15/15 |
| `evidence-href.test.ts` | módulo inexistente | 7/7 |
| `pdtp-evidence-thumbs.test.tsx` | 3 de 4 | 4/4 |
| `pdtp-execution-history.test.ts` | 9 de 12 (historial, sha256, B03 en obligaciones). Las 3 de segregación pasaban desde el inicio: **caracterizan** una guarda que ya existía | 12/12 |
| `pdtp-evidence-references.test.ts` | 11 de 12 con stubs | 12/12 |
| `evidence/[name]/route.test.ts` (dueño exacto, CAPA, alcance vacío) | 7 de 12 | 12/12 |
| `prevention-cron-contract.test.ts` + `deploy-workflow.test.ts` | 6 fallas (paridad y contrato) | 76/76 junto con `cron-runner.test.ts` |
| `submission-history.test.tsx` | módulo inexistente | 3/3 |
| `tests/pglite-files.test.ts` | listaba las 7 suites sin registrar | 3/3 |
| `pdtp-scheduled-start.test.ts` | **escrita después del código** (caracterización); un rojo real: `created` | 11/11 tras el arreglo |
| `e2e/pdtp-evidencia-aprobacion.spec.ts` | **escrita después del código**: pasó a la primera | 5/5 |

Ajustes de fixtures, sin cambio de comportamiento: siete suites PGlite borraban `users` con filas del historial todavía en `audit_log` (FK). Ahora limpian `audit_log` primero (`pdtp-execution-integrity`, `pdtp-occurrence-gap-obligation`, `prevention-incidents-re20`, `pdtp-constancias`, `pdtp-deviations`, `pdtp-preventive-organization-obligation`, `pdtp-worker-onboarding-accreditation`). El inventario de rutas de `module-toggles.test.ts` exigió mapear el cron nuevo al submódulo PDTP.

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS (sobre el HEAD final) |
| `npm run test:fast` | 768 archivos / **9.985 pruebas PASS**, 30 archivos omitidos (suites `*-postgres`) |
| `npm run test:pglite` | 208 archivos / **2.477 pruebas PASS** (incluye las 7 suites recién registradas y las 3 nuevas) |
| E2E `pdtp-*` + `prevencion-*` contra servidor aislado (puerto 3300, base desechable `bodega_t4_e2e` en `:55432`, reconstruida) | **157 PASS, 1 omitida** (omisión condicional de `pdtp-habilitacion`, la misma de tandas anteriores) |
| Recorrido de navegador por script (Playwright, sin MCP) a 1440 y 390 px | `/prevencion/pdtp/aprobaciones` y el detalle de verificación: jefe de terreno registra con PDF, administrador rechaza con motivo. Chip "En el módulo de origen" visible en ambos anchos; "Historial de envíos" con 2 entradas; 0 px de desborde horizontal; sin errores de consola ni respuestas 4xx/5xx |

## Pendiente y riesgos

- **M02-B diferido (D11).** `markPdtpExecution` todavía acepta cualquier ruta existente en `pdtp-evidence/`; sin un registro de subidas con dueño, un usuario que conozca un nombre ajeno (nanoid de 20) podría vincularlo. Sigue siendo teórico.
- **Filas anteriores a T4** no tienen historial ni sha256. El escaneo las cuenta como `withoutChecksum` y sólo puede detectar que falten, no que se alteraran. El detalle lo dice en su estado vacío.
- **El escaneo no incluye el ensayo de restauración del storage** (resto de I13): sigue pendiente.
- **Retención del historial**: queda bajo `cleanup_old_audit_log` (6 años), igual que el resto de las bitácoras de Prevención.
- **No verificado**: `test:e2e` completo, las suites `*-postgres`, React Doctor y el cron contra un contenedor `cron` real.

## Conflictos de merge esperados

- `lib/services/pdtp/executions.ts` (T2 en paralelo): T4 toca `markPdtpExecution` (hash previo, lectura de `existing`, metadatos, historial), `approvePdtpExecution`, `rejectPdtpExecution` y exporta `mergePdtpEvidence`. Si T2 agrega transiciones nuevas (p. ej. revisión de "No aplica"), conviene que también escriban historial.
- **Fixtures PGlite de T2/T3**: toda suite nueva que llame a una transición de ejecución y después borre `users` fallará por la FK de `audit_log` hasta que limpie `audit_log` primero.
- `lib/__tests__/pdtp-deviations.test.ts` (una línea en `beforeEach`), `tests/pglite-files.ts` (registros de T2/T3), `accreditation.ts` (T3: select y reversión), y `cron-runner.mjs` / `docker-compose.yml` / `deploy-workflow.test.ts` si T3 agrega crons.
