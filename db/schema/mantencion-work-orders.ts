import { relations, sql } from "drizzle-orm"
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { worksites } from "./worksites"
import { mantDrivers, mantWorkshops } from "./mantencion-catalogs"
import { preventionInspectionFindings } from "./prevention/inspections"
import { mantRecords, type MantEquipmentSnapshot } from "./mantencion-records"

/**
 * Orden de trabajo de reparación/mantención (2026-11-02), calcada del talonario
 * «Orden de Trabajo Reparación/Mantención» de Chome.
 *
 * La OT es el sobre del trabajo: quién la pidió y qué, a quién se le asignó, el
 * ingreso y la salida del taller, y las dos recepciones. El trabajo en sí lo
 * firma el mecánico con la correctiva o preventiva de la app, enlazada por
 * `mant_records.work_order_id`. Así la hoja de vida del equipo tiene una sola
 * fuente.
 *
 * Estados: solicitada → asignada → en_ejecucion → trabajo_terminado →
 * recepcionada → cerrada (la «Recepción en faena» es la conformidad), más
 * anulada. Un rechazo en cualquiera de las dos recepciones devuelve la OT a
 * en_ejecucion con el mismo mecánico. Las reglas de transición viven en
 * `lib/mantencion/work-order-states.ts`; los `check` de abajo garantizan en la
 * base que cada estado lleve los datos que le corresponden.
 */
export const mantWorkOrders = pgTable("mant_work_orders", {
  id:                    text("id").primaryKey(),
  folio:                 text("folio").notNull(),
  /** Idempotencia del alta web: el formulario genera el UUID al abrirse. */
  clientRequestId:       text("client_request_id"),
  vehicleId:             text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "restrict" }),
  /** Faena del equipo al crear la OT. No se mueve: el folio la usa. */
  worksiteId:            text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  equipmentSnapshot:     jsonb("equipment_snapshot").$type<MantEquipmentSnapshot>().notNull(),
  // ── Cabecera del papel ──
  repair:                boolean("repair").notNull().default(false),
  maintenance:           boolean("maintenance").notNull().default(false),
  /** FECHA OT. */
  requestDate:           text("request_date").notNull(),
  requestedByUserId:     text("requested_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  /** SOLICITANTE: por defecto quien la crea; editable (puede pedirla otra persona). */
  requesterName:         text("requester_name").notNull(),
  /** REPARACIÓN: lo que se pide reparar. */
  repairDescription:     text("repair_description"),
  observations:          text("observations"),
  /** Costo total de la OT (mano de obra + repuestos), opcional. Lo carga la jefatura. */
  totalCost:             numeric("total_cost", { precision: 14, scale: 2, mode: "number" }),
  // ── Flujo ──
  status:                text("status").notNull().default("solicitada"),
  version:               integer("version").notNull().default(1),
  rejectionCount:        integer("rejection_count").notNull().default(0),
  // ── Asignación ──
  assignedToUserId:      text("assigned_to_user_id").references(() => users.id, { onDelete: "restrict" }),
  assignedByUserId:      text("assigned_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  assignedAt:            timestamp("assigned_at", { withTimezone: true, mode: "string" }),
  // ── INGRESO A TALLER ──
  workshopKind:          text("workshop_kind"),
  workshopId:            text("workshop_id").references(() => mantWorkshops.id, { onDelete: "restrict" }),
  workshopName:          text("workshop_name"),
  /** Encargado del taller. */
  workshopManagerName:   text("workshop_manager_name"),
  operatorDriverId:      text("operator_driver_id").references(() => mantDrivers.id, { onDelete: "restrict" }),
  operatorName:          text("operator_name"),
  /** Fecha y hora de ingreso declaradas. */
  workshopEntryAt:       timestamp("workshop_entry_at", { withTimezone: true, mode: "string" }),
  entryOdometer:         numeric("entry_odometer", { precision: 14, scale: 1, mode: "number" }),
  entryHourmeter:        numeric("entry_hourmeter", { precision: 14, scale: 1, mode: "number" }),
  /** Fec. estimada entrega: la fecha de disponibilidad comprometida. */
  estimatedDeliveryDate: text("estimated_delivery_date"),
  startedByUserId:       text("started_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  startedAt:             timestamp("started_at", { withTimezone: true, mode: "string" }),
  // ── SALIDA TALLER ──
  /** Fecha y hora real de salida: la disponibilidad efectiva. */
  workshopExitAt:        timestamp("workshop_exit_at", { withTimezone: true, mode: "string" }),
  finishedByUserId:      text("finished_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  finishedAt:            timestamp("finished_at", { withTimezone: true, mode: "string" }),
  // ── RECEPCIÓN (quien retira el equipo del taller) ──
  receivedAt:            timestamp("received_at", { withTimezone: true, mode: "string" }),
  /** «Sr.»: quien recibió físicamente; puede no tener cuenta en la plataforma. */
  receiverName:          text("receiver_name"),
  receivedByUserId:      text("received_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  receivedRecordedAt:    timestamp("received_recorded_at", { withTimezone: true, mode: "string" }),
  // ── RECEPCIÓN EN FAENA = conformidad ──
  faenaReceivedAt:       timestamp("faena_received_at", { withTimezone: true, mode: "string" }),
  faenaReceiverName:     text("faena_receiver_name"),
  faenaReceivedByUserId: text("faena_received_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:              timestamp("closed_at", { withTimezone: true, mode: "string" }),
  // ── Anulación ──
  voidedByUserId:        text("voided_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  voidedAt:              timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidReason:            text("void_reason"),
  /** Hallazgo de inspección que originó la OT (FK con nombre corto, abajo). */
  inspectionFindingId:   text("inspection_finding_id"),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Nombre explícito: el autogenerado pasa de 63 bytes y Postgres lo truncaría.
  foreignKey({
    columns: [table.inspectionFindingId],
    foreignColumns: [preventionInspectionFindings.id],
    name: "mant_work_orders_finding_fk",
  }).onDelete("set null"),
  uniqueIndex("mant_work_orders_folio_unique").on(table.folio),
  uniqueIndex("mant_work_orders_client_request_unique").on(table.clientRequestId),
  // Un hallazgo deriva a lo más una OT viva. Anularla o cerrarla permite derivar otra:
  // si Prevención cancela la CAPA después de cerrada la OT y vuelve a derivar, el
  // trabajo nuevo va en una OT nueva y la cerrada queda como historia (2026-11-12).
  uniqueIndex("mant_work_orders_finding_unique").on(table.inspectionFindingId)
    .where(sql`${table.inspectionFindingId} IS NOT NULL AND ${table.status} NOT IN ('anulada', 'cerrada')`),
  index("mant_work_orders_status_idx").on(table.status),
  index("mant_work_orders_worksite_status_idx").on(table.worksiteId, table.status),
  index("mant_work_orders_assigned_status_idx").on(table.assignedToUserId, table.status),
  index("mant_work_orders_vehicle_created_idx").on(table.vehicleId, table.createdAt.desc()),
  check("mant_work_orders_status_valid", sql`${table.status} IN ('solicitada', 'asignada', 'en_ejecucion', 'trabajo_terminado', 'recepcionada', 'cerrada', 'anulada')`),
  check("mant_work_orders_kind_valid", sql`${table.repair} OR ${table.maintenance}`),
  check("mant_work_orders_repair_description_valid", sql`NOT ${table.repair} OR char_length(trim(coalesce(${table.repairDescription}, ''))) >= 5`),
  check("mant_work_orders_requester_valid", sql`char_length(trim(${table.requesterName})) >= 2`),
  check("mant_work_orders_assignment_valid", sql`
    (${table.status} = 'solicitada' AND ${table.assignedToUserId} IS NULL)
    OR (${table.status} IN ('asignada', 'en_ejecucion', 'trabajo_terminado', 'recepcionada', 'cerrada') AND ${table.assignedToUserId} IS NOT NULL)
    OR ${table.status} = 'anulada'
  `),
  check("mant_work_orders_entry_valid", sql`
    ${table.status} NOT IN ('en_ejecucion', 'trabajo_terminado', 'recepcionada', 'cerrada')
    OR (${table.workshopEntryAt} IS NOT NULL AND ${table.estimatedDeliveryDate} IS NOT NULL AND ${table.startedAt} IS NOT NULL AND ${table.workshopKind} IS NOT NULL)
  `),
  check("mant_work_orders_workshop_valid", sql`
    ${table.workshopKind} IS NULL
    OR (${table.workshopKind} = 'interno' AND ${table.workshopId} IS NULL)
    OR (${table.workshopKind} = 'externo' AND ${table.workshopId} IS NOT NULL)
  `),
  check("mant_work_orders_exit_valid", sql`
    (${table.status} IN ('trabajo_terminado', 'recepcionada', 'cerrada')
      AND ${table.workshopExitAt} IS NOT NULL AND ${table.finishedAt} IS NOT NULL AND ${table.workshopExitAt} >= ${table.workshopEntryAt})
    OR (${table.status} NOT IN ('trabajo_terminado', 'recepcionada', 'cerrada') AND ${table.status} <> 'anulada'
      AND ${table.workshopExitAt} IS NULL AND ${table.finishedAt} IS NULL)
    OR ${table.status} = 'anulada'
  `),
  check("mant_work_orders_reception_valid", sql`
    (${table.status} IN ('recepcionada', 'cerrada')
      AND ${table.receivedAt} IS NOT NULL AND ${table.receivedByUserId} IS NOT NULL AND ${table.receivedRecordedAt} IS NOT NULL
      AND char_length(trim(coalesce(${table.receiverName}, ''))) >= 2)
    OR (${table.status} NOT IN ('recepcionada', 'cerrada') AND ${table.status} <> 'anulada'
      AND ${table.receivedAt} IS NULL AND ${table.receivedByUserId} IS NULL AND ${table.receivedRecordedAt} IS NULL AND ${table.receiverName} IS NULL)
    OR ${table.status} = 'anulada'
  `),
  check("mant_work_orders_closure_valid", sql`
    (${table.status} = 'cerrada'
      AND ${table.faenaReceivedAt} IS NOT NULL AND ${table.faenaReceivedByUserId} IS NOT NULL AND ${table.closedAt} IS NOT NULL
      AND char_length(trim(coalesce(${table.faenaReceiverName}, ''))) >= 2)
    OR (${table.status} <> 'cerrada'
      AND ${table.faenaReceivedAt} IS NULL AND ${table.faenaReceivedByUserId} IS NULL AND ${table.closedAt} IS NULL AND ${table.faenaReceiverName} IS NULL)
  `),
  check("mant_work_orders_void_valid", sql`
    (${table.status} = 'anulada' AND ${table.voidedAt} IS NOT NULL AND ${table.voidedByUserId} IS NOT NULL
      AND char_length(trim(coalesce(${table.voidReason}, ''))) >= 5)
    OR (${table.status} <> 'anulada' AND ${table.voidedAt} IS NULL AND ${table.voidedByUserId} IS NULL AND ${table.voidReason} IS NULL)
  `),
  check("mant_work_orders_readings_valid", sql`coalesce(${table.entryOdometer}, 0) >= 0 AND coalesce(${table.entryHourmeter}, 0) >= 0`),
  check("mant_work_orders_counters_valid", sql`${table.version} >= 1 AND ${table.rejectionCount} >= 0`),
])

/**
 * Ítems pedidos en la OT, con su SÍ/NO. `anexo` = «Trabajos anexos
 * (reparación)»; `mantencion` = «Registro de mantenciones solicitadas o
 * asignadas en taller». `origin` dice si venía en la solicitud o lo agregó el
 * taller. Máximo 12 por tipo, como el talonario (lo controla el servicio).
 */
export const mantWorkOrderItems = pgTable("mant_work_order_items", {
  id:              text("id").primaryKey(),
  workOrderId:     text("work_order_id").notNull().references(() => mantWorkOrders.id, { onDelete: "cascade" }),
  kind:            text("kind").notNull(),
  origin:          text("origin").notNull().default("solicitud"),
  description:     text("description").notNull(),
  sortOrder:       integer("sort_order").notNull().default(0),
  done:            text("done"),
  note:            text("note"),
  markedByUserId:  text("marked_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  markedAt:        timestamp("marked_at", { withTimezone: true, mode: "string" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_work_order_items_order_idx").on(table.workOrderId, table.kind, table.sortOrder),
  check("mant_work_order_items_kind_valid", sql`${table.kind} IN ('anexo', 'mantencion')`),
  check("mant_work_order_items_origin_valid", sql`${table.origin} IN ('solicitud', 'taller')`),
  check("mant_work_order_items_description_valid", sql`char_length(trim(${table.description})) >= 3`),
  check("mant_work_order_items_mark_valid", sql`
    (${table.done} IS NULL AND ${table.markedByUserId} IS NULL AND ${table.markedAt} IS NULL)
    OR (${table.done} IN ('si', 'no') AND ${table.markedByUserId} IS NOT NULL AND ${table.markedAt} IS NOT NULL)
  `),
])

/**
 * Historial de la OT: cada transición y cada cambio (fecha estimada, ítems,
 * registro enlazado). `client_op_id` es la clave de idempotencia de lo que
 * envía el teléfono: la misma operación llega tres veces y queda un evento.
 */
export const mantWorkOrderEvents = pgTable("mant_work_order_events", {
  id:          text("id").primaryKey(),
  workOrderId: text("work_order_id").notNull().references(() => mantWorkOrders.id, { onDelete: "cascade" }),
  type:        text("type").notNull(),
  fromStatus:  text("from_status"),
  toStatus:    text("to_status"),
  reason:      text("reason"),
  changeSet:   jsonb("change_set").$type<Record<string, unknown>>(),
  actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  deviceId:    text("device_id"),
  clientOpId:  text("client_op_id"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_work_order_events_order_idx").on(table.workOrderId, table.createdAt),
  uniqueIndex("mant_work_order_events_client_op_unique").on(table.clientOpId),
  check("mant_work_order_events_type_valid", sql`${table.type} IN ('created', 'edited', 'assigned', 'unassigned', 'taken', 'started', 'entry_updated', 'estimate_changed', 'item_added', 'items_marked', 'finished', 'received', 'rejected', 'conformed', 'voided', 'reopened', 'record_linked')`),
])

export const mantWorkOrdersRelations = relations(mantWorkOrders, ({ one, many }) => ({
  vehicle:        one(fuelVehicles, { fields: [mantWorkOrders.vehicleId], references: [fuelVehicles.id] }),
  worksite:       one(worksites, { fields: [mantWorkOrders.worksiteId], references: [worksites.id] }),
  requestedBy:    one(users, { fields: [mantWorkOrders.requestedByUserId], references: [users.id], relationName: "mant_work_order_requested_by" }),
  assignedTo:     one(users, { fields: [mantWorkOrders.assignedToUserId], references: [users.id], relationName: "mant_work_order_assigned_to" }),
  workshop:       one(mantWorkshops, { fields: [mantWorkOrders.workshopId], references: [mantWorkshops.id] }),
  operatorDriver: one(mantDrivers, { fields: [mantWorkOrders.operatorDriverId], references: [mantDrivers.id] }),
  finding:        one(preventionInspectionFindings, { fields: [mantWorkOrders.inspectionFindingId], references: [preventionInspectionFindings.id] }),
  items:          many(mantWorkOrderItems),
  events:         many(mantWorkOrderEvents),
  records:        many(mantRecords),
}))

export const mantWorkOrderItemsRelations = relations(mantWorkOrderItems, ({ one }) => ({
  workOrder: one(mantWorkOrders, { fields: [mantWorkOrderItems.workOrderId], references: [mantWorkOrders.id] }),
}))

export const mantWorkOrderEventsRelations = relations(mantWorkOrderEvents, ({ one }) => ({
  workOrder: one(mantWorkOrders, { fields: [mantWorkOrderEvents.workOrderId], references: [mantWorkOrders.id] }),
}))
