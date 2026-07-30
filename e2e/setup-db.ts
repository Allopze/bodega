import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import bcrypt from "bcryptjs"
import { loadEnvConfig } from "@next/env"
import { eq, sql } from "drizzle-orm"
import * as schema from "../db/schema"
import { SYSTEM_PERMISSIONS } from "../lib/auth/system-rbac"
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

  // Los permisos se derivan del registry de módulos (`SYSTEM_PERMISSIONS`), no
  // de una copia a mano. Antes eran 93 hardcodeados contra los 204 que declaran
  // los manifests, así que al admin de e2e le faltaban los `*:view` de 12
  // módulos de prevención y ~13 specs de humo morían en /forbidden sin que la
  // causa se pareciera en nada a un problema de permisos. Derivarlos hace que
  // un permiso nuevo en cualquier manifest quede sembrado solo.
  await db.insert(schema.permissions).values(SYSTEM_PERMISSIONS)
  await db.insert(schema.rolePermissions).values(
    SYSTEM_PERMISSIONS.map((permission) => ({ roleId: "rol-admin", permissionId: permission.id })),
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

  // Add received quantities to the OC items so the receiving flow has data
  await db.update(schema.purchaseOrderItems)
    .set({ quantityOfficeReceived: 10, quantityReceived: 5 })
    .where(eq(schema.purchaseOrderItems.id, "oc-item-e2e-01"))

  // The "Conciliación por ítem" panel on the OC detail page only renders when
  // the OC has at least one invoice attached (see invoices-section.tsx) — it
  // reconciles invoiced quantity vs. OC quantity, not received quantity.
  await db.insert(schema.purchaseOrderInvoices).values({
    id: "oc-invoice-e2e",
    purchaseOrderId: "oc-e2e",
    invoiceNumber: "FAC-E2E-0001",
    amount: 10000,
    issueDate: "2026-07-15",
    fileName: "factura-e2e.pdf",
    filePath: "storage/purchase-orders/factura-e2e-fixture.pdf",
    uploadedBy: "user-admin-e2e",
    uploadedAt: now,
  })
  await db.insert(schema.purchaseOrderInvoiceItems).values({
    id: "oc-invoice-item-e2e",
    invoiceId: "oc-invoice-e2e",
    purchaseOrderItemId: "oc-item-e2e-01",
    productName: "Guante E2E",
    quantity: 10,
    unitPrice: 1000,
    subtotal: 10000,
  })

  // Advance the OC sequence past the fixture code (OC-2026-0001) so the
  // first real app call gets OC-2026-0002 and doesn't collide.
  await db.execute(sql`SELECT next_document_code('OC', EXTRACT(YEAR FROM NOW())::int)`)

  // ── PDTP fixture: programa + actividad + hoja + checklist activo + ejecución ──
  // Da a e2e/pdtp-flow.spec.ts un flujo completo y un borrador anual para
  // comprobar que el creador idempotente abre el programa existente.
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
  await db.insert(schema.pdtpPrograms).values({
    id: "pdtp-draft-e2e",
    year: 2027,
    version: 1,
    status: "draft",
    title: "Programa anual PDTP 2027 E2E",
    periodStart: "2027-01-01",
    periodEnd: "2027-12-31",
    creationMode: "base_2026",
    elaboratedByUserId: "user-admin-e2e",
    elaboratedByName: "Admin E2E",
    elaboratedByTitle: "Prevencionista",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpActivities).values({
    id: "pdtp-draft-act-e2e",
    programId: "pdtp-draft-e2e",
    n: 90,
    displayOrder: 1,
    activity: "Actividad ajustable anual E2E",
    program: "Guía preventiva E2E",
    responsibleSlugs: [],
    responsibleDisplay: "Prevencionista",
    sourceSheetRow: 0,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpSheets).values({
    id: "pdtp-draft-sheet-e2e",
    code: "pdtp_general",
    programId: "pdtp-draft-e2e",
    label: "General",
    area: "SG-SST",
    defaultScopeRoles: [],
    isActive: true,
  })
  await db.insert(schema.pdtpSheetActivities).values({
    id: "pdtp-draft-sheet-act-e2e",
    sheetId: "pdtp-draft-sheet-e2e",
    sheetCode: "pdtp_general",
    activityId: "pdtp-draft-act-e2e",
    sheetRow: 1,
    displayOrder: 1,
  })
  await db.insert(schema.pdtpProgramTemplates).values({
    id: "pdtp-base-template-e2e",
    code: "base_preventiva_2026",
    name: "Base preventiva 2026",
    description: "Base anual E2E",
    isActive: true,
    createdByUserId: "user-admin-e2e",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpProgramTemplateVersions).values({
    id: "pdtp-base-template-e2e-v1",
    templateId: "pdtp-base-template-e2e",
    version: 1,
    sourceProgramId: "pdtp-draft-e2e",
    sourceContentVersion: 1,
    contentDigest: "e".repeat(64),
    snapshotJson: {
      approvalSteps: [],
      views: [{
        code: "pdtp_general",
        label: "General",
        area: "SG-SST",
        defaultScopeRoles: [],
        isActive: true,
      }],
      activities: [{
        n: 90,
        displayOrder: 1,
        status: "active",
        activity: "Actividad ajustable anual E2E",
        program: "Guía preventiva E2E",
        responsibleSlugs: [],
        responsibleDisplay: "Prevencionista",
        audienceRoles: [],
        scheduleMode: "scheduled",
        scheduleClassificationStatus: "confirmed",
      }],
      schedules: [],
      memberships: [{
        viewCode: "pdtp_general",
        activityNumber: 90,
        sheetRow: 1,
        displayOrder: 1,
      }],
      checklists: [],
    },
    publishedByUserId: "user-admin-e2e",
    publishedAt: now,
    createdAt: now,
  })
  await db.update(schema.pdtpPrograms)
    .set({ sourceTemplateVersionId: "pdtp-base-template-e2e-v1" })
    .where(eq(schema.pdtpPrograms.id, "pdtp-draft-e2e"))
  await db.insert(schema.pdtpActivities).values({
    id: "pdtp-act-e2e",
    programId: "pdtp-prog-e2e",
    n: 1,
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
  // Ejecuciones dedicadas para e2e/pdtp-lifecycle-approvals.spec.ts: no
  // reutilizan pdtp-exec-e2e porque ese fixture lo consume el flujo de
  // checklist de e2e/pdtp-flow.spec.ts y aprobar/rechazar lo dejaría en un
  // estado que podría romper ese otro test según el orden de ejecución.
  await db.insert(schema.pdtpExecutions).values([
    {
      id: "pdtp-exec-approve-e2e",
      activityId: "pdtp-act-e2e",
      worksiteId: "ws-e2e",
      year: 2026,
      month: 7,
      week: 2,
      executedQuantity: 1,
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "pdtp-exec-reject-e2e",
      activityId: "pdtp-act-e2e",
      worksiteId: "ws-e2e",
      year: 2026,
      month: 7,
      week: 3,
      executedQuantity: 1,
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    },
  ])
  // Actividad "por evento" confirmada para e2e/pdtp-obligaciones.spec.ts:
  // la actividad pdtp-act-e2e es "scheduled", así que sin esta segunda
  // actividad el botón "Registrar necesidad o evento" queda siempre
  // deshabilitado (listPdtpDemandActivities exige scheduleMode
  // on_demand/triggered + scheduleClassificationStatus confirmed).
  await db.insert(schema.pdtpActivities).values({
    id: "pdtp-act-event-e2e",
    programId: "pdtp-prog-e2e",
    n: 2,
    activity: "Inducción a trabajador nuevo E2E",
    program: "Programa E2E",
    responsibleSlugs: [],
    responsibleDisplay: "Prevencionista",
    scheduleMode: "triggered",
    triggerType: "evento_operacional",
    triggerDescription: "Ingreso de un trabajador nuevo",
    dueDays: 5,
    evidenceRequirement: "Registro de inducción firmado",
    indicatorMode: "closed_on_time",
    sourceSheetRow: 2,
    createdAt: now,
    updatedAt: now,
  })

  // Planificación + ejecución aprobada para pdtp-act-e2e: sin esto el único
  // actividad del reporte de gestión siempre cae en "En desviación" (no hay
  // nada planificado). e2e/pdtp-reporte-gestion.spec.ts espera "Cumple meta".
  await db.insert(schema.pdtpActivitySchedule).values({
    id: "pdtp-sched-e2e",
    activityId: "pdtp-act-e2e",
    year: 2026,
    month: 1,
    week: 1,
    plannedQuantity: 1,
    sourceColumn: "manual-e2e",
  })
  await db.insert(schema.pdtpExecutions).values({
    id: "pdtp-exec-approved-e2e",
    activityId: "pdtp-act-e2e",
    worksiteId: "ws-e2e",
    year: 2026,
    month: 1,
    week: 1,
    executedQuantity: 1,
    status: "approved",
    createdAt: now,
    updatedAt: now,
  })

  // Requisito legal publicado + aplicabilidad + reloj de actualización para
  // e2e/pdtp-cobertura.spec.ts ("Declarar incorporada"): resolvePdtpUpdateObligation
  // exige que exista un preventionPdtpSourceLinks activo con el mismo
  // sourceType/sourceId, que solo se puede crear vinculando una fuente real
  // desde el picker de Cobertura.
  await db.insert(schema.preventionLegalRequirements).values({
    id: "legalreq-e2e",
    code: "RE-99-E2E",
    requirementVersion: 1,
    sourceType: "legal",
    authority: "SEREMI E2E",
    sourceTitle: "Ley E2E de prevención",
    sourceReference: "Art. 1",
    article: "Art. 1",
    requirement: "Requisito legal de prueba E2E.",
    versionLabel: "v1",
    validFrom: "2026-01-01",
    topic: "seguridad",
    chomeRole: "prevencionista",
    evidenceRequired: "Registro de cumplimiento",
    frequency: "anual",
    status: "published",
    createdByUserId: "user-admin-e2e",
    reviewedByUserId: "user-admin-e2e",
    approvedByUserId: "user-admin-e2e",
  })
  await db.insert(schema.preventionLegalApplicabilities).values({
    id: "legalapp-e2e",
    requirementId: "legalreq-e2e",
    worksiteId: "ws-e2e",
    applicabilityStatus: "applicable",
    rationale: "Aplica a la faena E2E.",
    responsibleSnapshot: "Prevencionista E2E",
  })
  await db.insert(schema.preventionPdtpUpdateObligations).values({
    id: "pdtpobl-e2e",
    idempotencyKey: "pdtpobl-e2e-key",
    worksiteId: "ws-e2e",
    sourceType: "legal_requirement",
    sourceId: "legalreq-e2e",
    sourceVersionSnapshot: "RE-99-E2E v1",
    dueAt: "2026-08-15T00:00:00.000Z",
    status: "pending",
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
  // Cada fila de catálogo es UNA talla, así que su atributo declara sólo la
  // suya. Antes las tres recibían `["S","M","L"]` completo y eso rompía el
  // picker: `getSizeVariantPicker` toma la primera opción como la talla de esa
  // variante, las tres resolvían a "S", detectaba labels duplicados y devolvía
  // `null` — el `VariantSelector` no se renderizaba nunca y
  // `epp-variant-request-flow` no tenía nada que probar.
  const variantSizes = [
    ["prod-epp-var-s", "S"],
    ["prod-epp-var-m", "M"],
    ["prod-epp-var-l", "L"],
  ] as const
  const variantPids = variantSizes.map(([productId]) => productId)
  for (let i = 0; i < variantSizes.length; i++) {
    const [productId, size] = variantSizes[i]!
    await db.insert(schema.productAttributes).values({
      id: `pa-epp-var-${i}`,
      productId,
      name: "Talla",
      type: "select",
      isRequired: true,
      options: JSON.stringify([size]),
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
