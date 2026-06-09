import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import bcrypt from "bcryptjs"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "../db/schema"

const dbPath = process.env.DATABASE_URL ?? "./.tmp/e2e.sqlite"
const resolvedDbPath = path.resolve(process.cwd(), dbPath)

fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true })
for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${resolvedDbPath}${suffix}`
  if (fs.existsSync(file)) fs.rmSync(file)
}

const sqlite = new Database(resolvedDbPath)
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")

const db = drizzle(sqlite, { schema })
const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

async function main() {
  migrate(db, { migrationsFolder })

  const password = await bcrypt.hash("chome2026", 10)
  const now = new Date().toISOString()

  await db.insert(schema.roles).values({
    id: "rol-admin",
    name: "administrador",
    label: "Administrador",
    description: "Control total E2E",
  })

  const permissions: (typeof schema.permissions.$inferInsert)[] = [
    { id: "p-req-create", name: "requests:create", module: "requests", description: "Crear solicitudes" },
    { id: "p-req-own", name: "requests:view_own", module: "requests", description: "Ver propias" },
    { id: "p-req-all", name: "requests:view_all", module: "requests", description: "Ver todas" },
    { id: "p-req-submit", name: "requests:submit", module: "requests", description: "Enviar solicitudes" },
    { id: "p-apr", name: "approvals:approve", module: "approvals", description: "Aprobar" },
    { id: "p-pur-view", name: "purchasing:view", module: "purchasing", description: "Ver compras" },
    { id: "p-pur-create", name: "purchasing:create_order", module: "purchasing", description: "Crear OC" },
    { id: "p-pur-send", name: "purchasing:send_order", module: "purchasing", description: "Enviar OC" },
    { id: "p-rec-reg", name: "receiving:register", module: "receiving", description: "Registrar recepción" },
    { id: "p-rec-view", name: "receiving:view", module: "receiving", description: "Ver recepción" },
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
  await db.insert(schema.suppliers).values({
    id: "sup-e2e",
    name: "Proveedor E2E",
    rut: "76.000.000-0",
    paymentTerms: "30 días",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.productCategories).values({
    id: "cat-e2e",
    name: "Categoría E2E",
    slug: "categoria-e2e",
    sortOrder: 1,
  })
  await db.insert(schema.products).values({
    id: "prod-e2e",
    sku: "E2E-001",
    name: "Guante E2E",
    categoryId: "cat-e2e",
    unitOfMeasure: "unidad",
    referencePrice: 1000,
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
  await db.insert(schema.warehouses).values({
    id: "wh-e2e",
    name: "Bodega Central E2E",
    code: "BOD-E2E",
    type: "central",
    isActive: true,
    createdAt: now,
  })

  sqlite.close()
}

main().catch((error) => {
  console.error(error)
  sqlite.close()
  process.exit(1)
})
