/**
 * scripts/seed-pdtp-inspection-templates-2026.ts
 *
 * Instala las 10 definiciones de checklist del programa 2026 como plantillas
 * del motor de inspecciones, cableadas a la actividad PDTP que acreditan.
 *
 * Reemplaza a `db:seed-pdtp-checklists`, que las instalaba en el motor propio
 * de PDTP (decisión D10 del diseño 2026-08-12: unificación de motores).
 *
 *   npm run db:seed-pdtp-inspection-templates
 *   SEED_DRY_RUN=true npm run db:seed-pdtp-inspection-templates   # sin escribir
 *   SEED_ACTOR_USER_ID=<id> npm run db:seed-pdtp-inspection-templates
 *
 * Sin `SEED_ACTOR_USER_ID` resuelve el primer usuario con rol `administrador`:
 * las plantillas se instalan aprobadas y `author_user_id` / `approved_by_user_id`
 * son FK obligatorias.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { roles, userRoles } from "@/db/schema"
import { ensurePdtp2026InspectionTemplates } from "@/lib/services/pdtp-adapters/inspection-templates-2026"

const DRY_RUN = process.env.SEED_DRY_RUN === "true"

async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.SEED_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv

  const [row] = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.name, "administrador"))
    .limit(1)
  if (!row) {
    throw new Error("No hay ningún usuario con rol `administrador`. Pasa SEED_ACTOR_USER_ID explícitamente.")
  }
  return row.userId
}

async function main() {
  const actorUserId = await resolveActorUserId()
  console.log(`Plantillas de inspección PDTP 2026 — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"} · actor=${actorUserId}`)

  const result = await ensurePdtp2026InspectionTemplates({ actorUserId, dryRun: DRY_RUN })

  for (const item of result.created) {
    console.log(`  ✓ n=${item.n}: plantilla ${item.templateId} (${item.code} v${item.versionLabel}) instalada y aprobada.`)
  }
  for (const item of result.relinked) {
    console.log(`  ↻ n=${item.n}: plantilla ${item.templateId} recableada ${JSON.stringify(item.from)} → ${JSON.stringify(item.to)}.`)
  }
  for (const item of result.skipped) {
    console.log(`  · n=${item.n}: plantilla ${item.templateId} ya instalada, omitida.`)
  }

  console.log("")
  console.log(`Resumen: ${result.created.length} instaladas, ${result.relinked.length} recableadas, ${result.skipped.length} sin cambios.`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
