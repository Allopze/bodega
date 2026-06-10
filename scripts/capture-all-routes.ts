import fs from "node:fs"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import Database from "better-sqlite3"
import bcrypt from "bcryptjs"
import { chromium, type BrowserContext, type Page } from "@playwright/test"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "../db/schema"

const root = process.cwd()
const port = Number(process.env.CAPTURE_PORT ?? 3127)
const baseUrl = `http://127.0.0.1:${port}`
const dbPath = path.join(root, ".tmp", "route-screenshots.sqlite")
const outputDir = path.join(root, "audit", "screenshots", "2026-06-09-playwright")
const authSecret = "route-screenshot-audit-secret"

type RouteTarget = {
  slug: string
  path: string
  auth: boolean
  notes?: string
}

type CaptureResult = {
  viewport: string
  slug: string
  path: string
  requestedUrl: string
  finalUrl: string
  status: number | null
  ok: boolean
  screenshot: string
  error?: string
  notes?: string
}

const desktop = { name: "desktop", width: 1440, height: 1000 }
const mobile = { name: "mobile", width: 390, height: 844 }

const routes: RouteTarget[] = [
  { slug: "root", path: "/", auth: false },
  { slug: "login", path: "/login", auth: false },
  { slug: "registro", path: "/registro", auth: false },
  { slug: "not-found", path: "/ruta-inexistente-auditoria", auth: false },
  { slug: "dashboard", path: "/dashboard", auth: true },
  { slug: "app-not-found", path: "/app-ruta-inexistente-auditoria", auth: true },
  { slug: "solicitudes", path: "/solicitudes", auth: true },
  { slug: "solicitudes-nueva", path: "/solicitudes/nueva", auth: true },
  { slug: "solicitudes-detalle", path: "/solicitudes/req-audit-1", auth: true },
  { slug: "aprobaciones", path: "/aprobaciones", auth: true },
  { slug: "compras", path: "/compras", auth: true },
  { slug: "compras-nueva", path: "/compras/nueva", auth: true },
  { slug: "compras-detalle", path: "/compras/po-audit-1", auth: true },
  { slug: "compras-print", path: "/compras/po-audit-1/print", auth: true },
  { slug: "recepcion", path: "/recepcion", auth: true },
  { slug: "recepcion-nueva", path: "/recepcion/nueva?oc=po-audit-1", auth: true },
  { slug: "recepcion-detalle", path: "/recepcion/rec-audit-1", auth: true },
  { slug: "bodega", path: "/bodega", auth: true },
  { slug: "entregas", path: "/entregas", auth: true },
  { slug: "trazabilidad", path: "/trazabilidad", auth: true },
  { slug: "reportes", path: "/reportes", auth: true },
  { slug: "admin", path: "/admin", auth: true },
  { slug: "admin-auditoria", path: "/admin/auditoria", auth: true },
  { slug: "admin-configuracion", path: "/admin/configuracion", auth: true },
  { slug: "admin-faenas", path: "/admin/faenas", auth: true },
  { slug: "admin-productos", path: "/admin/productos", auth: true },
  { slug: "admin-productos-nuevo", path: "/admin/productos/nuevo", auth: true },
  { slug: "admin-productos-detalle", path: "/admin/productos/prod-audit-1", auth: true, notes: "Esta ruta redirige a /admin/productos." },
  { slug: "admin-proveedores", path: "/admin/proveedores", auth: true },
  { slug: "admin-trabajadores", path: "/admin/trabajadores", auth: true },
  { slug: "admin-usuarios", path: "/admin/usuarios", auth: true },
]

async function main() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.mkdirSync(outputDir, { recursive: true })
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${dbPath}${suffix}`
    if (fs.existsSync(file)) fs.rmSync(file)
  }

  await prepareDatabase()
  const server = await startServer()
  const browser = await chromium.launch()
  const results: CaptureResult[] = []

  try {
    for (const viewport of [desktop, mobile]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        locale: "es-CL",
      })

      for (const route of routes.filter((r) => !r.auth)) {
        results.push(await captureRoute(context, viewport.name, route))
      }

      await login(context)

      for (const route of routes.filter((r) => r.auth)) {
        results.push(await captureRoute(context, viewport.name, route))
      }

      await context.close()
    }
  } finally {
    await browser.close()
    await stopServer(server)
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    database: dbPath,
    outputDir,
    credentials: {
      email: "admin.audit@chome.cl",
      password: "chome2026",
    },
    routes,
    results,
  }
  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Screenshots written to ${outputDir}`)
  console.log(`Manifest written to ${path.join(outputDir, "manifest.json")}`)
}

async function prepareDatabase() {
  const sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(root, "db", "migrations") })

  const now = new Date("2026-06-09T12:00:00.000Z").toISOString()
  const password = await bcrypt.hash("chome2026", 10)
  const userId = "user-audit-admin"
  const worksiteId = "ws-audit-1"
  const supplierId = "sup-audit-1"
  const productId = "prod-audit-1"
  const requestId = "req-audit-1"
  const requestItemId = "req-item-audit-1"
  const orderId = "po-audit-1"
  const orderItemId = "po-item-audit-1"
  const receiptId = "rec-audit-1"
  const deliveryId = "del-audit-1"

  const permissions: (typeof schema.permissions.$inferInsert)[] = [
    { id: "p-req-create", name: "requests:create", module: "requests", description: "Crear solicitudes" },
    { id: "p-req-own", name: "requests:view_own", module: "requests", description: "Ver propias" },
    { id: "p-req-all", name: "requests:view_all", module: "requests", description: "Ver todas" },
    { id: "p-req-submit", name: "requests:submit", module: "requests", description: "Enviar solicitudes" },
    { id: "p-apr", name: "approvals:approve", module: "approvals", description: "Aprobar solicitudes" },
    { id: "p-pur-view", name: "purchasing:view", module: "purchasing", description: "Ver compras" },
    { id: "p-pur-create", name: "purchasing:create_order", module: "purchasing", description: "Crear OC" },
    { id: "p-pur-send", name: "purchasing:send_order", module: "purchasing", description: "Enviar OC" },
    { id: "p-pur-sup", name: "purchasing:manage_suppliers", module: "purchasing", description: "Gestionar proveedores" },
    { id: "p-rec-reg", name: "receiving:register", module: "receiving", description: "Registrar recepción" },
    { id: "p-rec-view", name: "receiving:view", module: "receiving", description: "Ver recepción" },
    { id: "p-wh-stock", name: "warehouse:view_stock", module: "warehouse", description: "Ver stock" },
    { id: "p-wh-mov", name: "warehouse:register_movement", module: "warehouse", description: "Registrar movimientos" },
    { id: "p-wh-adj", name: "warehouse:adjust_stock", module: "warehouse", description: "Ajustar stock" },
    { id: "p-rep-view", name: "reports:view", module: "reports", description: "Ver reportes" },
    { id: "p-adm-usr", name: "admin:users", module: "admin", description: "Gestionar usuarios" },
    { id: "p-adm-ws", name: "admin:worksites", module: "admin", description: "Gestionar faenas" },
    { id: "p-adm-wrk", name: "admin:workers", module: "admin", description: "Gestionar trabajadores" },
    { id: "p-adm-prod", name: "admin:products", module: "admin", description: "Gestionar catálogo" },
    { id: "p-adm-sup", name: "admin:suppliers", module: "admin", description: "Gestionar proveedores" },
    { id: "p-adm-cfg", name: "admin:config", module: "admin", description: "Configurar sistema" },
    { id: "p-adm-audit", name: "admin:audit_log", module: "admin", description: "Ver auditoría" },
  ]

  await db.insert(schema.roles).values({
    id: "rol-admin",
    name: "administrador",
    label: "Administrador",
    description: "Control total para auditoría visual",
  })
  await db.insert(schema.permissions).values(permissions)
  await db.insert(schema.rolePermissions).values(permissions.map((permission) => ({
    roleId: "rol-admin",
    permissionId: permission.id,
  })))
  await db.insert(schema.users).values({
    id: userId,
    name: "Admin Auditoría",
    email: "admin.audit@chome.cl",
    hashedPassword: password,
    avatarColor: "212",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.userRoles).values({ userId, roleId: "rol-admin" })

  await db.insert(schema.worksites).values([
    {
      id: worksiteId,
      name: "Faena Mininco",
      code: "MIN-001",
      address: "Ruta 5 Sur km 512",
      region: "Biobío",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ws-audit-2",
      name: "Faena Cabrero",
      code: "CAB-002",
      address: "Camino Industrial 210",
      region: "Biobío",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.worksiteUsers).values([
    { userId, worksiteId, isPrimary: true },
    { userId, worksiteId: "ws-audit-2", isPrimary: false },
  ])

  await db.insert(schema.suppliers).values([
    {
      id: supplierId,
      name: "TRECK Seguridad Industrial",
      rut: "76.123.456-7",
      contactName: "Camila Rojas",
      email: "ventas@treck.example",
      phone: "+56 9 8123 4567",
      address: "Av. Industrial 1400",
      paymentTerms: "30 días",
      isActive: true,
      notes: "Proveedor preferente EPP.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sup-audit-2",
      name: "APRO Suministros",
      rut: "77.222.333-4",
      paymentTerms: "Contado",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.productCategories).values([
    { id: "cat-audit-epp", name: "Elementos de protección personal", slug: "epp-audit", isEpp: true, requiresPrevencion: true, sortOrder: 1 },
    { id: "cat-audit-insumos", name: "Insumos operativos", slug: "insumos-audit", isEpp: false, requiresPrevencion: false, sortOrder: 2 },
  ])
  await db.insert(schema.products).values([
    {
      id: productId,
      sku: "EPP-AUD-001",
      name: "Guante anticorte nivel 5",
      description: "Guante EPP para cuadrilla de mantención.",
      categoryId: "cat-audit-epp",
      unitOfMeasure: "par",
      isEpp: true,
      requiresPrevencion: true,
      referencePrice: 12900,
      isActive: true,
      notes: "Requiere talla.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod-audit-2",
      sku: "INS-AUD-002",
      name: "Cinta reflectante 50 mm",
      categoryId: "cat-audit-insumos",
      unitOfMeasure: "rollo",
      referencePrice: 8300,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.productAttributes).values({
    id: "attr-audit-1",
    productId,
    name: "Talla",
    type: "select",
    isRequired: true,
    options: JSON.stringify(["S", "M", "L", "XL"]),
    sortOrder: 1,
  })
  await db.insert(schema.productSuppliers).values([
    { id: "prod-sup-audit-1", productId, supplierId, unitPrice: 11900, isPreferred: true, lastUpdated: now },
    { id: "prod-sup-audit-2", productId: "prod-audit-2", supplierId: "sup-audit-2", unitPrice: 7900, isPreferred: true, lastUpdated: now },
  ])

  await db.insert(schema.workers).values([
    { id: "worker-audit-1", rut: "18.111.222-3", firstName: "Daniela", lastName: "Fuentes", position: "Operadora", worksiteId, isActive: true, createdAt: now },
    { id: "worker-audit-2", rut: "17.444.555-6", firstName: "Marco", lastName: "Silva", position: "Mecánico", worksiteId, isActive: true, createdAt: now },
  ])

  await db.insert(schema.purchaseRequests).values({
    id: requestId,
    code: "SOL-2026-0001",
    worksiteId,
    requesterId: userId,
    requestType: "epp",
    urgency: "high",
    requiredDate: "2026-06-20",
    status: "submitted",
    submittedAt: now,
    notes: "Reposición para cuadrilla de mantención.",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values([
    {
      id: requestItemId,
      requestId,
      productId,
      quantity: 12,
      unitOfMeasure: "par",
      status: "approved",
      urgency: "high",
      requiredDate: "2026-06-20",
      workerId: "worker-audit-1",
      suggestedSupplierId: supplierId,
      sortOrder: 0,
      notes: "Talla L para turno día.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "req-item-audit-2",
      requestId,
      productId: "prod-audit-2",
      quantity: 4,
      unitOfMeasure: "rollo",
      status: "pending_purchase",
      urgency: "normal",
      requiredDate: "2026-06-20",
      suggestedSupplierId: "sup-audit-2",
      sortOrder: 1,
      notes: "Para demarcación temporal.",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.requestItemAttributes).values({
    id: "req-attr-audit-1",
    requestItemId,
    attributeId: "attr-audit-1",
    attributeName: "Talla",
    value: "L",
  })
  await db.insert(schema.approvalDecisions).values({
    id: "approval-audit-1",
    requestItemId,
    requestId,
    type: "approve",
    decidedBy: userId,
    decidedAt: now,
    reason: "Stock requerido para continuidad operacional.",
    roleContext: "administrador",
  })

  await db.insert(schema.purchaseOrders).values({
    id: orderId,
    code: "OC-2026-0001",
    worksiteId,
    supplierId,
    createdBy: userId,
    status: "sent",
    issuedAt: now,
    sentAt: now,
    estimatedDelivery: "2026-06-18",
    deliveryAddress: "Bodega central Mininco",
    paymentTerms: "30 días",
    netAmount: 142800,
    taxAmount: 27132,
    totalAmount: 169932,
    notes: "Compra auditada para capturas.",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: orderItemId,
    purchaseOrderId: orderId,
    requestItemId,
    productId,
    quantity: 12,
    unitOfMeasure: "par",
    unitPrice: 11900,
    discount: 0,
    subtotal: 142800,
    quantityReceived: 6,
    status: "partially_received",
    sortOrder: 0,
    notes: "Entrega parcial coordinada.",
  })

  await db.insert(schema.receipts).values({
    id: receiptId,
    code: "REC-2026-0001",
    purchaseOrderId: orderId,
    receivedBy: userId,
    receivedAt: now,
    locationType: "faena",
    worksiteId,
    dispatchGuideNo: "GD-88231",
    status: "open",
    notes: "Recepción parcial sin rechazo.",
    createdAt: now,
  })
  await db.insert(schema.receiptItems).values({
    id: "rec-item-audit-1",
    receiptId,
    purchaseOrderItemId: orderItemId,
    quantityReceived: 6,
    quantityRejected: 0,
    quantityDamaged: 0,
    status: "partially_received",
    notes: "Saldo pendiente proveedor.",
  })

  await db.insert(schema.worksiteStock).values({
    id: "stock-audit-1",
    worksiteId,
    productId,
    quantity: 6,
    minStock: 10,
    lastMovementAt: now,
    updatedAt: now,
  })
  await db.insert(schema.inventoryMovements).values({
    id: "mov-audit-1",
    worksiteId,
    productId,
    type: "receipt",
    quantity: 6,
    referenceType: "receipt",
    referenceId: receiptId,
    stockBefore: 0,
    stockAfter: 6,
    performedBy: userId,
    performedAt: now,
    reason: "Recepción parcial OC-2026-0001",
  })

  await db.insert(schema.deliveries).values({
    id: deliveryId,
    code: "ENT-2026-0001",
    deliveredBy: userId,
    deliveredAt: now,
    destinationType: "worker",
    worksiteId,
    workerId: "worker-audit-1",
    receiverName: "Daniela Fuentes",
    notes: "Entrega parcial a trabajador.",
    createdAt: now,
  })
  await db.insert(schema.deliveryItems).values({
    id: "del-item-audit-1",
    deliveryId,
    requestItemId,
    productId,
    quantity: 2,
    unitOfMeasure: "par",
    notes: "Entrega inicial.",
  })

  await db.insert(schema.attachments).values({
    id: "att-audit-1",
    entityType: "purchase_order",
    entityId: orderId,
    fileName: "factura-oc-2026-0001.pdf",
    filePath: "/uploads/factura-oc-2026-0001.pdf",
    fileSize: 348120,
    mimeType: "application/pdf",
    uploadedBy: userId,
    uploadedAt: now,
  })
  await db.insert(schema.auditLog).values([
    {
      id: "audit-audit-1",
      userId,
      userEmail: "admin.audit@chome.cl",
      action: "create",
      entityType: "purchase_request",
      entityId: requestId,
      entityCode: "SOL-2026-0001",
      newState: JSON.stringify({ status: "submitted" }),
      createdAt: now,
    },
    {
      id: "audit-audit-2",
      userId,
      userEmail: "admin.audit@chome.cl",
      action: "status_change",
      entityType: "purchase_order",
      entityId: orderId,
      entityCode: "OC-2026-0001",
      oldState: JSON.stringify({ status: "issued" }),
      newState: JSON.stringify({ status: "sent" }),
      createdAt: now,
    },
  ])
  await db.insert(schema.notifications).values({
    id: "noti-audit-1",
    userId,
    type: "request_submitted",
    title: "Nueva solicitud: SOL-2026-0001",
    body: "Admin Auditoría envió una solicitud con 2 ítems",
    entityType: "purchase_request",
    entityId: requestId,
    entityHref: `/solicitudes/${requestId}`,
    isRead: false,
    createdAt: now,
  })
  await db.insert(schema.systemSettings).values([
    { key: "company_name", value: "Chome", updatedAt: now },
    { key: "purchase_order_footer", value: "Documento generado para auditoría visual.", updatedAt: now },
  ])

  sqlite.close()
}

async function startServer() {
  const env = {
    ...process.env,
    DATABASE_URL: dbPath,
    AUTH_SECRET: authSecret,
    NEXTAUTH_SECRET: authSecret,
    PORT: String(port),
  }
  const server = spawn(path.join(root, "node_modules", ".bin", "next"), ["start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })

  server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`))
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`))

  await waitForServer(server)
  return server
}

async function waitForServer(server: ChildProcess) {
  const deadline = Date.now() + 120_000
  let lastError = ""
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next server exited early with code ${server.exitCode}`)
    }
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" })
      if (response.status < 500) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Next server did not become ready: ${lastError}`)
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return
  server.kill("SIGTERM")
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL")
      resolve()
    }, 5000)
    server.once("exit", () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function login(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" })
  await page.getByLabel("Correo electrónico").fill("admin.audit@chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  await page.close()
}

async function captureRoute(context: BrowserContext, viewport: string, route: RouteTarget): Promise<CaptureResult> {
  const page = await context.newPage()
  const requestedUrl = `${baseUrl}${route.path}`
  const relativeScreenshot = path.join("audit", "screenshots", "2026-06-09-playwright", `${viewport}-${route.slug}.png`)
  const screenshot = path.join(root, relativeScreenshot)

  try {
    const response = await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
    await settle(page)
    await page.screenshot({ path: screenshot, fullPage: true })
    const status = response?.status() ?? null
    const finalUrl = page.url()
    await page.close()
    return {
      viewport,
      slug: route.slug,
      path: route.path,
      requestedUrl,
      finalUrl,
      status,
      ok: !status || status < 400,
      screenshot: relativeScreenshot,
      notes: route.notes,
    }
  } catch (error) {
    try {
      await page.screenshot({ path: screenshot, fullPage: true })
    } catch {
      // Ignore secondary screenshot failure.
    }
    const finalUrl = page.url()
    await page.close()
    return {
      viewport,
      slug: route.slug,
      path: route.path,
      requestedUrl,
      finalUrl,
      status: null,
      ok: false,
      screenshot: relativeScreenshot,
      error: error instanceof Error ? error.message : String(error),
      notes: route.notes,
    }
  }
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined)
  await page.waitForTimeout(500)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
