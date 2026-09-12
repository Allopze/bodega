/**
 * scripts/resign-pdtp-2026-inspection-templates.ts
 *
 * Retira las plantillas de inspección habilitadas por la persona equivocada,
 * para que las vuelva a firmar quien corresponde.
 *
 *   RESIGN_ACTOR_USER_ID=<id> RESIGN_APPROVED_BY_USER_ID=<id> npm run pdtp:resign-inspection-templates
 *   RESIGN_DRY_RUN=true ... (no escribe)
 *
 * **El problema que resuelve.** `approved_by_user_id` es la constancia de quién
 * revisó y habilitó cada instrumento SST, con su fecha. Si firmó alguien que no
 * es el responsable del Departamento de Prevención, el registro es veraz pero la
 * habilitación no la hizo quien debía.
 *
 * Sobrescribir esa columna no es una opción: el dato no está equivocado —esa
 * persona sí aprobó ese día— y cambiarlo haría que el sistema afirme que otra
 * revisó quince instrumentos en fechas en que no lo hizo. Además dejaría la fila
 * contradiciendo su propio historial, que conserva las entradas `approved` con
 * el actor original. Un registro de cumplimiento falsificado es peor que uno
 * incómodo.
 *
 * Tampoco se puede des-aprobar: la máquina de estados sólo va de `draft` a
 * `approved`, y de ahí a `superseded` o al borrado. `rollbackInspectionTemplate`
 * restaura una versión anterior, no devuelve una a borrador.
 *
 * Así que el camino es retirar y rehacer, en tres pasos:
 *
 *   1. este script retira las plantillas (las BORRA, dejando su constancia)
 *   2. `seed-inspection-templates` las recrea en borrador
 *   3. quien corresponde las aprueba desde el catálogo, revisándolas
 *
 * **Sólo es posible mientras no tengan uso.** `retireInspectionTemplate` borra
 * cuando no hay corridas ni programas asociados, y marca `superseded` cuando sí
 * los hay. Un `superseded` deja ocupado el par `(code, versionLabel)`, que tiene
 * índice único, así que el sembrador no podría recrear la plantilla y el
 * instrumento quedaría fuera de circulación. Por eso el script comprueba el uso
 * antes de tocar nada y se detiene si encuentra alguno, en vez de dejar que el
 * servicio decida.
 *
 * **La ventana importa.** Entre el paso 1 y el 3 no hay ninguna plantilla
 * vigente y nadie puede ejecutar una inspección. Conviene correrlo con la
 * persona que va a firmar disponible para hacerlo enseguida.
 */

import { eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  permissions as permissionsTable,
  preventionInspectionPrograms,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  rolePermissions,
  roles,
  userPermissions,
  userRoles,
  users,
} from "@/db/schema"
import { PDTP_2026_INSPECTION_SPECS } from "@/lib/prevention/inspection-wiring"
import { retireInspectionTemplate, type InspectionAccess } from "@/lib/services/prevention-inspections"

const DRY_RUN = process.env.RESIGN_DRY_RUN === "true"

export type TemplateRow = {
  id: string
  code: string
  versionLabel: string
  status: string
  approvedByUserId: string | null
  runs: number
  programs: number
}

export type TemplateOutcome =
  | { kind: "retire" }
  /** Firmada por otra persona: no es de las que este script vino a corregir. */
  | { kind: "not_targeted" }
  /** Ya no está vigente; el sembrador la recreará. */
  | { kind: "already_retired" }
  /** Tiene uso: retirarla la dejaría `superseded` y el sembrador no podría recrearla. */
  | { kind: "in_use"; runs: number; programs: number }

/**
 * Qué hacer con una plantilla. Pura y exportada: es la parte que decide, y
 * decidir sin base de datos es lo que la hace testeable.
 */
export function decideOutcome(row: TemplateRow, targetApproverId: string): TemplateOutcome {
  if (row.status !== "approved") return { kind: "already_retired" }
  if (row.approvedByUserId !== targetApproverId) return { kind: "not_targeted" }
  // El borrado es lo único que libera el par `(code, versionLabel)`. Con uso, el
  // servicio marcaría `superseded` y la plantilla quedaría irrecuperable para el
  // sembrador.
  if (row.runs > 0 || row.programs > 0) return { kind: "in_use", runs: row.runs, programs: row.programs }
  return { kind: "retire" }
}

/**
 * Las definiciones que el sembrador sabe recrear. Se derivan del catálogo y no
 * se escriben a mano: una lista propia se desincroniza del sembrador, y el
 * síntoma sería una plantilla retirada que ya nadie recrea.
 */
export function seedableDefinitions(): Set<string> {
  return new Set(PDTP_2026_INSPECTION_SPECS.map((spec) => spec.definitionCode))
}

async function resolvePermissions(userId: string): Promise<string[]> {
  const fromRoles = await db.select({ name: permissionsTable.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId))

  const direct = await db.select({ name: permissionsTable.name })
    .from(userPermissions)
    .innerJoin(permissionsTable, eq(permissionsTable.id, userPermissions.permissionId))
    .where(eq(userPermissions.userId, userId))

  return [...new Set([...fromRoles, ...direct].map((row) => row.name))].sort()
}

async function resolveUser(userId: string, label: string): Promise<{ id: string; name: string }> {
  const [user] = await db.select({ id: users.id, name: users.name })
    .from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error(`${label}: el usuario ${userId} no existe.`)
  return user
}

async function main() {
  const actorUserId = process.env.RESIGN_ACTOR_USER_ID?.trim()
  const targetApproverId = process.env.RESIGN_APPROVED_BY_USER_ID?.trim()
  if (!actorUserId || !targetApproverId) {
    throw new Error(
      "Faltan RESIGN_ACTOR_USER_ID (quien retira) y RESIGN_APPROVED_BY_USER_ID (de quién es la "
      + "firma que se corrige). Ambos quedan en el historial, así que se declaran y no se adivinan.",
    )
  }
  const actor = await resolveUser(actorUserId, "RESIGN_ACTOR_USER_ID")
  const target = await resolveUser(targetApproverId, "RESIGN_APPROVED_BY_USER_ID")

  const permissions = await resolvePermissions(actorUserId)
  if (!permissions.includes("prevention:inspections:approve")) {
    throw new Error(
      `El usuario ${actorUserId} no tiene 'prevention:inspections:approve'. `
      + "El script no puede concederse un permiso que la persona no tiene.",
    )
  }

  const access: InspectionAccess = {
    userId: actorUserId,
    scope: { mode: "all", ids: [] },
    permissions,
  }

  console.log(`Retiro de plantillas para refirma — ${DRY_RUN ? "[DRY RUN]" : "aplicando"}`)
  console.log(`  actor: ${actor.name}`)
  console.log(`  firma que se corrige: ${target.name}`)
  console.log("")

  const seedable = seedableDefinitions()
  const rows = await db.select({
    id: preventionInspectionTemplates.id,
    code: preventionInspectionTemplates.code,
    versionLabel: preventionInspectionTemplates.versionLabel,
    status: preventionInspectionTemplates.status,
    sourceDefinitionCode: preventionInspectionTemplates.sourceDefinitionCode,
    approvedByUserId: preventionInspectionTemplates.approvedByUserId,
  }).from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.status, "approved"))

  let retired = 0
  let skipped = 0
  const problems: string[] = []

  for (const row of rows) {
    const key = `${row.code}@${row.versionLabel}`

    // Una plantilla fuera del catálogo del sembrador no se recrea sola: retirarla
    // la haría desaparecer.
    const definition = row.sourceDefinitionCode ?? row.code
    if (!seedable.has(definition)) {
      if (row.approvedByUserId === targetApproverId) {
        const message = `${key}: no pertenece al catálogo del sembrador (${definition}); retirarla la dejaría sin reemplazo.`
        console.log(`  ✗ ${message}`)
        problems.push(message)
      }
      continue
    }

    const [runRow] = await db.select({ total: sql<number>`count(*)::int` })
      .from(preventionInspectionRuns).where(eq(preventionInspectionRuns.templateId, row.id))
    const [programRow] = await db.select({ total: sql<number>`count(*)::int` })
      .from(preventionInspectionPrograms).where(eq(preventionInspectionPrograms.templateId, row.id))

    const outcome = decideOutcome(
      { ...row, runs: runRow?.total ?? 0, programs: programRow?.total ?? 0 },
      targetApproverId,
    )

    if (outcome.kind === "not_targeted" || outcome.kind === "already_retired") {
      skipped++
      continue
    }
    if (outcome.kind === "in_use") {
      const message = `${key}: tiene ${outcome.runs} corrida(s) y ${outcome.programs} programa(s). Retirarla la dejaría 'superseded' y el sembrador no podría recrearla.`
      console.log(`  ✗ ${message}`)
      problems.push(message)
      continue
    }

    if (DRY_RUN) {
      console.log(`  → ${key}: se retiraría (${row.id}) y el sembrador la recrearía en borrador.`)
      retired++
      continue
    }

    const result = await retireInspectionTemplate({
      templateId: row.id,
      reason:
        `Retirada para que la habilitación la firme quien corresponde. Fue aprobada por ${target.name}, `
        + "que no es responsable del Departamento de Prevención. La constancia de una habilitación SST "
        + "no se corrige sobrescribiendo el registro —eso afirmaría que otra persona la revisó en una "
        + "fecha en que no lo hizo—, así que se retira sin uso y se vuelve a instalar en borrador para "
        + "que la revise y apruebe quien debe.",
    }, access)

    if (result.outcome !== "deleted") {
      const message = `${key}: quedó '${result.outcome}' en vez de borrada (${result.runs} corrida(s), ${result.programs} programa(s)). El sembrador no podrá recrearla.`
      console.log(`  ✗ ${message}`)
      problems.push(message)
      continue
    }
    console.log(`  ✓ ${key}: retirada; queda su constancia en el historial.`)
    retired++
  }

  console.log("")
  console.log(`Resumen: ${retired} ${DRY_RUN ? "por retirar" : "retiradas"}, ${skipped} sin cambios, ${problems.length} con problema.`)
  if (problems.length > 0) {
    console.log("")
    console.log("Revisa lo anterior antes de reintentar; el script no adivina qué quisiste.")
    process.exit(1)
  }
  if (!DRY_RUN && retired > 0) {
    console.log("")
    console.log("AHORA NO HAY NINGUNA PLANTILLA VIGENTE: nadie puede ejecutar una inspección.")
    console.log("Corré el sembrador y que se aprueben enseguida:")
    console.log("  docker compose run --rm seed-inspection-templates")
  }
  process.exit(0)
}

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
