import { pgTable, text, integer, boolean, timestamp, numeric, check, index, uniqueIndex } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"
import { worksites, workers, suppliers } from "./worksites"

/* ── Tipos de activo (catálogo configurable) ─────────────────────────────── */
export const itAssetTypes = pgTable("it_asset_types", {
  id:       text("id").primaryKey(),
  name:     text("name").notNull(),
  category: text("category").notNull(), // computacion | periferico | red | telefonia | movilidad | almacenamiento | otro
  /** true si aplican specs técnicas (procesador/RAM/almacenamiento/SO). */
  hasSpecs: boolean("has_specs").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_asset_types_category_valid", sql`${table.category} IN ('computacion', 'periferico', 'red', 'telefonia', 'movilidad', 'almacenamiento', 'otro')`),
  index("it_asset_types_active_idx").on(table.isActive),
])

/* ── Activos TI ───────────────────────────────────────────────────────────── */
export const itAssets = pgTable("it_assets", {
  id:           text("id").primaryKey(),
  code:         text("code").notNull().unique(), // código interno legible (TI-NB-0042)
  assetTypeId:  text("asset_type_id").notNull().references(() => itAssetTypes.id, { onDelete: "restrict" }),
  brand:        text("brand"),
  model:        text("model"),
  serialNumber: text("serial_number").unique(),
  status:       text("status").notNull().default("disponible"),
  /** Custodio actual — denormalizado, sincronizado por el flujo de asignaciones. */
  workerId:     text("worker_id").references(() => workers.id, { onDelete: "set null" }),
  /** Faena/oficina actual del activo. NULL = oficina central o sin ubicación asignada. */
  worksiteId:   text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  location:     text("location"), // texto libre: oficina, bodega, detalle de ubicación
  purchaseDate: text("purchase_date"),
  supplierId:   text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  purchaseDocType: text("purchase_doc_type"), // factura | oc | otro
  purchaseDocRef:  text("purchase_doc_ref"),
  cost:         numeric("cost", { precision: 14, scale: 2, mode: "number" }),
  warrantyEndDate: text("warranty_end_date"),
  processor:    text("processor"),
  ram:          text("ram"),
  storage:      text("storage"),
  os:           text("os"),
  observations: text("observations"),
  /** Soft delete (patrón purchase_orders): el historial y las asignaciones se conservan. */
  deletedAt:    timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_assets_status_valid", sql`${table.status} IN ('disponible', 'asignado', 'en_prestamo', 'en_reparacion', 'en_bodega', 'dado_de_baja', 'perdido', 'robado')`),
  check("it_assets_purchase_doc_type_valid", sql`${table.purchaseDocType} IS NULL OR ${table.purchaseDocType} IN ('factura', 'oc', 'otro')`),
  check("it_assets_cost_valid", sql`${table.cost} IS NULL OR ${table.cost} >= 0`),
  index("it_assets_status_idx").on(table.status),
  index("it_assets_worker_idx").on(table.workerId),
  index("it_assets_worksite_idx").on(table.worksiteId),
  index("it_assets_type_idx").on(table.assetTypeId),
  index("it_assets_supplier_idx").on(table.supplierId),
  index("it_assets_warranty_idx").on(table.warrantyEndDate),
  index("it_assets_deleted_idx").on(table.deletedAt),
])

/* ── Asignaciones / custodia ──────────────────────────────────────────────── */
export const itAssetAssignments = pgTable("it_asset_assignments", {
  id:           text("id").primaryKey(),
  code:         text("code").notNull().unique(), // ACT-2026-0001 (correlativo del acta)
  assetId:      text("asset_id").notNull().references(() => itAssets.id, { onDelete: "restrict" }),
  workerId:     text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  worksiteId:   text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  kind:         text("kind").notNull().default("delivery"), // delivery | loan | transfer | repair_exit
  deliveredAt:  timestamp("delivered_at", { withTimezone: true, mode: "string" }).notNull(),
  deliveredByUserId: text("delivered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  physicalState: text("physical_state").notNull().default("bueno"),
  observations: text("observations"),
  acceptedAt:   timestamp("accepted_at", { withTimezone: true, mode: "string" }),
  acceptedByUserId: text("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  returnedAt:   timestamp("returned_at", { withTimezone: true, mode: "string" }),
  returnedByUserId: text("returned_by_user_id").references(() => users.id, { onDelete: "set null" }),
  returnPhysicalState: text("return_physical_state"),
  returnObservations:  text("return_observations"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_asset_assignments_kind_valid", sql`${table.kind} IN ('delivery', 'loan', 'transfer', 'repair_exit')`),
  check("it_asset_assignments_physical_state_valid", sql`${table.physicalState} IN ('bueno', 'regular', 'malo', 'nuevo')`),
  check("it_asset_assignments_return_state_valid", sql`${table.returnPhysicalState} IS NULL OR ${table.returnPhysicalState} IN ('bueno', 'regular', 'malo')`),
  index("it_asset_assignments_asset_idx").on(table.assetId, table.createdAt),
  index("it_asset_assignments_worker_idx").on(table.workerId),
  index("it_asset_assignments_worksite_idx").on(table.worksiteId),
  // Invariante de custodia: a lo más UNA asignación abierta por activo.
  uniqueIndex("it_asset_assignments_active_asset_unique").on(table.assetId).where(sql`${table.returnedAt} IS NULL`),
])

/* ── Accesorios de una asignación ─────────────────────────────────────────── */
export const itAssignmentAccessories = pgTable("it_assignment_accessories", {
  id:           text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => itAssetAssignments.id, { onDelete: "cascade" }),
  name:         text("name").notNull(), // cargador, mouse, bolso, dock, adaptador, teclado, otro
  returnedAt:   timestamp("returned_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  index("it_assignment_accessories_assignment_idx").on(table.assignmentId),
])

/* ── Evidencia fotográfica de entrega/devolución ────────────────────────────
 * Nunca se borran una vez ancladas: son la prueba del estado físico en el
 * acto. Antes de confirmar una entrega/devolución pueden quedar pendientes
 * para que el usuario descarte la carga sin crear evidencia huérfana. */
export const itAssignmentPhotos = pgTable("it_assignment_photos", {
  id:           text("id").primaryKey(),
  /** Null mientras la foto espera ser anclada a la asignación que aún no existe
   * (upload previo a crear la entrega). createAssignment la ancla en su tx. */
  assignmentId: text("assignment_id").references(() => itAssetAssignments.id, { onDelete: "cascade" }),
  /** Para una devolución la asignación ya existe, pero la foto sigue pendiente
   * hasta que la devolución se confirma en la misma transacción. */
  pendingAssignmentId: text("pending_assignment_id").references(() => itAssetAssignments.id, { onDelete: "cascade" }),
  stage:        text("stage").notNull().default("delivery"), // delivery | return
  fileName:     text("file_name").notNull(),
  filePath:     text("file_path").notNull(),
  fileSize:     integer("file_size"),
  mimeType:     text("mime_type"),
  caption:      text("caption"),
  uploadedByUserId: text("uploaded_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_assignment_photos_stage_valid", sql`${table.stage} IN ('delivery', 'return')`),
  index("it_assignment_photos_assignment_idx").on(table.assignmentId, table.stage, table.createdAt),
  index("it_assignment_photos_pending_assignment_idx").on(table.pendingAssignmentId, table.stage, table.createdAt),
])

/* ── Línea de tiempo del activo (append-only) ─────────────────────────────── */
export const itAssetHistory = pgTable("it_asset_history", {
  id:         text("id").primaryKey(),
  assetId:    text("asset_id").notNull().references(() => itAssets.id, { onDelete: "cascade" }),
  action:     text("action").notNull(), // created | assigned | returned | status_changed | edited | maintenance | ticket | document | photo | warranty | retired
  detail:     text("detail").notNull(),
  changes:    text("changes"), // JSON de cambios relevantes (nunca sobrescribe; append-only)
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_asset_history_action_valid", sql`${table.action} IN ('created', 'assigned', 'returned', 'status_changed', 'edited', 'maintenance', 'ticket', 'document', 'photo', 'warranty', 'retired')`),
  index("it_asset_history_asset_created_idx").on(table.assetId, table.createdAt),
])

/* ── Mantenciones y reparaciones ──────────────────────────────────────────── */
export const itMaintenances = pgTable("it_maintenances", {
  id:         text("id").primaryKey(),
  assetId:    text("asset_id").notNull().references(() => itAssets.id, { onDelete: "cascade" }),
  type:       text("type").notNull().default("correctiva"), // preventiva | correctiva | reparacion | actualizacion | revision
  date:       text("date").notNull(), // plain date (America/Santiago)
  reportedIssue: text("reported_issue"),
  diagnosis:  text("diagnosis"),
  workDone:   text("work_done").notNull(),
  partsUsed:  text("parts_used"),
  supplierId: text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  /** Técnico externo (texto libre) o interno (usuario). Pueden coexistir. */
  technicianName:   text("technician_name"),
  technicianUserId: text("technician_user_id").references(() => users.id, { onDelete: "set null" }),
  cost:       numeric("cost", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  observations: text("observations"),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_maintenances_type_valid", sql`${table.type} IN ('preventiva', 'correctiva', 'reparacion', 'actualizacion', 'revision')`),
  check("it_maintenances_cost_valid", sql`${table.cost} >= 0`),
  index("it_maintenances_asset_date_idx").on(table.assetId, table.date),
  index("it_maintenances_supplier_idx").on(table.supplierId),
])

/* ── Tickets / mesa de ayuda TI ───────────────────────────────────────────── */
export const itTickets = pgTable("it_tickets", {
  id:         text("id").primaryKey(),
  code:       text("code").notNull().unique(), // INC-2026-0001
  subject:    text("subject").notNull(),
  description: text("description").notNull(),
  category:   text("category").notNull().default("hardware"),
  priority:   text("priority").notNull().default("normal"),
  status:     text("status").notNull().default("nuevo"),
  /** Quien crea el ticket (representante con cuenta en la faena o TI). */
  requesterUserId: text("requester_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  /** Trabajador afectado (puede no tener cuenta en la plataforma). */
  workerId:   text("worker_id").references(() => workers.id, { onDelete: "set null" }),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  assetId:    text("asset_id").references(() => itAssets.id, { onDelete: "set null" }),
  assigneeUserId: text("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  resolution: text("resolution"),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_tickets_category_valid", sql`${table.category} IN ('hardware', 'software', 'correo', 'internet', 'impresoras', 'telefonia', 'accesos', 'plataforma', 'cuentas', 'otro')`),
  check("it_tickets_priority_valid", sql`${table.priority} IN ('baja', 'normal', 'alta', 'critica')`),
  check("it_tickets_status_valid", sql`${table.status} IN ('nuevo', 'asignado', 'en_diagnostico', 'en_progreso', 'esperando_usuario', 'esperando_proveedor', 'resuelto', 'cerrado')`),
  index("it_tickets_status_idx").on(table.status),
  index("it_tickets_worksite_idx").on(table.worksiteId),
  index("it_tickets_assignee_idx").on(table.assigneeUserId),
  index("it_tickets_requester_idx").on(table.requesterUserId),
  index("it_tickets_asset_idx").on(table.assetId),
  index("it_tickets_created_idx").on(table.createdAt),
])

export const itTicketComments = pgTable("it_ticket_comments", {
  id:         text("id").primaryKey(),
  ticketId:   text("ticket_id").notNull().references(() => itTickets.id, { onDelete: "cascade" }),
  body:       text("body").notNull(),
  authorUserId: text("author_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  /** true = nota interna, visible solo para TI. */
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("it_ticket_comments_ticket_created_idx").on(table.ticketId, table.createdAt),
])

/* ── Licencias y suscripciones ────────────────────────────────────────────── */
export const itLicenses = pgTable("it_licenses", {
  id:         text("id").primaryKey(),
  name:       text("name").notNull(),
  supplierId: text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  type:       text("type"),
  purchasedQuantity: integer("purchased_quantity").notNull().default(0),
  cost:       numeric("cost", { precision: 14, scale: 2, mode: "number" }),
  periodicity: text("periodicity").notNull().default("anual"), // mensual | anual | unica
  startDate:  text("start_date"),
  renewalDate: text("renewal_date"),
  responsibleUserId: text("responsible_user_id").references(() => users.id, { onDelete: "set null" }),
  notes:      text("notes"),
  isActive:   boolean("is_active").notNull().default(true),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_licenses_periodicity_valid", sql`${table.periodicity} IN ('mensual', 'anual', 'unica')`),
  check("it_licenses_cost_valid", sql`${table.cost} IS NULL OR ${table.cost} >= 0`),
  check("it_licenses_quantity_valid", sql`${table.purchasedQuantity} >= 0`),
  index("it_licenses_renewal_idx").on(table.renewalDate),
  index("it_licenses_active_idx").on(table.isActive),
])

export const itLicenseAssignments = pgTable("it_license_assignments", {
  id:         text("id").primaryKey(),
  licenseId:  text("license_id").notNull().references(() => itLicenses.id, { onDelete: "cascade" }),
  workerId:   text("worker_id").references(() => workers.id, { onDelete: "set null" }),
  assetId:    text("asset_id").references(() => itAssets.id, { onDelete: "set null" }),
  /** Área/departamento como texto libre (no confundir con cost_centers). */
  area:       text("area"),
  worksiteId: text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  revokedAt:  timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  notes:      text("notes"),
}, (table) => [
  check("it_license_assignments_target_valid", sql`(${table.workerId} IS NOT NULL OR ${table.assetId} IS NOT NULL OR ${table.area} IS NOT NULL OR ${table.worksiteId} IS NOT NULL)`),
  index("it_license_assignments_license_idx").on(table.licenseId, table.revokedAt),
  index("it_license_assignments_worker_idx").on(table.workerId),
  index("it_license_assignments_asset_idx").on(table.assetId),
])

/* ── Sistemas con acceso (catálogo configurable) ──────────────────────────── */
export const itAccessSystems = pgTable("it_access_systems", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  description: text("description"),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("it_access_systems_active_idx").on(table.isActive),
  uniqueIndex("it_access_systems_name_unique").on(sql`lower(${table.name})`),
])

/** Qué accesos tiene cada trabajador. Nunca se almacenan contraseñas. */
export const itSystemAccess = pgTable("it_system_access", {
  id:         text("id").primaryKey(),
  systemId:   text("system_id").notNull().references(() => itAccessSystems.id, { onDelete: "restrict" }),
  workerId:   text("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  status:     text("status").notNull().default("activo"), // activo | suspendido | baja
  grantedAt:  timestamp("granted_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  revokedAt:  timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  responsibleUserId: text("responsible_user_id").references(() => users.id, { onDelete: "set null" }),
  notes:      text("notes"),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_system_access_status_valid", sql`${table.status} IN ('activo', 'suspendido', 'baja')`),
  uniqueIndex("it_system_access_system_worker_unique").on(table.systemId, table.workerId),
  index("it_system_access_worker_idx").on(table.workerId, table.status),
])

/* ── Checklists de alta/baja de trabajadores ──────────────────────────────── */
export const itWorkerChecklists = pgTable("it_worker_checklists", {
  id:        text("id").primaryKey(),
  workerId:  text("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  kind:      text("kind").notNull(), // onboarding | offboarding
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_worker_checklists_kind_valid", sql`${table.kind} IN ('onboarding', 'offboarding')`),
  index("it_worker_checklists_worker_idx").on(table.workerId, table.kind, table.createdAt),
])

export const itChecklistTasks = pgTable("it_checklist_tasks", {
  id:          text("id").primaryKey(),
  checklistId: text("checklist_id").notNull().references(() => itWorkerChecklists.id, { onDelete: "cascade" }),
  /** Nombre instanciado desde la plantilla al crear el checklist: queda histórico. */
  name:        text("name").notNull(),
  done:        boolean("done").notNull().default(false),
  doneAt:      timestamp("done_at", { withTimezone: true, mode: "string" }),
  doneByUserId: text("done_by_user_id").references(() => users.id, { onDelete: "set null" }),
  notes:       text("notes"),
}, (table) => [
  index("it_checklist_tasks_checklist_idx").on(table.checklistId),
])

/* ── Bajas de activos ─────────────────────────────────────────────────────── */
export const itAssetRetirements = pgTable("it_asset_retirements", {
  id:          text("id").primaryKey(),
  assetId:     text("asset_id").notNull().references(() => itAssets.id, { onDelete: "restrict" }),
  date:        text("date").notNull(), // plain date (America/Santiago)
  reason:      text("reason").notNull(), // venta | reciclaje | destruccion | repuesto | donacion | perdida | robo
  responsibleUserId: text("responsible_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  authorizedByUserId: text("authorized_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  destination: text("destination"),
  observations: text("observations"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_asset_retirements_reason_valid", sql`${table.reason} IN ('venta', 'reciclaje', 'destruccion', 'repuesto', 'donacion', 'perdida', 'robo')`),
  index("it_asset_retirements_asset_idx").on(table.assetId, table.date),
])

/* ── Proveedores TI (marca proveedores existentes, sin catálogo paralelo) ─── */
export const itSupplierLinks = pgTable("it_supplier_links", {
  id:         text("id").primaryKey(),
  supplierId: text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  category:   text("category").notNull(), // reparacion | venta_hardware | licencias | telefonia | internet | cloud | otro
  notes:      text("notes"),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("it_supplier_links_category_valid", sql`${table.category} IN ('reparacion', 'venta_hardware', 'licencias', 'telefonia', 'internet', 'cloud', 'otro')`),
  uniqueIndex("it_supplier_links_supplier_category_unique").on(table.supplierId, table.category),
  index("it_supplier_links_supplier_idx").on(table.supplierId),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const itAssetTypesRelations = relations(itAssetTypes, ({ many }) => ({
  assets: many(itAssets),
}))

export const itAssetsRelations = relations(itAssets, ({ one, many }) => ({
  assetType: one(itAssetTypes, { fields: [itAssets.assetTypeId], references: [itAssetTypes.id] }),
  worker:    one(workers, { fields: [itAssets.workerId], references: [workers.id] }),
  worksite:  one(worksites, { fields: [itAssets.worksiteId], references: [worksites.id] }),
  supplier:  one(suppliers, { fields: [itAssets.supplierId], references: [suppliers.id] }),
  assignments: many(itAssetAssignments),
  history:   many(itAssetHistory),
  maintenances: many(itMaintenances),
  tickets:   many(itTickets),
}))

export const itAssetAssignmentsRelations = relations(itAssetAssignments, ({ one, many }) => ({
  asset:   one(itAssets, { fields: [itAssetAssignments.assetId], references: [itAssets.id] }),
  worker:  one(workers, { fields: [itAssetAssignments.workerId], references: [workers.id] }),
  worksite: one(worksites, { fields: [itAssetAssignments.worksiteId], references: [worksites.id] }),
  deliveredBy: one(users, { fields: [itAssetAssignments.deliveredByUserId], references: [users.id], relationName: "assignment_delivered_by" }),
  acceptedBy:  one(users, { fields: [itAssetAssignments.acceptedByUserId], references: [users.id], relationName: "assignment_accepted_by" }),
  returnedBy:  one(users, { fields: [itAssetAssignments.returnedByUserId], references: [users.id], relationName: "assignment_returned_by" }),
  accessories: many(itAssignmentAccessories),
  photos:    many(itAssignmentPhotos),
}))

export const itAssignmentAccessoriesRelations = relations(itAssignmentAccessories, ({ one }) => ({
  assignment: one(itAssetAssignments, { fields: [itAssignmentAccessories.assignmentId], references: [itAssetAssignments.id] }),
}))

export const itAssignmentPhotosRelations = relations(itAssignmentPhotos, ({ one }) => ({
  assignment: one(itAssetAssignments, { fields: [itAssignmentPhotos.assignmentId], references: [itAssetAssignments.id] }),
  uploadedBy: one(users, { fields: [itAssignmentPhotos.uploadedByUserId], references: [users.id] }),
}))

export const itAssetHistoryRelations = relations(itAssetHistory, ({ one }) => ({
  asset: one(itAssets, { fields: [itAssetHistory.assetId], references: [itAssets.id] }),
  actor: one(users, { fields: [itAssetHistory.actorUserId], references: [users.id] }),
}))

export const itMaintenancesRelations = relations(itMaintenances, ({ one }) => ({
  asset:    one(itAssets, { fields: [itMaintenances.assetId], references: [itAssets.id] }),
  supplier: one(suppliers, { fields: [itMaintenances.supplierId], references: [suppliers.id] }),
  technician: one(users, { fields: [itMaintenances.technicianUserId], references: [users.id] }),
}))

export const itTicketsRelations = relations(itTickets, ({ one, many }) => ({
  requester: one(users, { fields: [itTickets.requesterUserId], references: [users.id], relationName: "ticket_requester" }),
  worker:    one(workers, { fields: [itTickets.workerId], references: [workers.id] }),
  worksite:  one(worksites, { fields: [itTickets.worksiteId], references: [worksites.id] }),
  asset:     one(itAssets, { fields: [itTickets.assetId], references: [itAssets.id] }),
  assignee:  one(users, { fields: [itTickets.assigneeUserId], references: [users.id], relationName: "ticket_assignee" }),
  comments:  many(itTicketComments),
}))

export const itTicketCommentsRelations = relations(itTicketComments, ({ one }) => ({
  ticket: one(itTickets, { fields: [itTicketComments.ticketId], references: [itTickets.id] }),
  author: one(users, { fields: [itTicketComments.authorUserId], references: [users.id] }),
}))

export const itLicensesRelations = relations(itLicenses, ({ one, many }) => ({
  supplier:    one(suppliers, { fields: [itLicenses.supplierId], references: [suppliers.id] }),
  responsible: one(users, { fields: [itLicenses.responsibleUserId], references: [users.id] }),
  assignments: many(itLicenseAssignments),
}))

export const itLicenseAssignmentsRelations = relations(itLicenseAssignments, ({ one }) => ({
  license: one(itLicenses, { fields: [itLicenseAssignments.licenseId], references: [itLicenses.id] }),
  worker:  one(workers, { fields: [itLicenseAssignments.workerId], references: [workers.id] }),
  asset:   one(itAssets, { fields: [itLicenseAssignments.assetId], references: [itAssets.id] }),
  worksite: one(worksites, { fields: [itLicenseAssignments.worksiteId], references: [worksites.id] }),
}))

export const itAccessSystemsRelations = relations(itAccessSystems, ({ many }) => ({
  accesses: many(itSystemAccess),
}))

export const itSystemAccessRelations = relations(itSystemAccess, ({ one }) => ({
  system: one(itAccessSystems, { fields: [itSystemAccess.systemId], references: [itAccessSystems.id] }),
  worker: one(workers, { fields: [itSystemAccess.workerId], references: [workers.id] }),
  responsible: one(users, { fields: [itSystemAccess.responsibleUserId], references: [users.id] }),
}))

export const itWorkerChecklistsRelations = relations(itWorkerChecklists, ({ one, many }) => ({
  worker:    one(workers, { fields: [itWorkerChecklists.workerId], references: [workers.id] }),
  createdBy: one(users, { fields: [itWorkerChecklists.createdByUserId], references: [users.id] }),
  tasks:     many(itChecklistTasks),
}))

export const itChecklistTasksRelations = relations(itChecklistTasks, ({ one }) => ({
  checklist: one(itWorkerChecklists, { fields: [itChecklistTasks.checklistId], references: [itWorkerChecklists.id] }),
  doneBy:    one(users, { fields: [itChecklistTasks.doneByUserId], references: [users.id] }),
}))

export const itAssetRetirementsRelations = relations(itAssetRetirements, ({ one }) => ({
  asset:      one(itAssets, { fields: [itAssetRetirements.assetId], references: [itAssets.id] }),
  responsible: one(users, { fields: [itAssetRetirements.responsibleUserId], references: [users.id], relationName: "retirement_responsible" }),
  authorizedBy: one(users, { fields: [itAssetRetirements.authorizedByUserId], references: [users.id], relationName: "retirement_authorized_by" }),
}))

export const itSupplierLinksRelations = relations(itSupplierLinks, ({ one }) => ({
  supplier: one(suppliers, { fields: [itSupplierLinks.supplierId], references: [suppliers.id] }),
}))

/* ── Inferred types ───────────────────────────────────────────────────────── */
export type ItAssetType        = typeof itAssetTypes.$inferSelect
export type ItAsset            = typeof itAssets.$inferSelect
export type ItAssetAssignment  = typeof itAssetAssignments.$inferSelect
export type ItAssignmentAccessory = typeof itAssignmentAccessories.$inferSelect
export type ItAssignmentPhoto  = typeof itAssignmentPhotos.$inferSelect
export type ItAssetHistoryRow  = typeof itAssetHistory.$inferSelect
export type ItMaintenance      = typeof itMaintenances.$inferSelect
export type ItTicket           = typeof itTickets.$inferSelect
export type ItTicketComment    = typeof itTicketComments.$inferSelect
export type ItLicense          = typeof itLicenses.$inferSelect
export type ItLicenseAssignment = typeof itLicenseAssignments.$inferSelect
export type ItAccessSystem     = typeof itAccessSystems.$inferSelect
export type ItSystemAccessRow  = typeof itSystemAccess.$inferSelect
export type ItWorkerChecklist  = typeof itWorkerChecklists.$inferSelect
export type ItChecklistTask    = typeof itChecklistTasks.$inferSelect
export type ItAssetRetirement  = typeof itAssetRetirements.$inferSelect
export type ItSupplierLink     = typeof itSupplierLinks.$inferSelect
