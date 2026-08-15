# Módulo SST y CPHS: implementación por etapas

Fecha: 2026-08-13 · Estado: **en construcción**
Origen: `Propuesta_Modulo_SST_CPHS_CHOME_v2.pdf`, aprobada por Prevención.
Empalma con `2026-08-12-pdtp-actividades-accionables-design.md` (decisión D5).

## 1. Contexto

La propuesta aprobada describe 25 secciones de módulo SST/CPHS. **La mayor parte
ya existe**: la Capacidad 5 (CPHS/gobernanza) se cerró el 2026-07-19 con 7 tablas,
y los dominios de medidas (CAPA), incidentes, higiene/vigilancia y RBAC cubren
§9, §12, §15 y §20 completos.

Este documento sólo planifica **lo que falta**, y respeta dos decisiones previas
que la propuesta desconoce:

- **§17 (Comité Paritario de Faena del mandante) queda fuera.** El 2026-07-19 se
  determinó que Chome opera como contratista, no como empresa principal, y se
  eliminó deliberadamente el set `prevention:contractors:*`. Las obligaciones de
  constitución del DS 76 recaen en el mandante. Ver `lib/__tests__/prevention-rbac.test.ts:111-114`.
- **§7 (elección digital) queda fuera.** Decisión del 2026-08-13: la
  incorporación de integrantes sigue siendo manual (`addCommitteeMember`). Se
  construye la *validación* de elegibilidad y equidad, no la votación.

### 1.1 Estado por sección de la propuesta

| Estado | Secciones |
|---|---|
| Ya implementado | §9 medidas · §12 investigación · §15 vigilancia · §20 permisos y trazabilidad |
| Parcial | §6 comité (falta acta/DT/alertas) · §11 inspecciones (falta origen CPHS y cierre oportuno) · §13 MIPER (falta FK de participación y mapa visual) · §19 paneles |
| Falta entero | §2 delegado SST · §5 ficha preventiva · §10 programa del comité · §14 capacitación ligada a CPHS · §16 comunicación CPHS · §18 certificación Mutual |
| Descartado | §7 elección digital · §17 comité del mandante |

### 1.2 La deuda que dejó D5

El 2026-08-12 se sacaron del PDTP las actividades N°12 (cursos CPHS), N°13
(reunión mensual) y N°14 (crear el programa del comité) con el argumento de que
"el módulo CPHS tendrá su propio programa con su propio cumplimiento".
`PDTP_CPHS_ACTIVITY_NUMBERS` pasó de `[11,12,13,14]` a `[11]`.

**Ese programa nunca se construyó.** Hoy esas tres obligaciones no las mide
nadie. La Etapa 1 salda esa deuda.

## 2. Decisiones de diseño

- **D-A · El catálogo de requisitos Mutual vive en código, no en base.** Los
  requisitos los fija el manual de Mutual, no el usuario. Mismo patrón que las
  definiciones de checklist (`lib/sst/definitions/*.ts`, constantes que se
  instalan como plantillas). Sin seed, sin migración, diffeable en git.
- **D-B · Los requisitos automáticos se evalúan en vivo y se congelan al
  presentar.** Una brecha tiene que estar al día para ser accionable, pero un
  expediente cuyo contenido cambia solo no sirve como evidencia de auditoría.
  Vista de trabajo = cálculo en vivo; `submitted` = snapshot en tabla.
- **D-C · Las brechas de certificación son acciones CAPA** (`sourceType: 'cphs'`,
  `targetDate` = plazo de 60 días). Aparecen en `/pendientes` gratis por la
  fuente `capa`, que ya existe. No se inventa un tablero de brechas.
- **D-D · El acta de constitución y el comprobante DT se adjuntan por
  `sstDocumentLinks`**, no como columnas de archivo en el comité. El CHECK de
  `entityType` ya acepta `'committee'`; sólo falta el allowlist del servicio
  (`lib/services/prevention-documents/links.ts:19-29`, ~6 líneas, sin migración).
  Se hereda versionado, checksum, aprobación, acuse con firma y auditoría.
- **D-E · El programa del comité NO reusa el motor PDTP.** PDTP es
  programas→actividades→ejecuciones→obligaciones→slots→aprobación. El programa
  del CPHS son 2 tablas y una ocurrencia derivada. D5 dijo "su propio
  cumplimiento" y eso es lo barato, no lo caro.
- **D-F · La ocurrencia del programa es derivada, no materializada** — mismo
  criterio que D2 del PDTP (`deriveActivityStatus`).
- **D-G · La ficha preventiva se protege con `prevention:cphs:view` y muestra
  secciones según permiso**, con el patrón de `prevention-home.tsx` (`can()` por
  sección). No se crea un permiso nuevo para una pantalla de lectura.
- **D-H · Un solo permiso nuevo: `prevention:cphs:certify`.** El programa del
  comité reusa `cphs:manage`; el delegado reusa `cphs:manage`. La certificación
  sí se separa: es un trámite externo que no todo prevencionista dirige.

## 3. Etapa 1 — Cumplimiento base y CPHS

### 3.1 Organización preventiva por faena (§2)

Hoy el umbral es binario y vive dentro de PDTP: `PDTP_CPHS_MIN_HEADCOUNT = 25`
en `lib/services/pdtp/worksites.ts:207`, que excluye la actividad N°11 en faenas
bajo 25. No existe el tramo 10–25 ni el concepto de Delegado SST (cero
coincidencias de "delegado" en todo el repo).

**Puro** — `lib/prevention/cphs-organization.ts`:
```ts
export const CPHS_MIN_HEADCOUNT = 25
export const DELEGATE_MIN_HEADCOUNT = 10
export type PreventiveOrganization = "cphs" | "delegate" | "none"
export function resolvePreventiveOrganization(headcount: number): PreventiveOrganization
export function assessOrganizationCompliance(input: {
  headcount: number; hasActiveCommittee: boolean; hasActiveDelegate: boolean
}): { required: PreventiveOrganization; compliant: boolean; detail: string }
```
`PDTP_CPHS_MIN_HEADCOUNT` pasa a re-exportar `CPHS_MIN_HEADCOUNT` para que el
umbral quede en un solo lugar.

**Tabla nueva** — `prevention_worksite_delegates`, prefijo `cphsdel-`:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `worksite_id` | text NOT NULL | → `worksites.id` restrict |
| `worker_id` | text NOT NULL | → `workers.id` restrict |
| `designated_on` | text NOT NULL | `YYYY-MM-DD` |
| `term_ends_on` | text | nullable |
| `status` | text NOT NULL def `'active'` | CHECK `IN ('active','ended')` |
| `ended_reason` / `ended_at` | text / timestamptz | consistencia por CHECK, motivo ≥10 |
| `version` | integer NOT NULL def 1 | CHECK ≥1 |
| `created_by_user_id` | text NOT NULL | → `users.id` restrict |
| `created_at` / `updated_at` | timestamptz defaultNow | |

Unique parcial `prevention_worksite_delegate_active_unique` sobre `worksite_id
WHERE status='active'` (un delegado vigente por faena, espejo del unique del
comité). CHECK `term_ends_on IS NULL OR term_ends_on > designated_on`.

**Servicio** — `lib/services/prevention-cphs-organization.ts`, con el
`CphsAccess`/`requireAccess`/`history` de `prevention-cphs.ts`:
`designateDelegate`, `endDelegate` (concurrencia optimista), `listDelegates`,
`getWorksiteHeadcount`. Historial en `preventionGovernanceHistory` con
`entityType: 'delegate'` (el `changeType` no tiene CHECK: sin migración).

### 3.2 Ficha preventiva por faena (§5)

No existe ninguna ruta de detalle por faena (`app/(app)/admin/faenas/` es CRUD
plano, sin `[id]`). Se crea bajo Prevención, no bajo admin: el usuario es el
prevencionista, que no tiene `admin:worksites`.

- `app/(app)/prevencion/faenas/page.tsx` — lista de faenas del alcance con
  dotación, organización requerida vs. real, y semáforo de cumplimiento.
- `app/(app)/prevencion/faenas/[worksiteId]/page.tsx` — la ficha.
- `lib/services/prevention-worksite-profile.ts` →
  `getWorksitePreventiveProfile(worksiteId, access)`, que agrega: dotación
  activa (`workers`), histórico de dotación (`safetyIndicatorDenominators`, que
  ya guarda `workerCount` por mes y es la fuente canónica), comité activo,
  delegado activo, prevencionista responsable, y estado del programa.

⚠️ Trampa conocida: `syncPdtpCphsHeadcountExclusion` cuenta `workers` en vivo
mientras el panel de indicadores usa `safetyIndicatorDenominators.workerCount`
cargado a mano por mes. **Son dos números que pueden discrepar.** La ficha
muestra los dos, rotulados, en vez de elegir uno en silencio.

### 3.3 Programa de trabajo del CPHS (§10) — salda D5

**Tabla `prevention_committee_programs`**, prefijo `cphspg-`:
`id` · `committee_id` → committees cascade · `year` integer · `status` CHECK
`IN ('draft','active','closed')` def `'draft'` · `approved_by_user_id` → users
set null · `approved_at` · `version` · `created_by_user_id` restrict ·
timestamps. Unique `(committee_id, year)`.

**Tabla `prevention_committee_program_activities`**, prefijo `cphspa-`:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `program_id` | text NOT NULL | → programs cascade |
| `title` | text NOT NULL | |
| `description` | text | |
| `planned_month` | integer NOT NULL | CHECK BETWEEN 1 AND 12 |
| `due_on` | text | `YYYY-MM-DD`, nullable |
| `responsible_member_id` | text | → members set null |
| `commission_label` | text | comisión cuando no es una persona |
| `risk_topic` | text | CHECK `IN ('vial','higiene','ergonomia','psicosocial','silice','otro')` o NULL |
| `status` | text NOT NULL def `'planned'` | CHECK `IN ('planned','done','cancelled')` |
| `completed_at` / `completion_note` | timestamptz / text | |
| `evidence_reference` | text | patrón liviano de `preventionCapaEvidence` |
| `evidence_checksum_sha256` | text | CHECK NULL o largo 64 |
| `reviewed_in_meeting_id` | text | → meetings set null — "seguimiento en reunión mensual" |
| `version` | integer def 1 | CHECK ≥1 |
| `created_by_user_id` | text NOT NULL | restrict |
| `created_at` / `updated_at` | timestamptz | |

CHECK de consistencia: `status='done'` ⇒ `completed_at NOT NULL`;
`status='cancelled'` ⇒ `completion_note` ≥10 caracteres.

**Puro** — `lib/prevention/cphs-program.ts`: `deriveProgramActivityStatus(activity,
asOf) → 'pending'|'done'|'overdue'|'cancelled'` (vencida si su mes planificado
ya pasó y sigue `planned`), `summarizeProgramCompliance(activities, asOf) →
{planned, done, overdue, compliancePct}` (denominador = actividades cuyo mes ya
llegó, no las 12), y los label maps.

**Servicio** — `lib/services/prevention-cphs-program.ts`: `createProgram`,
`addProgramActivity`, `completeProgramActivity`, `cancelProgramActivity`,
`linkActivityToMeeting`, `activateProgram`, `getProgramStatus`,
`listProgramsForCommittee`. Todo bajo `cphs:manage` salvo lecturas
(`cphs:view`). Historial `entityType: 'committee_program' | 'program_activity'`.

### 3.4 Cierre del ciclo del comité (§6, §8)

1. **Acta de constitución y comprobante DT**: agregar `'committee'` a
   `DOCUMENT_LINK_ENTITY_TYPES` y el `case` en `resolveDocumentLinkTarget`
   (`lib/services/prevention-documents/links.ts`). Sin migración.
2. **Registro ante la Dirección del Trabajo**: dos columnas en
   `prevention_committees` — `dt_registered_on` (text date) y
   `dt_registration_reference` (text). Es un dato del comité, no un documento.
3. **Servicios que faltan** (el esquema ya los admite, nadie los escribe):
   `dissolveCommittee` (status `dissolved` + motivo ≥10), `replaceCommitteeMember`
   (usa `replaced_by_member_id`, hoy muerto), `resignCommitteeMember`,
   `cancelCommitteeMeeting` (el estado `cancelled` es inalcanzable hoy).
4. **Elegibilidad y equidad**: extender `assessCommitteeParity` con las reglas de
   elegibilidad que sí son verificables con los datos que hay.
   ⚠️ **La equidad de género de la propuesta NO es implementable**: `workers` no
   tiene columna de sexo (el único campo de sexo del esquema está en
   `preventionIncidentPeople`). Se deja anotado como brecha, no se inventa.

### 3.5 Alertas y cola operacional (§19)

`expireLapsedCommittees()` existe y **no lo llama nadie** fuera de su test.

- Ruta cron `app/api/cron/prevention-cphs-alerts/route.ts` siguiendo
  `prevention-capa-reminders` (mismo patrón `createNotifications` + `dedupeKey`):
  llama `expireLapsedCommittees()`, avisa mandato por vencer (60/30/7 días),
  cadencia vencida (≥2 meses sin sesionar) y actividades del programa atrasadas.
  ⚠️ El agendamiento queda fuera del repo: `scripts/cron-runner.mjs` sólo
  registra los jobs de DTE y facturación, y ningún cron de prevención
  (`prevention-capa-reminders` incluido) aparece en él. La ruta queda lista y su
  programación se hace donde ya viven las demás.
- **Cola `/pendientes`**: agregar `"cphs"` a `OperationalModule`
  (`lib/work-queue.types.ts`) y a `OPERATIONAL_MODULE_LABELS`
  (`lib/work-queue-labels.ts`), más tres ramas en
  `operationalSourceBranches` respetando el contrato de 20 columnas: sesión
  atrasada por cadencia, mandato por vencer, actividad del programa atrasada.
  Las brechas de certificación **no** necesitan rama: son CAPA (D-C).
- Panel de atención: `prevention-attention.ts` no es un registro sino una función
  con tres consultas fijas. Añadir `includeCphs` + su consulta + mapper, y
  ampliar el union `kind`. ⚠️ Su comparador de orden (`:75`) trata `neutral` y
  `warning` como iguales; corregirlo al tocarlo.

### 3.6 Capacitación ligada al comité (§14, requisito Bronce)

`preventionCompetencyRequirements.scope` acepta `global|worksite|position|task`.
Agregar `committee` toca exactamente 5 lugares: el CHECK del esquema (migración),
el CHECK `scope_value_present`, el enum Zod + su `superRefine`
(`lib/validation/prevention-module/training.ts`), `COMPETENCY_SCOPE_LABELS` y el
`switch` de `requirementApplies` (`lib/prevention/training.ts:177-190`).
`scope_value` es text plano: lleva el `committee_id` sin columna nueva.

Curso "Orientación en Prevención de Riesgos" como requisito de los integrantes.
⚠️ Brecha adyacente detectada: `trainingCourseSchema` no expone
`pdtpActivityNumbers`, así que hoy un curso sólo puede ligarse al PDTP por SQL
directo. Se corrige de paso (una línea en el schema + una en `createTrainingCourse`).

## 4. Etapa 2 — Preparación Bronce Mutual (§18)

**Catálogo en código** (D-A) — `lib/prevention/cphs-certification.ts`:
```ts
export type CertificationLevel = "bronce" | "plata" | "oro"
export type RequirementCheck =
  | { kind: "auto"; key: AutoCheckKey }
  | { kind: "manual" }
export interface CertificationRequirement {
  code: string; level: CertificationLevel; title: string; description: string
  check: RequirementCheck; sortOrder: number
}
export const CERTIFICATION_REQUIREMENTS: readonly CertificationRequirement[]
```
Los `AutoCheckKey` de Bronce y de dónde salen:

| Key | Se resuelve con |
|---|---|
| `committee_constituted` | fila activa en `preventionCommittees` |
| `parity_valid` | `assessCommitteeParity` (ya valida titulares parejos) |
| `roles_assigned` | `assessCommitteeParity` (exige un presidente y un secretario) |
| `fuero_declared` | algún miembro activo con `hasFuero` |
| `monthly_meetings` | actas cerradas por mes vía `assessMeetingCadence` |
| `agreements_tracked` | acuerdos con `capaActionId` no nulo |
| `work_program_active` | programa de la Etapa 1 en `active` con actividades |
| `event_investigation` | incidentes con investigación cerrada |

Manuales (exigen evidencia adjunta): acta registrada ante la DT, orientación en
prevención de los integrantes, comunicación de riesgo grave e inminente.

**Tabla `prevention_certification_dossiers`**, prefijo `certexp-`: `id` ·
`committee_id` cascade · `level` CHECK · `period_year` · `status` CHECK
`IN ('draft','submitted','certified','rejected')` · `adherence_confirmed` bool ·
`sagecop_registered` bool · `sagecop_reference` · `audited_from`/`audited_to` ·
`audit_result` · `audited_on` · `gaps_deadline_on` (los 60 días) ·
`valid_until_on` (vigencia anual) · `contributions_status` (cotizaciones Ley
16.744) · `version` · `created_by_user_id` · timestamps.
Unique `(committee_id, level, period_year)`.

**Tabla `prevention_certification_evaluations`** (el congelado de D-B), prefijo
`certev-`: `id` · `dossier_id` cascade · `requirement_code` · `status` CHECK
`IN ('met','not_met','not_applicable')` · `source` CHECK `IN ('auto','manual')` ·
`detail` · `evidence_reference` · `capa_action_id` → CAPA set null ·
`evaluated_at` · `evaluated_by_user_id`. Unique `(dossier_id, requirement_code)`.

**Servicio** — `lib/services/prevention-cphs-certification.ts`:
`evaluateDossierLive(dossierId, access)` (no escribe), `submitDossier` (congela
el snapshot + abre una CAPA por cada `not_met` con `targetDate = gaps_deadline_on`),
`recordManualEvaluation`, `recordAuditResult`, `getDossier`, `listDossiers`.
Permiso nuevo `prevention:cphs:certify` (jefa de prevención + administrador);
lectura con `cphs:view`.

**UI** — `app/(app)/prevencion/cphs/certificacion/`: expediente con los tres
bloques (datos administrativos, checklist con su origen auto/manual, brechas
abiertas enlazadas a su CAPA).

### Implementado el 2026-08-13 (Etapas 1 y 2)

Migraciones `0160` (delegados, programa del comité, columnas DT), `0162`
(alcance `committee` en requisitos de competencia) y `0163` (expediente de
certificación). Las tres verificadas con `db:generate` idempotente.

| Pieza | Dónde |
|---|---|
| Umbral de 3 tramos | `lib/prevention/cphs-organization.ts`; PDTP re-exporta y consume la función |
| Programa del comité | `lib/prevention/cphs-program.ts` + `lib/services/prevention-cphs-program.ts` + `/prevencion/cphs/[id]/programa` |
| Delegado SST y ficha | `lib/services/prevention-cphs-organization.ts` + `/prevencion/faenas` y `/prevencion/faenas/[id]` |
| Ciclo del comité | `dissolveCommittee`, `resignCommitteeMember`, `replaceCommitteeMember`, `cancelCommitteeMeeting`, `recordCommitteeDtRegistration` |
| Alertas | `lib/services/prevention-cphs-reminders.ts` + `app/api/cron/prevention-cphs-alerts` + 3 ramas `cphs` en `/pendientes` + `includeCphs` en el panel de atención |
| Certificación Bronce | `lib/prevention/cphs-certification.ts` (catálogo) + `lib/services/prevention-cphs-certification.ts` + `/prevencion/cphs/[id]/certificacion` |

Pruebas: 21 puras de organización/programa, 18 del catálogo de certificación,
3 del alcance `committee`, 13 de integración PGlite
(`prevention-cphs-program-persistence.test.ts`, registrado en
`tests/pglite-files.ts`). `npm test` completo en verde salvo 4 fallos ajenos
preexistentes en `dte-portal/__tests__/sync.test.ts`.

**Corrección de borde con efecto legal**: `syncPdtpCphsHeadcountExclusion`
comparaba `headcount >= 25`, pero la exigencia es de MÁS de 25 trabajadores.
Con 25 justos ahora corresponde delegado, no comité. Ninguna faena está en ese
borde (Cholguán 41, Pacífico 35), así que no cambia ninguna exclusión vigente.

**Deuda encontrada y saldada de paso**: la aserción de
`prevention-rbac.test.ts` sobre `prevention:pdtp:execute` no incluía
`jefe_mantencion` pese a que C2 le concedió el permiso el 2026-08-13; el test
estaba rojo en HEAD.

**Lo que NO se hizo y hay que decidir**: la equidad de género de §7 sigue sin
ser calculable (`workers` no tiene columna de sexo) y el agendamiento del cron
queda fuera del repo.

### Implementado el 2026-08-13 (Etapa 3 y parte de 4-5)

Migración `0164`: `prevention_risk_matrices.committee_meeting_id` (participación
del CPHS verificable) y `prevention_inspection_runs.origin`
(`prevencion|cphs|mandante`, default `prevencion`).

- **§11** `summarizeTimelyClosure` en `lib/prevention/inspections.ts` — cierre
  oportuno con denominador honesto: lo abierto dentro de plazo no cuenta ni a
  favor ni en contra. `origin` cableado en `createInspectionRun`.
- **§13** `committeeMeetingId` expuesto en `riskMatrixDraftSchema` y escrito por
  `createRiskMatrixDraft`.
- **§16** `listDocumentsForEntity` + `CommitteeDocuments` en la ficha del comité:
  el acta, el comprobante DT y las difusiones viven en Documentación SST con su
  versionado y acuse; el módulo CPHS no guarda archivos.
- **Plata y Oro en el catálogo**: 7 requisitos Plata y 5 Oro. Se evalúan solos
  los que tienen dato — capacitación ampliada, inspecciones mensuales,
  inspecciones del comité, participación del CPHS en la IPER — y el resto queda
  `manual` en vez de fingir una medición inexistente.

### Implementado el 2026-08-13 (Etapas 4 y 5)

Migración `0166`: `agenda_sent_at` y `sent_to_management_at` en sesiones;
`prevention_committee_attendance.member_id` pasa a nullable con
`guest_worker_id`/`guest_name` y un CHECK de exclusividad; tablas
`prevention_committee_commissions` y `..._commission_members`.

Servicios nuevos en `prevention-cphs.ts`: `markAgendaSent`,
`markMinutesSentToManagement`, `addMeetingGuest`, `createCommission`,
`assignCommissionMember`, `listCommissions`.

Con eso, **cuatro requisitos pasaron de `manual` a `auto`**: tabla previa,
comisiones, invitación mensual y envío de actas a la administración. Quedan
manuales sólo los cinco que ningún dato del sistema puede sostener: comunicación
de riesgo grave e inminente, acción de seguridad compartida trimestral, mapa de
riesgos, seguridad vial y reconocimientos anuales.

Reparto final del catálogo: **11 requisitos Bronce, 7 Plata, 5 Oro**; 18
automáticos y 5 manuales.

El invitado no altera el quórum: `assessQuorum` se calcula sobre integrantes, no
sobre filas de asistencia, así que una fila con `member_id` nulo nunca puede
completar el quórum de una sesión.

⚠️ **Incidente de coordinación resuelto**: durante la Etapa 4 otra sesión tenía
ediciones de esquema sin migrar en el mismo checkout (eliminaba `sst_action_plan`
y `ppa_corrective_actions`), y `db:generate` arrastraba sus
`DROP TABLE ... CASCADE` dentro de la migración del CPHS. Se revirtieron dos
migraciones generadas —ninguna aplicada— y se esperó a que esa sesión aterrizara
su `0165`. La `0166` contiene sólo lo del CPHS. **Moraleja para el futuro: con
dos sesiones sobre el mismo checkout, revisar siempre el SQL generado antes de
darlo por bueno; drizzle migra el árbol entero, no tus cambios.**

### Implementado el 2026-08-13/14 (brechas del gap-listing: UI huérfana, curso, mapa de riesgos, pruebas)

Plan aprobado en `/home/allopze/.claude/plans/crea-un-plan-de-rosy-kite.md`.
Migraciones `0166` (Etapa 4-5), `0168` (mapa de riesgos) — `0167` fue de otra
sesión concurrente (renombre de columnas CAPA), verificado sin conflicto.

- **UI de las 10 acciones huérfanas**: `committee-lifecycle-dialogs.tsx`,
  `committee-maturity-dialogs.tsx`, `committee-commissions.tsx`, y
  "Vincular a sesión" en `program-panel.tsx`. De paso se corrigió un bug real:
  `listCommitteeMeetings` contaba invitados dentro de "convocados/asistieron",
  inflando esas cifras — se separó `guests` como columna propia.
- **Curso de orientación**: `scripts/seed-prevention-cphs-orientation-course.ts`
  (sembrado y verificado idempotente) + `pdtpActivityNumbers` ahora se escribe
  de verdad en `createTrainingCourse` (el diseño anterior afirmaba haberlo
  corregido "de paso" y **nunca se hizo** — verificado, no asumido).
- **Mapa de riesgos espacial**: `prevention_risk_map_layouts` +
  `..._markers`, overlay CSS puro sobre imagen responsiva (sin librería de
  mapas), mismo patrón de storage que la evidencia PDTP. El requisito Oro
  `risk_map` pasó de manual a automático.
- **Bug de concurrencia real encontrado por la prueba de integración**:
  `loadDossier` en `prevention-cphs-certification.ts` leía por `db` (conexión
  de nivel superior) desde DENTRO de tres transacciones
  (`recordManualEvaluation`, `updateDossierAdministrativeData`,
  `recordAuditResult`). Bajo PGlite esto es un auto-deadlock por conexión
  única; bajo Postgres real rompe la atomicidad que el control de versión
  optimista existe para garantizar — una lectura fuera de la transacción
  puede quedar obsoleta antes de que la escritura de adentro se confirme.
  Corregido pasando `tx` explícitamente en los tres sitios.
- **12 requisitos Bronce/Plata/Oro ahora en 20 automáticos** (subió de 18):
  `risk_map` se sumó a los cuatro de la Etapa 4-5 anterior.

Verificación: 112+12+13 pruebas puras/integración en verde, `npm run
db:generate` idempotente, cadena de migraciones íntegra. Fixtures CPHS y MIPER
agregadas a `e2e/setup-db.ts`; specs `prevencion-cphs-lifecycle.spec.ts`,
`prevencion-cphs-maturity.spec.ts` y `prevencion-miper-risk-map.spec.ts`
pendientes de correr contra un servidor real (ver §Verificación).

## 5. Etapa 3 — Gestión preventiva integrada

Casi todo existe; es cablear, no construir.

- **§13 participación del CPHS en MIPER**: `preventionRiskMatrices.participationSummary`
  es texto libre. Agregar `committee_meeting_id` → meetings set null para que la
  participación sea verificable.
- **§11 origen de la inspección**: `origin` en `preventionInspectionRuns`
  (CHECK `'prevencion'|'cphs'|'mandante'`, default `'prevencion'`) e indicador de
  **cierre oportuno** = hallazgos cuya CAPA cerró dentro de `targetDate`, como
  función pura sobre datos que ya están.
- **§16 comunicación**: publicar las actividades del comité del mes anterior y
  difundir protocolos reusando `sstDocuments` + `sstDocumentDistributionTargets`
  (que ya trae acuse con firma, `dueAt` y su cron de recordatorio).

## 6. Etapa 4 — Madurez Plata

- **Tabla previa**: columna `agenda_sent_at` en `preventionCommitteeMeetings`.
- **Comisiones**: `prevention_committee_commissions` + asignación de integrantes;
  las actividades del programa ya apuntan a comisión por `commission_label`, que
  pasaría a FK.
- **Invitados** (trabajador no integrante, mensual): hoy
  `preventionCommitteeAttendance.memberId` es NOT NULL. Volverlo nullable y sumar
  `guest_worker_id` con CHECK de "uno u otro".
- **Curso de 20 horas y Árbol de Causas**: cursos del catálogo + requisitos con
  el scope `committee` de la Etapa 1.
- **Seguimiento mensual de acuerdos, análisis mensual de accidentes,
  inspecciones mensuales, acción de seguridad compartida trimestral**: vistas y
  programación sobre CAPA, indicadores e inspecciones ya existentes.

## 7. Etapa 5 — Madurez Oro

- **IPER anual con participación del CPHS**: extiende la FK de la Etapa 3 con una
  regla de periodicidad anual.
- **Mapa de riesgos visual**: lo único genuinamente nuevo. Hoy sólo existe la
  matriz tabular; "Mapa de riesgos" aparece únicamente como string en el
  picklist de gestión del cambio.
- **Envío mensual de actas a la alta administración**: `sent_to_management_at` en
  las reuniones + distribución por Documentación SST.
- **Seguridad vial, reconocimientos, SGSST**: campañas y constancias.
- ⚠️ **GRD queda fuera**: el CGRD (DS 44) es un comité distinto del paritario,
  con su propia matriz, actas y programa. El doc del 12-08 ya lo identificó como
  "el mismo patrón que llevó al CPHS a tener módulo propio" (actividades N°79-81).
  Es un módulo aparte, no una sección de éste.

## 8. Verificación

Por etapa, antes de cerrarla:

1. `npm run db:generate` y confirmar que la segunda corrida dice "No schema
   changes". Nunca editar a mano `_journal.json` ni un `.sql` ya creado.
2. `npm run db:sync-rbac` tras cada cambio de `modules/prevention/manifest.ts`
   (la RBAC no va en migraciones).
3. Tests puros primero: `lib/__tests__/prevention-cphs-organization.test.ts`,
   `prevention-cphs-program-calc.test.ts`, `prevention-cphs-certification.test.ts`
   — sin DB, contra `lib/prevention/*.ts`.
4. Integración PGlite para el servicio del programa y el expediente, registrando
   el archivo en `tests/pglite-files.ts` (si se olvida, corre en el proyecto
   paralelo y satura la CPU).
5. `npm test` y `npm run test:pglite`. Las suites `*-postgres.test.ts` exigen
   `PGHOST=/var/run/postgresql` y su variable `*_ALLOW_DESTRUCTIVE_RESET`.
6. Correr la app y recorrer: ficha de faena → comité → programa → expediente.

## 9. Supuestos declarados

- El único comité real es **Cholguán**; los otros 3 en base son demo (C3 del doc
  del 12-08). Pacífico cierra por D13, así que su falta de comité no es
  incumplimiento pese a sus 35 trabajadores.
- La equidad de género de §7 no se implementa por falta de dato (ver 3.4).
- §17 y §7 quedan fuera por decisiones previas, no por omisión.

## 10. Cierre de brechas (2026-08-14, plan `crea-un-plan-de-rosy-kite`)

Tras "listame todo lo faltante" se ejecutaron 5 fases más para cerrar las 6
brechas reales que quedaron después de la Etapa 5:

- **Fase A**: UI para las 10 acciones de servicio que no tenían pantalla
  (disolver comité, renuncia/reemplazo de integrante, cancelar sesión, tabla
  previa enviada, invitado no integrante, acta enviada a gerencia, comisiones
  + asignación de integrante, vincular actividad del programa a sesión).
  Bug real encontrado de paso: `listCommitteeMeetings` contaba invitados como
  convocados/asistentes en el cálculo de quórum.
- **Fase B**: sembrado idempotente del curso "Orientación en Prevención de
  Riesgos" (`db:seed-cphs-orientation-course`). Se verificó que
  `pdtpActivityNumbers` — que el diseño del 13-08 decía haber agregado "de
  paso" — en realidad nunca se escribió ni en el schema Zod ni en
  `createTrainingCourse`; se corrigió con campo de UI incluido.
- **Fase C**: mapa de riesgos espacial (§13/Oro) — `preventionRiskMapLayouts`/
  `Markers`, storage local igual al patrón de evidencia PDTP, rutas IDOR-safe,
  overlay CSS por porcentaje sobre una imagen responsiva (sin librería de
  mapas). El requisito `risk_map` de certificación pasó de manual a
  automático (`riskMapActive && riskMapMarkerCount > 0`).
- **Fase D**: prueba de integración PGlite del ciclo completo de
  certificación. Encontró un bug real de concurrencia:
  `loadDossier()` usaba el cliente `db` de nivel superior desde dentro de
  `db.transaction()` en 3 sitios (`recordManualEvaluation`,
  `updateDossierAdministrativeData`, `recordAuditResult`) — autodeadlock bajo
  PGlite (conexión única) y violación de atomicidad bajo Postgres real.
  Corregido threading `tx` por parámetro.
- **Fase E**: fixtures de e2e + cobertura CRUD completa de las 10 acciones
  huérfanas en 3 specs nuevos (`prevencion-cphs-lifecycle`,
  `prevencion-cphs-maturity`, `prevencion-miper-risk-map`). Bug de
  accesibilidad encontrado al escribir los diálogos nuevos: faltaba la
  asociación `htmlFor`/`id` entre `Field` y su control en los campos Motivo
  (y ya faltaba, sin haber sido detectado, en diálogos preexistentes como
  `AddMemberDialog`/`ScheduleMeetingDialog`, nunca antes cubiertos por e2e).

**Verificación de cierre (2026-08-14)**:

- `npx vitest run --config vitest.config.ts`: 485 archivos, 4069 tests, 0
  fallos (181 skipped).
- `npx vitest run --config vitest.pglite.config.ts`: 62 archivos, 635 tests,
  0 fallos — incluye los 12 tests nuevos de
  `prevention-cphs-certification-persistence.test.ts`.
- `node scripts/verify-migration-chain.mjs`: 169 entradas verificadas hasta
  `0168_fat_scarlet_spider`.
- `npx drizzle-kit generate`: "No schema changes, nothing to migrate"
  (idempotente).
- **Los 3 specs e2e nuevos NO se pudieron ejecutar en vivo**: el `webServer`
  compartido de Playwright falla en `e2e/setup-db.ts` por una causa ajena a
  este trabajo — otra sesión concurrente dejó sin commitear un nuevo índice
  único `dte_documents_purchase_invoice_single_unique` en
  `db/schema/dte.ts`, pero el fixture DTE de `e2e/setup-db.ts:1301-1338`
  (preexistente, de `export-volume.spec.ts`) vincula a propósito dos DTEs al
  mismo `purchase_order_invoice_id` para probar detección de discrepancia —
  ahora viola esa restricción y tumba el arranque del servidor para *toda*
  la suite E2E, no sólo para los specs CPHS. No se tocó ese fixture: es
  trabajo en curso de otra sesión (`tasks/plan.md`/`todo.md` con cientos de
  líneas de diff sin commitear) y no corresponde corregirlo aquí. Los 3
  specs nuevos sí pasaron `tsc --noEmit` y `eslint` limpios, y siguen al pie
  de la letra los patrones ya probados del resto de la suite E2E
  (`expect.poll` para hidratación, `requestSubmit()`, `selectRadixById`,
  toasts). Pendiente: re-ejecutarlos en vivo una vez que la otra sesión
  resuelva esa colisión (o corrigiendo su propio fixture DTE, no el nuestro).
- Recorrido funcional manual: pendiente por la misma razón (requiere el
  mismo servidor E2E).
