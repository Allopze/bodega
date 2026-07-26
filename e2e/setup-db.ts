import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import bcrypt from "bcryptjs"
import { loadEnvConfig } from "@next/env"
import { eq, sql } from "drizzle-orm"
import * as schema from "../db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "../lib/testing/destructive-database-guard"

loadEnvConfig(process.cwd())

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) throw new Error("DATABASE_URL is required for E2E setup")

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

async function main() {
  assertSafeDestructiveDatabase({
    databaseUrl: dbUrl!,
    allowDestructiveReset: process.env.E2E_ALLOW_DESTRUCTIVE_RESET === "true",
    context: "E2E",
  })
  await ensureDatabaseExists(dbUrl!)

  // Drop and recreate the public schema to start from a clean slate
  const setupClient = postgres(dbUrl!, { max: 1 })
  const setupDb = drizzle(setupClient)
  await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
  await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
  await setupDb.execute(sql`CREATE SCHEMA public`)
  await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  await setupClient.end()

  // Run migrations
  const migrationClient = postgres(dbUrl!, { max: 1 })
  await migrate(drizzle(migrationClient), { migrationsFolder })
  await migrationClient.end()

  // Insert test fixtures
  const client = postgres(dbUrl!, { max: 1 })
  const db = drizzle(client, { schema })

  const password = await bcrypt.hash("chome2026", 10)
  const now = new Date().toISOString()

  await db.insert(schema.roles).values({
    id: "rol-admin",
    name: "administrador",
    label: "Administrador",
    description: "Control total E2E",
    isGlobal: true,
  })

  const permissions: (typeof schema.permissions.$inferInsert)[] = [
    { id: "p-req-create", name: "requests:create", module: "requests", description: "Crear solicitudes" },
    { id: "p-req-own", name: "requests:view_own", module: "requests", description: "Ver propias" },
    { id: "p-req-all", name: "requests:view_all", module: "requests", description: "Ver todas" },
    { id: "p-req-submit", name: "requests:submit", module: "requests", description: "Enviar solicitudes" },
    { id: "p-apr", name: "approvals:approve", module: "approvals", description: "Aprobar" },
    { id: "p-pur-view", name: "purchasing:view", module: "purchasing", description: "Ver órdenes de compra" },
    { id: "p-pur-create", name: "purchasing:create_order", module: "purchasing", description: "Crear OC" },
    { id: "p-pur-send", name: "purchasing:send_order", module: "purchasing", description: "Enviar OC" },
    { id: "p-rec-reg-office", name: "receiving:register_office", module: "receiving", description: "Registrar llegada a oficina" },
    { id: "p-rec-reg-faena", name: "receiving:register_faena", module: "receiving", description: "Registrar recepción en faena" },
    { id: "p-rec-view", name: "receiving:view", module: "receiving", description: "Ver recepción" },
    { id: "p-trace-view", name: "traceability:view", module: "traceability", description: "Ver trazabilidad" },
    { id: "p-del-view", name: "deliveries:view", module: "deliveries", description: "Ver entregas" },
    { id: "p-del-create", name: "deliveries:create", module: "deliveries", description: "Registrar entregas" },
    { id: "p-ops-view-work", name: "operations:view_work", module: "operations", description: "Ver cola operacional" },
    { id: "p-ops-assign-work", name: "operations:assign_work", module: "operations", description: "Asignar pendientes operacionales" },
    { id: "p-wh-stock", name: "warehouse:view_stock", module: "warehouse", description: "Ver stock" },
    { id: "p-wh-mov", name: "warehouse:register_movement", module: "warehouse", description: "Movimientos" },
    { id: "p-wh-adj", name: "warehouse:adjust_stock", module: "warehouse", description: "Ajuste stock" },
    { id: "p-repuestos-create", name: "repuestos:create", module: "repuestos", description: "Crear solicitudes de repuestos" },
    { id: "p-repuestos-own", name: "repuestos:view_own", module: "repuestos", description: "Ver solicitudes de repuestos propias" },
    { id: "p-repuestos-all", name: "repuestos:view_all", module: "repuestos", description: "Ver todas las solicitudes de repuestos" },
    { id: "p-repuestos-submit", name: "repuestos:submit", module: "repuestos", description: "Enviar solicitudes de repuestos" },
    { id: "p-repuestos-approve", name: "repuestos:approve", module: "repuestos", description: "Aprobar cotizaciones de repuestos" },
    { id: "p-servicios-create", name: "servicios:create", module: "servicios", description: "Crear solicitudes de servicios" },
    { id: "p-servicios-own", name: "servicios:view_own", module: "servicios", description: "Ver solicitudes de servicios propias" },
    { id: "p-servicios-all", name: "servicios:view_all", module: "servicios", description: "Ver todas las solicitudes de servicios" },
    { id: "p-servicios-submit", name: "servicios:submit", module: "servicios", description: "Enviar solicitudes de servicios" },
    { id: "p-servicios-approve", name: "servicios:approve", module: "servicios", description: "Aprobar cotizaciones de servicios" },
    { id: "p-rep-view", name: "reports:view", module: "reports", description: "Reportes" },
    { id: "p-adm-usr", name: "admin:users", module: "admin", description: "Usuarios" },
    { id: "p-adm-ws", name: "admin:worksites", module: "admin", description: "Faenas" },
    { id: "p-adm-wrk", name: "admin:workers", module: "admin", description: "Trabajadores" },
    { id: "p-adm-prod", name: "admin:products", module: "admin", description: "Productos" },
    { id: "p-adm-sup", name: "admin:suppliers", module: "admin", description: "Proveedores" },
    { id: "p-adm-cfg", name: "admin:config", module: "admin", description: "Config" },
    { id: "p-adm-audit", name: "admin:audit_log", module: "admin", description: "Auditoría" },
    { id: "p-adm-fleet", name: "admin:fleet_catalog", module: "admin", description: "Catálogos de flota" },
    { id: "p-ppa-view", name: "ppa:view", module: "ppa", description: "Ver PPA Digital" },
    { id: "p-ppa-review", name: "ppa:review", module: "ppa", description: "Revisar PPA" },
    { id: "p-ppa-manage", name: "ppa:manage", module: "ppa", description: "Gestionar PPA" },
    { id: "p-sst-view", name: "sst:view", module: "sst", description: "Ver evaluaciones SST" },
    { id: "p-sst-create", name: "sst:create", module: "sst", description: "Crear evaluaciones SST" },
    { id: "p-sst-close", name: "sst:close", module: "sst", description: "Cerrar evaluaciones SST" },
    { id: "p-sst-manage", name: "sst:manage", module: "sst", description: "Gestionar evaluaciones SST" },
    { id: "p-fuel-view", name: "combustibles:view", module: "combustibles", description: "Ver registros de combustible" },
    { id: "p-fuel-create", name: "combustibles:create", module: "combustibles", description: "Crear registros de combustible" },
    { id: "p-fuel-delete", name: "combustibles:delete", module: "combustibles", description: "Eliminar registros de combustible" },
    { id: "p-fuel-import", name: "combustibles:import", module: "combustibles", description: "Importar datos de combustible" },
    { id: "p-fuel-export", name: "combustibles:export", module: "combustibles", description: "Exportar datos de combustible" },
    { id: "p-fuel-view-costs", name: "combustibles:view_costs", module: "combustibles", description: "Ver costos de combustible" },
    { id: "p-fuel-veh", name: "combustibles:manage_vehicles", module: "combustibles", description: "Gestionar vehículos de combustible" },
    { id: "p-fuel-sup", name: "combustibles:manage_suppliers", module: "combustibles", description: "Gestionar proveedores de combustible" },
    { id: "p-fuel-tae-view", name: "combustibles:tae_view", module: "combustibles", description: "Ver control TAE" },
    { id: "p-fuel-tae-review", name: "combustibles:tae_review", module: "combustibles", description: "Revisar control TAE" },
    { id: "p-fuel-tae-config", name: "combustibles:tae_manage_config", module: "combustibles", description: "Configurar control TAE" },
    { id: "p-fuel-tae-import", name: "combustibles:tae_import", module: "combustibles", description: "Importar histórico TAE" },
    { id: "p-fuel-tae-export", name: "combustibles:tae_export", module: "combustibles", description: "Exportar control TAE" },
    { id: "p-flot-view", name: "flota:view", module: "flota", description: "Ver flota de vehículos" },
    { id: "p-mant-view", name: "mantenciones:view", module: "mantenciones", description: "Ver mantenciones de vehículos" },
    { id: "p-mant-create", name: "mantenciones:create", module: "mantenciones", description: "Registrar mantenciones de vehículos" },
    { id: "p-mant-edit", name: "mantenciones:edit", module: "mantenciones", description: "Editar y cancelar mantenciones de vehículos" },
    { id: "p-feedback-create", name: "feedback:create", module: "feedback", description: "Crear reportes de soporte" },
    { id: "p-feedback-own", name: "feedback:view_own", module: "feedback", description: "Ver reportes propios" },
    { id: "p-feedback-all", name: "feedback:view_all", module: "feedback", description: "Ver todos los reportes" },
    { id: "p-feedback-manage", name: "feedback:manage", module: "feedback", description: "Gestionar reportes" },
    { id: "p-prev-docs-v", name: "prevention:docs:view", module: "prevention", description: "Ver documentación preventiva" },
    { id: "p-prev-docs-m", name: "prevention:docs:manage", module: "prevention", description: "Gestionar documentos" },
    { id: "p-prev-docs-a", name: "prevention:docs:approve", module: "prevention", description: "Aprobar/observar/archivar documentos" },
    { id: "p-prev-docs-arch", name: "prevention:docs:archive", module: "prevention", description: "Archivar documentos" },
    { id: "p-prev-docs-ack", name: "prevention:docs:ack", module: "prevention", description: "Acuse de lectura de documentos" },
    { id: "p-prev-docs-link", name: "prevention:docs:link", module: "prevention", description: "Asociar documentos con entidades" },
    { id: "p-prev-docs-e", name: "prevention:docs:export", module: "prevention", description: "Exportar documentación (Excel)" },
    { id: "p-prev-docs-sens", name: "prevention:docs:manage_sensitive", module: "prevention", description: "Gestionar documentos sensibles" },
    { id: "p-prev-docs-rest", name: "prevention:docs:manage_restricted", module: "prevention", description: "Gestionar documentos restringidos" },
    { id: "p-prev-pdtp-view", name: "prevention:pdtp:view", module: "prevention", description: "Ver Programa de Trabajo Preventivo SG-SST" },
    { id: "p-prev-pdtp-execute", name: "prevention:pdtp:execute", module: "prevention", description: "Registrar ejecuciones y evidencias PDTP en faenas autorizadas" },
    { id: "p-prev-pdtp-program-manage", name: "prevention:pdtp:program:manage", module: "prevention", description: "Gestionar catálogo, cronograma y metas por faena del PDTP" },
    { id: "p-prev-pdtp-approve", name: "prevention:pdtp:approve", module: "prevention", description: "Aprobar el PDTP como jefatura de prevención" },
    { id: "p-prev-pdtp-sign-legal", name: "prevention:pdtp:sign_legal", module: "prevention", description: "Firmar el PDTP como Gerencia Legal" },
    { id: "p-prev-pdtp-cl-manage", name: "prevention:pdtp:checklist:manage", module: "prevention", description: "Crear/editar plantillas de checklist del PDTP" },
    { id: "p-prev-pdtp-cl-fill", name: "prevention:pdtp:checklist:fill", module: "prevention", description: "Llenar checklist en una ejecución del PDTP" },
    { id: "p-prev-pdtp-ap-manage", name: "prevention:pdtp:action:manage", module: "prevention", description: "Crear/editar acciones y seguimiento del plan de acción PDTP" },
    { id: "p-prev-pdtp-ap-verify", name: "prevention:pdtp:action:verify", module: "prevention", description: "Verificar cierre de acciones del plan de acción PDTP" },
    { id: "p-adm-epp-up", name: "admin:epp_import_upload", module: "admin", description: "Cargar archivos de importación EPP" },
    { id: "p-adm-epp-rv", name: "admin:epp_import_review", module: "admin", description: "Revisar y resolver importaciones EPP" },
    { id: "p-adm-epp-cf", name: "admin:epp_import_confirm", module: "admin", description: "Confirmar importaciones EPP" },
    { id: "p-adm-modules", name: "admin:module_management", module: "admin", description: "Activar/desactivar módulos del sistema" },
  ]

  await db.insert(schema.permissions).values(permissions)
  await db.insert(schema.rolePermissions).values(
    permissions.map((permission) => ({ roleId: "rol-admin", permissionId: permission.id })),
  )

  await db.insert(schema.users).values({
    id: "user-admin-e2e",
    name: "Admin E2E",
    email: "admin@e2e.chome.cl",
    hashedPassword: password,
    avatarColor: "160",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.userRoles).values({ userId: "user-admin-e2e", roleId: "rol-admin" })

  await db.insert(schema.worksites).values({
    id: "ws-e2e",
    name: "Faena E2E",
    code: "E2E-001",
    address: "Ruta E2E",
    region: "Testing",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksiteUsers).values({
    userId: "user-admin-e2e",
    worksiteId: "ws-e2e",
    isPrimary: true,
  })
  await db.insert(schema.users).values({
    id: "user-ops-e2e",
    name: "Comprador E2E",
    email: "comprador@e2e.chome.cl",
    hashedPassword: password,
    avatarColor: "180",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.userRoles).values({ userId: "user-ops-e2e", roleId: "rol-admin" })
  await db.insert(schema.worksiteUsers).values({
    userId: "user-ops-e2e",
    worksiteId: "ws-e2e",
    isPrimary: true,
  })
  await db.insert(schema.fuelSuppliers).values({
    id: "fuel-sup-e2e",
    name: "Proveedor Combustible E2E",
    rut: "76.111.222-3",
    contactName: "Proveedor E2E",
    contactEmail: "combustible@e2e.cl",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.fuelVehicles).values({
    id: "fuel-veh-e2e",
    plate: "E2E-FUEL-1",
    type: "camioneta",
    equipmentTypeId: "fet-camioneta",
    meterType: "odometer",
    performanceUnit: "km_per_liter",
    brand: "Toyota",
    model: "Hilux",
    year: 2024,
    worksiteId: "ws-e2e",
    responsibleUserId: "user-admin-e2e",
    operationalStatus: "operativo",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.fuelVehicleProducts).values({
    vehicleId: "fuel-veh-e2e",
    productId: "fuel-diesel",
  })
  // Second worksite for scope testing
  await db.insert(schema.worksites).values({
    id: "ws-restricted-e2e",
    name: "Faena Restringida E2E",
    code: "E2E-RESTR",
    address: "Ruta Restringida",
    region: "Testing",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  // Scoped user (solicitante_faena) — only has access to ws-e2e
  await db.insert(schema.roles).values({
    id: "rol-sol-faena",
    name: "solicitante_faena",
    label: "Solicitante faena",
    description: "Solicita ítems para sus faenas asignadas — E2E",
  })
  const solFaenaPermissions = [
    { roleId: "rol-sol-faena", permissionId: "p-req-create" },
    { roleId: "rol-sol-faena", permissionId: "p-req-own" },
    { roleId: "rol-sol-faena", permissionId: "p-req-submit" },
    { roleId: "rol-sol-faena", permissionId: "p-rec-reg-faena" },
    { roleId: "rol-sol-faena", permissionId: "p-rec-view" },
    { roleId: "rol-sol-faena", permissionId: "p-wh-stock" },
    { roleId: "rol-sol-faena", permissionId: "p-wh-mov" },
    { roleId: "rol-sol-faena", permissionId: "p-ops-view-work" },
  ]
  await db.insert(schema.rolePermissions).values(solFaenaPermissions)
  await db.insert(schema.users).values({
    id: "user-scoped-e2e",
    name: "Scoped E2E",
    email: "scoped@e2e.chome.cl",
    hashedPassword: await bcrypt.hash("scoped2026", 10),
    avatarColor: "200",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.userRoles).values({ userId: "user-scoped-e2e", roleId: "rol-sol-faena" })
  await db.insert(schema.worksiteUsers).values({
    userId: "user-scoped-e2e",
    worksiteId: "ws-e2e",
    isPrimary: true,
  })
  await db.insert(schema.suppliers).values({
    id: "sup-e2e",
    name: "Proveedor E2E",
    rut: "76.000.000-0",
    businessActivity: "Venta de material industrial",
    address: "Av. Industrial 1234",
    commune: "Santiago",
    city: "Santiago",
    paymentTerms: "30 días",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.productCategories).values({
    id: "cat-e2e",
    name: "Categoría E2E",
    slug: "categoria-e2e",
    isEpp: false,
    requiresPrevencion: false,
    sortOrder: 1,
  })
  await db.insert(schema.productCategories).values({
    id: "cat-epp-e2e",
    name: "EPP E2E",
    slug: "epp-e2e",
    isEpp: true,
    requiresPrevencion: false,
    sortOrder: 2,
  })
  await db.insert(schema.products).values({
    id: "prod-e2e",
    sku: "E2E-001",
    name: "Guante E2E",
    categoryId: "cat-e2e",
    unitOfMeasure: "unidad",
    referencePrice: 1000,
    isEpp: false,
    requiresPrevencion: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.products).values({
    id: "prod-epp-e2e",
    sku: "E2E-EPP-001",
    name: "Casco EPP E2E",
    categoryId: "cat-epp-e2e",
    unitOfMeasure: "unidad",
    referencePrice: 2500,
    isEpp: true,
    requiresPrevencion: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  // Producto dedicado para los fixtures masivos de export/paginación. Mantenerlo
  // separado de "Guante E2E" (prod-e2e) evita que los 120 ítems bulk contaminen
  // la pantalla de creación de OC, donde compartirían la etiqueta "Incluir Guante
  // E2E" con el ítem del flujo funcional y volverían no determinista al .first().
  await db.insert(schema.products).values({
    id: "prod-bulk-e2e",
    sku: "E2E-BULK-001",
    name: "Bulk Export E2E",
    categoryId: "cat-e2e",
    unitOfMeasure: "unidad",
    referencePrice: 500,
    isEpp: false,
    requiresPrevencion: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.productSuppliers).values({
    id: "prod-sup-e2e",
    productId: "prod-e2e",
    supplierId: "sup-e2e",
    unitPrice: 1000,
    isPreferred: true,
    lastUpdated: now,
  })
  await db.insert(schema.productSuppliers).values({
    id: "prod-sup-epp-e2e",
    productId: "prod-epp-e2e",
    supplierId: "sup-e2e",
    unitPrice: 2500,
    isPreferred: true,
    lastUpdated: now,
  })
  await db.insert(schema.workers).values({
    id: "worker-e2e",
    rut: "11111111-1",
    firstName: "Trabajador",
    lastName: "E2E",
    position: "Operario E2E",
    worksiteId: "ws-e2e",
    isActive: true,
    createdAt: now,
  })
  await db.insert(schema.purchaseRequests).values({
    id: "req-delivery-e2e",
    code: "SOL-2026-EPP",
    worksiteId: "ws-e2e",
    requesterId: "user-admin-e2e",
    requestType: "epp",
    urgency: "normal",
    requiredDate: "2026-07-15",
    status: "closed",
    submittedAt: now,
    closedAt: now,
    notes: "Fixture E2E para entrega de EPP a trabajador",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequests).values([
    {
      id: "req-delivery-invalid-file-e2e",
      code: "SOL-2026-EPP-BAD",
      worksiteId: "ws-e2e",
      requesterId: "user-admin-e2e",
      requestType: "epp",
      urgency: "normal",
      requiredDate: "2026-07-15",
      status: "closed",
      submittedAt: now,
      closedAt: now,
      notes: "Fixture E2E para entrega con comprobante inválido",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "req-delivery-attachment-e2e",
      code: "SOL-2026-EPP-ADJ",
      worksiteId: "ws-e2e",
      requesterId: "user-admin-e2e",
      requestType: "epp",
      urgency: "normal",
      requiredDate: "2026-07-15",
      status: "closed",
      submittedAt: now,
      closedAt: now,
      notes: "Fixture E2E para entrega con comprobante descargable",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.purchaseRequestItems).values({
    id: "req-item-delivery-e2e",
    requestId: "req-delivery-e2e",
    productId: "prod-epp-e2e",
    productNameFree: null,
    quantity: 4,
    unitOfMeasure: "unidad",
    status: "received",
    urgency: "normal",
    requiredDate: "2026-07-15",
    workerId: null,
    suggestedSupplierId: "sup-e2e",
    sortOrder: 1,
    notes: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values([
    {
      id: "req-item-delivery-invalid-file-e2e",
      requestId: "req-delivery-invalid-file-e2e",
      productId: "prod-epp-e2e",
      productNameFree: null,
      quantity: 1,
      unitOfMeasure: "unidad",
      status: "received",
      urgency: "normal",
      requiredDate: "2026-07-15",
      workerId: null,
      suggestedSupplierId: "sup-e2e",
      sortOrder: 1,
      notes: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "req-item-delivery-attachment-e2e",
      requestId: "req-delivery-attachment-e2e",
      productId: "prod-epp-e2e",
      productNameFree: null,
      quantity: 2,
      unitOfMeasure: "unidad",
      status: "received",
      urgency: "normal",
      requiredDate: "2026-07-15",
      workerId: null,
      suggestedSupplierId: "sup-e2e",
      sortOrder: 1,
      notes: null,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.worksiteStock).values({
    id: "stock-epp-e2e",
    worksiteId: "ws-e2e",
    productId: "prod-epp-e2e",
    quantity: 10,
    minStock: 0,
    lastMovementAt: now,
    updatedAt: now,
  })

  const bulkRequests = Array.from({ length: 120 }, (_, index) => {
    const number = String(index + 1).padStart(3, "0")
    return {
      id: `req-bulk-e2e-${number}`,
      code: `SOL-BULK-E2E-${number}`,
      worksiteId: "ws-e2e",
      requesterId: "user-admin-e2e",
      requestType: "otro",
      urgency: "normal",
      requiredDate: "2026-08-15",
      status: "approved",
      submittedAt: now,
      notes: "Fixture E2E para exportes masivos",
      createdAt: now,
      updatedAt: now,
    } satisfies typeof schema.purchaseRequests.$inferInsert
  })
  await db.insert(schema.purchaseRequests).values(bulkRequests)

  await db.insert(schema.purchaseRequestItems).values(
    bulkRequests.map((request, index) => {
      const number = String(index + 1).padStart(3, "0")
      return {
        id: `req-item-bulk-e2e-${number}`,
        requestId: request.id,
        productId: "prod-bulk-e2e",
        productNameFree: null,
        quantity: 1 + (index % 9),
        unitOfMeasure: "unidad",
        status: "approved",
        urgency: "normal",
        requiredDate: "2026-08-15",
        workerId: null,
        suggestedSupplierId: "sup-e2e",
        sortOrder: 1,
        notes: `Bulk E2E ${number}`,
        createdAt: now,
        updatedAt: now,
      } satisfies typeof schema.purchaseRequestItems.$inferInsert
    }),
  )

  // ── Purchase Order fixture ──────────────────────────────────────────────
  // Provides a self-contained OC for e2e/pdf-exports.spec.ts PO tests so they
  // don't depend on purchase-flow.spec.ts creating one first.
  await db.insert(schema.purchaseRequests).values({
    id: "req-oc-e2e",
    code: "SOL-OC-E2E",
    worksiteId: "ws-e2e",
    requesterId: "user-admin-e2e",
    requestType: "otro",
    urgency: "normal",
    requiredDate: "2026-07-15",
    status: "approved",
    submittedAt: now,
    notes: "Fixture E2E para orden de compra",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: "req-item-oc-e2e",
    requestId: "req-oc-e2e",
    productId: "prod-e2e",
    productNameFree: null,
    quantity: 10,
    unitOfMeasure: "unidad",
    status: "approved",
    urgency: "normal",
    requiredDate: "2026-07-15",
    workerId: null,
    suggestedSupplierId: "sup-e2e",
    sortOrder: 1,
    notes: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.requestItemAttributes).values([
    {
      id: "req-item-oc-e2e-size",
      requestItemId: "req-item-oc-e2e",
      attributeId: null,
      attributeName: "Talla",
      value: "L",
    },
    {
      id: "req-item-oc-e2e-color",
      requestItemId: "req-item-oc-e2e",
      attributeId: null,
      attributeName: "Color",
      value: "Azul",
    },
  ])
  await db.insert(schema.purchaseOrders).values({
    id: "oc-e2e",
    code: "OC-2026-0001",
    worksiteId: "ws-e2e",
    supplierId: "sup-e2e",
    createdBy: "user-admin-e2e",
    status: "issued",
    issuedAt: now,
    estimatedDelivery: "2026-07-20",
    deliveryAddress: "Ruta E2E",
    paymentTerms: "30 días",
    netAmount: 11400,
    taxAmount: 2166,
    totalAmount: 13566,
    notes: "Fixture E2E para PDF",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: "oc-item-e2e-01",
    purchaseOrderId: "oc-e2e",
    requestItemId: "req-item-oc-e2e",
    productId: "prod-e2e",
    productNameFree: null,
    quantity: 10,
    unitOfMeasure: "unidad",
    unitPrice: 1000,
    discount: 0,
    subtotal: 10000,
    status: "issued",
    sortOrder: 1,
    notes: null,
  })
  // Second item (uncatalogued) to exercise the productNameFree path
  await db.insert(schema.purchaseOrderItems).values({
    id: "oc-item-e2e-02",
    purchaseOrderId: "oc-e2e",
    requestItemId: null,
    productId: null,
    productNameFree: "Servicio de consultoría E2E",
    quantity: 1,
    unitOfMeasure: "servicio",
    unitPrice: 1400,
    discount: 0,
    subtotal: 1400,
    status: "issued",
    sortOrder: 2,
    notes: "Consultoría de implementación",
  })

  // SST seed — one closed evaluation used by sst-pdf.spec.ts to verify the
  // /sst/[id]/print/pdf route works in standalone without MODULE_NOT_FOUND.
  await db.insert(schema.sstEvaluations).values({
    id: "sst-eval-e2e",
    worksiteId: "ws-e2e",
    workerId: "worker-e2e",
    createdBy: "user-admin-e2e",
    definicionCode: "trabajador_nuevo",
    definicionVersion: "01",
    tipo: "nuevo",
    fechaEvaluacion: "2026-06-20",
    estado: "cerrado",
    resultadoFinal: "cumple",
    porcentajeCumplimiento: 100,
    resultadoEficacia: "eficaz",
    createdAt: now,
    updatedAt: now,
  })

  // Delivery fixture — for worker-delivery and delivery-print E2E specs
  await db.insert(schema.deliveries).values({
    id: "del-e2e",
    code: "ENT-2026-0001",
    deliveredBy: "user-admin-e2e",
    deliveredAt: now,
    destinationType: "worker",
    worksiteId: "ws-e2e",
    workerId: "worker-e2e",
    receiverName: "Trabajador E2E",
    notes: "Fixture E2E para comprobante de entrega",
    createdAt: now,
  })
  await db.insert(schema.deliveryItems).values({
    id: "del-item-e2e",
    deliveryId: "del-e2e",
    requestItemId: "req-item-delivery-e2e",
    productId: "prod-epp-e2e",
    quantity: 2,
    unitOfMeasure: "unidad",
    notes: null,
  })
  // The fixture occupies ENT-2026-0001; advance the native document sequence
  // so the first UI-created delivery gets the next unique code.
  await db.execute(sql`SELECT next_document_code('ENT', 2026)`)

  // Maintenance fixture — for mantenciones E2E spec
  await db.insert(schema.maintenanceRecords).values({
    id: "mant-e2e",
    vehicleId: "fuel-veh-e2e",
    supplierId: "sup-e2e",
    worksiteId: "ws-e2e",
    maintenanceDate: "2026-07-15",
    maintenanceType: "preventiva",
    status: "scheduled",
    odometerReading: 50000,
    netAmount: 100000,
    taxAmount: 19000,
    totalAmount: 119000,
    notes: "Fixture E2E para mantenciones",
    createdBy: "user-admin-e2e",
    createdAt: now,
    updatedAt: now,
  })

  // Fleet document fixture — for flota E2E spec
  await db.insert(schema.fleetVehicleDocuments).values({
    id: "fleet-doc-e2e",
    vehicleId: "fuel-veh-e2e",
    documentType: "seguro",
    fileName: "seguro-e2e.pdf",
    filePath: "storage/fleet/seguro-e2e-fixture.pdf",
    fileSize: 1024,
    mimeType: "application/pdf",
    expiresAt: "2026-12-31",
    uploadedBy: "user-admin-e2e",
    createdAt: now,
  })

  // Add received quantities to the OC items so reconciliation panel has data
  await db.update(schema.purchaseOrderItems)
    .set({ quantityOfficeReceived: 10, quantityReceived: 5 })
    .where(eq(schema.purchaseOrderItems.id, "oc-item-e2e-01"))

  // Advance the OC sequence past the fixture code (OC-2026-0001) so the
  // first real app call gets OC-2026-0002 and doesn't collide.
  await db.execute(sql`SELECT next_document_code('OC', EXTRACT(YEAR FROM NOW())::int)`)

  // ── PDTP fixture: programa + actividad + hoja + checklist activo + ejecución ──
  // Da a e2e/pdtp-flow.spec.ts un flujo completo navegable sin pasar por la UI
  // de creación (que hoy no redirige, ver test.skip en ese spec).
  await db.insert(schema.pdtpPrograms).values({
    id: "pdtp-prog-e2e",
    year: 2026,
    version: 1,
    status: "active",
    title: "Programa PDTP E2E",
    elaboratedByName: "Admin E2E",
    elaboratedByTitle: "Prevencionista",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpActivities).values({
    id: "pdtp-act-e2e",
    programId: "pdtp-prog-e2e",
    n: 1,
    objectiveOrder: 1,
    objective: "Objetivo E2E",
    activity: "Charla de seguridad E2E",
    program: "Programa E2E",
    responsibleSlugs: [],
    responsibleDisplay: "Prevencionista",
    sourceSheetRow: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpSheets).values({
    id: "pdtp-sheet-e2e",
    code: "s1",
    programId: "pdtp-prog-e2e",
    label: "Hoja E2E",
    area: "SG-SST",
    defaultScopeRoles: [],
    isActive: true,
  })
  await db.insert(schema.pdtpSheetActivities).values({
    id: "pdtp-sheet-act-e2e",
    sheetId: "pdtp-sheet-e2e",
    sheetCode: "s1",
    activityId: "pdtp-act-e2e",
    sheetRow: 1,
    displayOrder: 1,
  })
  await db.insert(schema.pdtpActivityChecklists).values({
    id: "pdtp-cl-e2e",
    activityId: "pdtp-act-e2e",
    programId: "pdtp-prog-e2e",
    version: "01",
    label: "Checklist E2E",
    definitionJson: {
      code: "e2e", version: "01", revisionDate: "2026-01-01",
      title: "Checklist E2E", tipo: "nuevo",
      legalFramework: [], applicableTo: "",
      sections: [{
        id: "s1", title: "Sección E2E",
        items: [{ id: "i1", label: "Ítem conforme al procedimiento", kind: "cumple_nocumple_obs" }],
      }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
    },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpExecutions).values({
    id: "pdtp-exec-e2e",
    activityId: "pdtp-act-e2e",
    worksiteId: "ws-e2e",
    year: 2026,
    month: 7,
    week: 1,
    executedQuantity: 1,
    status: "submitted",
    createdAt: now,
    updatedAt: now,
  })

  // EPP family + variant products to test the variant-quantity-grid feature.
  await db.insert(schema.eppProductFamilies).values({
    id: "family-epp-e2e",
    categoryId: "cat-epp-e2e",
    canonicalName: "Casco E2E Variantes",
    identityKey: "casco-e2e-variantes",
    brand: "3M",
    model: "H-700",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.products).values([
    {
      id: "prod-epp-var-s", sku: "E2E-CASCO-S", name: "Casco E2E S",
      categoryId: "cat-epp-e2e", familyId: "family-epp-e2e",
      unitOfMeasure: "unidad", isEpp: true, isActive: true,
      createdAt: now, updatedAt: now,
    },
    {
      id: "prod-epp-var-m", sku: "E2E-CASCO-M", name: "Casco E2E M",
      categoryId: "cat-epp-e2e", familyId: "family-epp-e2e",
      unitOfMeasure: "unidad", isEpp: true, isActive: true,
      createdAt: now, updatedAt: now,
    },
    {
      id: "prod-epp-var-l", sku: "E2E-CASCO-L", name: "Casco E2E L",
      categoryId: "cat-epp-e2e", familyId: "family-epp-e2e",
      unitOfMeasure: "unidad", isEpp: true, isActive: true,
      createdAt: now, updatedAt: now,
    },
  ])
  const variantPids = ["prod-epp-var-s", "prod-epp-var-m", "prod-epp-var-l"] as const
  for (let i = 0; i < variantPids.length; i++) {
    await db.insert(schema.productAttributes).values({
      id: `pa-epp-var-${i}`,
      productId: variantPids[i],
      name: "Talla",
      type: "select",
      isRequired: true,
      options: JSON.stringify(["S", "M", "L"]),
      sortOrder: 0,
    })
  }
  for (const variantId of variantPids) {
    await db.insert(schema.productSuppliers).values({
      id: `ps-${variantId}`,
      productId: variantId,
      supplierId: "sup-e2e",
      unitPrice: 3200,
      isPreferred: true,
      lastUpdated: now,
    })
  }

  await client.end()
}

async function ensureDatabaseExists(databaseUrl: string) {
  const databaseName = getDatabaseNameFromUrl(databaseUrl)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(databaseUrl), { max: 1 })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`
      SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1
    `
    if (rows.length === 0) {
      await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
    }
  } finally {
    await maintenanceClient.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
