import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import bcrypt from "bcryptjs"
import { loadEnvConfig } from "@next/env"
import { sql } from "drizzle-orm"
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
    { id: "p-wh-stock", name: "warehouse:view_stock", module: "warehouse", description: "Ver stock" },
    { id: "p-wh-mov", name: "warehouse:register_movement", module: "warehouse", description: "Movimientos" },
    { id: "p-wh-adj", name: "warehouse:adjust_stock", module: "warehouse", description: "Ajuste stock" },
    { id: "p-rep-view", name: "reports:view", module: "reports", description: "Reportes" },
    { id: "p-adm-usr", name: "admin:users", module: "admin", description: "Usuarios" },
    { id: "p-adm-ws", name: "admin:worksites", module: "admin", description: "Faenas" },
    { id: "p-adm-wrk", name: "admin:workers", module: "admin", description: "Trabajadores" },
    { id: "p-adm-prod", name: "admin:products", module: "admin", description: "Productos" },
    { id: "p-adm-sup", name: "admin:suppliers", module: "admin", description: "Proveedores" },
    { id: "p-adm-cfg", name: "admin:config", module: "admin", description: "Config" },
    { id: "p-adm-audit", name: "admin:audit_log", module: "admin", description: "Auditoría" },
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
    { id: "p-fuel-veh", name: "combustibles:manage_vehicles", module: "combustibles", description: "Gestionar vehículos de combustible" },
    { id: "p-fuel-sup", name: "combustibles:manage_suppliers", module: "combustibles", description: "Gestionar proveedores de combustible" },
    { id: "p-flot-view", name: "flota:view", module: "flota", description: "Ver flota de vehículos" },
    { id: "p-mant-view", name: "mantenciones:view", module: "mantenciones", description: "Ver mantenciones de vehículos" },
    { id: "p-mant-create", name: "mantenciones:create", module: "mantenciones", description: "Registrar mantenciones de vehículos" },
    { id: "p-mant-edit", name: "mantenciones:edit", module: "mantenciones", description: "Editar y cancelar mantenciones de vehículos" },
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

  // Advance the OC sequence past the fixture code (OC-2026-0001) so the
  // first real app call gets OC-2026-0002 and doesn't collide.
  await db.execute(sql`SELECT next_document_code('OC', EXTRACT(YEAR FROM NOW())::int)`)

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
