/**
 * scripts/approve-pdtp-2026-inspection-templates.ts
 *
 * Cierra a mano lo que el sembrador del catálogo deja abierto a propósito:
 * habilita las plantillas que todavía están en borrador y retira las que
 * quedaron vigentes sin declarar ninguna actividad.
 *
 *   APPROVE_ACTOR_USER_ID=<id> npm run pdtp:approve-inspection-templates
 *   APPROVE_DRY_RUN=true  APPROVE_ACTOR_USER_ID=<id> npm run pdtp:approve-inspection-templates
 *
 * **No es un atajo alrededor de la revisión humana, es la misma operación por
 * otra puerta.** Llama a `approveInspectionTemplate` y `retireInspectionTemplate`,
 * que son las que usa la UI: retiran la vigente anterior del mismo código,
 * reasignan los programas y las ejecuciones `planned` a la versión nueva, suben
 * la `version` con lock optimista y dejan dos entradas de historial con actor y
 * motivo. Un `UPDATE ... SET status='approved'` haría sólo lo primero, y las
 * inspecciones ya programadas quedarían apuntando a una plantilla reemplazada.
 *
 * Los permisos del actor se leen de la base —roles más grants directos— y no se
 * fabrican: si la persona no tiene `prevention:inspections:approve`, el script
 * falla igual que fallaría la UI. `approved_by_user_id` es un registro de
 * cumplimiento SST con nombre y fecha; que lo firme quien corre el script es el
 * punto, no un efecto colateral.
 *
 * Idempotente: cada entrada declara el estado en que espera encontrar la
 * plantilla y se salta la que ya está donde debe estar.
 */

import { and, eq, or } from "drizzle-orm"
import { db } from "@/db"
import {
  permissions as permissionsTable,
  preventionInspectionTemplates,
  rolePermissions,
  roles,
  userPermissions,
  userRoles,
  users,
} from "@/db/schema"
import {
  approveInspectionTemplate,
  retireInspectionTemplate,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections"

const DRY_RUN = process.env.APPROVE_DRY_RUN === "true"

export type RemediationEntry = {
  /** Identidad de la plantilla: `(code, versionLabel)` tiene índice único. */
  code: string
  versionLabel: string
  action: "approve" | "retire"
  /** Estado en que la entrada espera encontrarla; cualquier otro se reporta. */
  expectStatus: "draft" | "approved"
  /** Queda en el historial para siempre: tiene que explicar el porqué. */
  reason: string
}

/**
 * Lo que quedó pendiente después de habilitar el catálogo 2026 desde la UI.
 *
 * Las tres aprobaciones son las únicas actividades del programa que siguen sin
 * instrumento vigente (la N°10, la N°40 y la N°41). Los dos retiros son casos
 * que el reemplazo automático no alcanza, cada uno por su motivo.
 */
export const PDTP_2026_TEMPLATE_REMEDIATION: readonly RemediationEntry[] = [
  {
    code: "inspeccion_condiciones_ambientales",
    versionLabel: "01",
    action: "approve",
    expectStatus: "draft",
    reason: "Habilitación del catálogo PDTP 2026 vía script: declara la actividad N°10 y sin versión aprobada esa actividad no puede acreditar ni el programa puede activarse.",
  },
  {
    code: "INSP-AREA",
    versionLabel: "01",
    action: "approve",
    expectStatus: "draft",
    reason: "Habilitación del catálogo PDTP 2026 vía script: declara la actividad N°40 y sin versión aprobada esa actividad no puede acreditar ni el programa puede activarse.",
  },
  {
    code: "CAMINATA-SEG",
    versionLabel: "01",
    action: "approve",
    expectStatus: "draft",
    reason: "Habilitación del catálogo PDTP 2026 vía script: declara la actividad N°41 y sin versión aprobada esa actividad no puede acreditar ni el programa puede activarse.",
  },
  {
    // `orphan_approved`: el reemplazo compara por `code` y el suyo es distinto
    // desde que la migración 0218 separó la EPP del jefe de terreno de la del
    // prevencionista, así que aprobar las dos nuevas no la retiró.
    code: "inspeccion_epp",
    versionLabel: "02",
    action: "retire",
    expectStatus: "approved",
    reason: "Retirada por reemplazo: sus actividades N°64 y N°65 las acreditan ahora inspeccion_epp_jt e inspeccion_epp_prf, con código propio desde la migración 0218. Quedaba vigente y ejecutable sin declarar ninguna actividad, acreditando nada.",
  },
  {
    // `duplicate_drafts`: comparte `code` con la v02 ya aprobada, así que
    // aprobarla por error retiraría la vigente buena.
    code: "inspeccion_taller",
    versionLabel: "001",
    action: "retire",
    expectStatus: "draft",
    reason: "Borrador duplicado del catálogo viejo: la versión 02 ya está aprobada y declara la N°27. Comparten código, así que aprobar este borrador retiraría la vigente correcta.",
  },
]

export type EntryOutcome =
  | { kind: "apply" }
  /** Ya está donde la entrada quería dejarla. */
  | { kind: "already_done" }
  | { kind: "missing" }
  | { kind: "unexpected_status"; found: string }

/**
 * Qué hacer con una entrada, dada la fila que hay en la base (o su ausencia).
 * Pura y exportada: es la parte que decide, y decidir sin base de datos es lo
 * que la hace testeable.
 */
export function decideOutcome(entry: RemediationEntry, row: { status: string } | undefined): EntryOutcome {
  // Retirar algo que ya no está es el resultado buscado, no un problema: el
  // servicio borra la plantilla cuando no tiene corridas ni programas.
  if (!row) return entry.action === "retire" ? { kind: "already_done" } : { kind: "missing" }
  if (row.status === entry.expectStatus) return { kind: "apply" }
  if (entry.action === "approve" && row.status === "approved") return { kind: "already_done" }
  if (entry.action === "retire" && row.status === "superseded") return { kind: "already_done" }
  return { kind: "unexpected_status", found: row.status }
}

/**
 * Los permisos reales del usuario: los que le dan sus roles más los concedidos
 * directamente. Se leen, no se declaran — un `permissions: [...]` a mano
 * convertiría `requireAccess` en decoración.
 */
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

async function resolveActor(): Promise<{ userId: string; permissions: string[] }> {
  const userId = process.env.APPROVE_ACTOR_USER_ID?.trim()
  if (!userId) {
    throw new Error(
      "Falta APPROVE_ACTOR_USER_ID. Aprobar una plantilla queda firmado con nombre y fecha, "
      + "así que el actor se declara explícitamente y no se adivina.",
    )
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error(`El usuario ${userId} no existe.`)

  const permissions = await resolvePermissions(userId)
  if (!permissions.includes("prevention:inspections:approve")) {
    throw new Error(
      `El usuario ${userId} no tiene 'prevention:inspections:approve'. `
      + "El script no puede concederse un permiso que la persona no tiene.",
    )
  }
  return { userId, permissions }
}

async function main() {
  const actor = await resolveActor()
  // `scope` no lo mira ninguna de las dos operaciones —`requireAccess` se llama
  // sin faena porque una plantilla es catálogo global, no dato de faena—, así
  // que esto no ensancha nada.
  const access: InspectionAccess = {
    userId: actor.userId,
    scope: { mode: "all", ids: [] },
    permissions: actor.permissions,
  }

  console.log(`Plantillas de inspección PDTP 2026 — ${DRY_RUN ? "[DRY RUN]" : "aplicando"} · actor=${actor.userId}`)
  console.log("")

  const rows = await db.select({
    id: preventionInspectionTemplates.id,
    code: preventionInspectionTemplates.code,
    versionLabel: preventionInspectionTemplates.versionLabel,
    status: preventionInspectionTemplates.status,
    version: preventionInspectionTemplates.version,
    // Pares exactos: dos `inArray` cruzados traerían combinaciones que no
    // existen en el plan (`inspeccion_taller` con la versión de la EPP, por
    // ejemplo) y el mapa por clave las escondería en vez de delatarlas.
  }).from(preventionInspectionTemplates).where(or(
    ...PDTP_2026_TEMPLATE_REMEDIATION.map((entry) => and(
      eq(preventionInspectionTemplates.code, entry.code),
      eq(preventionInspectionTemplates.versionLabel, entry.versionLabel),
    )),
  ))
  const byKey = new Map(rows.map((row) => [`${row.code}@${row.versionLabel}`, row]))

  let applied = 0
  let skipped = 0
  const problems: string[] = []

  for (const entry of PDTP_2026_TEMPLATE_REMEDIATION) {
    const key = `${entry.code}@${entry.versionLabel}`
    const row = byKey.get(key)
    const outcome = decideOutcome(entry, row)

    if (outcome.kind === "already_done") {
      console.log(`  · ${key}: ya está ${entry.action === "approve" ? "aprobada" : "retirada"}, omitida.`)
      skipped++
      continue
    }
    if (outcome.kind === "missing") {
      const message = `${key}: no existe en la base. ¿Corrió el sembrador del catálogo?`
      console.log(`  ✗ ${message}`)
      problems.push(message)
      continue
    }
    if (outcome.kind === "unexpected_status") {
      const message = `${key}: se esperaba '${entry.expectStatus}' y está '${outcome.found}'. No se toca.`
      console.log(`  ✗ ${message}`)
      problems.push(message)
      continue
    }

    if (DRY_RUN) {
      console.log(`  → ${key}: se ${entry.action === "approve" ? "aprobaría" : "retiraría"} (${row!.id}).`)
      applied++
      continue
    }

    if (entry.action === "approve") {
      const updated = await approveInspectionTemplate(
        { templateId: row!.id, expectedVersion: row!.version, reason: entry.reason },
        access,
      )
      console.log(`  ✓ ${key}: aprobada (${updated.id}); la vigente anterior del mismo código quedó reemplazada.`)
    } else {
      const result = await retireInspectionTemplate({ templateId: row!.id, reason: entry.reason }, access)
      console.log(
        `  ✓ ${key}: retirada — ${result.outcome === "deleted" ? "borrada (sin corridas ni programas; queda la entrada de historial)" : `marcada superseded (${result.runs} corrida(s), ${result.programs} programa(s))`}.`,
      )
    }
    applied++
  }

  console.log("")
  console.log(`Resumen: ${applied} ${DRY_RUN ? "por aplicar" : "aplicadas"}, ${skipped} sin cambios, ${problems.length} con problema.`)
  if (problems.length > 0) {
    console.log("")
    console.log("Revisa lo anterior antes de reintentar; el script no adivina qué quisiste.")
    process.exit(1)
  }
  console.log("Verifica con: docker compose run --rm preflight-pdtp-wiring")
  process.exit(0)
}

// El bundle de esbuild se ejecuta directo; el import desde un test no debe
// disparar `main`.
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
