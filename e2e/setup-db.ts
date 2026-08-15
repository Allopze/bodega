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
  await setupDb.execute(sql`CREATE SCHEMA drizzle`)
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
    { roleId: "rol-sol-faena", permissionId: "p-rec-reg-faena" },
    { roleId: "rol-sol-faena", permissionId: "p-rec-view" },
    { roleId: "rol-sol-faena", permissionId: "p-wh-stock" },
    { roleId: "rol-sol-faena", permissionId: "p-wh-mov" },
    { roleId: "rol-sol-faena", permissionId: "p-ops-view-work" },
  ]
  await db.insert(schema.rolePermissions).values(solFaenaPermissions)

  /*
   * Observador de prevención: ve los indicadores pero **no** puede cargar los
   * denominadores. Existe para una pregunta concreta de TASK-UI-009 que no se
   * podía responder con los tres usuarios anteriores: cuando falta el
   * denominador de horas-hombre y la tasa aparece como «—», ¿quien no puede
   * corregirlo entiende **por qué** falta, o se queda ante un guion mudo?
   *
   * Sin este rol, la prueba por rol sólo podía ejercitar el caso de quien sí
   * puede arreglarlo, que es el fácil.
   */
  await db.insert(schema.roles).values({
    id: "rol-prev-lectura",
    name: "prevencion_lectura",
    label: "Prevención — sólo lectura",
    description: "Consulta indicadores SST sin poder registrar denominadores — E2E",
  })
  await db.insert(schema.rolePermissions).values([
    { roleId: "rol-prev-lectura", permissionId: "p-prev-ind-view" },
  ])
  await db.insert(schema.users).values({
    id: "user-prev-lectura-e2e",
    name: "Prevención Lectura E2E",
    email: "prevencion.lectura@e2e.chome.cl",
    hashedPassword: await bcrypt.hash("chome2026", 10),
    avatarColor: "260",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.userRoles).values({ userId: "user-prev-lectura-e2e", roleId: "rol-prev-lectura" })
  // Con alcance a una faena: sin él no ve ningún indicador y la prueba por rol
  // se saltaría sin comprobar nada, que es peor que fallar.
  await db.insert(schema.worksiteUsers).values({
    userId: "user-prev-lectura-e2e",
    worksiteId: "ws-e2e",
    isPrimary: true,
  })
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
  // Instrumento del registro para el flujo de servicios (mantención de monogás).
  await db.insert(schema.serviceEquipment).values({
    id: "eq-monogas-e2e",
    code: "MG-E2E",
    name: "Monogás E2E",
    kind: "monogas",
    brand: "Dräger",
    model: "Pac 6500",
    serialNumber: "E2E-0001",
    worksiteId: "ws-e2e",
    isActive: true,
    createdAt: now,
    updatedAt: now,
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

  /*
   * Bodega de la oficina para las Guías de Despacho Internas (GDI).
   *
   * Es una faena aparte —el origen del traslado— y se declara explícitamente en
   * `system_settings`, no por su nombre: así el fixture ejercita el mismo camino
   * de resolución que usa producción cuando la oficina está configurada.
   */
  await db.insert(schema.worksites).values({
    id: "ws-oficina-e2e",
    name: "Oficina Central E2E",
    code: "E2E-OFI",
    address: "Casa Matriz E2E",
    region: "Testing",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.systemSettings).values({
    key: "warehouse.office_worksite_id",
    value: "ws-oficina-e2e",
    updatedAt: now,
  })
  await db.insert(schema.worksiteStock).values([
    {
      id: "stock-oficina-epp-e2e",
      worksiteId: "ws-oficina-e2e",
      productId: "prod-epp-e2e",
      quantity: 25,
      minStock: 0,
      lastMovementAt: now,
      updatedAt: now,
    },
    {
      id: "stock-oficina-e2e",
      worksiteId: "ws-oficina-e2e",
      productId: "prod-e2e",
      quantity: 40,
      minStock: 0,
      lastMovementAt: now,
      updatedAt: now,
    },
  ])

  // Estas entregas E2E deben seguir el mismo circuito que producción: solicitud
  // → OC → recepción en faena → entrega. Marcar sólo la solicitud como
  // "received" hacía que el formulario la ofreciera pero el servicio la
  // rechazara, porque no existía evidencia de recepción trazable.
  await db.insert(schema.purchaseOrders).values({
    id: "oc-delivery-e2e",
    code: "OC-2026-0088",
    worksiteId: "ws-e2e",
    supplierId: "sup-e2e",
    createdBy: "user-admin-e2e",
    status: "received",
    deliveryMode: "directo_faena",
    issuedAt: now,
    sentAt: now,
    estimatedDelivery: "2026-07-15",
    netAmount: 17500,
    taxAmount: 3325,
    totalAmount: 20825,
    notes: "Fixture E2E para entregas trazables de EPP",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values([
    {
      id: "oc-item-delivery-e2e",
      purchaseOrderId: "oc-delivery-e2e",
      requestItemId: "req-item-delivery-e2e",
      productId: "prod-epp-e2e",
      productNameFree: null,
      quantity: 4,
      unitOfMeasure: "unidad",
      unitPrice: 2500,
      discount: 0,
      subtotal: 10000,
      quantityReceived: 4,
      status: "issued",
      sortOrder: 1,
      notes: null,
    },
    {
      id: "oc-item-delivery-invalid-file-e2e",
      purchaseOrderId: "oc-delivery-e2e",
      requestItemId: "req-item-delivery-invalid-file-e2e",
      productId: "prod-epp-e2e",
      productNameFree: null,
      quantity: 1,
      unitOfMeasure: "unidad",
      unitPrice: 2500,
      discount: 0,
      subtotal: 2500,
      quantityReceived: 1,
      status: "issued",
      sortOrder: 2,
      notes: null,
    },
    {
      id: "oc-item-delivery-attachment-e2e",
      purchaseOrderId: "oc-delivery-e2e",
      requestItemId: "req-item-delivery-attachment-e2e",
      productId: "prod-epp-e2e",
      productNameFree: null,
      quantity: 2,
      unitOfMeasure: "unidad",
      unitPrice: 2500,
      discount: 0,
      subtotal: 5000,
      quantityReceived: 2,
      status: "issued",
      sortOrder: 3,
      notes: null,
    },
  ])
  await db.insert(schema.receipts).values({
    id: "rec-delivery-e2e",
    code: "REC-2026-0088",
    purchaseOrderId: "oc-delivery-e2e",
    receivedBy: "user-admin-e2e",
    receivedAt: now,
    locationType: "faena",
    worksiteId: "ws-e2e",
    dispatchGuideNo: "GD-EPP-E2E",
    status: "closed",
    notes: "Fixture E2E para entregas trazables de EPP",
    createdAt: now,
  })
  await db.insert(schema.receiptItems).values([
    {
      id: "rec-item-delivery-e2e",
      receiptId: "rec-delivery-e2e",
      purchaseOrderItemId: "oc-item-delivery-e2e",
      quantityReceived: 4,
      quantityRejected: 0,
      quantityDamaged: 0,
      status: "received",
      notes: null,
    },
    {
      id: "rec-item-delivery-invalid-file-e2e",
      receiptId: "rec-delivery-e2e",
      purchaseOrderItemId: "oc-item-delivery-invalid-file-e2e",
      quantityReceived: 1,
      quantityRejected: 0,
      quantityDamaged: 0,
      status: "received",
      notes: null,
    },
    {
      id: "rec-item-delivery-attachment-e2e",
      receiptId: "rec-delivery-e2e",
      purchaseOrderItemId: "oc-item-delivery-attachment-e2e",
      quantityReceived: 2,
      quantityRejected: 0,
      quantityDamaged: 0,
      status: "received",
      notes: null,
    },
  ])

  /**
   * 120 solicitudes aprobadas sin OC. NO es relleno: son exactamente el
   * conjunto que mide `export-volume.spec.ts`, que exige `rowCount >= 121` en
   * el export `items_sin_oc`. Bajar el número rompe esa prueba.
   *
   * El efecto colateral es que la cola de Compras (`/compras`) llega con ~12
   * páginas en la BD E2E, y como está ordenada FIFO —lo que lleva más tiempo
   * esperando va primero— cualquier solicitud que cree un test cae en la
   * última. Los specs que persiguen la suya la buscan con `/compras?q=<código>`
   * en vez de asumir que está en la primera página (ver
   * `flujo-cuatro-modulos.spec.ts`); es además lo que hace un comprador real.
   */
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
    status: "sent",
    issuedAt: now,
    sentAt: now,
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

  // OC con suficientes ítems para que el PDF pase de una hoja (pdf-exports.spec.ts
  // verifica numeración, encabezado repetido y que el bloque de firma no se
  // duplique). Va en estado cerrado a propósito: queda fuera de las colas de
  // pendientes y aprobaciones, así no mueve los conteos de otros specs.
  await db.insert(schema.purchaseOrders).values({
    id: "oc-multipagina-e2e",
    code: "OC-2026-0077",
    worksiteId: "ws-e2e",
    supplierId: "sup-e2e",
    createdBy: "user-admin-e2e",
    status: "closed",
    deliveryMode: "directo_faena",
    issuedAt: now,
    sentAt: now,
    estimatedDelivery: "2026-07-20",
    paymentTerms: "30 días",
    netAmount: 120000,
    taxAmount: 22800,
    totalAmount: 142800,
    notes: "Fixture E2E para PDF multipágina",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values(
    Array.from({ length: 40 }, (_, index) => ({
      id: `oc-item-multipagina-e2e-${String(index + 1).padStart(2, "0")}`,
      purchaseOrderId: "oc-multipagina-e2e",
      requestItemId: null,
      productId: null,
      productNameFree: `Insumo multipágina ${index + 1} de línea extendida`,
      quantity: 2,
      unitOfMeasure: "unidad",
      unitPrice: 1500,
      discount: 0,
      subtotal: 3000,
      quantityReceived: 2,
      // El estado de línea sólo distingue activa/anulada (ARQ-12): la recepción
      // se trackea con los contadores numéricos.
      status: "issued",
      sortOrder: index + 1,
      notes: "Detalle largo para que la fila ocupe dos líneas en la hoja A4.",
    })),
  )

  // OC dedicada al flujo completo enviada → oficina → faena → recibida → cerrada
  // (oc-flow.spec.ts). Es propia porque ese spec avanza el estado y no puede
  // pisar a `oc-e2e`, que otros specs leen esperando una OC recién emitida.
  await db.insert(schema.purchaseRequests).values({
    id: "req-oc-flow-e2e",
    code: "SOL-OC-FLOW-E2E",
    worksiteId: "ws-e2e",
    requesterId: "user-admin-e2e",
    requestType: "otro",
    urgency: "normal",
    requiredDate: "2026-07-15",
    status: "approved",
    submittedAt: now,
    notes: "Fixture E2E para el flujo OC → recepción",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: "req-item-oc-flow-e2e",
    requestId: "req-oc-flow-e2e",
    productId: "prod-e2e",
    productNameFree: null,
    quantity: 10,
    unitOfMeasure: "unidad",
    status: "in_purchase_order",
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
    id: "oc-flow-e2e",
    code: "OC-2026-0090",
    worksiteId: "ws-e2e",
    supplierId: "sup-e2e",
    createdBy: "user-admin-e2e",
    status: "draft",
    deliveryMode: "via_oficina",
    estimatedDelivery: "2026-07-20",
    deliveryAddress: "Ruta E2E",
    paymentTerms: "30 días",
    netAmount: 10000,
    taxAmount: 1900,
    totalAmount: 11900,
    notes: "Fixture E2E para el flujo OC → recepción",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: "oc-item-flow-e2e",
    purchaseOrderId: "oc-flow-e2e",
    requestItemId: "req-item-oc-flow-e2e",
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

  // OC dedicada al E2E de la GDI integrada: llega primero a Oficina CHOME,
  // prepara automáticamente el documento y permite probar despacho/PDF/cotejo
  // sin competir con el spec que recorre `oc-flow-e2e`.
  await db.insert(schema.purchaseRequests).values({
    id: "req-gdi-e2e",
    code: "SOL-GDI-E2E",
    worksiteId: "ws-e2e",
    requesterId: "user-admin-e2e",
    requestType: "epp",
    urgency: "normal",
    requiredDate: "2026-07-20",
    status: "in_purchasing",
    submittedAt: now,
    notes: "Fixture E2E para la Guía de Despacho Interna integrada",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: "req-item-gdi-e2e",
    requestId: "req-gdi-e2e",
    productId: "prod-e2e",
    productNameFree: null,
    quantity: 6,
    unitOfMeasure: "unidad",
    status: "purchased",
    urgency: "normal",
    requiredDate: "2026-07-20",
    workerId: null,
    suggestedSupplierId: "sup-e2e",
    sortOrder: 1,
    notes: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrders).values({
    id: "oc-gdi-e2e",
    code: "OC-2026-0093",
    worksiteId: "ws-e2e",
    supplierId: "sup-e2e",
    createdBy: "user-admin-e2e",
    status: "sent",
    deliveryMode: "via_oficina",
    issuedAt: now,
    sentAt: now,
    estimatedDelivery: "2026-07-22",
    deliveryAddress: "Oficina CHOME",
    netAmount: 6000,
    taxAmount: 1140,
    totalAmount: 7140,
    notes: "Fixture E2E para GDI integrada",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: "oc-item-gdi-e2e",
    purchaseOrderId: "oc-gdi-e2e",
    requestItemId: "req-item-gdi-e2e",
    productId: "prod-e2e",
    productNameFree: null,
    quantity: 6,
    unitOfMeasure: "unidad",
    unitPrice: 1000,
    discount: 0,
    subtotal: 6000,
    status: "issued",
    sortOrder: 1,
    notes: null,
  })

  // OC de despacho DIRECTO A FAENA para el camino alternativo completo
  // (directo-faena-flow.spec.ts): sin checkpoint de oficina, `sent` pasa
  // directo a `partially_received` y luego a `received`/`closed`. Ese camino
  // no tenía ninguna cobertura, incluida la guarda que rechaza registrar
  // oficina sobre una OC directa.
  await db.insert(schema.purchaseRequests).values({
    id: "req-directo-faena-e2e",
    code: "SOL-DIRECTO-E2E",
    worksiteId: "ws-e2e",
    requesterId: "user-admin-e2e",
    requestType: "otro",
    urgency: "high",
    deliveryMode: "directo_faena",
    requiredDate: "2026-07-15",
    status: "approved",
    submittedAt: now,
    notes: "Fixture E2E para el flujo directo a faena",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: "req-item-directo-faena-e2e",
    requestId: "req-directo-faena-e2e",
    productId: "prod-e2e",
    productNameFree: null,
    quantity: 8,
    unitOfMeasure: "unidad",
    status: "in_purchase_order",
    urgency: "high",
    requiredDate: "2026-07-15",
    workerId: null,
    suggestedSupplierId: "sup-e2e",
    sortOrder: 1,
    notes: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrders).values({
    id: "oc-directo-faena-e2e",
    code: "OC-2026-0092",
    worksiteId: "ws-e2e",
    supplierId: "sup-e2e",
    createdBy: "user-admin-e2e",
    status: "draft",
    deliveryMode: "directo_faena",
    estimatedDelivery: "2026-07-20",
    deliveryAddress: "Faena E2E",
    paymentTerms: "30 días",
    netAmount: 8000,
    taxAmount: 1520,
    totalAmount: 9520,
    notes: "Fixture E2E para el flujo directo a faena",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: "oc-item-directo-faena-e2e",
    purchaseOrderId: "oc-directo-faena-e2e",
    requestItemId: "req-item-directo-faena-e2e",
    productId: "prod-e2e",
    productNameFree: null,
    quantity: 8,
    unitOfMeasure: "unidad",
    unitPrice: 1000,
    discount: 0,
    subtotal: 8000,
    status: "issued",
    sortOrder: 1,
    notes: null,
  })

  // OC recibida completa y sin factura: el caso que antes no se veía desde
  // ninguna parte (oc-reconciliation.spec.ts). Propia porque los otros fixtures
  // de OC ya tienen factura o avanzan de estado.
  await db.insert(schema.purchaseOrders).values({
    id: "oc-sin-factura-e2e",
    code: "OC-2026-0091",
    worksiteId: "ws-e2e",
    supplierId: "sup-e2e",
    createdBy: "user-admin-e2e",
    status: "received",
    deliveryMode: "directo_faena",
    issuedAt: now,
    sentAt: now,
    estimatedDelivery: "2026-07-18",
    netAmount: 5000,
    taxAmount: 950,
    totalAmount: 5950,
    notes: "Fixture E2E para OC recibida sin factura",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: "oc-item-sin-factura-e2e",
    purchaseOrderId: "oc-sin-factura-e2e",
    requestItemId: null,
    productId: null,
    productNameFree: "Insumo recibido sin factura E2E",
    quantity: 5,
    unitOfMeasure: "unidad",
    unitPrice: 1000,
    discount: 0,
    subtotal: 5000,
    status: "issued",
    quantityReceived: 5,
    sortOrder: 1,
    notes: null,
  })
  // Su recepción, con el número de guía que el atajo "Adjuntar factura" del
  // detalle de recepción prellena en el formulario de la OC.
  await db.insert(schema.receipts).values({
    id: "rec-sin-factura-e2e",
    code: "REC-2026-0091",
    purchaseOrderId: "oc-sin-factura-e2e",
    receivedBy: "user-admin-e2e",
    receivedAt: now,
    locationType: "faena",
    worksiteId: "ws-e2e",
    dispatchGuideNo: "GD-77123",
    status: "closed",
    notes: "Fixture E2E: recepción sin factura adjunta",
    createdAt: now,
  })
  await db.insert(schema.receiptItems).values({
    id: "rec-item-sin-factura-e2e",
    receiptId: "rec-sin-factura-e2e",
    purchaseOrderItemId: "oc-item-sin-factura-e2e",
    quantityReceived: 5,
    quantityRejected: 0,
    quantityDamaged: 0,
    status: "received",
    notes: null,
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

  // Historical exception used by the integrity E2E: delivery tied to a request
  // item before any receipt in faena. The cancelled OC is context only; the
  // detector must still report the delivery excess, never the cancellation.
  await db.insert(schema.purchaseRequests).values({
    id: "req-integrity-e2e",
    code: "SOL-INTEGRITY-E2E",
    worksiteId: "ws-e2e",
    requesterId: "user-admin-e2e",
    requestType: "epp",
    urgency: "normal",
    status: "approved",
    deliveryMode: "directo_faena",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: "req-item-integrity-e2e",
    requestId: "req-integrity-e2e",
    productId: "prod-epp-e2e",
    quantity: 1,
    unitOfMeasure: "unidad",
    status: "received",
  })
  await db.insert(schema.purchaseOrders).values({
    id: "oc-integrity-e2e",
    code: "OC-INTEGRITY-E2E",
    worksiteId: "ws-e2e",
    supplierId: "sup-e2e",
    createdBy: "user-admin-e2e",
    status: "cancelled",
    deliveryMode: "directo_faena",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: "oc-item-integrity-e2e",
    purchaseOrderId: "oc-integrity-e2e",
    requestItemId: "req-item-integrity-e2e",
    productId: "prod-epp-e2e",
    quantity: 1,
    unitOfMeasure: "unidad",
    status: "cancelled",
  })
  await db.insert(schema.deliveries).values({
    id: "del-integrity-e2e",
    code: "ENT-2026-0002",
    deliveredBy: "user-admin-e2e",
    deliveredAt: now,
    destinationType: "worker",
    worksiteId: "ws-e2e",
    workerId: "worker-e2e",
    receiverName: "Trabajador E2E",
    notes: "Entrega histórica para revisar integridad",
    createdAt: now,
  })
  await db.insert(schema.deliveryItems).values({
    id: "del-item-integrity-e2e",
    deliveryId: "del-integrity-e2e",
    requestItemId: "req-item-integrity-e2e",
    productId: "prod-epp-e2e",
    quantity: 1,
    unitOfMeasure: "unidad",
  })
  await db.insert(schema.inventoryMovements).values({
    id: "adjustment-integrity-e2e",
    worksiteId: "ws-e2e",
    productId: "prod-epp-e2e",
    type: "ajuste",
    quantity: 1,
    stockBefore: 10,
    stockAfter: 11,
    performedBy: "user-admin-e2e",
    performedAt: now,
    reason: "Ajuste compensatorio E2E",
  })
  // The extra historical fixture occupies ENT-2026-0002 too.
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

  // El panel "Conciliación por línea" del detalle OC sólo se muestra cuando la
  // orden tiene factura: separa el total monetario de la evidencia por línea,
  // nunca de la cantidad recibida.
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
  // The invoice total exactly completes the OC total but deliberately carries
  // no line items. This proves that monetary reconciliation never invents
  // documentary evidence by line.
  await db.insert(schema.purchaseOrderInvoices).values({
    id: "oc-invoice-no-lines-e2e",
    purchaseOrderId: "oc-e2e",
    invoiceNumber: "FAC-E2E-SIN-LINEAS",
    amount: 3566,
    issueDate: "2026-07-16",
    fileName: "factura-e2e-sin-lineas.pdf",
    filePath: "storage/purchase-orders/factura-e2e-sin-lineas-fixture.pdf",
    uploadedBy: "user-admin-e2e",
    uploadedAt: now,
  })

  // ── DTE fixture: portal DTE FacturaEnLínea (Bandeja de Entrada) ──────────────
  // Da a e2e/export-volume.spec.ts datos para los 3 reportes de DTE: uno
  // vinculado sin discrepancia (oc-invoice-e2e, $10.000), uno vinculado CON
  // discrepancia (oc-invoice-no-lines-e2e, $3.566 → $500 de diferencia) y uno
  // huérfano (sin OC ni combustible).
  //
  // Cada DTE cuelga de una factura distinta a propósito:
  // `dte_documents_purchase_invoice_single_unique` (migración 0159) admite un
  // solo DTE por factura de OC. Antes los dos vinculados compartían
  // oc-invoice-e2e y el sembrado fallaba, dejando el servidor E2E sin arrancar.
  const dtePeriodo = "2026-07"
  await db.insert(schema.dteSyncRuns).values({
    id: "dte-sync-run-e2e",
    periodo: dtePeriodo,
    codEmp: "433",
    trigger: "manual",
    status: "success",
    rowsSeen: 3,
    rowsInserted: 3,
    rowsUpdated: 0,
    importerId: "user-admin-e2e",
    startedAt: now,
    finishedAt: now,
  })
  await db.insert(schema.dteDocuments).values([
    {
      id: "dte-e2e-matched",
      tipoDte: "33",
      folio: 900001,
      rutEmisor: "76000000-0",
      razonSocialEmisor: "Proveedor E2E",
      fechaEmision: "2026-07-15",
      montoNeto: 8403,
      iva: 1597,
      montoTotal: 10000,
      estadoSii: "aceptado",
      codEmp: "433",
      periodo: dtePeriodo,
      rawHash: "e2e-hash-matched",
      purchaseOrderInvoiceId: "oc-invoice-e2e",
      syncRunId: "dte-sync-run-e2e",
      syncedAt: now,
      createdAt: now,
    },
    {
      id: "dte-e2e-discrepancia",
      tipoDte: "33",
      folio: 900002,
      rutEmisor: "76000000-0",
      razonSocialEmisor: "Proveedor E2E",
      fechaEmision: "2026-07-16",
      // $4.066 contra una factura de $3.566: la discrepancia sigue siendo $500.
      montoNeto: 3417,
      iva: 649,
      montoTotal: 4066,
      estadoSii: "aceptado",
      codEmp: "433",
      periodo: dtePeriodo,
      rawHash: "e2e-hash-discrepancia",
      purchaseOrderInvoiceId: "oc-invoice-no-lines-e2e",
      syncRunId: "dte-sync-run-e2e",
      syncedAt: now,
      createdAt: now,
    },
    {
      id: "dte-e2e-huerfana",
      tipoDte: "61",
      folio: 900003,
      rutEmisor: "99999999-9",
      razonSocialEmisor: "Proveedor Huérfano E2E",
      fechaEmision: "2026-07-17",
      montoNeto: 21008,
      iva: 3992,
      montoTotal: 25000,
      estadoSii: "pendiente_envio",
      codEmp: "433",
      periodo: dtePeriodo,
      rawHash: "e2e-hash-huerfana",
      syncRunId: "dte-sync-run-e2e",
      syncedAt: now,
      createdAt: now,
    },
  ])

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
  // `prod-epp-e2e` NO entra a la familia: es el casco genérico de los fixtures
  // de recepción y entrega, y no tiene atributo "Talla". `getSizeVariantPicker`
  // anula la familia entera si **algún** miembro carece de talla, así que
  // meterlo aquí dejaba al `VariantSelector` sin renderizar y a
  // `epp-variant-request-flow` sin nada que probar — el mismo síntoma que ya
  // documenta el comentario de más abajo, por otra causa.
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

  // ── CPHS fixture: comité base con integrantes, sesiones, programa y
  // comisión, para el flujo CRUD de e2e/prevencion-cphs-*.spec.ts. Sigue la
  // convención del resto del archivo: cada test destructivo (disolver) recibe
  // su propio comité dedicado para no interferir con los demás; los que no se
  // destruyen entre sí (agregar invitado / marcar tabla enviada) comparten
  // sesión porque ninguno invalida la precondición del otro.
  await db.insert(schema.workers).values([
    { id: "worker-cphs-e2e-1", rut: "22222222-2", firstName: "Presidenta", lastName: "CPHS E2E", position: "Prevencionista", worksiteId: "ws-e2e", isActive: true, createdAt: now },
    { id: "worker-cphs-e2e-2", rut: "33333333-3", firstName: "Secretario", lastName: "CPHS E2E", position: "Operario", worksiteId: "ws-e2e", isActive: true, createdAt: now },
    { id: "worker-cphs-e2e-3", rut: "44444444-4", firstName: "Suplente Renuncia", lastName: "CPHS E2E", position: "Operario", worksiteId: "ws-e2e", isActive: true, createdAt: now },
    { id: "worker-cphs-e2e-4", rut: "55555555-5", firstName: "Suplente Reemplazo", lastName: "CPHS E2E", position: "Operario", worksiteId: "ws-e2e", isActive: true, createdAt: now },
    // Dedicado a "agregar invitado": ni la Etapa lifecycle ni ninguna otra lo
    // incorpora como integrante, así que no colisiona si los specs corren en
    // paralelo contra la misma base compartida.
    { id: "worker-cphs-e2e-guest", rut: "66666666-6", firstName: "Invitado", lastName: "CPHS E2E", position: "Visita técnica", worksiteId: "ws-e2e", isActive: true, createdAt: now },
  ])
  await db.insert(schema.preventionCommittees).values({
    id: "cphs-e2e-base",
    worksiteId: "ws-e2e",
    name: "CPHS Faena E2E",
    constitutedOn: "2026-01-15",
    mandateEndsOn: "2030-01-15",
    status: "active",
    createdByUserId: "user-admin-e2e",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionCommitteeMembers).values([
    { id: "cphsm-e2e-presidente", committeeId: "cphs-e2e-base", workerId: "worker-cphs-e2e-1", representation: "company", seat: "titular", role: "presidente", hasFuero: false, status: "active", createdAt: now, updatedAt: now },
    { id: "cphsm-e2e-secretario", committeeId: "cphs-e2e-base", workerId: "worker-cphs-e2e-2", representation: "workers", seat: "titular", role: "secretario", hasFuero: true, status: "active", createdAt: now, updatedAt: now },
    { id: "cphsm-e2e-renuncia", committeeId: "cphs-e2e-base", workerId: "worker-cphs-e2e-3", representation: "company", seat: "suplente", role: "integrante", hasFuero: false, status: "active", createdAt: now, updatedAt: now },
    { id: "cphsm-e2e-reemplazo", committeeId: "cphs-e2e-base", workerId: "worker-cphs-e2e-4", representation: "workers", seat: "suplente", role: "integrante", hasFuero: false, status: "active", createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.preventionCommitteeMeetings).values([
    // Convocada: para "marcar tabla enviada" y "agregar invitado" (ninguna
    // de las dos cambia el estado que la otra necesita).
    {
      id: "cphsmt-e2e-agenda", code: "CPHS-E2E-AGENDA", committeeId: "cphs-e2e-base",
      meetingType: "ordinary", scheduledFor: now, agenda: "Tabla de sesión ordinaria E2E, mínimo diez caracteres.",
      status: "scheduled", quorumReached: false, version: 1, createdByUserId: "user-admin-e2e", createdAt: now, updatedAt: now,
    },
    // Convocada dedicada: para "cancelar sesión" (destructivo, no comparte).
    {
      id: "cphsmt-e2e-cancelar", code: "CPHS-E2E-CANCELAR", committeeId: "cphs-e2e-base",
      meetingType: "extraordinary", scheduledFor: now, agenda: "Tabla de sesión a cancelar E2E, mínimo diez caracteres.",
      status: "scheduled", quorumReached: false, version: 1, createdByUserId: "user-admin-e2e", createdAt: now, updatedAt: now,
    },
    // Cerrada: para "enviar acta a gerencia".
    {
      id: "cphsmt-e2e-cerrada", code: "CPHS-E2E-CERRADA", committeeId: "cphs-e2e-base",
      meetingType: "ordinary", scheduledFor: now, heldAt: now, agenda: "Tabla de sesión cerrada E2E, mínimo diez caracteres.",
      minutes: "Acta cerrada de fixture E2E con el mínimo de veinte caracteres exigido.",
      status: "closed", quorumReached: true, closedByUserId: "user-admin-e2e", closedAt: now,
      version: 1, createdByUserId: "user-admin-e2e", createdAt: now, updatedAt: now,
    },
    // Cerrada dedicada: para "vincular actividad a sesión" (no comparte con
    // la anterior para no acoplar el orden de los dos tests).
    {
      id: "cphsmt-e2e-vincular", code: "CPHS-E2E-VINCULAR", committeeId: "cphs-e2e-base",
      meetingType: "ordinary", scheduledFor: now, heldAt: now, agenda: "Tabla de sesión para vincular actividad E2E, mínimo diez caracteres.",
      minutes: "Acta cerrada de fixture E2E con el mínimo de veinte caracteres exigido.",
      status: "closed", quorumReached: true, closedByUserId: "user-admin-e2e", closedAt: now,
      version: 1, createdByUserId: "user-admin-e2e", createdAt: now, updatedAt: now,
    },
  ])
  await db.insert(schema.preventionCommitteePrograms).values({
    id: "cphspg-e2e-base", committeeId: "cphs-e2e-base", year: 2026, status: "active",
    approvedByUserId: "user-admin-e2e", approvedAt: now,
    version: 1, createdByUserId: "user-admin-e2e", createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionCommitteeProgramActivities).values({
    id: "cphspa-e2e-vincular", programId: "cphspg-e2e-base",
    title: "Actividad E2E para vincular a sesión", plannedMonth: 6, status: "planned",
    version: 1, createdByUserId: "user-admin-e2e", createdAt: now, updatedAt: now,
  })
  // Sin integrantes: la asignación de integrante a comisión la ejerce el test.
  await db.insert(schema.preventionCommitteeCommissions).values({
    id: "cphscom-e2e-base", committeeId: "cphs-e2e-base",
    name: "Comisión Higiene E2E", purpose: "Comisión de fixture para asignar integrantes en el flujo E2E.",
    isActive: true, createdByUserId: "user-admin-e2e", createdAt: now, updatedAt: now,
  })

  // Comité dedicado y desechable para "disolver comité": en una faena
  // distinta porque sólo puede existir un comité activo por faena.
  await db.insert(schema.preventionCommittees).values({
    id: "cphs-e2e-dissolve",
    worksiteId: "ws-restricted-e2e",
    name: "CPHS Faena Restringida E2E (a disolver)",
    constitutedOn: "2026-01-15",
    mandateEndsOn: "2030-01-15",
    status: "active",
    createdByUserId: "user-admin-e2e",
    createdAt: now,
    updatedAt: now,
  })

  // ── MIPER fixture: matriz publicada con un peligro, para
  // e2e/prevencion-miper-risk-map.spec.ts (necesita un peligro que ubicar).
  await db.insert(schema.preventionRiskMethodologies).values({
    id: "riskmethod-e2e", code: "ISP-E2E", name: "Metodología ISP E2E", versionLabel: "v1",
    kind: "primary", authoritySource: "ISP", configuration: {}, isActive: true,
    createdByUserId: "user-admin-e2e", createdAt: now,
  })
  await db.insert(schema.preventionRiskProcesses).values({
    id: "riskproc-e2e", worksiteId: "ws-e2e", code: "PROC-E2E", name: "Proceso E2E",
    isActive: true, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionRiskTasks).values({
    id: "risktask-e2e", processId: "riskproc-e2e", code: "TASK-E2E", name: "Tarea E2E",
    isRoutine: true, isActive: true, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionRiskPositions).values({
    id: "riskpos-e2e", taskId: "risktask-e2e", code: "POS-E2E", name: "Puesto E2E",
    isActive: true, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionRiskMatrices).values({
    id: "riskmatrix-e2e", worksiteId: "ws-e2e", matrixVersion: 1, title: "MIPER E2E",
    status: "published", methodologyId: "riskmethod-e2e", methodologySnapshot: {},
    revisionReason: "Fixture E2E para el mapa de riesgos espacial, mínimo diez caracteres.",
    participationSummary: "Participación de fixture E2E, mínimo diez caracteres.",
    consultationEvidenceReference: "Evidencia de fixture E2E",
    createdByUserId: "user-admin-e2e",
    reviewedByUserId: "user-admin-e2e", reviewedAt: now,
    approvedByUserId: "user-admin-e2e", approvedAt: now,
    publishedByUserId: "user-admin-e2e", publishedAt: now,
    version: 1, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionRiskEntries).values({
    id: "riskentry-e2e", matrixId: "riskmatrix-e2e", processId: "riskproc-e2e", taskId: "risktask-e2e", positionId: "riskpos-e2e",
    hazardCode: "HAZ-E2E", hazard: "Caída de altura E2E", riskFactor: "Trabajo en altura sin arnés",
    expectedEventOrDamage: "Caída con lesión", exposedPeopleDescription: "Operarios de mantención",
    exposedPeopleCount: 4, genderConsiderations: "Sin diferencias identificadas.",
    sensitiveWorkerConsiderations: "Sin trabajadores sensibles identificados.",
    inherentDimensions: { assessment: "alto" }, inherentLevel: "high",
    residualDimensions: { assessment: "moderado" }, residualLevel: "moderate",
    isCritical: false, responsibleSnapshot: "Admin E2E",
    version: 1, createdAt: now, updatedAt: now,
  })

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
