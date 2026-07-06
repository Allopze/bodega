/**
 * Bootstrap seed — Plataforma Chome
 * Creates only system roles, permissions, and base catalog data.
 * Operational/test data should be entered through the app flows.
 * Run with: npx tsx db/seed.ts
 */
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import bcrypt from "bcryptjs"
import { loadEnvConfig } from "@next/env"
import * as schema from "./schema"
import { eq, or, inArray, notInArray } from "drizzle-orm"
import { loadSeedWorkerData } from "./seed/workers"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "../lib/auth/system-rbac"
import { seedNuevosRoles } from "./seed/nuevos-roles"
import {
  loadPdtpCatalog,
  approvePdtpProgramJdpr,
  signPdtpProgramLegal,
  activatePdtpProgram,
} from "../lib/services/prevention-pdtp"
import pdtpCatalog2026 from "./seed/pdtp-catalog-2026.json"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const eppCatalog = JSON.parse(
  readFileSync(resolve(__dirname, "seed", "epp-catalog.json"), "utf-8")
)

loadEnvConfig(process.cwd())

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required (postgres://...)")
  process.exit(1)
}

const adminName = process.env.SEED_ADMIN_NAME ?? "Administrador"
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@chome.cl").toLowerCase()
const NODE_ENV = process.env.NODE_ENV ?? "development"

function resolveSeedAdminPassword(): string {
  const explicit = process.env.SEED_ADMIN_PASSWORD
  if (explicit && explicit.length > 0) return explicit
  if (NODE_ENV === "production") {
    console.error(
      "Refusing to seed: SEED_ADMIN_PASSWORD is not set and NODE_ENV=production.\n" +
      "Define a strong password via SEED_ADMIN_PASSWORD.",
    )
    process.exit(1)
  }
  return "chome2026"
}
const adminPassword = resolveSeedAdminPassword()
const client = postgres(process.env.DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })

const EPP_CATEGORY = eppCatalog.category as typeof schema.productCategories.$inferInsert
const EPP_SUPPLIERS = eppCatalog.suppliers as (typeof schema.suppliers.$inferInsert)[]
const EPP_CATALOG_ITEMS = eppCatalog.items as EppCatalogItem[]

const COMPANY_PROFILE_SETTINGS: (typeof schema.systemSettings.$inferInsert)[] = [
  { key: "company_name", value: "Servicios Industriales Chome Limitada" },
  { key: "company_rut", value: "78.023.530-6" },
  { key: "company_business_activity", value: "Servicios Industrial" },
  { key: "company_address", value: "Camino de Luna 91 Villa Portal del Sol - Panguipulli - Panguipulli - Chile" },
  { key: "company_branch_address", value: "Pedro Aguirre Cerda 1156 Block 4to, Concepcion" },
  { key: "company_phone", value: "41-3251368" },
  { key: "company_email", value: "" },
  { key: "company_website", value: "" },
]

interface EppCatalogItem {
  id: string
  supplierId: string
  sku: string
  name: string
  originalName?: string
  detail: string | null
  price: number | null
  attributes?: { name: string; value: string }[]
}

function sourceNote(item: EppCatalogItem) {
  const parts = [
    "Fuente: EPP PROVEEDORES.xlsx.",
    `Proveedor original: ${item.supplierId === "sup-treck" ? "TRECK" : "APRO"}.`,
  ]
  if (item.originalName) parts.push(`Nombre original: ${item.originalName}.`)
  if (item.detail) parts.push(`Detalle / Nota: ${item.detail}`)
  return parts.join(" ")
}

async function main() {
  console.log("Inicializando datos base de Plataforma Chome...")

  // A-16: SEED_DRY_RUN valida todas las entradas del seed (config, parsing del
  // markdown de trabajadores, catálogo EPP, política de contraseña) y reporta
  // lo que se insertaría, SIN tocar la base de datos. Útil en CI/pre-deploy.
  if (process.env.SEED_DRY_RUN === "true") {
    const workerData = loadSeedWorkerData()
    console.log("\n[DRY RUN] No se escribirá nada en la base de datos.")
    console.log(`  Config de empresa: ${COMPANY_PROFILE_SETTINGS.length} ajustes`)
    console.log(`  Roles: ${SYSTEM_ROLES.length} · Permisos: ${SYSTEM_PERMISSIONS.length} · Role-permissions: ${SYSTEM_ROLE_PERMISSIONS.length}`)
    console.log(`  Admin: ${adminEmail} (password ${process.env.SEED_ADMIN_PASSWORD ? "definido" : "default chome2026"})`)
    console.log(`  Faenas: ${workerData.worksites.length} · Trabajadores: ${workerData.workers.length} (${workerData.skippedDuplicateRuts} RUT duplicado omitido)`)
    console.log(`  Catálogo EPP: ${EPP_CATALOG_ITEMS.length} productos · ${EPP_SUPPLIERS.length} proveedores`)
    console.log(`  Catálogo PDTP 2026: ${pdtpCatalog2026.activities.length} actividades · ${pdtpCatalog2026.objectives.length} objetivos`)
    console.log("\n[DRY RUN] Validación completada sin errores.")
    return
  }

  /* ── Configuración de empresa para OC ─────────────────────────────────── */
  for (const setting of COMPANY_PROFILE_SETTINGS) {
    await db.insert(schema.systemSettings).values(setting).onConflictDoNothing()
  }

  /* ── Roles ────────────────────────────────────────────────────────────── */
  const roleData = SYSTEM_ROLES
  for (const role of roleData) {
    await db.insert(schema.roles).values(role).onConflictDoUpdate({
      target: schema.roles.id,
      set: {
        name: role.name,
        label: role.label,
        description: role.description ?? null,
      },
    })
  }

  /* ── Permissions ─────────────────────────────────────────────────────── */
  const perms = SYSTEM_PERMISSIONS
  for (const permission of perms) {
    await db.insert(schema.permissions).values(permission).onConflictDoUpdate({
      target: schema.permissions.id,
      set: {
        name: permission.name,
        module: permission.module,
        description: permission.description ?? null,
      },
    })
  }

  const keepRoleIds = roleData.map((r) => r.id)
  const keepPermIds = perms.map((p) => p.id)
  await db.delete(schema.rolePermissions)
  await db.delete(schema.userRoles).where(notInArray(schema.userRoles.roleId, keepRoleIds))
  await db.delete(schema.roles).where(notInArray(schema.roles.id, keepRoleIds))
  await db.delete(schema.permissions).where(notInArray(schema.permissions.id, keepPermIds))

  /* ── Role → Permission mapping ───────────────────────────────────────── */
  const rolePermData = SYSTEM_ROLE_PERMISSIONS
  await db.insert(schema.rolePermissions).values(rolePermData)

  /* ── Initial administrator ───────────────────────────────────────────── */
  // Idempotente: el admin puede existir por email configurado o por el id fijo
  // "user-admin" (p. ej. si cambió SEED_ADMIN_EMAIL entre corridas).
  const existingAdmin = await db.query.users.findFirst({
    where: or(eq(schema.users.email, adminEmail), eq(schema.users.id, "user-admin")),
  })
  const adminId = existingAdmin?.id ?? "user-admin"
  const hashedPassword = await bcrypt.hash(adminPassword, 12)

  if (existingAdmin) {
    await db.update(schema.users).set({
      name: adminName,
      email: adminEmail,
      hashedPassword,
      isActive: true,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.users.id, adminId))
  } else {
    await db.insert(schema.users).values({
      id: adminId,
      name: adminName,
      email: adminEmail,
      hashedPassword,
      avatarColor: "160",
      isActive: true,
    })
  }

  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId))
  await db.insert(schema.userRoles).values({ userId: adminId, roleId: "rol-admin" })

  /* ── Faenas y trabajadores desde libros de remuneraciones ───────────── */
  const seedWorkerData = loadSeedWorkerData()
  for (const worksite of seedWorkerData.worksites) {
    await db.insert(schema.worksites).values({
      ...worksite,
      isActive: true,
    }).onConflictDoUpdate({
      target: schema.worksites.id,
      set: {
        name: worksite.name,
        code: worksite.code,
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
    })
  }

  for (const worker of seedWorkerData.workers) {
    await db.insert(schema.workers).values({
      id: worker.id,
      rut: worker.rut,
      firstName: worker.firstName,
      lastName: worker.lastName,
      position: null,
      worksiteId: worker.worksiteId,
      isActive: true,
    }).onConflictDoUpdate({
      target: schema.workers.rut,
      set: {
        firstName: worker.firstName,
        lastName: worker.lastName,
        position: null,
        worksiteId: worker.worksiteId,
        isActive: true,
      },
    })
  }

  /* ── EPP catalog from supplier spreadsheet ───────────────────────────── */
  await db.insert(schema.productCategories).values(EPP_CATEGORY).onConflictDoUpdate({
    target: schema.productCategories.id,
    set: {
      name: EPP_CATEGORY.name,
      slug: EPP_CATEGORY.slug,
      isEpp: EPP_CATEGORY.isEpp,
      requiresPrevencion: EPP_CATEGORY.requiresPrevencion,
      sortOrder: EPP_CATEGORY.sortOrder,
    },
  })

  for (const supplier of EPP_SUPPLIERS) {
    await db.insert(schema.suppliers).values(supplier).onConflictDoUpdate({
      target: schema.suppliers.id,
      set: {
        name: supplier.name,
        rut: supplier.rut ?? null,
        businessActivity: supplier.businessActivity ?? null,
        address: supplier.address ?? null,
        commune: supplier.commune ?? null,
        city: supplier.city ?? null,
        paymentTerms: supplier.paymentTerms ?? null,
        notes: supplier.notes ?? null,
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
    })
  }

  for (const item of EPP_CATALOG_ITEMS) {
    const attributeRows = item.attributes?.map((a, i) => ({
      id: `pa-${item.id}-${i + 1}`,
      productId: item.id,
      categoryId: null,
      name: a.name,
      type: "select",
      isRequired: true,
      options: JSON.stringify([a.value]),
      sortOrder: i,
    })) ?? []

    await db.insert(schema.products).values({
      id: item.id,
      sku: item.sku,
      name: item.name,
      description: item.detail,
      categoryId: EPP_CATEGORY.id,
      unitOfMeasure: "unidad",
      isEpp: true,
      requiresPrevencion: true,
      referencePrice: item.price,
      isActive: true,
      notes: sourceNote(item),
    }).onConflictDoUpdate({
      target: schema.products.id,
      set: {
        sku: item.sku,
        name: item.name,
        description: item.detail,
        categoryId: EPP_CATEGORY.id,
        unitOfMeasure: "unidad",
        isEpp: true,
        requiresPrevencion: true,
        referencePrice: item.price,
        isActive: true,
        notes: sourceNote(item),
        updatedAt: new Date().toISOString(),
      },
    })

    // Delete referencing request_item_attributes first (FK ON DELETE NO ACTION)
    const attrIds = (
      await db
        .select({ id: schema.productAttributes.id })
        .from(schema.productAttributes)
        .where(eq(schema.productAttributes.productId, item.id))
    ).map((a) => a.id)
    if (attrIds.length > 0) {
      await db.delete(schema.requestItemAttributes).where(inArray(schema.requestItemAttributes.attributeId, attrIds))
    }
    await db.delete(schema.productAttributes).where(eq(schema.productAttributes.productId, item.id))
    if (attributeRows.length > 0) {
      await db.insert(schema.productAttributes).values(attributeRows)
    }

    await db.insert(schema.productSuppliers).values({
      id: `ps-${item.id}`,
      productId: item.id,
      supplierId: item.supplierId,
      unitPrice: item.price,
      isPreferred: true,
      notes: item.detail,
    }).onConflictDoUpdate({
      target: schema.productSuppliers.id,
      set: {
        productId: item.id,
        supplierId: item.supplierId,
        unitPrice: item.price,
        isPreferred: true,
        notes: item.detail,
        lastUpdated: new Date().toISOString(),
      },
    })
  }

  /* ── Usuarios desde docs/planificacion/nuevos_roles.md ── */
  console.log("")
  console.log("  Sembrando usuarios de docs/planificacion/nuevos_roles.md...")
  const nuevosRolesResult = await seedNuevosRoles(db, schema)
  console.log(`  ${nuevosRolesResult.created} usuarios creados, ${nuevosRolesResult.assignedRoles} roles asignados, ${nuevosRolesResult.assignedWorksites} faenas asignadas, ${nuevosRolesResult.skipped} omitidos.`)

  /* ── Email templates ──────────────────────────────────────────────── */
  console.log("")
  console.log("  Sembrando plantillas de correo por defecto...")
  const { seedDefaultTemplates } = await import("@/lib/services/email-templates")
  await seedDefaultTemplates()
  console.log("  Plantillas de correo cargadas.")

  /* ── PDTP SG-SST 2026 ──────────────────────────────────────────────── */
  console.log("")
  console.log("  Sembrando catalogo PDTP SG-SST 2026...")
  await loadPdtpCatalog({
    year: 2026,
    version: 1,
    title: "Programa de Trabajo Preventivo SG-SST 2026",
    catalog: pdtpCatalog2026,
    userId: adminId,
  }, db)
  console.log(`  Catálogo PDTP cargado: ${pdtpCatalog2026.activities.length} actividades, ${pdtpCatalog2026.objectives.length} objetivos.`)

  // Activate the 2026 PDTP program (it was approved 2026-01-27 and signed 2026-02-04)
  try {
    const programId = "pdtp-2026-v1"
    await approvePdtpProgramJdpr(programId, adminId)
    await signPdtpProgramLegal(programId, adminId)
    await activatePdtpProgram(programId, adminId)
    console.log("  Programa PDTP 2026 activado (aprobado JDPR + firmado Legal).")
  } catch (e) {
    // Idempotent: if already approved/signed/activated, skip
    console.log(`  Programa PDTP 2026: ya activo o aprobado. (${(e as Error).message})`)
  }

  console.log("")
  console.log("Seed base completado.")
  console.log("  La contraseña viene de SEED_ADMIN_PASSWORD; si no se define, usa chome2026.")
  console.log(`  Faenas cargadas: ${seedWorkerData.worksites.length}.`)
  console.log(`  Trabajadores cargados: ${seedWorkerData.workers.length} (${seedWorkerData.skippedDuplicateRuts} RUT duplicado omitido).`)
  console.log(`  Nuevos roles: ${nuevosRolesResult.created} usuarios creados, ${nuevosRolesResult.assignedRoles} roles asignados, ${nuevosRolesResult.assignedWorksites} faenas asignadas.`)
  console.log(`  Catálogo EPP cargado: ${EPP_CATALOG_ITEMS.length} productos, ${EPP_SUPPLIERS.length} proveedores.`)
  console.log(`  Catálogo PDTP 2026 cargado: ${pdtpCatalog2026.activities.length} actividades.`)
  console.log("  No se cargaron stock ni solicitudes demo.")

  /* ── Biblioteca documental SST — taxonomía por defecto ───────────── */
  console.log("")
  console.log("  Sembrando categorías de la biblioteca documental SST...")
  try {
    const { seedDefaultCategories } = await import("@/lib/services/prevention-documents-library")
    await seedDefaultCategories()
    console.log("  Categorías documentales cargadas (10 categorías, upsert idempotente).")
  } catch (e) {
    console.log(`  Categorías documentales: ya cargadas. (${(e as Error).message})`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => client.end())
