/**
 * scripts/seed-document-root-folders.ts
 *
 * Siembra las cuatro carpetas raíz del Registro documental, agrupadas por
 * **sujeto**: de quién es el papel. Es la pregunta con la que se busca durante
 * una fiscalización — "muéstreme lo del trabajador X", "lo que le exigió la
 * Dirección del Trabajo" — y no coincide con la taxonomía por categoría, que
 * responde de qué trata.
 *
 * Es configuración, no esquema: `sst_document_folders` ya es un árbol
 * autorreferente y esta convención sólo lo puebla. Nada impide crear otras
 * carpetas ni mover documentos después.
 *
 * Idempotente: se salta cualquier carpeta raíz cuyo slug ya exista.
 *
 *   npm run db:seed-document-root-folders                    # usa .env.local
 *   SEED_DRY_RUN=true npm run db:seed-document-root-folders  # validar sin escribir
 *
 * Actor: por defecto el primer usuario con rol `administrador`. Se puede fijar
 * con DOCUMENT_FOLDERS_ACTOR_USER_ID.
 */
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { eq, isNull } from "drizzle-orm"
import { loadEnvConfig } from "@next/env"
import * as schema from "../db/schema"
import { nanoid } from "../lib/id"

loadEnvConfig(process.cwd())

const DRY_RUN = process.env.SEED_DRY_RUN === "true"

const ROOT_FOLDERS = [
  { slug: "empresa", name: "Empresa", detail: "Reglamento interno, política, procedimientos, actas del sistema." },
  { slug: "trabajador", name: "Trabajador", detail: "ODI, entregas de EPP, certificados, acuses nominativos." },
  { slug: "contratista", name: "Contratista", detail: "Documentación exigida a terceros que trabajan en la faena." },
  { slug: "externa", name: "Externa", detail: "Actas de fiscalización, visitas de la mutualidad, correspondencia." },
] as const

async function resolveActorUserId(db: ReturnType<typeof drizzle>): Promise<string> {
  const fromEnv = process.env.DOCUMENT_FOLDERS_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  const [row] = await db.select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.roles.name, "administrador"))
    .limit(1)
  if (!row) throw new Error("No hay ningún usuario con rol `administrador`. Pasa DOCUMENT_FOLDERS_ACTOR_USER_ID explícitamente.")
  return row.userId
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is required (postgres://...)")
    process.exit(1)
  }

  const client = postgres(process.env.DATABASE_URL, { max: 1 })
  const db = drizzle(client, { schema })

  console.log(`Siembra de carpetas raíz del Registro documental — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"}`)

  // El índice único es (parent_id, slug), pero con parent_id NULL no aplica en
  // Postgres: dos raíces con el mismo slug serían posibles. Por eso se consulta.
  const existing = await db.select({ slug: schema.sstDocumentFolders.slug })
    .from(schema.sstDocumentFolders)
    .where(isNull(schema.sstDocumentFolders.parentId))
  const existingSlugs = new Set(existing.map((row) => row.slug))

  const pending = ROOT_FOLDERS.filter((folder) => !existingSlugs.has(folder.slug))
  if (pending.length === 0) {
    console.log("  · Las cuatro carpetas raíz ya existen, nada que hacer.")
    await client.end()
    return
  }

  const actorUserId = await resolveActorUserId(db)
  console.log(`  Actor: ${actorUserId}`)

  for (const folder of pending) {
    if (DRY_RUN) {
      console.log(`  [DRY RUN] crearía "${folder.name}" (${folder.slug}) — ${folder.detail}`)
      continue
    }
    const now = new Date().toISOString()
    await db.insert(schema.sstDocumentFolders).values({
      id: `sdf-${nanoid()}`,
      parentId: null,
      name: folder.name,
      slug: folder.slug,
      worksiteId: null,
      createdBy: actorUserId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    console.log(`  ✓ "${folder.name}" creada.`)
  }

  await client.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
