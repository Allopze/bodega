/**
 * scripts/apply-sst-document-taxonomy.ts
 *
 * Siembra el catálogo de Documentación SST —categorías y tipos— y con él el
 * cableado de la N°43 y la N°36 al programa anual.
 *
 * Existía el sembrador (`seedDefaultCategories`, que encadena
 * `seedDefaultDocumentTypes`) y no lo llamaba nadie salvo un botón del panel de
 * administración. El resultado, verificado el 2026-09-03: `sst_document_types`
 * y `sst_document_categories` en **cero filas** en producción, y por lo tanto
 * dos actividades del programa sin ningún camino para acreditar —el conector
 * lee el número del tipo del documento, y no había tipos—.
 *
 *   npm run db:apply-sst-taxonomy
 *   SST_TAXONOMY_DRY_RUN=true npm run db:apply-sst-taxonomy
 *   SST_TAXONOMY_DEPLOY_MODE=true node scripts/apply-sst-document-taxonomy.mjs
 *
 * A diferencia de aprobar una plantilla de inspección, sembrar un catálogo de
 * tipos documentales no es el juicio de nadie: es la lista que la normativa y
 * el programa ya fijaron. Por eso corre en cada deploy.
 *
 * Idempotente por `(category_slug, code)`, que ya tiene índice único. El
 * `onConflictDoUpdate` incluye las dos columnas del PDTP a propósito: un
 * catálogo sembrado antes de que existieran se quedaría sin ellas para siempre
 * si el conflicto no las corrigiera.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { roles, sstDocumentCategories, sstDocumentTypes, userRoles } from "@/db/schema"
import { seedSstDocumentMasterList } from "@/lib/services/prevention-documents/master-list-seed"
import {
  DEFAULT_CATEGORIES,
  DEFAULT_DOCUMENT_TYPES,
  seedDefaultCategories,
} from "@/lib/services/prevention-documents/taxonomy"

const DRY_RUN = process.env.SST_TAXONOMY_DRY_RUN === "true"
const DEPLOY_MODE = process.env.SST_TAXONOMY_DEPLOY_MODE === "true"

/**
 * Actor de los documentos sembrados. Cualquiera con rol administrativo sirve:
 * el inventario no es de nadie en particular, y `uploaded_by` es `NOT NULL`.
 */
async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.SST_TAXONOMY_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  for (const roleName of ["administrador", "prevencionista", "jefa_chome"]) {
    const [row] = await db.select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(roles.name, roleName))
      .limit(1)
    if (row) return row.userId
  }
  throw new Error("No hay ningún usuario administrativo para atribuir el inventario documental.")
}

async function main() {
  console.log(`Taxonomía documental SST — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"}`)

  const [categoriesBefore, typesBefore] = await Promise.all([
    db.select({ slug: sstDocumentCategories.slug }).from(sstDocumentCategories),
    db.select({ id: sstDocumentTypes.id }).from(sstDocumentTypes),
  ])
  console.log(`  Estado actual: ${categoriesBefore.length} categoría(s), ${typesBefore.length} tipo(s).`)

  const wired = DEFAULT_DOCUMENT_TYPES.filter((type) =>
    (type.pdtpActivityNumbers?.length ?? 0) > 0 || (type.pdtpAcknowledgmentActivityNumbers?.length ?? 0) > 0)
  for (const type of wired) {
    const publish = type.pdtpActivityNumbers ?? []
    const ack = type.pdtpAcknowledgmentActivityNumbers ?? []
    const detail = [
      publish.length > 0 ? `N°${publish.join(", N°")} al publicar` : null,
      ack.length > 0 ? `N°${ack.join(", N°")} por acuse` : null,
    ].filter(Boolean).join(" · ")
    console.log(`  · ${type.code} — ${detail}`)
  }

  if (DRY_RUN) {
    console.log("")
    console.log(`Sembraría ${DEFAULT_CATEGORIES.length} categoría(s) y ${DEFAULT_DOCUMENT_TYPES.length} tipo(s).`)
    process.exit(0)
  }

  await seedDefaultCategories()

  // El inventario del RE-08 va después de los tipos: `type_id` es FK.
  const actorUserId = await resolveActorUserId()
  const master = await seedSstDocumentMasterList({
    actorUserId,
    onProgress: (line) => console.log(line),
  })
  console.log(`  · listado maestro RE-08: ${master.created} documento(s) nuevo(s) de ${master.documents}, ${master.folders} carpeta(s).`)

  const [categoriesAfter, typesAfter] = await Promise.all([
    db.select({ slug: sstDocumentCategories.slug }).from(sstDocumentCategories),
    db.select({ id: sstDocumentTypes.id }).from(sstDocumentTypes),
  ])
  console.log("")
  console.log(`Resumen: ${categoriesAfter.length} categoría(s) y ${typesAfter.length} tipo(s) en catálogo.`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  // En despliegue no se aborta: el catálogo documental no es una precondición
  // del arranque de la aplicación, y dejar caer un deploy por él sería
  // desproporcionado. Mismo criterio que los otros pasos de datos del PDTP.
  process.exit(DEPLOY_MODE ? 0 : 1)
})
