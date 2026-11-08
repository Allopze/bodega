/**
 * Sincronización de dotación desde Talana (sistema de remuneraciones), sólo
 * lectura. Ver `lib/integrations/talana/`.
 *
 * Talana no se gestiona al día en Chome: lo que falta o está viejo allá no debe
 * mover nada acá. Por eso estas tablas guardan, además de la copia de Talana,
 * los marcadores que hacen que cada señal positiva (un contrato activo nuevo, un
 * finiquito) se procese una sola vez, y la «base» del merge a tres bandas que
 * evita pisar lo que alguien corrigió a mano en Chome.
 *
 * Minimización: sólo los campos que la sync usa. Nunca fecha de nacimiento,
 * correo, sueldo ni el payload crudo de Talana.
 */
import { sql } from "drizzle-orm"
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { workers } from "./worksites"

const civilDate = (column: unknown) => sql`${column} IS NULL OR ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`

/** Una fila por corrida, sea simulación o aplicación. */
export const talanaSyncRuns = pgTable("talana_sync_runs", {
  id:                      text("id").primaryKey(),
  trigger:                 text("trigger").notNull(),
  mode:                    text("mode").notNull(),
  status:                  text("status").notNull().default("running"),
  actorUserId:             text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  errorCode:               text("error_code"),
  /** Por qué el fusible no dejó aplicar nada. Nulo salvo en `blocked`. */
  fusibleReason:           text("fusible_reason"),
  /** Alguien revisó un bloqueo que persistía y dejó pasar la próxima corrida. */
  fusibleAcceptedAt:       timestamp("fusible_accepted_at", { withTimezone: true, mode: "string" }),
  fusibleAcceptedBy:       text("fusible_accepted_by").references(() => users.id, { onDelete: "set null" }),
  /** Esta corrida pasó gracias a esa aceptación. */
  fusibleBypassed:         boolean("fusible_bypassed").notNull().default(false),
  contractsReceived:       integer("contracts_received").notNull().default(0),
  contractsRejected:       integer("contracts_rejected").notNull().default(0),
  activeContracts:         integer("active_contracts").notNull().default(0),
  previousActiveContracts: integer("previous_active_contracts").notNull().default(0),
  unexplainedDrop:         integer("unexplained_drop").notNull().default(0),
  absencesReceived:        integer("absences_received").notNull().default(0),
  altas:                   integer("altas").notNull().default(0),
  reactivaciones:          integer("reactivaciones").notNull().default(0),
  bajas:                   integer("bajas").notNull().default(0),
  traslados:               integer("traslados").notNull().default(0),
  cargos:                  integer("cargos").notNull().default(0),
  jefes:                   integer("jefes").notNull().default(0),
  sexos:                   integer("sexos").notNull().default(0),
  skipped:                 integer("skipped").notNull().default(0),
  failed:                  integer("failed").notNull().default(0),
  startedAt:               timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  finishedAt:              timestamp("finished_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  check("talana_sync_runs_trigger_valid", sql`${table.trigger} IN ('cron', 'manual')`),
  check("talana_sync_runs_mode_valid", sql`${table.mode} IN ('simulate', 'apply')`),
  check("talana_sync_runs_status_valid", sql`${table.status} IN ('running', 'success', 'partial', 'failed', 'blocked')`),
  check("talana_sync_runs_error_code_valid", sql`${table.errorCode} IS NULL OR ${table.errorCode} ~ '^TALANA_[A-Z_]+$'`),
  check("talana_sync_runs_failed_has_code", sql`${table.status} <> 'failed' OR ${table.errorCode} IS NOT NULL`),
  check("talana_sync_runs_fusible_valid", sql`
    ${table.fusibleReason} IS NULL OR ${table.fusibleReason} IN ('no_active_contracts', 'active_drop', 'mass_altas')
  `),
  check("talana_sync_runs_blocked_has_reason", sql`(${table.status} = 'blocked') = (${table.fusibleReason} IS NOT NULL)`),
  check("talana_sync_runs_counts_valid", sql`
    ${table.contractsReceived} >= 0 AND ${table.contractsRejected} >= 0 AND ${table.activeContracts} >= 0
    AND ${table.previousActiveContracts} >= 0 AND ${table.unexplainedDrop} >= 0 AND ${table.absencesReceived} >= 0
    AND ${table.altas} >= 0 AND ${table.reactivaciones} >= 0 AND ${table.bajas} >= 0 AND ${table.traslados} >= 0
    AND ${table.cargos} >= 0 AND ${table.jefes} >= 0 AND ${table.sexos} >= 0 AND ${table.skipped} >= 0 AND ${table.failed} >= 0
  `),
  index("talana_sync_runs_started_idx").on(table.startedAt),
  index("talana_sync_runs_status_idx").on(table.status),
])

/**
 * Copia local de los contratos de Talana. Nunca se borran: un contrato que deja
 * de aparecer queda con `missing_since`, y eso no cambia nada en Chome.
 */
export const talanaContracts = pgTable("talana_contracts", {
  talanaContractId:      integer("talana_contract_id").primaryKey(),
  talanaPersonId:        integer("talana_person_id"),
  /** Canónico `12345678-9` (`cleanRut`). */
  rut:                   text("rut").notNull(),
  rutValid:              boolean("rut_valid").notNull(),
  firstName:             text("first_name"),
  lastNamePaternal:      text("last_name_paternal"),
  lastNameMaternal:      text("last_name_maternal"),
  sex:                   text("sex"),
  employerName:          text("employer_name"),
  contractType:          text("contract_type"),
  cargo:                 text("cargo"),
  costCenterId:          integer("cost_center_id"),
  costCenterName:        text("cost_center_name"),
  jefeRut:               text("jefe_rut"),
  jefeName:              text("jefe_name"),
  hiredOn:               text("hired_on"),
  startsOn:              text("starts_on"),
  endsOn:                text("ends_on"),
  finiquitado:           boolean("finiquitado").notNull(),
  talanaActive:          boolean("talana_active"),
  /** Aparece en `solo-activos`: es la definición de «activo» que usa la sync. */
  listedActive:          boolean("listed_active").notNull().default(false),
  talanaModifiedAt:      timestamp("talana_modified_at", { withTimezone: true, mode: "string" }),
  firstSeenAt:           timestamp("first_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastSeenAt:            timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastSeenRunId:         text("last_seen_run_id"),
  missingSince:          timestamp("missing_since", { withTimezone: true, mode: "string" }),
  /** Una corrida que aplica ya procesó este contrato activo (alta, reactivación o nada que hacer). */
  activationProcessedAt: timestamp("activation_processed_at", { withTimezone: true, mode: "string" }),
  /** Una corrida que aplica ya procesó el finiquito de este contrato. */
  finiquitoProcessedAt:  timestamp("finiquito_processed_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  check("talana_contracts_sex_valid", sql`${table.sex} IS NULL OR ${table.sex} IN ('M', 'F', 'N')`),
  check("talana_contracts_hired_on_valid", civilDate(table.hiredOn)),
  check("talana_contracts_starts_on_valid", civilDate(table.startsOn)),
  check("talana_contracts_ends_on_valid", civilDate(table.endsOn)),
  check("talana_contracts_text_lengths_valid", sql`
    length(${table.rut}) <= 20
    AND (${table.firstName} IS NULL OR length(${table.firstName}) <= 160)
    AND (${table.lastNamePaternal} IS NULL OR length(${table.lastNamePaternal}) <= 160)
    AND (${table.lastNameMaternal} IS NULL OR length(${table.lastNameMaternal}) <= 160)
    AND (${table.employerName} IS NULL OR length(${table.employerName}) <= 200)
    AND (${table.contractType} IS NULL OR length(${table.contractType}) <= 120)
    AND (${table.cargo} IS NULL OR length(${table.cargo}) <= 300)
    AND (${table.costCenterName} IS NULL OR length(${table.costCenterName}) <= 200)
    AND (${table.jefeRut} IS NULL OR length(${table.jefeRut}) <= 20)
    AND (${table.jefeName} IS NULL OR length(${table.jefeName}) <= 300)
  `),
  index("talana_contracts_rut_idx").on(table.rut),
  index("talana_contracts_listed_active_idx").on(table.listedActive).where(sql`${table.listedActive}`),
])

/**
 * Persona de Talana ↔ trabajador de Chome, por RUT, con la base del merge a
 * tres bandas: el valor de Talana que se aplicó (o se aceptó) la última vez.
 * Un cambio de Talana se sigue sólo si Chome todavía tiene lo que esa base
 * mapeaba; si alguien lo cambió a mano, Chome manda. `base_updated_at` nulo =
 * persona sin base todavía (primera corrida que aplica).
 */
export const talanaWorkerLinks = pgTable("talana_worker_links", {
  rut:              text("rut").primaryKey(),
  workerId:         text("worker_id").references(() => workers.id, { onDelete: "set null" }),
  baseCargoKey:     text("base_cargo_key"),
  basePositionId:   text("base_position_id"),
  baseCostCenterId: integer("base_cost_center_id"),
  baseWorksiteId:   text("base_worksite_id"),
  baseJefeKey:      text("base_jefe_key"),
  baseSupervisor:   text("base_supervisor"),
  baseUpdatedAt:    timestamp("base_updated_at", { withTimezone: true, mode: "string" }),
  baseRunId:        text("base_run_id"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("talana_worker_links_worker_unique").on(table.workerId),
])

/**
 * Ausencias vigentes o futuras (licencias, permisos). Se reemplazan enteras en
 * cada corrida buena: no se acumula historia de salud. Sólo tipo y fechas.
 */
export const talanaAbsences = pgTable("talana_absences", {
  talanaAbsenceId: integer("talana_absence_id").primaryKey(),
  rut:             text("rut").notNull(),
  absenceType:     text("absence_type"),
  startsOn:        text("starts_on").notNull(),
  endsOn:          text("ends_on").notNull(),
  returnOn:        text("return_on"),
  status:          text("status"),
  approved:        boolean("approved"),
  lastSeenRunId:   text("last_seen_run_id"),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("talana_absences_starts_on_valid", civilDate(table.startsOn)),
  check("talana_absences_ends_on_valid", civilDate(table.endsOn)),
  check("talana_absences_return_on_valid", civilDate(table.returnOn)),
  check("talana_absences_text_lengths_valid", sql`
    (${table.absenceType} IS NULL OR length(${table.absenceType}) <= 120)
    AND (${table.status} IS NULL OR length(${table.status}) <= 60)
  `),
  index("talana_absences_rut_idx").on(table.rut),
])

/**
 * Lo que una corrida planeó (simulación) o hizo (aplicación), persona por
 * persona. Es lo que se revisa en `/admin/talana` antes de encender la
 * aplicación. El sexo nunca lleva valor: se registra el hecho, no el dato.
 */
export const talanaSyncRunItems = pgTable("talana_sync_run_items", {
  id:               text("id").primaryKey(),
  runId:            text("run_id").notNull().references(() => talanaSyncRuns.id, { onDelete: "cascade" }),
  workerId:         text("worker_id").references(() => workers.id, { onDelete: "set null" }),
  talanaContractId: integer("talana_contract_id"),
  rut:              text("rut"),
  kind:             text("kind").notNull(),
  outcome:          text("outcome").notNull(),
  reasonCode:       text("reason_code"),
  beforeLabel:      text("before_label"),
  afterLabel:       text("after_label"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("talana_sync_run_items_kind_valid", sql`
    ${table.kind} IN ('alta', 'reactivacion', 'baja', 'traslado', 'cargo', 'jefe', 'sexo')
  `),
  check("talana_sync_run_items_outcome_valid", sql`${table.outcome} IN ('planned', 'applied', 'skipped', 'failed')`),
  check("talana_sync_run_items_sex_without_values", sql`
    ${table.kind} <> 'sexo' OR (${table.beforeLabel} IS NULL AND ${table.afterLabel} IS NULL)
  `),
  check("talana_sync_run_items_text_lengths_valid", sql`
    (${table.reasonCode} IS NULL OR length(${table.reasonCode}) <= 60)
    AND (${table.beforeLabel} IS NULL OR length(${table.beforeLabel}) <= 200)
    AND (${table.afterLabel} IS NULL OR length(${table.afterLabel}) <= 200)
  `),
  index("talana_sync_run_items_run_idx").on(table.runId),
  index("talana_sync_run_items_worker_idx").on(table.workerId),
])
