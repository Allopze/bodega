# Correcciones — Production readiness de Prevención (2026-09-26)

Seguimiento de [2026-09-26-prevencion-production-readiness.md](2026-09-26-prevencion-production-readiness.md).

- **Rama:** `prevencion/fixes-production-readiness`, sin commit.
- **Alcance acordado:** los bloqueadores, C01 y C04, más los recomendables de esfuerzo bajo.
- **Decisión de producto aplicada (PREV-B02):** para declarar "Se hizo" hay que adjuntar un archivo, salvo que la actividad declare una excepción explícita. En esa excepción basta una observación escrita, pero nunca vacía.

## Qué se corrigió

| Hallazgo | Cambio | Archivos principales |
|---|---|---|
| **B02** "Se hizo" sin evidencia | Declarar una cantidad mayor que 0 exige un archivo real en disco (planilla y obligaciones manuales). Nueva columna `pdtp_activities.manual_evidence_policy` (`file_required` por defecto, o `declaration_allowed`). La migración 0329 marca como excepción las 19 actividades 2026 cuyo respaldo vive fuera de la plataforma (N°11, 15, 16, 18, 52, 57, 66–78). La aprobación vuelve a verificar que exista evidencia (incluye importadas y archivos borrados). El formulario lo indica. | `lib/services/pdtp/executions.ts`, `obligations.ts`, `db/schema/prevention/pdtp.ts`, `db/migrations/0329_*`, `pdtp-execution-form.tsx`, `obligaciones/pdtp-obligations-workbench.tsx` |
| **B03** sobrescritura de envíos ajenos | Un envío `submitted` no se reemplaza si no lo hizo quien lo registró (salvo `override:manage`). La evidencia es append-only: el archivo anterior pasa a `evidence_photos`, así sigue referenciado, descargable y fuera del GC. El reenvío guarda en el evento el estado previo, el motivo de rechazo, el archivo y el autor. Aprobar y rechazar quedan en el control de cambios; el rechazo guarda su motivo. La lectura del registro previo se movió dentro de la transacción. | `executions.ts`, `actions/executions.ts` |
| **B01** anular la fuente no revertía lo aprobado | Una acreditación aprobada por una persona ahora también se revierte cuando se anula su fuente. Conserva `previousApprovedByUserId`, deja una entrada en el control de cambios y el resultado la reporta en `revertedApproved`. | `lib/services/pdtp/accreditation.ts` |
| **C01** cifras divergentes | La planilla y su Excel cuentan como ejecutado solo lo aprobado; lo enviado se muestra aparte como "+N por aprobar", y rechazos y borradores ya no suman. El avance por eje usa el mismo tope mensual que el indicador. El KPI del tablero ahora dice lo que cuenta. | `sheets.ts`, `compliance.ts`, `pdtp-sheet-table.tsx`, `pdtp/page.tsx` |
| **C04** crons no agendados | 9 crons de Prevención agregados a `cron-runner.mjs` y al crontab de `docker-compose.yml` (hora de Chile). Sus rutas se alinearon al contrato del runner: antes, aun agendadas, habrían fallado. `pdtp-evidence-gc` queda fuera a propósito. | `scripts/cron-runner.mjs`, `docker-compose.yml`, `app/api/cron/*` |
| **I02** cierre del mes en curso | Se rechaza cerrar el mes en curso y cerrar con envíos pendientes de aprobación en esa faena. | `period-closures.ts` |
| **I03** asignación nominal | Con una asignación vigente, solo la persona asignada registra la actividad (salvo `override:manage`). | `executions.ts` |
| **I06** expediente de auditor | La columna "Evidencia" distingue: Archivo verificado, Registro de origen, Archivo no encontrado, Solo declaración y Sin evidencia. | `audit-dossier-evidence.ts`, `expediente-auditor/route.ts` |
| **I07** errores tragados | Nuevo error tipado `PdtpWorksiteNotInProgramError` y helper `resolvePdtpActivityIdsOrSkip`: solo "sin programa" y "faena fuera del programa" se omiten; una falla real se relanza. | `accreditation.ts`, `pdtp-adapters/obligation-kit.ts` y 3 conectores |
| **I09** subidas de 10–25 MB | `experimental.proxyClientMaxBodySize: "27mb"` y validación de tamaño en el cliente con mensaje claro. | `next.config.ts`, formularios |
| **I10** N°88 → Campañas | La N°88 apunta a Capacitación (CAM-07). Campañas deja de ser instrumento usable y su pantalla ya no promete acreditar el PDTP. | `fulfillment-contract-2026.ts`, `instruments.ts`, `campanas-client.tsx` |
| **I11** `reportedAt` del cliente | Eliminado del esquema de la acción; el servidor fija la fecha. | `lib/validation/prevention-module/pdtp.ts` |
| **I14** mensajes contradictorios | Un programa activo muestra "N no tienen cómo acreditarse" en vez de "frenan la firma", y "Versión congelada: Registrada". Las aprobaciones muestran "Jul · sem. 2" en vez de "M7S2". | `coverage-summary-card.tsx`, `program-lifecycle-controls.tsx`, `pdtp-approval-buttons.tsx` |
| **I15** cumplimiento a la fecha | Nuevo `toDate` (plan y ejecutado hasta el mes en curso). Es la cifra principal del panel y del listado de programas; el avance anual queda rotulado aparte. | `compliance.ts`, `pdtp-indicators-panel.tsx`, `programas/page.tsx` |
| **K01** IDs en el control de cambios | La sección técnica se muestra como categoría legible ("Obligación", "Ejecución"…). | `change-log-labels.ts`, `[programId]/page.tsx` |
| **M01** un activo por año | Índice único parcial `(year) WHERE status='active'` (migración 0329). | `db/schema/prevention/pdtp.ts` |
| **M05** JDPR | El paso JDPR excluye también a quien envió a revisión. | `approval-flow.ts` |

## Verificación

**Puertas del repositorio**

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:fast` | **768 archivos / 9.972 pruebas PASS**, 29 archivos omitidos (suites `*-postgres` sin variables) |
| `npm run test:pglite` | **193 archivos / 2.320 pruebas PASS** |
| `npm run db:verify-migrations` | PASS (330 entradas hasta 0329); `db:generate` sin cambios pendientes |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado reconstruido (build de producción, base desechable) | **147 PASS, 1 omitida** (la misma omisión condicional de la auditoría) |

**Recorrido en navegador sobre el servidor aislado**

| Caso | Resultado |
|---|---|
| Registrar sin archivo | Rechazado con "Para declarar la actividad como realizada adjunta un archivo…"; no se crea fila |
| Supervisor B reenvía la celda pendiente del supervisor A | Rechazado ("Esta semana ya tiene un registro enviado por otra persona…"); la fila conserva cantidad, archivo y autor de A |
| PDF de 12 MB | Sube y se registra (antes fallaba con "Body inválido") |
| PDF de 26 MB | Rechazado en el cliente con "El archivo supera 25 MB…" |
| Aprobaciones | Botones "✓ Jul · sem. 2"; toast "Ejecución de Ago semana 3 aprobada." |
| Planilla | "1 / 2 · +4 por aprobar" (antes "1 / 5" sumando rechazadas y pendientes) |
| Control de cambios | Muestra "Ejecución · Ejecución de la actividad N°1 (mes 8, semana 3) aprobada." |
| Tablero y listado | Coinciden: eje "Plan 4 · Ejecutado 1 · 25 %", listado "a la fecha 25 % · avance anual 25 %" |
| Ficha del programa activo | "2 no tienen cómo acreditarse" y "Versión congelada: Registrada"; tile "Cumplimiento a la fecha" |
| Consola y red | Sin errores de consola ni fallos de red en los recorridos |

## Pendiente y riesgos

**Antes de desplegar**
- La migración 0329 **no se aplicó** en ninguna base persistente (solo en PGlite y en la base E2E desechable). En producción la aplica el despliegue normal (`deploy-prod.sh` → servicio `migrate` → `scripts/migrate.mjs`), no `npm run db:migrate`. El preflight dentro de `migrate.mjs` bloquea la migración si un año tiene dos programas activos (chequeo agregado en T0). El procedimiento completo está en `docs/deploy/DESPLIEGUE_PREVENCION_2026-09.md`.
- **Cambio de comportamiento para los usuarios:** fuera de las 19 excepciones, toda ejecución manual necesita un archivo, y las ejecuciones ya enviadas sin archivo no se podrán aprobar: habrá que rechazarlas para que se reenvíen con evidencia. Conviene comunicarlo antes del despliegue y revisar si otras actividades deben declararse como excepción (`manual_evidence_policy`).
- **Revocaciones (B01):** las acreditaciones aprobadas cuya fuente se anule a partir de ahora vuelven a borrador. Las anuladas **antes** de este cambio siguen aprobadas. *(Actualizado en T3)*: `scripts/revert-pdtp-revoked-approvals.ts` las corrige — reporte por defecto (servicio one-shot `revert-pdtp-revoked-approvals` o `npm run pdtp:revert-revoked-approvals`), revisión con Prevención, respaldo, y recién entonces `--apply --actor <userId>`. Omite y lista meses y programas cerrados (D17) y declara el período ciego anterior al 03-09-2026. Ver `2026-09-26-prevencion-t3.md`.

**Riesgos conocidos**
- Al intentar sobrescribir un envío ajeno, el archivo ya se subió cuando el servidor rechaza la operación y queda huérfano en `storage/pdtp-evidence/`. El GC sigue sin agendar.

**Fuera de esta tanda**
- C02 (compensación entre actividades dentro del mes y cantidad sin tope)
- C03 (cambio de año 2027)
- C05 (revisión v+1)
- C06 (atrasos ocultos)
- C07 ("No aplica" sin revisión)
- I01 ("Registrar" en móvil)
- I04 parcial (historial completo por intento en tabla propia)
- I05 (enlaces de evidencia de integración y CAPA)
- I08 (instancias programadas)
- I12 (performance)
- I13 (observabilidad)
- I16 (faena fuera de membresía y reconciliador)
- M02–M04 y M06–M10

**No verificado**
- `npm run test:e2e` completo y suites `*-postgres`.
- El comportamiento real de los crons en el contenedor de producción.
