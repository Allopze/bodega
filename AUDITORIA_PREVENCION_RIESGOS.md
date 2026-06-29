# Auditoria del modulo de Prevencion de Riesgos

Fecha: 2026-06-29  
Alcance revisado: `app/(app)/prevencion`, `lib/sst`, `lib/services/sst.ts`, `db/schema/sst.ts`, PPA Digital y piezas EPP relacionadas.

## Resumen ejecutivo

El modulo de Prevencion tiene una base util: evaluaciones SST por trabajador, checklists versionados, PPA Digital, acta imprimible, seguimientos, plan de accion, scoping por faena, permisos SST/PPA, export XLSX en PPA y trazabilidad EPP desde bodega/entregas.

Los riesgos mas importantes estan en integridad de actas y autorizacion server-side: el cierre no exige completar todos los items aplicables, se pueden borrar evaluaciones cerradas, algunas restricciones solo viven en la UI y el flujo de `conductor_lider` queda inconsistente entre pagina, action y servicio.

## Hallazgos confirmados

### Critico - cierre de evaluacion incompleta

`closeEvaluation()` calcula cumplimiento solo con respuestas existentes y no exige que todos los items aplicables esten respondidos. El helper `getUnansweredApplicableItems()` existe, pero no se usa en el cierre.

Evidencia:
- `lib/services/sst.ts` calcula `applicableResponses` desde las filas existentes y luego cierra.
- `lib/sst/checklist.ts` ya tiene la funcion para detectar items sin responder.

Impacto:
- Una evaluacion puede cerrar con porcentaje artificialmente alto o bajo.
- El acta cerrada queda inmutable con informacion incompleta.

Estado fix:
- Corregido en esta pasada: `closeEvaluation()` ahora rechaza el cierre si existe cualquier item aplicable sin respuesta.

### Critico - borrado permanente de evaluaciones cerradas

La UI y la documentacion indican que una evaluacion cerrada es inmutable, pero `deleteEvaluation()` borra cabecera, respuestas, seguimientos y plan sin revisar `estado`.

Evidencia:
- `lib/services/sst.ts` borra todas las filas asociadas.
- `docs/sst/DOMAIN.md` declara que el cierre es inmutable.

Impacto:
- Perdida de evidencia legal/operacional.
- No hay flujo de anulacion auditada.

Estado fix:
- Corregido en esta pasada: `deleteEvaluation()` rechaza evaluaciones cerradas y conserva sus evidencias.

### Alto - flujo de conductor lider inconsistente

La lista principal muestra "Nueva Evaluacion" si el usuario tiene `sst:evaluate_acompanamiento`, pero `/prevencion/nueva` exige `sst:create`. En la vista por trabajador, se detecta `conductor_lider`, pero el boton exige `permissions.canCreate`. A nivel server action, `sst:evaluate_acompanamiento` puede crear sin restringir que sea solo `trabajador_nuevo`.

Impacto:
- El conductor lider no puede iniciar su evaluacion desde la UI prevista.
- Un POST directo podria intentar crear una evaluacion fuera de su alcance funcional.

Estado fix:
- Corregido en esta pasada: `/prevencion/nueva`, la vista por trabajador y `createEvaluationAction()` permiten el flujo acotado de `conductor_lider`, pero solo para `trabajador_nuevo` / `nuevo`.

### Alto - plan de accion post-cierre bloqueado pese al dominio

`docs/sst/DOMAIN.md` dice que despues del cierre el plan de accion puede continuar, pero la UI lo pone read-only y el servicio llama `assertEditable()`.

Impacto:
- No se puede gestionar la correccion despues de cerrar el acta, que es justamente cuando muchas acciones quedan en seguimiento.

Estado fix:
- Corregido en esta pasada: el servicio y la UI permiten gestionar el plan de accion con evaluacion cerrada, protegido por `sst:manage`.

### Medio/alto - completar semanas futuras solo esta protegido en UI

La UI bloquea por `fechaDesbloqueo`, pero `markWeekCompleted()` no valida fecha, estado ni evaluacion cerrada.

Impacto:
- Un llamado directo a la Server Action puede marcar semanas futuras como completadas.

Estado fix:
- Corregido en esta pasada: `markWeekCompleted()` valida evaluacion abierta, fecha de desbloqueo y estado pendiente.

### Medio - riesgo de duplicados en respuestas y plan de accion

El esquema no define unique para `(evaluationId, seccionId, itemId)` ni para `(evaluationId, n)`, pero el servicio implementa upsert con `select` + `insert`.

Impacto:
- En autoguardados concurrentes puede haber filas duplicadas.
- El calculo, impresion y lectura pueden consumir datos ambiguos.

Estado fix:
- Corregido en continuacion: se agregaron indices unicos, migracion deduplicadora y upsert atomico en servicio.

### Medio - notificaciones PPA sin filtro por faena

Cuando un PPA se detiene, se notifica a todos los usuarios con `ppa:review`, sin filtrar por faena. El detalle queda protegido por scope, pero la notificacion incluye trabajador y faena.

Impacto:
- Filtracion operacional menor a usuarios revisores fuera de la faena.

Estado fix:
- Corregido en esta pasada: los avisos PPA detenidos ahora se envian a revisores globales o asignados a la faena del PPA.

### Bajo/medio - documentacion SST desfasada

`docs/sst/DOMAIN.md` describe permisos y eficacia que no coinciden con el codigo actual.

Impacto:
- Nuevos cambios pueden implementarse contra reglas obsoletas.

Estado fix:
- Corregido en esta pasada: `docs/sst/DOMAIN.md` fue sincronizado con permisos, tablas, umbrales de eficacia y regla de cierre actuales.

## Que ya existe

- Evaluaciones SST de trabajador nuevo y seguimiento.
- Checklists versionados en codigo.
- PPA Digital con revision, estados, export XLSX e indicadores.
- Seguimientos programados para trabajador antiguo.
- Semanas de acompanamiento para `conductor_lider`.
- Plan de accion correctiva por evaluacion.
- Acta imprimible/PDF de SST.
- Scoping por faena en rutas/actions principales.
- Flujo EPP de compra, recepcion, entrega nominal y devolucion/retiro.

## Faltantes para un modulo completo de prevencion de riesgos

- Matriz IPER/MIPER por faena, proceso, tarea, peligro, riesgo, controles, riesgo residual y responsable.
- Registro e investigacion de accidentes, incidentes, cuasi accidentes y enfermedades profesionales, con causa raiz, DIAT/DIEP, evidencias y acciones.
- Inspecciones de seguridad, observaciones conductuales y auditorias SST independientes del onboarding de trabajadores.
- Gestion de capacitaciones: ODI, RIOHS, charlas, cursos, evaluaciones, vencimientos, asistencia y certificados.
- Gestion preventiva de EPP mas alla de entrega: matriz EPP por cargo/riesgo, vida util, recambio, evidencia, stock critico por faena.
- Permisos de trabajo, AST/ART/JSA para tareas criticas.
- Gestion documental legal: DS 44, DS 594, Ley 16.744, protocolos, versiones, vencimientos y responsables.
- Vigilancia de salud ocupacional: examenes, protocolos MINSAL, restricciones medicas y aptitudes por cargo.
- Emergencias: planes, simulacros, equipos de emergencia, inspecciones de extintores, botiquines y camillas.
- Gestion de contratistas y cumplimiento Ley 20.123.
- CPHS/comites, reuniones, acuerdos y seguimiento.
- KPIs preventivos: tasa de frecuencia, gravedad, siniestralidad, dias perdidos, cierres vencidos, reincidencia y cumplimiento por faena.
- Adjuntos/evidencia y firmas digitales reales para evaluaciones, acciones, inspecciones y capacitaciones.

## Plan de fixes de esta pasada

- [x] Bloquear cierre de evaluaciones con items aplicables sin responder.
- [x] Impedir borrado permanente de evaluaciones cerradas.
- [x] Arreglar flujo y guardas de `conductor_lider`.
- [x] Validar server-side el desbloqueo/estado de semanas antes de completarlas.
- [x] Permitir gestionar plan de accion despues del cierre, manteniendo el acta/respuestas inmutables.
- [x] Agregar constraints unicos para respuestas y plan con migracion nueva y upsert real.
- [x] Filtrar notificaciones PPA por alcance de faena.
- [x] Sincronizar `docs/sst/DOMAIN.md`.

## Fixes aplicados

- `closeEvaluation()` ahora construye el set de items aplicables segun definicion, cargos y rol evaluador; si falta una respuesta aplicable, no cierra.
- `deleteEvaluation()` bloquea el borrado de actas cerradas.
- `markWeekCompleted()` bloquea semanas futuras, semanas ya completadas y evaluaciones cerradas.
- El plan de accion queda vivo despues del cierre y usa permiso `sst:manage` en la Server Action.
- `conductor_lider` puede iniciar solo evaluaciones `trabajador_nuevo` de tipo `nuevo`; no puede crear seguimientos u otras definiciones por POST directo.
- PPA detenido notifica solo a usuarios activos con `ppa:review` globales o asignados a la faena del PPA.
- `docs/sst/DOMAIN.md` quedo alineado con los permisos y tablas actuales.

## Continuacion de fixes

- 2026-06-29: agregado test rojo `lib/__tests__/sst-integrity-constraints.test.ts`; confirma que la base permite duplicar `sst_responses (evaluation_id, seccion_id, item_id)` y `sst_action_plan (evaluation_id, n)`.
- 2026-06-29: agregado `uniqueIndex` en `db/schema/sst.ts` y migracion `db/migrations/0006_flawless_vengeance.sql`; la migracion deduplica filas existentes antes de crear los indices unicos.
- 2026-06-29: `saveResponses()` y `saveActionPlanItem()` cambiados a upsert atomico con `onConflictDoUpdate`; ademas `saveResponses()` rechaza filas cuyo `evaluationId` no corresponda al ID padre.
- 2026-06-29: `PGHOST=/var/run/postgresql npm run db:migrate` aplicado correctamente en la base local `postgres:///bodega`; `npm run db:generate` posterior reporto "No schema changes".

## Pendientes no cerrados en esta pasada

- No quedan pendientes tecnicos de los hallazgos corregibles listados en esta auditoria. Quedan como alcance funcional futuro los faltantes de modulo completo listados arriba.

## Verificacion

- `npm test -- lib/__tests__/sst-integrity-constraints.test.ts lib/__tests__/sst-delete-evaluation.test.ts lib/__tests__/sst-service-full.test.ts lib/__tests__/sst-service.test.ts lib/__tests__/prevencion-actions-extra.test.ts lib/__tests__/notification-permission-targeting.test.ts app/(app)/prevencion/[id]/evaluation-detail.test.tsx lib/sst/__tests__/checklist.test.ts lib/sst/__tests__/section-access.test.ts` -> 9 archivos, 126 tests passing.
- `npx eslint ...` sobre archivos tocados de Prevencion/SST/notificaciones/PPA/tests/schema -> sin errores.
- `npm run typecheck` -> passing.
- `npm run db:generate` -> "No schema changes, nothing to migrate".
- `PGHOST=/var/run/postgresql npm run db:migrate` -> migraciones aplicadas correctamente en `postgres:///bodega`.
- `git diff --check` -> sin errores.
- `npm test` completo -> 160 archivos passing, 5 skipped, 1 fallo fuera del alcance Prevencion/SST: `lib/__tests__/request-type-actions-rejection.test.ts` espera error RBAC de `servicios:create`, pero recibe validacion de item "Ubicacion requerida para cada servicio".
