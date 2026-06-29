import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import postgres from "postgres"
import bcrypt from "bcryptjs"
import { chromium, type BrowserContext, type Page } from "@playwright/test"
import { loadEnvConfig } from "@next/env"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { sql } from "drizzle-orm"
import * as schema from "../db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  getRedactedDatabaseIdentifier,
  quotePostgresIdentifier,
} from "../lib/testing/destructive-database-guard"

loadEnvConfig(process.cwd())

const root = process.cwd()
const port = Number(process.env.CAPTURE_PORT ?? 3127)
const baseUrl = `http://127.0.0.1:${port}`
const outputDir = path.join(root, "audit", "screenshots", "2026-06-09-playwright")
const authSecret = "route-screenshot-audit-secret"

export type RouteTarget = {
  slug: string
  path: string
  auth: boolean
  expectedStatus?: number
  notes?: string
}

export type CaptureSeedArea = {
  section: string
  fixtures: string[]
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

function requireCaptureDatabaseUrl() {
  const databaseUrl = process.env.CAPTURE_DATABASE_URL
  if (!databaseUrl) throw new Error("CAPTURE_DATABASE_URL is required")
  return databaseUrl
}

const desktop = { name: "desktop", width: 1440, height: 1000 }
const mobile = { name: "mobile", width: 390, height: 844 }

const routeTargets: RouteTarget[] = [
  { slug: "root", path: "/", auth: false },
  { slug: "login", path: "/login", auth: false },
  { slug: "registro", path: "/registro", auth: false },
  { slug: "recuperar", path: "/recuperar", auth: false },
  { slug: "recuperar-token", path: "/recuperar/capture-reset-token", auth: false },
  { slug: "not-found", path: "/ruta-inexistente-auditoria", auth: true, expectedStatus: 404 },
  { slug: "dashboard", path: "/dashboard", auth: true },
  { slug: "perfil", path: "/perfil", auth: true },
  { slug: "app-not-found", path: "/app-ruta-inexistente-auditoria", auth: true, expectedStatus: 404 },
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
  { slug: "trazabilidad-detalle", path: "/trazabilidad/req-item-audit-1", auth: true },
  { slug: "reportes", path: "/reportes", auth: true },
  { slug: "analitica", path: "/analitica", auth: true },
  { slug: "flota", path: "/flota", auth: true },
  { slug: "flota-detalle", path: "/flota/fuel-veh-audit-1", auth: true },
  { slug: "mantenciones", path: "/mantenciones", auth: true },
  // ── Combustibles ──────────────────────────────────────────────────────
  { slug: "combustibles", path: "/combustibles", auth: true },
  { slug: "combustibles-nueva", path: "/combustibles/nueva", auth: true },
  { slug: "combustibles-detalle", path: "/combustibles/fuel-audit-1", auth: true },
  { slug: "combustibles-reportes", path: "/combustibles/reportes", auth: true },
  { slug: "combustibles-vehiculos", path: "/combustibles/vehiculos", auth: true },
  { slug: "combustibles-proveedores", path: "/combustibles/proveedores-combustible", auth: true },
  { slug: "combustibles-cuenta-corriente", path: "/combustibles/cuenta-corriente", auth: true },
  { slug: "combustibles-cc-detalle", path: "/combustibles/cuenta-corriente/cc-audit-1", auth: true },
  { slug: "repuestos", path: "/repuestos", auth: true },
  { slug: "repuestos-nueva", path: "/repuestos/nueva", auth: true },
  { slug: "repuestos-detalle", path: "/repuestos/rep-audit-1", auth: true },
  { slug: "servicios", path: "/servicios", auth: true },
  { slug: "servicios-nueva", path: "/servicios/nueva", auth: true },
  { slug: "servicios-detalle", path: "/servicios/srv-audit-1", auth: true },
  { slug: "prevencion", path: "/prevencion", auth: true },
  { slug: "prevencion-nueva", path: "/prevencion/nueva", auth: true },
  { slug: "prevencion-detalle", path: "/prevencion/sst-audit-1", auth: true },
  { slug: "prevencion-trabajador-detalle", path: "/prevencion/trabajador/worker-audit-1", auth: true },
  { slug: "sst-print", path: "/sst/sst-audit-1/print", auth: true },
  { slug: "ppa-form", path: "/ppa", auth: false },
  { slug: "ppa-result", path: "/ppa/result/capture-ppa-token", auth: false },
  { slug: "prevencion-ppa", path: "/prevencion/ppa", auth: true },
  { slug: "prevencion-ppa-detalle", path: "/prevencion/ppa/ppa-audit-1", auth: true },
  { slug: "admin", path: "/admin", auth: true },
  { slug: "admin-auditoria", path: "/admin/auditoria", auth: true },
  { slug: "admin-configuracion", path: "/admin/configuracion", auth: true },
  { slug: "admin-correo-smtp", path: "/admin/correo-smtp", auth: true },
  { slug: "admin-faenas", path: "/admin/faenas", auth: true },
  { slug: "admin-plantillas", path: "/admin/plantillas", auth: true },
  { slug: "admin-productos", path: "/admin/productos", auth: true },
  { slug: "admin-productos-nuevo", path: "/admin/productos/nuevo", auth: true },
  { slug: "admin-productos-detalle", path: "/admin/productos/prod-audit-1", auth: true, notes: "Esta ruta redirige a /admin/productos." },
  { slug: "admin-proveedores", path: "/admin/proveedores", auth: true },
  { slug: "admin-trabajadores", path: "/admin/trabajadores", auth: true },
  { slug: "admin-usuarios", path: "/admin/usuarios", auth: true },
  { slug: "forbidden", path: "/forbidden", auth: true },
  { slug: "soporte", path: "/soporte", auth: true },
  { slug: "soporte-nuevo", path: "/soporte/nuevo", auth: true },
  { slug: "soporte-detalle", path: "/soporte/sop-audit-1", auth: true },
]

const seedCoverage: CaptureSeedArea[] = [
  { section: "dashboard", fixtures: ["tareas pendientes", "métricas por faena", "actividad reciente"] },
  { section: "solicitudes", fixtures: ["solicitud EPP enviada", "solicitud pendiente de aprobación", "solicitud recibida para entrega"] },
  { section: "aprobaciones", fixtures: ["ítems requested en cola de aprobación"] },
  { section: "compras", fixtures: ["OC enviada", "OC recibida parcialmente", "factura asociada", "ítems aprobados sin OC"] },
  { section: "recepcion", fixtures: ["OC pendiente de recepción", "OC con brecha oficina-faena"] },
  { section: "bodega", fixtures: ["stock con mínimo crítico", "kardex ingreso OC", "kardex entrega a trabajador"] },
  { section: "entregas", fixtures: ["trabajadores activos", "EPP recibido pendiente de entrega", "historial de entregas"] },
  { section: "trazabilidad", fixtures: ["ítems aprobados", "ítems en OC", "ítems recibidos", "alerta sin OC"] },
  { section: "reportes", fixtures: ["solicitudes", "ítems", "OC", "recepciones", "estados variados"] },
  { section: "analitica", fixtures: ["compras", "combustible", "flota", "stock crítico", "EPP"] },
  { section: "flota", fixtures: ["vehículos activos", "cargas de combustible", "mantenciones"] },
  { section: "mantenciones", fixtures: ["vehículos", "proveedores", "mantenciones registradas"] },
  { section: "combustibles", fixtures: ["cargas de combustible", "vehículos de combustible", "proveedores de combustible", "cuentas corrientes", "reportes mensuales"] },
  { section: "repuestos", fixtures: ["solicitud de repuestos", "ítem libre", "cotización pendiente"] },
  { section: "servicios", fixtures: ["solicitud de servicios", "ítem libre", "cotización pendiente"] },
  { section: "prevencion", fixtures: ["evaluación nueva", "evaluación seguimiento", "plan de acción"] },
  { section: "admin-faenas", fixtures: ["faenas activas"] },
  { section: "admin-plantillas", fixtures: ["plantillas de correo del sistema"] },
  { section: "admin-productos", fixtures: ["categorías", "productos EPP", "productos insumo", "proveedores preferidos"] },
  { section: "admin-proveedores", fixtures: ["proveedores activos con contacto"] },
  { section: "admin-trabajadores", fixtures: ["trabajadores por faena"] },
  { section: "admin-usuarios", fixtures: ["usuarios con roles y faenas"] },
  { section: "admin-auditoria", fixtures: ["eventos create", "status_change", "update"] },
  { section: "admin-configuracion", fixtures: ["datos empresa", "pie OC", "límite PDF"] },
  { section: "notificaciones", fixtures: ["notificación no leída", "notificación leída"] },
  { section: "soporte", fixtures: ["reporte de soporte abierto", "reporte resuelto"] },
]

export function getCaptureRoutes() {
  return routeTargets.map((route) => ({ ...route }))
}

export function getCaptureSeedCoverage() {
  return seedCoverage.map((area) => ({ ...area, fixtures: [...area.fixtures] }))
}

async function main() {
  const captureDbUrl = requireCaptureDatabaseUrl()
  const routes = getCaptureRoutes()
  fs.mkdirSync(outputDir, { recursive: true })

  await prepareDatabase(captureDbUrl)
  const server = await startServer(captureDbUrl)
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
    database: getRedactedDatabaseIdentifier(captureDbUrl),
    outputDir,
    credentials: {
      email: "admin.audit@chome.cl",
      password: "chome2026",
    },
    seedCoverage,
    routes,
    results,
  }
  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Screenshots written to ${outputDir}`)
  console.log(`Manifest written to ${path.join(outputDir, "manifest.json")}`)
}

async function prepareDatabase(captureDbUrl: string) {
  assertSafeDestructiveDatabase({
    databaseUrl: captureDbUrl,
    allowDestructiveReset: process.env.CAPTURE_ALLOW_DESTRUCTIVE_RESET === "true",
    context: "CAPTURE",
  })
  await ensureDatabaseExists(captureDbUrl)

  // Reset Postgres schema and re-run migrations for a clean state
  const setupClient = postgres(captureDbUrl, { max: 1 })
  const setupDb = drizzle(setupClient)
  await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
  await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
  await setupDb.execute(sql`CREATE SCHEMA public`)
  await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  await setupClient.end()

  const migrationClient = postgres(captureDbUrl, { max: 1 })
  await migrate(drizzle(migrationClient), { migrationsFolder: path.join(root, "db", "migrations") })
  await migrationClient.end()

  const pgClient = postgres(captureDbUrl, { max: 1 })
  const db = drizzle(pgClient, { schema })

  const now = new Date("2026-06-09T12:00:00.000Z").toISOString()
  const password = await bcrypt.hash("chome2026", 10)
  const userId = "user-audit-admin"
  const worksiteId = "ws-audit-1"
  const supplierId = "sup-audit-1"
  const productId = "prod-audit-1"
  const deliverableProductId = "prod-audit-3"
  const requestId = "req-audit-1"
  const requestItemId = "req-item-audit-1"
  const pendingRequestId = "req-audit-approval"
  const pendingRequestItemId = "req-item-audit-approval"
  const deliveryRequestId = "req-audit-delivery"
  const deliverableRequestItemId = "req-item-audit-deliverable"
  const orderId = "po-audit-1"
  const orderItemId = "po-item-audit-1"
  const officeOrderId = "po-audit-2"
  const officeOrderItemId = "po-item-audit-2"
  const receiptId = "rec-audit-1"
  const officeReceiptId = "rec-audit-office"
  const deliveryId = "del-audit-1"
  const repuestoRequestId = "rep-audit-1"
  const repuestoItemId = "rep-item-audit-1"
  const serviceRequestId = "srv-audit-1"
  const serviceItemId = "srv-item-audit-1"
  const resetToken = "capture-reset-token"
  const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex")

  const permissions: (typeof schema.permissions.$inferInsert)[] = [
    { id: "p-req-create", name: "requests:create", module: "requests", description: "Crear solicitudes" },
    { id: "p-req-own", name: "requests:view_own", module: "requests", description: "Ver propias" },
    { id: "p-req-all", name: "requests:view_all", module: "requests", description: "Ver todas" },
    { id: "p-req-submit", name: "requests:submit", module: "requests", description: "Enviar solicitudes" },
    { id: "p-apr", name: "approvals:approve", module: "approvals", description: "Aprobar solicitudes" },
    { id: "p-pur-view", name: "purchasing:view", module: "purchasing", description: "Ver órdenes de compra" },
    { id: "p-pur-create", name: "purchasing:create_order", module: "purchasing", description: "Crear OC" },
    { id: "p-pur-send", name: "purchasing:send_order", module: "purchasing", description: "Enviar OC" },
    { id: "p-pur-sup", name: "purchasing:manage_suppliers", module: "purchasing", description: "Gestionar proveedores" },
    { id: "p-rec-reg", name: "receiving:register", module: "receiving", description: "Registrar recepción" },
    { id: "p-rec-office", name: "receiving:register_office", module: "receiving", description: "Registrar recepción en oficina" },
    { id: "p-rec-faena", name: "receiving:register_faena", module: "receiving", description: "Registrar recepción en faena" },
    { id: "p-rec-view", name: "receiving:view", module: "receiving", description: "Ver recepción" },
    { id: "p-wh-stock", name: "warehouse:view_stock", module: "warehouse", description: "Ver stock" },
    { id: "p-wh-mov", name: "warehouse:register_movement", module: "warehouse", description: "Registrar movimientos" },
    { id: "p-wh-adj", name: "warehouse:adjust_stock", module: "warehouse", description: "Ajustar stock" },
    { id: "p-rep-view", name: "reports:view", module: "reports", description: "Ver reportes" },
    { id: "p-ana-view", name: "analytics:view", module: "analytics", description: "Ver analítica transversal" },
    { id: "p-ana-export", name: "analytics:export", module: "analytics", description: "Exportar analítica transversal" },
    { id: "p-flot-view", name: "flota:view", module: "flota", description: "Ver flota de vehículos" },
    { id: "p-mant-view", name: "mantenciones:view", module: "mantenciones", description: "Ver mantenciones de vehículos" },
    { id: "p-mant-create", name: "mantenciones:create", module: "mantenciones", description: "Registrar mantenciones de vehículos" },
    { id: "p-mant-edit", name: "mantenciones:edit", module: "mantenciones", description: "Editar mantenciones" },
    // ── Combustibles ───────────────────────────────────────────────────
    { id: "p-fuel-view", name: "combustibles:view", module: "combustibles", description: "Ver registros de combustible" },
    { id: "p-fuel-create", name: "combustibles:create", module: "combustibles", description: "Crear registros de combustible" },
    { id: "p-fuel-delete", name: "combustibles:delete", module: "combustibles", description: "Eliminar registros de combustible" },
    { id: "p-fuel-import", name: "combustibles:import", module: "combustibles", description: "Importar datos de combustible" },
    { id: "p-fuel-export", name: "combustibles:export", module: "combustibles", description: "Exportar datos de combustible" },
    { id: "p-fuel-veh", name: "combustibles:manage_vehicles", module: "combustibles", description: "Gestionar vehículos de combustible" },
    { id: "p-fuel-sup", name: "combustibles:manage_suppliers", module: "combustibles", description: "Gestionar proveedores de combustible" },
    // ── PPA ────────────────────────────────────────────────────────────
    { id: "p-ppa-view", name: "ppa:view", module: "ppa", description: "Ver PPA Digital" },
    { id: "p-ppa-review", name: "ppa:review", module: "ppa", description: "Revisar PPA" },
    { id: "p-ppa-manage", name: "ppa:manage", module: "ppa", description: "Gestionar PPA" },
    // ── Feedback / Soporte ────────────────────────────────────────────
    { id: "p-fb-create", name: "feedback:create", module: "feedback", description: "Crear reportes de soporte" },
    { id: "p-fb-own", name: "feedback:view_own", module: "feedback", description: "Ver reportes propios" },
    { id: "p-fb-all", name: "feedback:view_all", module: "feedback", description: "Ver todos los reportes" },
    { id: "p-fb-manage", name: "feedback:manage", module: "feedback", description: "Gestionar reportes de soporte" },
    { id: "p-adm-usr", name: "admin:users", module: "admin", description: "Gestionar usuarios" },
    { id: "p-adm-ws", name: "admin:worksites", module: "admin", description: "Gestionar faenas" },
    { id: "p-adm-wrk", name: "admin:workers", module: "admin", description: "Gestionar trabajadores" },
    { id: "p-adm-prod", name: "admin:products", module: "admin", description: "Gestionar catálogo" },
    { id: "p-adm-sup", name: "admin:suppliers", module: "admin", description: "Gestionar proveedores" },
    { id: "p-adm-cfg", name: "admin:config", module: "admin", description: "Configurar sistema" },
    { id: "p-adm-audit", name: "admin:audit_log", module: "admin", description: "Ver auditoría" },
    { id: "p-adm-smtp", name: "admin:smtp", module: "admin", description: "Configurar SMTP" },
    { id: "p-adm-tpl", name: "admin:email_templates", module: "admin", description: "Gestionar plantillas de correo" },
    { id: "p-del-view", name: "deliveries:view", module: "deliveries", description: "Ver entregas" },
    { id: "p-trz-view", name: "traceability:view", module: "traceability", description: "Ver trazabilidad" },
    { id: "p-rep-create", name: "repuestos:create", module: "repuestos", description: "Crear solicitudes de repuestos" },
    { id: "p-rep-own", name: "repuestos:view_own", module: "repuestos", description: "Ver repuestos propios" },
    { id: "p-rep-all", name: "repuestos:view_all", module: "repuestos", description: "Ver todos los repuestos" },
    { id: "p-rep-submit", name: "repuestos:submit", module: "repuestos", description: "Enviar repuestos" },
    { id: "p-rep-approve", name: "repuestos:approve", module: "repuestos", description: "Aprobar cotizaciones de repuestos" },
    { id: "p-srv-create", name: "servicios:create", module: "servicios", description: "Crear solicitudes de servicios" },
    { id: "p-srv-own", name: "servicios:view_own", module: "servicios", description: "Ver servicios propios" },
    { id: "p-srv-all", name: "servicios:view_all", module: "servicios", description: "Ver todos los servicios" },
    { id: "p-srv-submit", name: "servicios:submit", module: "servicios", description: "Enviar servicios" },
    { id: "p-srv-approve", name: "servicios:approve", module: "servicios", description: "Aprobar cotizaciones de servicios" },
    { id: "p-sst-view", name: "sst:view", module: "sst", description: "Ver evaluaciones SST" },
    { id: "p-sst-create", name: "sst:create", module: "sst", description: "Crear evaluaciones SST" },
    { id: "p-sst-close", name: "sst:close", module: "sst", description: "Cerrar evaluaciones SST" },
    { id: "p-sst-manage", name: "sst:manage", module: "sst", description: "Gestionar plan de acción SST" },
  ]

  const roles: (typeof schema.roles.$inferInsert)[] = [
    { id: "rol-admin", name: "administrador", label: "Administrador", description: "Control total para auditoría visual" },
    { id: "rol-jefa", name: "jefa_chome", label: "Jefatura Chome", description: "Aprueba solicitudes y coordina compras" },
    { id: "rol-prevencion", name: "prevencionista_faena", label: "Prevencionista faena", description: "Solicita EPP y servicios desde faena" },
    { id: "rol-bodega", name: "bodega", label: "Encargado bodega", description: "Gestiona recepción, stock y entregas" },
    { id: "rol-secretaria", name: "secretaria", label: "Secretaría", description: "Apoya compras y documentación" },
  ]

  await db.insert(schema.roles).values(roles)
  await db.insert(schema.permissions).values(permissions)
  const permissionIdByName = Object.fromEntries(permissions.map((permission) => [permission.name, permission.id]))
  const rolePermissionNames: Record<string, string[]> = {
    "rol-admin": permissions.map((permission) => permission.name),
    "rol-jefa": ["requests:view_all", "approvals:approve", "purchasing:view", "purchasing:create_order", "purchasing:send_order", "receiving:view", "reports:view", "analytics:view", "analytics:export", "flota:view", "mantenciones:view", "mantenciones:create", "repuestos:view_all", "repuestos:approve", "servicios:view_all", "servicios:approve"],
    "rol-prevencion": ["requests:create", "requests:view_own", "requests:submit", "repuestos:create", "repuestos:view_own", "repuestos:submit", "servicios:create", "servicios:view_own", "servicios:submit", "sst:view", "sst:create", "sst:close", "sst:manage"],
    "rol-bodega": ["receiving:view", "receiving:register", "receiving:register_office", "receiving:register_faena", "warehouse:view_stock", "warehouse:register_movement", "warehouse:adjust_stock", "reports:view"],
    "rol-secretaria": ["purchasing:view", "purchasing:create_order", "purchasing:send_order", "purchasing:manage_suppliers", "reports:view", "analytics:view", "analytics:export"],
  }

  await db.insert(schema.rolePermissions).values(Object.entries(rolePermissionNames).flatMap(([roleId, names]) =>
    names.map((name) => ({
      roleId,
      permissionId: permissionIdByName[name]!,
    })),
  ))
  await db.insert(schema.users).values([
    {
      id: userId,
      name: "Admin Auditoría",
      email: "admin.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "212",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user-audit-jefa",
      name: "Jefa Operaciones",
      email: "jefa.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "142",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user-audit-prevencion",
      name: "Prevencionista Faena",
      email: "prevencion.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "36",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user-audit-bodega",
      name: "Encargado Bodega",
      email: "bodega.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "260",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user-audit-inactive",
      name: "Usuario Inactivo",
      email: "inactivo.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "18",
      isActive: false,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.passwordResetTokens).values({
    id: "reset-token-audit-1",
    userId,
    tokenHash: resetTokenHash,
    expiresAt: "2030-01-01T00:00:00.000Z",
    createdAt: now,
  })
  await db.insert(schema.userRoles).values([
    { userId, roleId: "rol-admin" },
    { userId: "user-audit-jefa", roleId: "rol-jefa" },
    { userId: "user-audit-prevencion", roleId: "rol-prevencion" },
    { userId: "user-audit-bodega", roleId: "rol-bodega" },
    { userId: "user-audit-inactive", roleId: "rol-secretaria" },
  ])

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
    { userId: "user-audit-jefa", worksiteId, isPrimary: true },
    { userId: "user-audit-prevencion", worksiteId, isPrimary: true },
    { userId: "user-audit-bodega", worksiteId, isPrimary: true },
    { userId: "user-audit-inactive", worksiteId: "ws-audit-2", isPrimary: true },
  ])

  await db.insert(schema.suppliers).values([
    {
      id: supplierId,
      name: "TRECK Seguridad Industrial",
      rut: "76.123.456-7",
      businessActivity: "Venta de EPP e insumos industriales",
      contactName: "Camila Rojas",
      email: "ventas@treck.example",
      phone: "+56 9 8123 4567",
      address: "Av. Industrial 1400",
      commune: "Los Ángeles",
      city: "Los Ángeles",
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
      businessActivity: "Servicios y suministros operativos",
      contactName: "Rodrigo Vera",
      email: "contacto@apro.example",
      phone: "+56 9 7444 1234",
      address: "Camino a Cabrero 210",
      commune: "Cabrero",
      city: "Cabrero",
      paymentTerms: "Contado",
      isActive: true,
      notes: "Proveedor para servicios y mantención.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sup-audit-3",
      name: "Sur Repuestos Maquinaria",
      rut: "78.555.111-2",
      businessActivity: "Repuestos para maquinaria pesada",
      contactName: "Natalia Pérez",
      email: "cotizaciones@sur-repuestos.example",
      phone: "+56 9 6555 8888",
      address: "Parque Industrial 88",
      commune: "Concepción",
      city: "Concepción",
      paymentTerms: "45 días",
      isActive: true,
      notes: "Cotiza repuestos críticos.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.productCategories).values([
    { id: "cat-audit-epp", name: "Elementos de protección personal", slug: "epp-audit", isEpp: true, requiresPrevencion: true, sortOrder: 1 },
    { id: "cat-audit-insumos", name: "Insumos operativos", slug: "insumos-audit", isEpp: false, requiresPrevencion: false, sortOrder: 2 },
    { id: "cat-audit-repuestos", name: "Repuestos maquinaria", slug: "repuestos-audit", isEpp: false, requiresPrevencion: false, sortOrder: 3 },
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
    {
      id: deliverableProductId,
      sku: "EPP-AUD-003",
      name: "Casco dieléctrico con barbiquejo",
      description: "Casco EPP para entrega nominal a trabajador.",
      categoryId: "cat-audit-epp",
      unitOfMeasure: "unidad",
      isEpp: true,
      requiresPrevencion: true,
      referencePrice: 22900,
      isActive: true,
      notes: "Usado para capturas de entregas.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod-audit-4",
      sku: "REP-AUD-004",
      name: "Filtro hidráulico FH-9001",
      description: "Repuesto catalogado para maquinaria pesada.",
      categoryId: "cat-audit-repuestos",
      unitOfMeasure: "unidad",
      isEpp: false,
      requiresPrevencion: false,
      referencePrice: 122500,
      isActive: true,
      notes: "Alternativa catalogada para repuestos.",
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
    { id: "prod-sup-audit-3", productId: deliverableProductId, supplierId, unitPrice: 20500, isPreferred: true, lastUpdated: now },
    { id: "prod-sup-audit-4", productId: "prod-audit-4", supplierId: "sup-audit-3", unitPrice: 118000, isPreferred: true, lastUpdated: now },
  ])

  await db.insert(schema.workers).values([
    { id: "worker-audit-1", rut: "18.111.222-3", firstName: "Daniela", lastName: "Fuentes", position: "Operadora", worksiteId, isActive: true, createdAt: now },
    { id: "worker-audit-2", rut: "17.444.555-6", firstName: "Marco", lastName: "Silva", position: "Mecánico", worksiteId, isActive: true, createdAt: now },
    { id: "worker-audit-3", rut: "16.777.888-9", firstName: "Paula", lastName: "Mella", position: "Supervisora", worksiteId: "ws-audit-2", isActive: true, createdAt: now },
  ])

  await db.insert(schema.purchaseRequests).values([
    {
      id: requestId,
      code: "SOL-2026-0001",
      worksiteId,
      requesterId: "user-audit-prevencion",
      requestType: "epp",
      urgency: "high",
      requiredDate: "2026-06-20",
      status: "submitted",
      submittedAt: now,
      notes: "Reposición para cuadrilla de mantención.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: pendingRequestId,
      code: "SOL-2026-0002",
      worksiteId,
      requesterId: "user-audit-prevencion",
      requestType: "otro",
      urgency: "critical",
      requiredDate: "2026-06-19",
      status: "submitted",
      submittedAt: now,
      notes: "Solicitud urgente para mostrar cola de aprobaciones.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: deliveryRequestId,
      code: "SOL-2026-0003",
      worksiteId,
      requesterId: "user-audit-prevencion",
      requestType: "epp",
      urgency: "normal",
      requiredDate: "2026-06-21",
      status: "closed",
      submittedAt: now,
      closedAt: now,
      notes: "Solicitud recibida para capturas de entrega nominal.",
      createdAt: now,
      updatedAt: now,
    },
  ])
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
    {
      id: pendingRequestItemId,
      requestId: pendingRequestId,
      productId: "prod-audit-2",
      quantity: 8,
      unitOfMeasure: "rollo",
      status: "requested",
      urgency: "critical",
      requiredDate: "2026-06-19",
      suggestedSupplierId: "sup-audit-2",
      sortOrder: 0,
      notes: "Pendiente para panel de aprobaciones.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: deliverableRequestItemId,
      requestId: deliveryRequestId,
      productId: deliverableProductId,
      quantity: 5,
      unitOfMeasure: "unidad",
      status: "partially_delivered",
      urgency: "normal",
      requiredDate: "2026-06-21",
      workerId: "worker-audit-2",
      suggestedSupplierId: supplierId,
      sortOrder: 0,
      notes: "EPP disponible para entrega a trabajador.",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.requestItemAttributes).values([
    {
      id: "req-attr-audit-1",
      requestItemId,
      attributeId: "attr-audit-1",
      attributeName: "Talla",
      value: "L",
    },
    {
      id: "req-attr-audit-2",
      requestItemId: deliverableRequestItemId,
      attributeId: "attr-audit-1",
      attributeName: "Talla",
      value: "M",
    },
  ])
  await db.insert(schema.approvalDecisions).values([
    {
      id: "approval-audit-1",
      requestItemId,
      requestId,
      type: "approve",
      decidedBy: "user-audit-jefa",
      decidedAt: now,
      reason: "Stock requerido para continuidad operacional.",
      roleContext: "jefa_chome",
    },
    {
      id: "approval-audit-2",
      requestItemId: deliverableRequestItemId,
      requestId: deliveryRequestId,
      type: "approve",
      decidedBy: "user-audit-jefa",
      decidedAt: now,
      reason: "EPP aprobado para entrega nominal.",
      roleContext: "jefa_chome",
    },
  ])

  await db.insert(schema.purchaseRequests).values([
    {
      id: repuestoRequestId,
      code: "REP-2026-0001",
      worksiteId,
      requesterId: userId,
      requestType: "repuestos",
      urgency: "normal",
      requiredDate: "2026-06-24",
      status: "submitted",
      submittedAt: now,
      notes: "Proveedor único disponible para el repuesto crítico.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: serviceRequestId,
      code: "SRV-2026-0001",
      worksiteId,
      requesterId: userId,
      requestType: "servicios",
      urgency: "high",
      requiredDate: "2026-06-25",
      status: "submitted",
      submittedAt: now,
      notes: "Servicio técnico programado con disponibilidad limitada.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.purchaseRequestItems).values([
    {
      id: repuestoItemId,
      requestId: repuestoRequestId,
      productNameFree: "Filtro hidráulico principal",
      quantity: 2,
      unitOfMeasure: "unidad",
      status: "requested",
      urgency: "normal",
      requiredDate: "2026-06-24",
      supplierHint: "TRECK Seguridad Industrial",
      sortOrder: 0,
      notes: "Compatible con equipo de mantención.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: serviceItemId,
      requestId: serviceRequestId,
      productNameFree: "Mantención preventiva de generador",
      quantity: 1,
      unitOfMeasure: "servicio",
      status: "requested",
      urgency: "high",
      requiredDate: "2026-06-25",
      supplierHint: "APRO Suministros",
      sortOrder: 0,
      notes: "Coordinar acceso con jefe de faena.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.requestItemAttributes).values([
    { id: "rep-attr-part", requestItemId: repuestoItemId, attributeName: "N° de Parte", value: "FH-9001" },
    { id: "rep-attr-equipment", requestItemId: repuestoItemId, attributeName: "Equipo", value: "Excavadora CAT 320" },
    { id: "rep-attr-patent", requestItemId: repuestoItemId, attributeName: "Patente/Código", value: "EQ-17" },
    { id: "rep-attr-brand", requestItemId: repuestoItemId, attributeName: "Marca", value: "Caterpillar" },
    { id: "rep-attr-model", requestItemId: repuestoItemId, attributeName: "Modelo", value: "320D" },
    { id: "srv-attr-location", requestItemId: serviceItemId, attributeName: "Ubicación", value: "Sala generador faena Mininco" },
    { id: "srv-attr-equipment", requestItemId: serviceItemId, attributeName: "Equipo", value: "Generador industrial" },
    { id: "srv-attr-patent", requestItemId: serviceItemId, attributeName: "Patente/Código", value: "GEN-04" },
    { id: "srv-attr-brand", requestItemId: serviceItemId, attributeName: "Marca", value: "Cummins" },
    { id: "srv-attr-model", requestItemId: serviceItemId, attributeName: "Modelo", value: "C220D5" },
  ])

  await db.insert(schema.repuestoQuotations).values([
    {
      id: "rep-quote-audit-1",
      requestId: repuestoRequestId,
      supplierId,
      fileName: "cotizacion-repuesto-2026-0001.pdf",
      filePath: "/storage/repuestos/cotizacion-repuesto-2026-0001.pdf",
      fileSize: "192410",
      totalAmount: 245000,
      status: "pending",
      notes: "Incluye despacho a faena.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.serviceQuotations).values([
    {
      id: "srv-quote-audit-1",
      requestId: serviceRequestId,
      supplierId: "sup-audit-2",
      fileName: "cotizacion-servicio-2026-0001.pdf",
      filePath: "/storage/servicios/cotizacion-servicio-2026-0001.pdf",
      fileSize: "221600",
      totalAmount: 680000,
      status: "pending",
      notes: "Incluye visita técnica y repuestos menores.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  // ── SST Evaluations ──────────────────────────────────────────────────────
  await db.insert(schema.sstEvaluations).values([
    {
      id: "sst-audit-1",
      worksiteId,
      workerId: "worker-audit-1",
      createdBy: userId,
      definicionCode: "trabajador_nuevo",
      definicionVersion: "01",
      tipo: "nuevo",
      fechaEvaluacion: "2026-06-09",
      estado: "cerrado",
      cargosJson: JSON.stringify(["operador_maquinaria"]),
      resultadoFinal: "apto",
      porcentajeCumplimiento: 95.5,
      observacionesGenerales: "Evaluación de ingreso para trabajador nuevo.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sst-audit-2",
      worksiteId,
      workerId: "worker-audit-2",
      createdBy: userId,
      definicionCode: "trabajador_antiguo",
      definicionVersion: "01",
      tipo: "seguimiento",
      motivo: "accidente",
      descripcionEvento: "Seguimiento post-incidente menor.",
      fechaEvaluacion: "2026-06-09",
      estado: "cerrado",
      cargosJson: JSON.stringify(["mecanico"]),
      resultadoFinal: "apto",
      porcentajeCumplimiento: 88.0,
      resultadoEficacia: "eficaz",
      observacionesGenerales: "Seguimiento por incidente menor en faena.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.sstActionPlan).values([
    {
      id: "sst-action-audit-1",
      evaluationId: "sst-audit-1",
      n: 1,
      hallazgo: "Falta EPP en sector norte",
      accion: "Entregar kit completo al trabajador",
      responsable: "Jefe de faena",
      plazo: "2026-06-15",
      estado: "completado",
    },
  ])

  await db.insert(schema.ppaSubmissions).values([
    {
      id: "ppa-audit-1",
      worksiteId,
      workerId: "worker-audit-1",
      workerName: "Daniela Fuentes",
      workerRut: "18.111.222-3",
      workerCompany: "Chome",
      manualIdentificacion: false,
      tipoTrabajo: "conductor_batea",
      esCritica: false,
      answersJson: {
        tipoTrabajo: "conductor_batea",
        cambioPlanificado: "no",
        peligroNoControlado: "no",
        controles: ["epp", "herramientas"],
        seguroComenzar: "si",
        complementarias: {},
      },
      resultado: "autorizado_auto",
      triggeredReasons: [],
      estado: "aprobado_auto",
      publicToken: "capture-ppa-token",
      createdAt: now,
      updatedAt: now,
    },
  ])

  // ── Combustibles ─────────────────────────────────────────────────────────
  await db.insert(schema.fuelSuppliers).values([
    {
      id: "fuel-sup-audit-1",
      name: "COPEC Los Ángeles",
      rut: "76.555.666-7",
      contactName: "Francisco Muñoz",
      contactEmail: "fmunoz@copec.cl",
      contactPhone: "+56 9 7222 1133",
      notes: "Proveedor principal de combustible para la faena.",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.fuelVehicles).values([
    {
      id: "fuel-veh-audit-1",
      plate: "FD-71-22",
      type: "camioneta",
      brand: "Toyota",
      model: "Hilux 4x4",
      year: 2023,
      worksiteId,
      isActive: true,
      notes: "Vehículo de supervisión, consumo diésel.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "fuel-veh-audit-2",
      plate: "LK-45-10",
      type: "camion",
      brand: "Mercedes-Benz",
      model: "Atego 1726",
      year: 2022,
      worksiteId,
      isActive: true,
      notes: "Camión de carga para faena Mininco.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.fuelMonthlyStatements).values([
    {
      id: "cc-audit-1",
      month: "2026-06",
      fuelSupplierId: "fuel-sup-audit-1",
      totalLiters: 850,
      totalBaseAmount: 1428000,
      totalIec: 102000,
      totalIva: 290700,
      totalAmount: 1820700,
      paidAmount: 910350,
      dueDate: "2026-07-15",
      status: "partial",
      notes: "Estado de cuenta parcial de junio 2026.",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.fuelLoads).values([
    {
      id: "fuel-audit-1",
      statementId: "cc-audit-1",
      loadDate: "2026-06-09",
      month: "2026-06",
      serviceType: "TCT",
      vehicleId: "fuel-veh-audit-1",
      fuelSupplierId: "fuel-sup-audit-1",
      worksiteId,
      product: "PETROLEO DIESEL",
      receiptNumber: "B-88231",
      odometerReading: 45820,
      hourMeterReading: null,
      liters: 85.5,
      iecFixed: 5130,
      iecVariable: 5130,
      baseAmount: 145350,
      iecTotal: 10260,
      ivaAmount: 26262,
      totalAmount: 181872,
      status: "registered",
      notes: "Carga regular para vehículo de supervisión.",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.fuelPayments).values([
    {
      id: "fuel-pay-audit-1",
      statementId: "cc-audit-1",
      paymentDate: "2026-06-20",
      amount: 910350,
      paymentMethod: "transferencia",
      reference: "TRF-2026-0610",
      notes: "Pago parcial estado de cuenta junio.",
      createdBy: userId,
      createdAt: now,
    },
  ])

  await db.insert(schema.purchaseOrders).values([
    {
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
    },
    {
      id: officeOrderId,
      code: "OC-2026-0002",
      worksiteId,
      supplierId: "sup-audit-2",
      createdBy: "user-audit-jefa",
      status: "office_received",
      issuedAt: now,
      sentAt: now,
      confirmedAt: now,
      estimatedDelivery: "2026-06-22",
      deliveryAddress: "Oficina Chome Los Ángeles",
      paymentTerms: "Contado",
      netAmount: 66400,
      taxAmount: 12616,
      totalAmount: 79016,
      notes: "OC con recepción de oficina pendiente de despacho a faena.",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.purchaseOrderItems).values([
    {
      id: orderItemId,
      purchaseOrderId: orderId,
      requestItemId,
      productId,
      quantity: 12,
      unitOfMeasure: "par",
      unitPrice: 11900,
      discount: 0,
      subtotal: 142800,
      quantityOfficeReceived: 6,
      quantityReceived: 6,
      status: "partially_received",
      sortOrder: 0,
      notes: "Entrega parcial coordinada.",
    },
    {
      id: officeOrderItemId,
      purchaseOrderId: officeOrderId,
      requestItemId: null,
      productId: "prod-audit-2",
      quantity: 8,
      unitOfMeasure: "rollo",
      unitPrice: 8300,
      discount: 0,
      subtotal: 66400,
      quantityOfficeReceived: 8,
      quantityReceived: 0,
      status: "issued",
      sortOrder: 0,
      notes: "Recibido en oficina, pendiente para faena.",
    },
  ])

  await db.insert(schema.purchaseOrderInvoices).values([
    {
      id: "invoice-audit-1",
      purchaseOrderId: orderId,
      invoiceNumber: "F-88231",
      amount: 169932,
      issueDate: "2026-06-18",
      fileName: "factura-oc-2026-0001.pdf",
      filePath: "storage/purchase-orders/factura-oc-2026-0001.pdf",
      fileSize: 348120,
      mimeType: "application/pdf",
      uploadedBy: userId,
      uploadedAt: now,
    },
  ])

  await db.insert(schema.receipts).values([
    {
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
    },
    {
      id: officeReceiptId,
      code: "REC-2026-0002",
      purchaseOrderId: officeOrderId,
      receivedBy: "user-audit-bodega",
      receivedAt: now,
      locationType: "office",
      worksiteId: null,
      dispatchGuideNo: "GD-88232",
      status: "open",
      notes: "Recepción en oficina pendiente de traslado.",
      createdAt: now,
    },
  ])
  await db.insert(schema.receiptItems).values([
    {
      id: "rec-item-audit-1",
      receiptId,
      purchaseOrderItemId: orderItemId,
      quantityReceived: 6,
      quantityRejected: 0,
      quantityDamaged: 0,
      status: "partially_received",
      notes: "Saldo pendiente proveedor.",
    },
    {
      id: "rec-item-audit-office",
      receiptId: officeReceiptId,
      purchaseOrderItemId: officeOrderItemId,
      quantityReceived: 8,
      quantityRejected: 0,
      quantityDamaged: 0,
      status: "received",
      notes: "Ingreso a oficina sin observaciones.",
    },
  ])

  await db.insert(schema.worksiteStock).values([
    {
      id: "stock-audit-1",
      worksiteId,
      productId,
      quantity: 6,
      minStock: 10,
      lastMovementAt: now,
      updatedAt: now,
    },
    {
      id: "stock-audit-2",
      worksiteId,
      productId: deliverableProductId,
      quantity: 3,
      minStock: 2,
      lastMovementAt: now,
      updatedAt: now,
    },
    {
      id: "stock-audit-3",
      worksiteId: "ws-audit-2",
      productId: "prod-audit-2",
      quantity: 14,
      minStock: 5,
      lastMovementAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.inventoryMovements).values([
    {
      id: "mov-audit-1",
      worksiteId,
      productId,
      type: "ingreso_oc",
      quantity: 6,
      referenceType: "purchase_order",
      referenceId: receiptId,
      stockBefore: 0,
      stockAfter: 6,
      performedBy: userId,
      performedAt: now,
      reason: "Recepción parcial OC-2026-0001",
    },
    {
      id: "mov-audit-2",
      worksiteId,
      productId: deliverableProductId,
      type: "ingreso_oc",
      quantity: 5,
      referenceType: "purchase_order",
      referenceId: deliveryRequestId,
      stockBefore: 0,
      stockAfter: 5,
      performedBy: "user-audit-bodega",
      performedAt: now,
      reason: "Ingreso EPP para entrega nominal",
    },
    {
      id: "mov-audit-3",
      worksiteId,
      productId: deliverableProductId,
      type: "egreso_entrega",
      quantity: 2,
      referenceType: "delivery",
      referenceId: deliveryId,
      stockBefore: 5,
      stockAfter: 3,
      performedBy: "user-audit-bodega",
      performedAt: now,
      reason: "Entrega parcial a trabajador",
    },
  ])

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
    requestItemId: deliverableRequestItemId,
    productId: deliverableProductId,
    quantity: 2,
    unitOfMeasure: "unidad",
    notes: "Entrega inicial.",
  })

  await db.insert(schema.attachments).values([
    {
      id: "att-audit-1",
      entityType: "purchase_order",
      entityId: orderId,
      fileName: "factura-oc-2026-0001.pdf",
      filePath: "/uploads/factura-oc-2026-0001.pdf",
      fileSize: 348120,
      mimeType: "application/pdf",
      uploadedBy: userId,
      uploadedAt: now,
    },
    {
      id: "att-audit-delivery-1",
      entityType: "delivery",
      entityId: deliveryId,
      fileName: "comprobante-entrega-2026-0001.pdf",
      filePath: "/uploads/comprobante-entrega-2026-0001.pdf",
      fileSize: 128420,
      mimeType: "application/pdf",
      uploadedBy: "user-audit-bodega",
      uploadedAt: now,
    },
  ])
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
    {
      id: "audit-audit-3",
      userId: "user-audit-bodega",
      userEmail: "bodega.audit@chome.cl",
      action: "create",
      entityType: "delivery",
      entityId: deliveryId,
      entityCode: "ENT-2026-0001",
      newState: JSON.stringify({ destinationType: "worker", quantity: 2 }),
      createdAt: now,
    },
    {
      id: "audit-audit-4",
      userId: userId,
      userEmail: "admin.audit@chome.cl",
      action: "update",
      entityType: "system_settings",
      entityId: "company_name",
      entityCode: "Configuración",
      oldState: JSON.stringify({ value: "Chome" }),
      newState: JSON.stringify({ value: "Chome Operaciones" }),
      reason: "Actualización de datos para capturas",
      createdAt: now,
    },
  ])
  await db.insert(schema.statusHistory).values([
    {
      id: "status-audit-1",
      entityType: "purchase_request",
      entityId: requestId,
      fromStatus: "draft",
      toStatus: "submitted",
      changedBy: "user-audit-prevencion",
      reason: "Solicitud enviada a aprobación.",
      changedAt: now,
    },
    {
      id: "status-audit-2",
      entityType: "purchase_request",
      entityId: requestId,
      fromStatus: "submitted",
      toStatus: "partially_approved",
      changedBy: "user-audit-jefa",
      reason: "Aprobación parcial para compra.",
      changedAt: now,
    },
    {
      id: "status-audit-rep-1",
      entityType: "purchase_request",
      entityId: repuestoRequestId,
      fromStatus: "draft",
      toStatus: "submitted",
      changedBy: "user-audit-prevencion",
      reason: "Cotización adjunta para evaluación.",
      changedAt: now,
    },
    {
      id: "status-audit-srv-1",
      entityType: "purchase_request",
      entityId: serviceRequestId,
      fromStatus: "draft",
      toStatus: "submitted",
      changedBy: "user-audit-prevencion",
      reason: "Servicio externo enviado a evaluación.",
      changedAt: now,
    },
  ])
  await db.insert(schema.notifications).values([
    {
      id: "noti-audit-1",
      userId,
      type: "request_submitted",
      title: "Nueva solicitud: SOL-2026-0001",
      body: "Prevencionista Faena envió una solicitud con 2 ítems",
      entityType: "purchase_request",
      entityId: requestId,
      entityHref: `/solicitudes/${requestId}`,
      isRead: false,
      createdAt: now,
    },
    {
      id: "noti-audit-2",
      userId,
      type: "oc_sent",
      title: "OC enviada: OC-2026-0001",
      body: "La orden de compra fue enviada al proveedor TRECK.",
      entityType: "purchase_order",
      entityId: orderId,
      entityHref: `/compras/${orderId}`,
      isRead: true,
      createdAt: now,
    },
    {
      id: "noti-audit-3",
      userId,
      type: "dispatch_done",
      title: "Entrega registrada: ENT-2026-0001",
      body: "Se registró una entrega nominal de EPP.",
      entityType: "delivery",
      entityId: deliveryId,
      entityHref: "/entregas",
      isRead: false,
      createdAt: now,
    },
  ])
  await db.insert(schema.systemSettings).values([
    { key: "company_name", value: "Chome Operaciones", updatedAt: now },
    { key: "company_rut", value: "76.000.000-0", updatedAt: now },
    { key: "company_address", value: "Av. Industrial 1400, Los Ángeles", updatedAt: now },
    { key: "company_business_activity", value: "Servicios forestales y operaciones industriales", updatedAt: now },
    { key: "pdf_max_size_mb", value: "10", updatedAt: now },
    { key: "purchase_order_footer", value: "Documento generado para auditoría visual.", updatedAt: now },
  ])

  // Sync sequences past all hardcoded document codes inserted above.
  // Each call to next_document_code creates the sequence (if needed) and
  // consumes one value; setval then pins it at the max code we've inserted,
  // so the next real app call gets max+1 with no collisions.
  await db.execute(sql`
    DO $$
    DECLARE
      yr int := EXTRACT(YEAR FROM NOW())::int;
    BEGIN
      -- SOL uses year=0 per code-sequences.ts
      PERFORM next_document_code('SOL', 0);
      PERFORM setval('code_seq_sol_0', GREATEST(
        3,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM purchase_requests WHERE code ~ '^SOL-')
      ));

      PERFORM next_document_code('OC', yr);
      PERFORM setval('code_seq_oc_' || yr, GREATEST(
        2,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM purchase_orders WHERE code ~ ('^OC-' || yr || '-'))
      ));

      PERFORM next_document_code('REP', yr);
      PERFORM setval('code_seq_rep_' || yr, GREATEST(
        1,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM purchase_requests WHERE code ~ ('^REP-' || yr || '-'))
      ));

      PERFORM next_document_code('REC', yr);
      PERFORM setval('code_seq_rec_' || yr, GREATEST(
        2,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM receipts WHERE code ~ ('^REC-' || yr || '-'))
      ));

      PERFORM next_document_code('ENT', yr);
      PERFORM setval('code_seq_ent_' || yr, GREATEST(
        1,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM deliveries WHERE code ~ ('^ENT-' || yr || '-'))
      ));
    END;
    $$
  `)

  await pgClient.end()
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

async function startServer(captureDbUrl: string) {
  const env = {
    ...process.env,
    DATABASE_URL: captureDbUrl,
    AUTH_SECRET: authSecret,
    NEXTAUTH_SECRET: authSecret,
    APP_URL: baseUrl,
    NEXTAUTH_URL: baseUrl,
    PORT: String(port),
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: "",
    SMTP_DISABLED: "true",
    SMTP_TIMEOUT_MS: "1000",
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
      ok: isExpectedStatus(status, route),
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

function isExpectedStatus(status: number | null, route: RouteTarget) {
  if (route.expectedStatus !== undefined) return status === route.expectedStatus
  return !status || status < 400
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
