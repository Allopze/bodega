# Plan de Trabajo Preventivo SG-SST 2026 — Implementación en Plataforma Chome

> **Documento:** Plan de Trabajo Preventivo SG-SST 2026 (basado en `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx`)
> **Repositorio base:** `/home/allopze/dev/chome/bodega` (Next.js App Router + Drizzle/Postgres + Auth.js)
> **Estado al:** 2026-06-30
> **Marco normativo chileno:** Ley 16.744 · D.S. N° 44 (2025) · D.S. N° 594 · Ley 20.123 · Ley 21.643 (Karin) · Ley 21.364 (SENAPRED) · Ley 19.518 (SENCE) · Protocolos MINSAL

---

## 0. Resumen ejecutivo

El documento `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx` define **8 hojas**, **89 actividades** (N° 1–89) distribuidas en **8 objetivos específicos** con cronograma semanal Planeado/Ejecutado (P/E) por **12 meses x 4 semanas = 48 semanas lógicas y 96 celdas P/E** por actividad en la mayoría de las hojas. El libro contiene `PDTP GENERAL` y 7 vistas derivadas: `CPHS`, `PRF Y Adm. de contrato`, `Sup, JT`, `PRF`, `Adm. de contrato`, `Subgerente operaciones y mant.` y `Capacitación y Campañas `. Cada hoja replica fórmulas reales de suma, porcentaje mensual y promedio trimestral (`SUM`, `IFERROR`, `AVERAGE`), con **firmas de JDPR (Lorena Alvarado Cornejo, 27-01-2026)** y **Gerente Legal y RRHH (Paulette Recart Andrades, 04-02-2026)**, más control de cambios del 2026-02-12.

Contraste directo contra el XLSX (2026-06-30):

| Hoja Excel | Actividades incluidas | Observación de implementación |
|---|---:|---|
| `PDTP GENERAL` | 89 | Fuente total del catálogo N° 1-89. |
| `CPHS` | 4 | N° 11-14. No es solo filtro por rol `cphs`; incluye actividades de PRF/Adm. de contrato relacionadas con CPHS. |
| `PRF Y Adm. de contrato` | 76 | Vista operacional amplia; contiene actividades JDPR, PRF, Sup/JT y adm. contrato. Debe modelarse como membresía de hoja, no como filtro simple por roles. |
| `Sup, JT` | 18 | Incluye inspecciones, charlas, EPP y flujo de accidentes N° 66-76. |
| `PRF` | 41 | Vista PRF pura con protocolos, EPP, capacitaciones y campañas. |
| `Adm. de contrato` | 2 | N° 28 y 72. |
| `Subgerente operaciones y mant.` | 1 | N° 5. |
| `Capacitación y Campañas ` | 12 | N° 54-60 y 85-89; mantiene nombre con espacio final en el XLSX. |

Objetivos específicos reales del XLSX:
1. Fortalecer el liderazgo de seguridad y salud en el trabajo (N° 1-9).
2. Mantener a la empresa y sus sucursales entre los márgenes de la normativa legal vigente (N° 10-34).
3. Detectar, evaluar, medir y corregir condiciones y conductas sub-estándar (N° 35-50).
4. Reforzar la cultura preventiva del personal (N° 51-60).
5. Elementos de Protección Personal (EPP) (N° 61-65).
6. Controlar la aplicación del procedimiento de accidentes e incidentes (N° 66-78).
7. Controlar la aplicación del procedimiento de contingencia y sus instructivos (N° 79-84).
8. Campañas de seguridad y salud en el trabajo (N° 85-89).

Lo que ya está implementado en el repo (ola 2026-06-30):
- `db/schema/prevention.ts` con 6 tablas: IPER matrices + risk items, prevention incidents + actions, training courses + worker assignments.
- 3 services en `lib/services/prevention-*.ts`, validation en `lib/validation/prevention.ts`, manifest `modules/prevention/manifest.ts`, registry actualizado, RBAC test verde.
- 3 páginas App Router: `/prevencion/iper`, `/prevencion/incidentes`, `/prevencion/capacitaciones` con detalle en `/prevencion/incidentes/[id]`.
- 3 endpoints de export XLSX en `/api/prevencion/<area>/export`.
- 1 migración: `0007_striped_mantis.sql`.

Lo que **falta** para cumplir el documento tal como está escrito:

1. **PDTP como sistema** (crítico): tabla de actividades (catálogo de las 89), programa anual versionado con estados (draft/active/closed), firmas de JDPR y Gerente Legal, control de cambios, cronograma semanal P/E con bitácora de ejecución, porcentaje de cumplimiento mensual y trimestral, réplica por hoja de rol, y exportes XLSX que emulen las 8 hojas.
2. **Inspecciones y observaciones conductuales** (N° 39–41): schema, service, UI y bitácora digital.
3. **Capacitación MINSAL completa** (N° 44–50, 54–60, 85–89): protocolos PREXOR, TMERT, psicosocial, UV, vida saludable, estrés, alcohol/drogas, seguridad vial, puntos ciegos.
4. **EPP preventivo avanzado** (N° 61–65): matriz EPP por cargo/riesgo, vida útil, recambio, evidencia de uso, stock crítico.
5. **Permisos de trabajo y AST/ART/JSA** (N° 43, 46, 51, 53).
6. **Emergencias y CGRD** (N° 79–84): plan de emergencia, simulacros, brigadas, GRD, extintores, botiquines.
7. **Gestión documental legal** (N° 15, 18, 19): RIOHS, ODI, IRL, carpeta de arranque, cartas SEREMI/inspección.
8. **CPHS y reuniones** (N° 11–14): constitución, reuniones mensuales, actas, programa CPHS.
9. **Contratistas y Ley 20.123** (N° 20).
10. **KPIs preventivos** (N° 7): tasa de frecuencia, gravedad, siniestralidad, días perdidos, cierres vencidos, reincidencia.
11. **Reportes operacionales, equipos y alcotest** (N° 25–34): report diario de equipos, revisión/firma por Sup/JT, contenedores, maquinaria, taller/RESPEL, alcotest DO-48 y envío de registros.
12. **Procedimiento completo de accidentes e incidentes** (N° 66–78): avisos inmediatos, informe preliminar 3 horas, encuesta/declaración, DIAT, investigación 72 horas, informe definitivo, difusión, seguimiento y ONE PAGE.
13. **Multi-rol y responsables no-RBAC** (N° 5, 6, 8, 9, 25, 28, 55, 64): los responsables "JDPR", "PRF", "Adm. de contrato", "Sup", "JT", "CPHS", "Sub. Gerente Operaciones", "Gerente Legal y RRHH", "JM" y "Conductores, operadores y choferes" deben ser modelados como responsables del PDTP aunque no todos sean roles de login.

Este plan ataca los 13 frentes en 4 olas secuenciadas por dependencias técnicas, terminando con el sistema PDTP funcional, auditable y firmado.

---

## 1. Decisiones estructurales (acordadas con el usuario)

- **Alcance:** PDTP completo + bases restantes. Se cubren las 8 hojas del Excel como sistema, no solo los datos primarios.
- **Modelo de roles:** se mantiene el RBAC en 3 roles globales (`prevencionista`, `prevencionista_faena`, `administrador`) más los ya existentes (`jefa_chome`, `secretaria`, `admin_contrato`, `conductor_lider`, `jefe_mantencion`, `solicitante_faena`). Se agregan 3 roles nuevos: `supervisor_faena`, `jefe_terreno`, `cphs`. La terna "JDPR / Subgerente Operaciones / Gerente Legal y RRHH" se cubre con `prevencionista` y `jefa_chome` respectivamente, con `pdtp_responsible_catalog.displayName` reproduciendo el string exacto del Excel sin requerir un rol 1-a-1. `JM` se mapea a `jefe_mantencion`; "Conductores, operadores y choferes" se registra como responsable operacional ejecutable por trabajador/equipo y no como rol administrativo.
- **Hojas del Excel:** no se derivan solo por intersección de roles. Se guarda una tabla explícita de membresía `pdtp_sheet_activities` porque `CPHS`, `PRF Y Adm. de contrato` y `Capacitación y Campañas ` incluyen actividades cuyo responsable textual no coincide 1:1 con el nombre de la hoja.
- **Cronograma:** las celdas P/E aceptan cantidades, no booleanos. En el Excel hay semanas con `5` (por ejemplo charlas diarias N° 38 y N° 53); por eso el modelo usa `plannedQuantity` y `executedQuantity`.
- **Aprobaciones:** tabla `pdtp_programs` con `status='draft'|'active'|'closed'`, `approvedByJdprUserId`, `approvedByJdprAt`, `approvedByLegalUserId`, `approvedByLegalAt` (esta última firma pendiente en el Excel). Tabla `pdtp_change_log` para los diffs de versiones.

---

## 2. Stack y convenciones (respeto de AGENTS.md y código existente)

- **Source of truth:** `lib/services/<dominio>.ts` (servicios puros) + `app/(app)/<área>/actions.ts` (Server Actions).
- **Manifests:** `modules/<área>/manifest.ts` solo contiene `permissions`, `permissionMeta`, `nav`, `defaultGrants`, `seed`.
- **Migraciones:** `npm run db:generate` produce deltas; **nunca** editar `meta/_journal.json` a mano. Re-ejecutar `db:generate` debe terminar en "No schema changes".
- **RBAC:** seed vía `npm run db:seed`, nunca en migraciones. Nuevos roles van en `lib/auth/system-rbac.ts > SYSTEM_ROLES`.
- **Exports:** SIEMPRE XLSX, nunca CSV. Helpers en `lib/reports/export.ts` o route handler dedicado.
- **Server Actions:** `guardAuth()` → verificación de permiso → `resolveWorksiteScope()` → revalidación.
- **Scope de faena:** `string[] | "all"`, helper `assertWorksiteAccess(worksiteId, scope)` en cada service.
- **Tests:** Vitest + PGlite con mock de `@/db` vía `globalThis.__db`, `migratePGlite` desde `lib/testing/pglite-migrate`.
- **Next.js modificado:** leer `node_modules/next/dist/docs/` antes de cualquier cambio en rutas o Server Actions.

---

## 3. Permisos compartidos del PDTP (nuevos en `modules/prevention/manifest.ts`)

```ts
const NEW_PERMISSIONS = [
  "prevention:pdtp:view",        // ver PDTP por hoja de rol o vista general
  "prevention:pdtp:manage",      // crear/borrar actividades, marcar ejecutado
  "prevention:pdtp:approve",     // firmar como JDPR
  "prevention:pdtp:sign_legal",  // firmar como Gerente Legal y RRHH
  "prevention:inspections:view",
  "prevention:inspections:manage",
  "prevention:inspections:close",
  "prevention:equipment_reports:view",
  "prevention:equipment_reports:manage",
  "prevention:alcohol_tests:view",
  "prevention:alcohol_tests:manage",
  "prevention:epp_matrix:view",
  "prevention:epp_matrix:manage",
  "prevention:incident_procedure:view",
  "prevention:incident_procedure:manage",
  "prevention:incident_procedure:close",
  "prevention:permits:view",
  "prevention:permits:request",
  "prevention:permits:approve",
  "prevention:permits:close",
  "prevention:legal_docs:view",
  "prevention:legal_docs:manage",
  "prevention:legal_docs:sign",
  "prevention:health:view",
  "prevention:health:manage",
  "prevention:health:restrict",
  "prevention:emergency:view",
  "prevention:emergency:manage",
  "prevention:emergency:drill",
  "prevention:contractors:view",
  "prevention:contractors:manage",
  "prevention:cphs:view",
  "prevention:cphs:manage",
  "prevention:kpis:view",
  "prevention:kpis:export",
] as const
```

Default grants (resumen):
- `prevencionista` (JDPR): `pdtp:view/manage/approve`, `inspections:*`, `equipment_reports:*`, `alcohol_tests:*`, `incident_procedure:*`, `epp_matrix:*`, `permits:*`, `legal_docs:*`, `health:*`, `emergency:*`, `contractors:*`, `cphs:*`, `kpis:*`. `sign_legal` queda solo para `jefa_chome` (Gerente Legal y RRHH).
- `prevencionista_faena` (PRF): `pdtp:view/manage` (sin approve ni sign_legal), `inspections:*`, `equipment_reports:view/manage`, `alcohol_tests:view/manage`, `incident_procedure:view/manage`, `epp_matrix:view`, `permits:view/request`, `legal_docs:view`, `health:view`, `emergency:view`, `contractors:view`, `cphs:view`, `kpis:view`.
- `jefa_chome` (Gerente Legal y RRHH / subgerente): `pdtp:view/approve/sign_legal`, `kpis:view/export`, `legal_docs:sign`.
- `administrador`: todos los `manage`, `close`, `approve`, `sign_legal`.
- `supervisor_faena` (rol nuevo): `inspections:view/manage`, `equipment_reports:view/manage`, `alcohol_tests:view/manage`, `incident_procedure:view/manage`, `permits:view/request`, `kpis:view`.
- `jefe_terreno` (rol nuevo): igual a `supervisor_faena` + `emergency:view/manage`, `cphs:view`.
- `cphs` (rol nuevo): `cphs:view/manage`, `inspections:view`, `kpis:view`, `pdtp:view`.

---

## 4. Roles nuevos (en `lib/auth/system-rbac.ts`)

```ts
{ id: "rol-sup-faena", name: "supervisor_faena", label: "Supervisor de faena", description: "Ejecuta bitácora P/E del PDTP y levanta inspecciones en sus faenas", isGlobal: false },
{ id: "rol-jt", name: "jefe_terreno", label: "Jefe de terreno", description: "Lidera terreno: charas, alcotest, inspecciones, emergencias y bitácora P/E", isGlobal: false },
{ id: "rol-cphs", name: "cphs", label: "Representante CPHS", description: "Miembro del Comité Paritario de Higiene y Seguridad con acceso a reuniones y KPIs", isGlobal: false },
```

`GLOBAL_ROLES` no cambia: estos 3 son `isGlobal: false` (con scope de faena).

`FAENA_SCOPED_ROLES` (en `app/(app)/admin/usuarios/actions.helpers.ts`) se actualiza para incluir los 3 nuevos.

`scopeToIds` (en `lib/auth/can.ts`) y `resolveWorksiteScope` (en `lib/auth/scope.ts`) **no se modifican** — ya soportan cualquier rol con `isGlobal: false` y `worksiteUsers`.

`lib/auth/admin-user-scope.ts` se valida para que la asignación de faenas funcione con los nuevos roles.

---

## 5. Modelo de datos (tablas nuevas, todas en `db/schema/prevention.ts` o archivos por dominio)

### 5.1 PDTP — Catálogo de actividades y bitácora

| Tabla | Campos clave | Constraints |
|---|---|---|
| `pdtp_programs` | `year` (PK lógico), `version`, `status` (`draft`/`active`/`closed`), `title`, `elaboratedByUserId`, `elaboratedByName`, `elaboratedByTitle`, `approvedByJdprUserId?`, `approvedByJdprAt?`, `approvedByLegalUserId?`, `approvedByLegalAt?`, `createdAt` | `unique(year, version)` |
| `pdtp_responsible_catalog` | `slug`, `displayName`, `roleName?`, `kind` (`rbac_role`/`worker_group`/`external_label`), `notes` | `unique(slug)`, `unique(displayName)` |
| `pdtp_activities` | `programId`, `n` (1–89), `objectiveOrder` (1-8), `objective`, `activity`, `program`, `responsibleSlugs` (text[]: `['prf','admin_contrato',...]`), `responsibleDisplay` (texto exacto del XLSX), `sourceSheetRow`, `notes` | `unique(programId, n)`, `index(responsibleSlugs)` con GIN opcional |
| `pdtp_activity_schedule` | `activityId`, `year`, `month` (1–12), `week` (1–4), `plannedQuantity` (numeric), `sourceColumn` | `unique(activityId, year, month, week)`, `check(plannedQuantity >= 0)` |
| `pdtp_executions` | `activityId`, `worksiteId?`, `year`, `month` (1–12), `week` (1–4), `executedQuantity` (numeric), `status` (`draft`/`submitted`/`approved`/`rejected`), `evidenceText?`, `evidenceUrl?`, `evidencePhotos` (text[]), `executedByUserId`, `executedAt`, `approvedByUserId?`, `approvedAt?` | `unique(activityId, worksiteId, year, month, week)`, `index(worksiteId, year, month)`, `check(executedQuantity >= 0)` |
| `pdtp_change_log` | `programId`, `version`, `changedByUserId`, `changedAt`, `section` (catalog/executions), `before` (jsonb), `after` (jsonb), `note` | `index(programId, version)` |
| `pdtp_sheets` (catálogo de hojas réplica) | `code` (`pdtp_general`, `cphs`, `prf_adm_contrato`, `sup_jt`, `prf`, `adm_contrato`, `subgerente`, `capacitacion`), `label`, `area` (`prevencion`/`capacitacion`/`subgerencia`), `defaultScopeRoles` (text[]) | `unique(code)` |
| `pdtp_sheet_activities` | `sheetCode`, `activityId`, `sheetRow`, `displayOrder` | `unique(sheetCode, activityId)`, `index(sheetCode, displayOrder)` |

`pdtp_activities.responsibleSlugs` guarda responsables normalizados (`['prf']`, `['admin_contrato']`, `['jt','sup']`, `['jefa_dpto_prevencion']`, `['jm']`, `['conductores_operadores_choferes']`, etc.) y `responsibleDisplay` conserva el texto exacto del Excel. La UI puede filtrar por rol del usuario, pero las exportaciones y vistas oficiales usan `pdtp_sheet_activities` para replicar exactamente cada hoja.

La suma mensual no se calcula contando filas: se calcula con `plannedQuantity` y `executedQuantity`. Esto es obligatorio porque el Excel programa cantidades mayores a 1 en algunas semanas.

### 5.2 Inspecciones y observaciones conductuales

| Tabla | Campos clave | Constraints |
|---|---|---|
| `inspection_templates` | `code`, `title`, `scope`, `items` (jsonb), `frequency` (`diaria`/`semanal`/`quincenal`/`mensual`/`trimestral`/`semestral`/`anual`/`evento`), `requiresPhoto` | `unique(code)` |
| `inspection_runs` | `templateId`, `worksiteId`, `inspectorId`, `startedAt`, `completedAt?`, `status` (`open`/`in_review`/`closed`), `signature?` | `index(worksiteId, status)` |
| `inspection_items` | `runId`, `itemKey`, `expected`, `observed?`, `status` (`ok`/`no_conforme`/`critico`/`na`), `note?`, `photoUrl?`, `closedAt?` | `unique(runId, itemKey)` |
| `behavioral_observations` | `worksiteId`, `observerId`, `workerId?`, `antecedent`, `behavior`, `consequence`, `severity` (`bajo`/`medio`/`alto`/`critico`), `runId?`, `correctiveActionId?` | `index(worksiteId, severity)` |

### 5.2.1 Reportes operacionales, equipos y alcotest

| Tabla | Campos clave | Constraints |
|---|---|---|
| `equipment_daily_reports` | `worksiteId`, `equipmentId`, `operatorWorkerId`, `reportedAt`, `shift`, `status` (`ok`/`observado`/`fuera_servicio`), `odometer?`, `hourmeter?`, `checklist` (jsonb), `signedByWorkerId?` | `index(worksiteId, reportedAt)`, `index(equipmentId, reportedAt)` |
| `equipment_report_reviews` | `reportId`, `reviewedByUserId`, `reviewedAt`, `status` (`aprobado`/`observado`/`requiere_cierre`), `findings` (jsonb), `closedAt?` | `unique(reportId)` |
| `equipment_checklists` | `worksiteId`, `kind` (`contenedor`/`camion`/`equipo`/`carro`/`batea`/`taller_respel`), `assetCode`, `performedByUserId`, `performedAt`, `items` (jsonb), `status`, `closeRequired` | `index(worksiteId, kind, performedAt)` |
| `alcohol_tests` | `worksiteId`, `performedByUserId`, `testedWorkerId?`, `shift`, `performedAt`, `procedureCode` (`DO-48`), `result` (`negativo`/`positivo`/`rechazado`/`no_concluyente`), `evidenceUrl?`, `sentAt?` | `index(worksiteId, performedAt)`, `index(testedWorkerId, performedAt)` |
| `sanitization_controls` | `worksiteId`, `providerName`, `serviceDate`, `reportUrl`, `reviewedByUserId`, `reviewedAt`, `status`, `expiresAt?` | `index(worksiteId, serviceDate)` |

### 5.3 Matriz EPP preventiva

| Tabla | Campos clave | Constraints |
|---|---|---|
| `epp_position_matrix` | `worksiteId`, `position`, `eppProductId`, `riskId?` (link a `iper_risk_items.id`), `requiredSince`, `notes` | `unique(worksiteId, position, eppProductId)` |
| `epp_lifecycle_policies` | `eppProductId`, `lifespanDays`, `maxReuses?`, `inspectionChecklist` (jsonb) | `unique(eppProductId)` |
| `epp_recambio_log` | `workerId`, `eppProductId`, `deliveredAt`, `expiresAt`, `returnedAt?`, `disposition?` (`baja`/`reparable`/`reutilizable`/`vigente`) | `index(workerId, expiresAt)` |
| `epp_stock_thresholds` | `worksiteId`, `eppProductId`, `minStock`, `criticalStock` | `unique(worksiteId, eppProductId)` |

### 5.4 Permisos de trabajo y AST/ART/JSA

| Tabla | Campos clave | Constraints |
|---|---|---|
| `permit_templates` | `code`, `title`, `riskType` (`altura`/`confinado`/`caliente`/`excavacion`/`izaje`/`electrico`/`otro`), `astFields` (jsonb), `validityHours`, `requiresSignoff` (jsonb: roles requeridos) | `unique(code)` |
| `permit_requests` | `templateId`, `worksiteId`, `requesterId`, `task`, `location`, `plannedStart`, `plannedEnd`, `ast` (jsonb), `status` (`solicitado`/`en_revision`/`aprobado`/`en_ejecucion`/`cerrado`/`rechazado`/`cancelado`), `approverId?`, `executorId?` | `index(worksiteId, status, plannedStart)` |
| `permit_signoffs` | `permitId`, `role`, `userId`, `signedAt`, `signature` | `unique(permitId, role)` |
| `permit_attachments` | `permitId`, `kind`, `url`, `uploadedBy` | `index(permitId, kind)` |

### 5.5 Documentación legal (RIOHS, ODI, IRL, programas)

| Tabla | Campos clave | Constraints |
|---|---|---|
| `legal_documents` | `type` (`rio_hs`/`odi`/`irl`/`programa`/`protocolo`/`otro`), `code`, `title`, `currentVersionId?`, `mandatory` | `unique(type, code)` |
| `legal_document_versions` | `documentId`, `version`, `effectiveFrom`, `effectiveTo?`, `fileUrl`, `changelog`, `signedBy` | `unique(documentId, version)` |
| `document_deliveries` | `versionId`, `workerId`, `deliveredAt`, `method`, `evidenceUrl`, `acknowledgedAt?` | `unique(versionId, workerId)` |
| `document_signatures` | `deliveryId`, `userId`, `signature`, `signedAt`, `ip?` | `unique(deliveryId, userId)` |

### 5.6 Salud ocupacional y protocolos MINSAL

| Tabla | Campos clave | Constraints |
|---|---|---|
| `health_exams` | `workerId`, `type` (`preocupacional`/`periodico`/`egreso`/`reincorporacion`), `protocolId?`, `performedAt`, `result` (`apto`/`apto_con_restricciones`/`no_apto`/`pendiente`), `expiresAt?`, `evidenceUrl` | `index(workerId, type, expiresAt)` |
| `health_aptitudes` | `workerId`, `examId?`, `position`, `aptitude`, `restrictions` (jsonb), `validUntil` | `index(workerId, position, validUntil)` |
| `health_restrictions` | `workerId`, `kind`, `description`, `effectiveFrom`, `effectiveTo?` | `index(workerId, effectiveTo)` |
| `minsal_protocols` | `code` (`prexor`/`tmert`/`psicosocial`/`uv`/`silice`/`hiperbaria`/`estres_termico`), `name`, `legalFramework`, `appliesToPositions` (jsonb), `periodicityMonths` | `unique(code)` |
| `protocol_applications` | `workerId`, `protocolId`, `startedAt`, `lastEvaluationAt`, `nextDueAt`, `status` (`vigente`/`vencido`/`suspendido`/`n_a`) | `unique(workerId, protocolId)` |

### 5.7 Emergencias y CGRD

| Tabla | Campos clave | Constraints |
|---|---|---|
| `emergency_plans` | `worksiteId`, `version`, `threats` (jsonb), `roles` (jsonb), `routes` (jsonb), `approvedBy?`, `approvedAt?` | `unique(worksiteId, version)` |
| `emergency_drills` | `planId`, `type`, `scheduledAt`, `executedAt?`, `attendees` (int), `findings` (jsonb), `effectiveness` (`eficaz`/`parcialmente_eficaz`/`no_eficaz`) | `index(planId, scheduledAt)` |
| `emergency_teams` | `worksiteId`, `name`, `leaderId`, `members` (jsonb) | `unique(worksiteId, name)` |
| `emergency_equipment` | `worksiteId`, `kind` (`extintor`/`botiquin`/`camilla`/`otro`), `code`, `location`, `lastInspectionAt?`, `nextInspectionAt` | `unique(worksiteId, kind, code)` |
| `equipment_inspections` | `equipmentId`, `performedAt`, `performedBy`, `status`, `findings` | `index(equipmentId, performedAt)` |

### 5.8 Contratistas, CPHS y reuniones

| Tabla | Campos clave | Constraints |
|---|---|---|
| `contractors` | `rut`, `name`, `legalRepresentative`, `contact`, `status` | `unique(rut)` |
| `contractor_workers` | `contractorId`, `workerId`, `position`, `startDate`, `endDate?` | `index(contractorId, endDate)` |
| `contractor_documents` | `contractorId`, `type`, `versionId?`, `status`, `expiresAt?` | `index(contractorId, type, expiresAt)` |
| `committees` | `worksiteId`, `type` (`cphs`/`cphs_faena`/`bipartito_capacitacion`), `createdAt`, `status` | `unique(worksiteId, type)` |
| `committee_members` | `committeeId`, `userId`, `role`, `startDate`, `endDate?` | `unique(committeeId, userId)` |
| `committee_meetings` | `committeeId`, `scheduledAt`, `heldAt?`, `attendees` (jsonb), `agenda`, `minutesUrl?` | `index(committeeId, scheduledAt)` |
| `committee_agreements` | `meetingId`, `description`, `responsibleId`, `dueDate`, `status` | `index(meetingId, status)` |

### 5.9 KPIs preventivos

| Tabla | Campos clave | Constraints |
|---|---|---|
| `kpi_snapshots` | `worksiteId?`, `period` (`YYYY-MM`), `metric`, `value` (numeric), `computedAt`, `source` | `unique(worksiteId, period, metric)` |
| `labor_hours` | `worksiteId`, `period` (`YYYY-MM`), `hours` (numeric) | `unique(worksiteId, period)` |

### 5.10 Procedimiento de accidentes e incidentes (extensión de lo existente)

Las tablas actuales `prevention_incidents` y `prevention_actions` se mantienen. Se agregan tablas de procedimiento para cubrir N° 66-78 del Excel:

| Tabla | Campos clave | Constraints |
|---|---|---|
| `incident_notifications` | `incidentId`, `kind` (`aviso_inmediato`/`informe_preliminar`/`diat`/`informe_definitivo`/`one_page`), `recipientRole`, `sentByUserId`, `sentAt`, `deadlineAt?`, `channel`, `evidenceUrl?` | `unique(incidentId, kind, recipientRole)`, `index(deadlineAt, sentAt)` |
| `incident_statements` | `incidentId`, `workerId?`, `statementType` (`encuesta`/`declaracion_puno_letra`/`testigo`), `takenByUserId`, `takenAt`, `fileUrl?`, `summary` | `index(incidentId, takenAt)` |
| `incident_investigations` | `incidentId`, `startedAt`, `dueAt`, `completedAt?`, `method` (`arbol_causal`/`do_36`/`otro`), `participants` (jsonb), `rootCauses` (jsonb), `finalReportUrl?`, `status` | `unique(incidentId)` |
| `incident_corrective_followups` | `incidentId`, `actionId?`, `responsibleUserId`, `dueDate`, `status`, `closedAt?`, `evidenceUrl?` | `index(incidentId, status)`, `index(dueDate, status)` |
| `incident_disseminations` | `incidentId`, `kind` (`difusion_turno`/`medidas_preventivas`/`one_page`), `worksiteId`, `performedByUserId`, `performedAt`, `attendanceUrl?`, `contentUrl?` | `index(incidentId, performedAt)` |

---

## 6. Migración

Una sola migración `0008_pdtp_sgsst_2026.sql` generada con `drizzle-kit generate` que cubre:

- 3 roles nuevos en `roles`.
- Permisos nuevos listados en la sección 3 (módulo `prevention`).
- Grants `role_permissions` correspondientes según `defaultGrants` del manifest actualizado.
- Tablas nuevas listadas arriba + sus `relations()`, separando PDTP, reportes operacionales, EPP, salud, emergencias, documentación, contratistas, comités, KPIs y procedimiento de incidentes.
- Sin funciones SQL custom (todo vive en el service layer).

Post-migración:
- `npm run db:generate` final → "No schema changes".
- `git diff --check` limpio.
- `lib/__tests__/frozen-modular-migration.test.ts` sigue verde (solo `modules/prevention/manifest.ts` en el módulo).

---

## 7. Fases (4 olas)

### Ola 1 — PDTP como sistema (crítico, base de las otras)

**Entregables:**
1. 3 roles nuevos en `lib/auth/system-rbac.ts` (Sup, JT, CPHS) + `npm run db:seed`.
2. Permisos nuevos en `modules/prevention/manifest.ts` + `defaultGrants` + nav entries (`/prevencion/pdtp`, `/prevencion/inspecciones`, `/prevencion/equipos`, `/prevencion/alcotest`, `/prevencion/kpis`).
3. Schema PDTP (7 tablas) en `db/schema/prevention.ts` (sección PDTP).
4. Validation Zod en `lib/validation/prevention.ts` (nuevos schemas).
5. Service `lib/services/prevention-pdtp.ts` con:
   - `loadCatalogFromXlsx()` (importador idempotente: recibe JSON del Excel y crea/actualiza 89 actividades + 8 sheets + membresías de hoja + cronograma con cantidades).
   - `getActiveProgram(year)`, `createProgram(input, userId)`, `signAsJdpr(programId, userId)`, `signAsLegal(programId, userId)`, `cloneProgram(programId)`.
   - `markExecution(activityId, scope, year, month, week, executedQuantity, evidence)`, `bulkMarkFromSheet(rows)`.
   - `getKpiMonthly(programId, worksiteId, year)`, `getKpiQuarterly(programId, worksiteId, year)`.
   - `buildPdtpExport(programId, sheetCode)` que replica **una hoja del Excel** con cronograma anual y KPIs.
6. Catálogo inicial en `db/seed/pdtp-catalog-2026.json` con los 89 ítems extraídos del XLSX (estructura: `{n, objectiveOrder, objective, program, activity, responsibleSlugs, responsibleDisplay, sheetCodes, schedule, notes}`).
7. `npm run db:seed` actualizado para sembrar el catálogo 2026 + 3 roles nuevos.
8. Server Actions en `app/(app)/prevencion/pdtp/actions.ts` (12 funciones) + RBAC.
9. Páginas:
   - `/prevencion/pdtp/page.tsx`: vista por defecto = hoja oficial asociada al usuario (`pdtp_sheet_activities`), con fallback por rol y toggle a "Vista general (PDTP GENERAL)".
   - `/prevencion/pdtp/programa/page.tsx`: estado del programa (draft/active/closed), botones "Firmar como JDPR" / "Firmar como Legal" con guard de permisos.
   - `/prevencion/pdtp/cambios/page.tsx`: `pdtp_change_log` con diffs.
   - `/prevencion/pdtp/kpi/page.tsx`: tabla de cumplimiento mensual y trimestral + gráfico de tendencia.
10. Componentes cliente:
    - `PdtpSheetTable.tsx`: replica visual del Excel (encabezado Mes/Semana/P-E, color por nivel de cumplimiento, celda con cantidad programada y cantidad ejecutada editable).
    - `PdtpSignDialog.tsx`: modal de firma (nombre legible + comentario, persistido en `pdtp_change_log`).
    - `PdtpCatalogImport.tsx`: botón "Importar Excel" que sube el .xlsx y previsualiza diffs.
11. Route handlers XLSX:
    - `GET /api/prevencion/pdtp/export?programId=...&sheet=pdtp_general` → replica exacta de una hoja.
    - `GET /api/prevencion/pdtp/export?programId=...&sheet=capacitacion` → hoja de capacitación + campañas.
    - El mismo endpoint acepta los 8 `sheetCode` del Excel y conserva nombres oficiales, incluida `Capacitación y Campañas `.
12. Tests:
    - `lib/__tests__/prevention-pdtp.test.ts` (>=10 tests con PGlite): loadCatalogFromXlsx idempotente, 89 actividades, 8 objetivos, membresía de 8 hojas, cantidades planificadas mayores a 1, firmas con guard de rol, markExecution no duplica, getKpiMonthly calcula %, buildPdtpExport retorna XLSX no vacío.
    - `lib/__tests__/prevention-pdtp-rbac.test.ts`: server actions deniegan por permiso/scope.
    - `app/(app)/prevencion/pdtp/pdtp-sheet-table.test.tsx`: render con datos.
13. **Verificación final de la ola**: typecheck + ESLint + `db:generate` no drift + tests focales verdes + suite completa verde.

### Ola 2 — Inspecciones, reportes operacionales, alcotest y EPP preventivo (N° 23–34, 39–42, 51, 53, 61–65)

**Entregables:**
1. Schema `db/schema/prevention.ts` (sección inspections + reportes operacionales + alcotest + epp_matrix) con las tablas de 5.2, 5.2.1 y 5.3.
2. Service `lib/services/prevention-inspections.ts` con CRUD + `addObservation()` + cierre exige completitud.
3. Service `lib/services/prevention-equipment.ts` con report diario, revisión/firma, checklists de contenedores/maquinaria/taller RESPEL y cierres.
4. Service `lib/services/prevention-alcohol-tests.ts` con registro DO-48, evidencias y envío de registros.
5. Service `lib/services/prevention-epp-matrix.ts` con `getCriticalStock(worksiteId)`, `getExpiredEpp(worksiteId, today)`, `assignFromMatrix(workerId, position, worksiteId)`.
6. Hook en `lib/services/epp.ts` (existente, no romper): al entregar EPP que esté en `epp_position_matrix` para el cargo del trabajador, crear fila en `epp_recambio_log` con `expiresAt = deliveredAt + lifespanDays`.
7. UI:
   - `/prevencion/inspecciones/page.tsx` (lista filtrable por faena, status, fecha).
   - `/prevencion/inspecciones/[id]/page.tsx` (detalle, items, observaciones conductuales, cierre con firma).
   - `/prevencion/equipos/reportes/page.tsx` (report diario de equipos y revisión/firma).
   - `/prevencion/equipos/checklists/page.tsx` (contenedores, maquinaria, carros, bateas, taller/RESPEL).
   - `/prevencion/alcotest/page.tsx` (registro DO-48 y envío de respaldos).
   - `/prevencion/epp/matriz/page.tsx` (matriz cargo × EPP por faena).
   - `/prevencion/epp/stock/page.tsx` (alertas stock crítico).
   - `/prevencion/epp/vencidos/page.tsx` (EPP vencidos por faena).
8. Server Actions + RBAC.
9. 7 endpoints XLSX: inspecciones, observaciones, reportes de equipos, checklists de equipos, alcotest, matriz EPP, stock crítico.
10. Tests focales PGlite + UI.
11. Conexión con PDTP: al crear hallazgo crítico en inspección, crear `pdtp_execution` para la actividad N° 40 o 41 (según tipo) en la semana actual; reportes/checklists/alcotest alimentan N° 25-34; al observar `severity='critico'`, crear acción en `committee_agreements` si hay CPHS activo.

### Ola 3 — Capacitación MINSAL, salud ocupacional, emergencias y CGRD (N° 44–50, 54–60, 79–84, 85–89)

**Entregables:**
1. Schema con 11 tablas (training MINSAL, health_exams, aptitudes, restrictions, minsal_protocols, protocol_applications, emergency_plans, drills, teams, equipment, equipment_inspections).
2. Seed adicional: `minsal_protocols` con 7 protocolos (PREXOR, TMERT, psicosocial, UV, sílice, hiperbaria, estrés térmico); `training_courses` con los cursos del PDTP (Extintores, Primeros auxilios, Manejo a la defensiva, Comunicación efectiva, Coordinador GRD, Investigación árbol causal, Liderazgo línea de mando, IRL, ODI, RIOHS, Módulos vida saludable, Manejo del estrés, Alcohol y Drogas, Seguridad Vial, Puntos ciegos).
3. Service `lib/services/prevention-health.ts` con `getActiveAptitude(workerId, position)`, `isRestricted(workerId, today)`, `getDueProtocols(workerId, today)`.
4. Service `lib/services/prevention-emergency.ts` con `getOverdueInspections(worksiteId, today)`, `requiresEmergencyPlan(worksiteId)` (basado en Ley 21.364).
5. UI:
   - `/prevencion/salud/page.tsx` (ficha de salud por trabajador).
   - `/prevencion/salud/protocolos/page.tsx` (cumplimiento MINSAL por protocolo y faena).
   - `/prevencion/emergencias/page.tsx` (dashboard: planes vigentes, simulacros del año, equipos con inspección vencida).
   - `/prevencion/emergencias/[tipo]/page.tsx` (planes, simulacros, equipos, brigadas).
6. Server Actions + RBAC + permisos nuevos (`health:restrict`, `emergency:drill`).
7. 3 endpoints XLSX: salud ocupacional por trabajador, cumplimiento MINSAL por faena, emergencias.
8. Tests focales.
9. Integración con PDTP: las actividades N° 44–50, 54–60, 79–84, 85–89 ahora se "ejecutan" marcando ejecuciones reales (capacitación con asistencia, simulacro con resultado, inspección de equipo con hallazgo).

### Ola 4 — Documentación legal, contratistas, CPHS, KPIs e incidentes completos (N° 7, 11–15, 18–20, 35–36, 66–78)

**Entregables:**
1. Schema con documentación legal, contratistas, comités, KPIs y extensión del procedimiento de incidentes (tablas de 5.5, 5.8, 5.9 y 5.10).
2. Service `lib/services/prevention-legal-docs.ts` con versionado inmutable, `deliverDocument(workerId, versionId)`, `acknowledgeDelivery()`, `getPendingDeliveries(workerId)`, `getExpiredDocuments(worksiteId, today)`.
3. Service `lib/services/prevention-contractors.ts` con padrón, `getContractorCompliance(contractorId)`, `blockContractorIfExpired(contractorId, worksiteId)`.
4. Service `lib/services/prevention-committees.ts` con `requiresCphs(worksiteId)` (basado en conteo de `workers` + `contractor_workers` activos), `scheduleMeeting()`, `recordAttendance()`, `trackAgreement()`.
5. Service `lib/services/prevention-kpis.ts` con:
   - `computeMonthlySnapshot(worksiteId, period)`: tasa accidentabilidad, frecuencia, gravedad, siniestralidad, % cumplimiento IPER, capacitaciones vencidas, inspecciones abiertas, cierres vencidos, cumplimiento documental, cumplimiento EPP.
   - `getKpiTrend(metric, worksiteIds, fromPeriod, toPeriod)`.
   - `buildKpiExport(programId, year)`: XLSX con 12 hojas (una por métrica) + 1 hoja de alertas.
6. Service `lib/services/prevention-incident-procedure.ts` que orquesta plazos del DO-36: aviso inmediato, informe preliminar 3 horas, encuesta/declaración, DIAT, investigación 72 horas, informe definitivo, difusión, seguimiento y ONE PAGE.
7. UI:
   - `/prevencion/documentacion/page.tsx` (catálogo por tipo, vigente/vencido).
   - `/prevencion/documentacion/[id]/page.tsx` (detalle de versión, entregas, firmas).
   - `/prevencion/contratistas/page.tsx` (padrón por faena).
   - `/prevencion/contratistas/[id]/page.tsx` (cumplimiento documental).
   - `/prevencion/comites/page.tsx` (CPHS, bipartito, reuniones, acuerdos).
   - `/prevencion/kpis/page.tsx` (dashboard con cards + sparklines + tabla histórica).
   - `/prevencion/incidentes/[id]/procedimiento/page.tsx` (línea de tiempo N° 66-78, plazos y evidencias).
8. Server Actions + RBAC.
9. 5 endpoints XLSX: documentación legal (matriz trabajador x tipo), cumplimiento contratistas, actas de comité, KPIs completos, procedimiento de incidentes.
10. Tabla `audit_annulments` (anulaciones auditadas para evidencia legal).
11. Tests focales + tests de concurrencia (upserts atómicos, inmutabilidad post-firma).
12. **Verificación final del PDTP**: 8 hojas del Excel se pueden exportar y replican formato + fórmulas + firmas.

---

## 8. Servicios y componentes (resumen de archivos por ola)

### Ola 1
- **Crear:** `lib/services/prevention-pdtp.ts`, `app/(app)/prevencion/pdtp/{page,programa,cambios,kpi}/page.tsx`, `app/(app)/prevencion/pdtp/actions.ts`, `app/(app)/prevencion/pdtp/{pdtp-sheet-table,pdtp-sign-dialog,pdtp-catalog-import}.tsx`, `app/api/prevencion/pdtp/export/route.ts`, `db/seed/pdtp-catalog-2026.json`, `lib/__tests__/prevention-pdtp.test.ts`, `lib/__tests__/prevention-pdtp-rbac.test.ts`, `app/(app)/prevencion/pdtp/pdtp-sheet-table.test.tsx`.
- **Modificar:** `db/schema/prevention.ts` (sección PDTP), `db/schema/index.ts`, `lib/validation/prevention.ts`, `lib/auth/system-rbac.ts`, `modules/prevention/manifest.ts`, `modules/registry.ts`, `db/seed.ts`, `app/(app)/admin/usuarios/actions.helpers.ts`.

### Ola 2
- **Crear:** `lib/services/prevention-inspections.ts`, `lib/services/prevention-equipment.ts`, `lib/services/prevention-alcohol-tests.ts`, `lib/services/prevention-epp-matrix.ts`, `app/(app)/prevencion/inspecciones/{page,actions}.tsx`, `app/(app)/prevencion/inspecciones/[id]/page.tsx`, `app/(app)/prevencion/equipos/{reportes,checklists}/page.tsx`, `app/(app)/prevencion/alcotest/page.tsx`, `app/(app)/prevencion/epp/{matriz,stock,vencidos}/page.tsx`, `app/api/prevencion/inspecciones/export/route.ts`, `app/api/prevencion/equipos/{reportes,checklists}/export/route.ts`, `app/api/prevencion/alcotest/export/route.ts`, `app/api/prevencion/epp/{matriz,stock,vencidos}/export/route.ts`, `lib/__tests__/{prevention-inspections,prevention-equipment,prevention-alcohol-tests,prevention-epp-matrix}.test.ts`.
- **Modificar:** `db/schema/prevention.ts` (sección inspections + reportes operacionales + alcotest + epp), `lib/validation/prevention.ts`, `lib/services/epp.ts` (hook sin breaking change), `modules/prevention/manifest.ts`, `modules/registry.ts`.

### Ola 3
- **Crear:** `lib/services/prevention-health.ts`, `lib/services/prevention-emergency.ts`, `app/(app)/prevencion/salud/{page,protocolos}/page.tsx`, `app/(app)/prevencion/emergencias/{page,[tipo]/page}.tsx`, `app/api/prevencion/salud/export/route.ts`, `app/api/prevencion/emergencias/export/route.ts`, `lib/__tests__/{prevention-health,prevention-emergency}.test.ts`, `db/seed/{minsal-protocols,training-catalog-pdtp-2026}.json`.
- **Modificar:** `db/schema/prevention.ts`, `lib/validation/prevention.ts`, `modules/prevention/manifest.ts`, `modules/registry.ts`, `db/seed.ts`.

### Ola 4
- **Crear:** `lib/services/prevention-legal-docs.ts`, `lib/services/prevention-contractors.ts`, `lib/services/prevention-committees.ts`, `lib/services/prevention-kpis.ts`, `lib/services/prevention-incident-procedure.ts`, `app/(app)/prevencion/documentacion/{page,[id]/page}.tsx`, `app/(app)/prevencion/contratistas/{page,[id]/page}.tsx`, `app/(app)/prevencion/comites/page.tsx`, `app/(app)/prevencion/kpis/page.tsx`, `app/(app)/prevencion/incidentes/[id]/procedimiento/page.tsx`, `app/api/prevencion/documentacion/export/route.ts`, `app/api/prevencion/contratistas/export/route.ts`, `app/api/prevencion/comites/export/route.ts`, `app/api/prevencion/kpis/export/route.ts`, `app/api/prevencion/incidentes/procedimiento/export/route.ts`, `lib/__tests__/{prevention-legal-docs,prevention-contractors,prevention-committees,prevention-kpis,prevention-incident-procedure}.test.ts`.
- **Modificar:** `db/schema/prevention.ts` (sección final), `lib/validation/prevention.ts`, `modules/prevention/manifest.ts`, `modules/registry.ts`, `db/seed.ts`.

---

## 9. Patrones transversales (de la auditoría 2026-06-30)

1. **Inmutabilidad post-cierre:** todo registro cerrado legalmente vinculante rechaza `UPDATE`/`DELETE`; permite anulación auditada vía `audit_annulments`.
2. **Upsert atómico:** `onConflictDoUpdate` en lugar de `select`+`insert` para autoguardado concurrente.
3. **Constraints únicos:** `uniqueIndex` sobre cualquier (resourceId, n) o tupla lógica.
4. **Notificaciones con scope:** helper `targetUsers({ permission, worksiteIds })` que filtra por permiso global vs. faena-asignado (patrón del fix PPA).
5. **Export XLSX universal:** `lib/reports/buildXlsx` con hojas nombradas, anchos de columna, autofilter, formato de cabeceras.
6. **Server Action típico:** `guardAuth()` → `can(perm)` → `resolveWorksiteScope()` → servicio puro → `revalidatePath()`.
7. **Tests PGlite:** `globalThis.__db` + `vi.mock("@/db", ...)` + `migratePGlite` antes de los `describe`.
8. **Migración única por ola:** una `.sql` por ola, validada con `db:generate` roundtrip.

---

## 10. Verificación al cerrar cada ola

```bash
# 1. Typecheck
npm run typecheck

# 2. Lint
npx eslint <archivos tocados>

# 3. Migración
npm run db:generate
PGHOST=/var/run/postgresql npm run db:migrate
npm run db:generate   # debe decir "No schema changes"

# 4. Tests focales
npm test -- \
  lib/__tests__/prevention-pdtp.test.ts \
  lib/__tests__/prevention-pdtp-rbac.test.ts \
  app/'(app)'/prevencion/pdtp/*.test.tsx

# 5. Regresión
npm test

# 6. Hygiene
git diff --check
```

Criterios de "ola cerrada":
- ✅ Typecheck y ESLint sin errores.
- ✅ Migración aplica limpio y `db:generate` sin drift.
- ✅ Tests focales verdes.
- ✅ Sin regresión en suite completa (o regresión documentada con fix).
- ✅ `AUDITORIA_PREVENCION_RIESGOS.md` actualizado con verificación + fecha + items cerrados.

---

## 11. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Edición manual del journal rompe migraciones | Regla en AGENTS.md + CI verifica diff del journal |
| R2 | Next.js modificado con breaking changes | Leer `node_modules/next/dist/docs/` antes de cada ola |
| R3 | Tablas duplicadas (e.g., acciones correctivas dispersas) | Decidir en Ola 4 si unificar `corrective_actions` |
| R4 | No hay fuente de horas hombre trabajadas para KPI frecuencia/gravedad | Pre-requisito explícito: crear `labor_hours` con seed inicial o importar de planillas |
| R5 | Firmas digitales sin validez legal (solo base64) | Corto plazo: hash + IP + timestamp; mediano: integrar firma.gob.cl |
| R6 | Carga de UI por tablas grandes | Paginación server-side, filtros por faena, índices |
| R7 | Acoplamiento entre módulos | Helpers en `lib/services/<dominio>.ts` con API estable; tests de integración |
| R8 | Export XLSX lento con muchos registros | Streaming cuando supere 10k filas |
| R9 | Tests PGlite divergen de Postgres real | CI usa PGlite + job semanal aplica a Postgres efímero |
| R10 | Catálogo de 89 ítems mal extraído del XLSX | Doble revisión manual + importador idempotente (`loadCatalogFromXlsx` puede re-ejecutarse) |

---

## 12. Roadmap visual

```
Semana  1  2  3  4  5  6  7  8 │ 9 10 11 12 13 14 15 16 │17 18 19 20 21 22 23 24 │25 26 27 28 29 30 31 32
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
Ola 1:  ████████████████████████ PDTP como sistema (catálogo, bitácora, firmas, KPI, exports)
Ola 2:                            ████████████████████████ Inspecciones + equipos + alcotest + EPP matrix
Ola 3:                                                   ████████████████████████ Salud + Emergencias
Ola 4:                                                                          ████████████████████████ Doc Legal + Contratistas + CPHS + KPIs + incidentes

Hitos clave:
  S4  Catálogo PDTP cargado y firmado como JDPR
  S8  Bitácora P/E digital + export XLSX de 8 hojas
  S12 Inspecciones MVP
  S16 EPP matrix MVP
  S20 Salud ocupacional + MINSAL MVP
  S24 Emergencias + CGRD MVP
  S28 Documentación legal + contratistas + CPHS MVP
  S32 KPIs preventivos y reporting completo
```

---

## 13. Checklist de cierre del PDTP

- [ ] Tablas nuevas migradas, permisos registrados, 3 roles nuevos seeded y responsables no-RBAC cargados en `pdtp_responsible_catalog`.
- [ ] 89 actividades del XLSX cargadas en `pdtp_activities` con 8 objetivos, responsables correctos, `responsibleDisplay` exacto y cronograma con cantidades.
- [ ] 8 hojas exportadas como XLSX replicando formato del documento y membresía exacta por hoja.
- [ ] Bitácora P/E funcional con cálculo de % cumplimiento mensual y trimestral.
- [ ] Firmas de JDPR y Gerente Legal y RRHH registradas con `change_log`.
- [ ] Inspecciones, observaciones conductuales, reportes de equipos, alcotest, EPP matrix, salud ocupacional, emergencias, documentación legal, contratistas, CPHS, procedimiento de incidentes, KPIs todos en producción.
- [ ] `AUDITORIA_PREVENCION_RIESGOS.md` con cada faltante histórico movido a "implementado" + comando de verificación + fecha.
- [ ] Suite completa de tests en verde.
- [ ] Migraciones limpias (último `db:generate` dice "No schema changes").
- [ ] Sin warnings de ESLint en código nuevo.
- [ ] Manual de usuario para fiscalización publicado en `docs/operacion/`.

---

## 14. Self-review

- ✅ Spec coverage: cubre los 8 objetivos reales del XLSX, las 8 hojas, las 89 actividades y los 13 frentes identificados al inicio.
- ✅ Coherencia con código: respeta `lib/services` + `app/(app)/<area>/actions.ts` como source of truth y los manifests.
- ✅ Cumplimiento normativo: cada módulo mapea a su base legal (DS 44, DS 594, Ley 20.123, 21.364, 21.643, 19.518, 16.744).
- ✅ Placeholder scan: no hay TBD ni pasos sin comando esperado.
- ✅ Consistencia de nombres: tablas y campos coherentes entre schema, services y tests.
- ✅ Trazabilidad de migración: una sola `.sql` por ola, validada con roundtrip.
- ✅ Réplica fiel del Excel: 8 hojas oficiales, con cronograma P/E cuantitativo, membresía explícita por hoja, nombres oficiales y fórmulas de KPI equivalentes.
- ✅ Decisiones estructurales con el usuario documentadas: alcance (PDTP completo + bases), modelo de roles (3 nuevos sin tocar RBAC existente), aprobaciones (tabla `pdtp_programs` + `pdtp_change_log`), catálogo (seed idempotente), UI (vista por defecto = hoja del rol).
