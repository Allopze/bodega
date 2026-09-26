# Tanda T0: cerrar la rama y dejarla desplegable (2026-09-26)

T0 es la primera tanda del plan de pendientes de la auditoría de Prevención (plan en `/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`). Se hizo sobre la rama `prevencion/fixes-production-readiness`, sin commit. Corrige problemas que la propia rama introducía y prepara el despliegue.

## Qué se corrigió

| ID | Cambio | Archivos |
|---|---|---|
| W1-N01 | La carga manual ya no lee la fila de integración de la misma celda. Esa fila le prestaba su archivo, y así se saltaba PREV-B02, o la bloqueaba si ya estaba aprobada | `lib/services/pdtp/executions.ts` |
| M03 | `evidence_status` refleja la evidencia real: queda `provided` o `not_required` en cada carga. Una fila migrada no se aprueba por su texto automático "Migrado desde…", aunque la actividad admita declaración | `executions.ts` |
| W1-N02 | La foto del cierre se congela al mes del corte. Los meses posteriores quedan en cero y trimestres, año y `toDate` se recalculan sobre ese recorte; se descarta `lastExecutionUpdatedAt`. En el RE-36, lo ejecutado después del corte y el calendario ISO (medido contra el corte y no contra hoy) quedan fuera. `integral`, que es una cifra corrida del año, queda fuera del digest. Un cierre ya no aparece desviado porque se opere un mes posterior | `compliance.ts` (`cutPdtpComplianceIndicatorsToMonth`), `period-closures.ts`, `re36-document.ts` |
| C05-A | La revisión v+1 copia `manualEvidencePolicy`, `scheduleDefinition` (solo si es el mismo año), la configuración de ejecución y los recordatorios. Además, tres arreglos asociados:<br>• no se materializan ocurrencias anteriores a la activación;<br>• las asignaciones nominales abiertas pasan a la versión nueva al activarla (`handoverPdtpWorksiteAssignees`, en la misma transacción);<br>• los recordatorios solo salen de programas vigentes, con actividad activa, faena activa y no excluida, y sin repetir un aviso cuyo momento cayó antes de la activación | `programs.ts`, `scheduled-instances.ts`, `assignees.ts`, `lifecycle.ts`, `scheduled-reminders.ts` |
| K02 | Una falla del disco al subir evidencia responde 500 con un mensaje genérico, sin exponer la ruta interna | `app/api/prevencion/pdtp/evidence/route.ts` |
| K03 | La exportación de integridad documental aplica `sanitizeCell` | `app/api/prevencion/documentacion/integrity/export/route.ts` |
| I13-A/B | `onRequestError` registra los errores de servidor no capturados, con la ruta sin query y sin headers. La descarga registra con `warn` una evidencia referenciada cuyo archivo ya no está en disco | `instrumentation.ts`, `evidence/[name]/route.ts` |
| D15 | El cron de docker queda como único scheduler: se retiró el workflow de Actions `prevention-inspection-programs.yml` y el archivo local ignorado `prevention-daily-reminders.yml`, que incluía el GC. Documentado en el RUNBOOK | `.github/workflows/`, `docs/deploy/RUNBOOK.md` |
| DEPLOY-0329 | El preflight (que corre dentro de `migrate.mjs`) bloquea si un año tiene dos programas activos. Runbook de despliegue con: consultas Q1–Q4 validadas contra el esquema, comunicación a usuarios, contingencias ante cualquier fallo antes o después de la migración (etiqueta `:prev`, restaurar el compose, estado de la base según `[migrate] done`) y verificación posterior de los crons | `scripts/migration-preflight.mjs`, `docs/deploy/DESPLIEGUE_PREVENCION_2026-09.md` |
| Informes | Corrección de C04 en la auditoría: el workflow de inspecciones sí estaba versionado. El informe de fixes ahora indica que producción migra con `migrate.mjs` | `qa/reports/` |

## Revisión adversarial

Un workflow de 3 revisores más 3 escépticos por hallazgo revisó T0 recién implementado (60 agentes de solo lectura): **16 hallazgos confirmados y 3 refutados**. Los 16 quedaron corregidos en esta misma tanda:
- W1-N02 cubría solo `toDate`: faltaban los meses posteriores, `lastExecutionUpdatedAt`, `integral`, el RE-36 y el calendario ISO.
- La v+1 materializaba ocurrencias desde enero.
- La v+1 no heredaba las asignaciones nominales.
- Se reenviaban avisos que la versión anterior ya había dado.
- El filtro de recordatorios no miraba la faena activa ni las exclusiones.
- Faltaban pruebas para la actividad retirada, la copia entre años distintos y el SQL real del preflight.
- Runbook: la etiqueta correcta es `:prev`, faltaba restaurar el compose, la contingencia no cubría los pasos entre la migración y `ROLLBACK_ARMED`, Q2 y Q4 no calzaban con la regla real, y el rollback automático no siempre ocurre.

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS |
| `npm run test:fast` | 769 archivos / **9.978 pruebas PASS**, 29 archivos omitidos (suites `*-postgres`) |
| `npm run test:pglite` | 195 archivos / **2.340 pruebas PASS** |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado reconstruido | **147 PASS, 1 omitida** (omisión condicional por datos del fixture) |
| SQL del runbook | Las 4 consultas se ejecutan sin error sobre el esquema migrado (PGlite) |
| Prueba de mutación del preflight | Con el estado mal escrito, la prueba falla. Verificado y revertido |

Suites nuevas:
- `lib/__tests__/pdtp-revision-midyear.test.ts` (11 casos);
- `lib/__tests__/migration-preflight-pdtp-active.test.ts`;
- `lib/__tests__/instrumentation-on-request-error.test.ts`;
- casos agregados en `pdtp-execution-integrity`, `pdtp-period-closures`, pruebas de rutas y `migration-preflight.test.ts`.

## Pendiente

- No hubo recorrido de navegador propio en T0. Los cambios visibles son menores (textos de error de subida y la foto del cierre) y los cubren las E2E; no se capturaron pantallas.
- El despliegue sigue el runbook: Q1–Q4 sobre producción, aviso de 48 h, migración 0329 y verificación de los crons.
- Siguientes tandas del plan: T1 (cálculo del porcentaje) y T5 (cambio de año, en paralelo, merge a más tardar el 20-11-2026).
