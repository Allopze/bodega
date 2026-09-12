/**
 * scripts/reclassify-pdtp-2026-specific-courses.ts
 *
 * Corrige la clasificación de tres cursos del programa 2026 que quedaron
 * declarados como `legal_mandatory` sin serlo.
 *
 *   RECLASSIFY_ACTOR_USER_ID=<id> npm run pdtp:reclassify-specific-courses
 *   RECLASSIFY_DRY_RUN=true RECLASSIFY_ACTOR_USER_ID=<id> npm run pdtp:reclassify-specific-courses
 *
 * **Por qué existe y no se hace desde la UI.** `legal_mandatory` significa, en
 * este código, "curso del artículo 16 del DS 44": ocho horas mínimo y vigencia
 * declarada de a lo más 24 meses (`assessLegalFloor`). Extintores, EPP y la
 * capacitación del Coordinador GRD son capacitaciones **específicas**, con
 * obligación y contenido propios —el DS 594 art. 48 exige instruir y entrenar
 * en el uso de extintores y el art. 53 exige capacitación teórica y práctica
 * para el EPP, ninguno de los dos con piso de ocho horas—, así que declararlas
 * como el curso general era el error.
 *
 * El efecto de ese error es que HOY no se puede crear la versión de esos
 * cursos: `createTrainingCourseVersion` corre `assessLegalFloor` y la rechaza.
 * Y no hay `updateTrainingCourse` en la capa de servicio —sólo `create`—, así
 * que no existe pantalla ni función que permita corregirlo. De ahí que el
 * arreglo sea un script y no un clic.
 *
 * Llegaron mal por `apply-pdtp-2026-program-data.ts`, que inserta los cursos
 * con `db.insert` directo y por eso se salta `createTrainingCourse` y su
 * validación. Corregir ese catálogo no basta: usa `onConflictDoNothing`, así
 * que no toca las filas ya existentes. Hacen falta las dos cosas.
 *
 * No toca la duración a propósito. Una vez reclasificados, `assessLegalFloor`
 * no aplica y la duración queda libre de corregir cuando lleguen las fichas
 * reales de los organismos administradores, sin bloquear nada mientras tanto.
 */

import { eq, or } from "drizzle-orm"
import { db } from "@/db"
import {
  permissions as permissionsTable,
  preventionTrainingCourses,
  preventionTrainingHistory,
  rolePermissions,
  roles,
  userPermissions,
  userRoles,
  users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"

const DRY_RUN = process.env.RECLASSIFY_DRY_RUN === "true"

/**
 * Queda en `legal_basis` y en el historial. Explica que la baja aparente de 8
 * horas a 4/2 no es una rebaja del estándar: el curso del artículo 16 sigue
 * siendo una obligación distinta, con su propia duración y cobertura.
 */
const TRACEABILITY_NOTE =
  "Se reclasifica desde capacitación Art. 16 DS 44 a capacitación específica. "
  + "La modificación no elimina el cumplimiento del curso general del artículo 16: "
  + "es una obligación distinta que mantiene separadamente su duración mínima y su "
  + "cobertura integral de contenidos."

export type ReclassifyEntry = {
  /** `code` del curso; tiene índice único. */
  code: string
  /** Clasificación en la que la entrada espera encontrarlo. */
  expectKind: string
  /** Clasificación correcta. */
  toKind: string
  /** Base legal corregida. `null` deja la que ya tiene. */
  legalBasis: string | null
  /** Queda en el historial: tiene que explicar el porqué. */
  reason: string
}

export const PDTP_2026_COURSE_RECLASSIFICATION: readonly ReclassifyEntry[] = [
  {
    code: "PDTP-54",
    expectKind: "legal_mandatory",
    toKind: "practical_training",
    // La base legal declarada eran los art. 44 y 45, que obligan a DISPONER de
    // extintores. El que obliga a capacitar es el 48.
    legalBasis: `DS 594 art. 48 (instrucción y entrenamiento en uso de extintores). ${TRACEABILITY_NOTE}`,
    reason:
      "Capacitación específica de prevención y protección contra incendios, no el curso general del "
      + "art. 16 del DS 44. El uso de extintores es una de las materias de ese curso y además una "
      + "obligación propia del DS 594 art. 48, que exige instruir y entrenar sin fijar piso de 8 horas.",
  },
  {
    code: "PDTP-58",
    expectKind: "legal_mandatory",
    toKind: "practical_training",
    legalBasis: `Designación y formación del Coordinador GRD del centro de trabajo. ${TRACEABILITY_NOTE}`,
    reason:
      "Capacitación específica del rol de Coordinador de Gestión del Riesgo de Desastres, no el curso "
      + "general del art. 16 del DS 44. Hoy pasa el piso legal sólo porque declara 480 minutos; al "
      + "corregir la duración a la de la ficha real del organismo administrador quedaría bloqueada.",
  },
  {
    code: "PDTP-63",
    expectKind: "legal_mandatory",
    toKind: "practical_training",
    legalBasis: `DS 594 art. 53 (capacitación teórica y práctica para el correcto empleo del EPP). ${TRACEABILITY_NOTE}`,
    reason:
      "Capacitación específica de uso y mantención de EPP, no el curso general del art. 16 del DS 44. "
      + "El DS 594 art. 53 exige capacitación teórica y práctica sin piso de 8 horas, y SUSESO regula "
      + "por separado un programa de capacitación en uso y mantención de EPP con contenidos propios.",
  },
]

export type EntryOutcome =
  | { kind: "apply" }
  /** Ya está en la clasificación de destino. */
  | { kind: "already_done" }
  | { kind: "missing" }
  | { kind: "unexpected_kind"; found: string }

/**
 * Qué hacer con una entrada, dada la fila que hay en la base (o su ausencia).
 * Pura y exportada: es la parte que decide, y decidir sin base de datos es lo
 * que la hace testeable.
 */
export function decideOutcome(entry: ReclassifyEntry, row: { kind: string } | undefined): EntryOutcome {
  if (!row) return { kind: "missing" }
  if (row.kind === entry.toKind) return { kind: "already_done" }
  if (row.kind === entry.expectKind) return { kind: "apply" }
  return { kind: "unexpected_kind", found: row.kind }
}

/**
 * Los permisos reales del usuario: los que le dan sus roles más los concedidos
 * directamente. Se leen, no se declaran — un `permissions: [...]` a mano
 * convertiría la comprobación en decoración.
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

async function resolveActor(): Promise<string> {
  const userId = process.env.RECLASSIFY_ACTOR_USER_ID?.trim()
  if (!userId) {
    throw new Error(
      "Falta RECLASSIFY_ACTOR_USER_ID. La reclasificación queda registrada en el historial "
      + "con nombre y fecha, así que el actor se declara explícitamente y no se adivina.",
    )
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error(`El usuario ${userId} no existe.`)

  const permissions = await resolvePermissions(userId)
  // El mismo permiso que exige `createTrainingCourse`: quien no podría crear el
  // curso tampoco puede reclasificarlo.
  if (!permissions.includes("prevention:training:manage")) {
    throw new Error(
      `El usuario ${userId} no tiene 'prevention:training:manage'. `
      + "El script no puede concederse un permiso que la persona no tiene.",
    )
  }
  return userId
}

async function main() {
  const actorUserId = await resolveActor()

  console.log(`Reclasificación de cursos específicos PDTP 2026 — ${DRY_RUN ? "[DRY RUN]" : "aplicando"} · actor=${actorUserId}`)
  console.log("")

  const rows = await db.select({
    id: preventionTrainingCourses.id,
    code: preventionTrainingCourses.code,
    name: preventionTrainingCourses.name,
    kind: preventionTrainingCourses.kind,
    minimumDurationMinutes: preventionTrainingCourses.minimumDurationMinutes,
    validityMonths: preventionTrainingCourses.validityMonths,
    legalBasis: preventionTrainingCourses.legalBasis,
  }).from(preventionTrainingCourses).where(or(
    ...PDTP_2026_COURSE_RECLASSIFICATION.map((entry) => eq(preventionTrainingCourses.code, entry.code)),
  ))
  const byCode = new Map(rows.map((row) => [row.code, row]))

  let applied = 0
  let skipped = 0
  const problems: string[] = []

  for (const entry of PDTP_2026_COURSE_RECLASSIFICATION) {
    const row = byCode.get(entry.code)
    const outcome = decideOutcome(entry, row)

    if (outcome.kind === "already_done") {
      console.log(`  · ${entry.code}: ya está como '${entry.toKind}', omitido.`)
      skipped++
      continue
    }
    if (outcome.kind === "missing") {
      const message = `${entry.code}: no existe en la base. ¿Corrió apply-pdtp-program-data?`
      console.log(`  ✗ ${message}`)
      problems.push(message)
      continue
    }
    if (outcome.kind === "unexpected_kind") {
      const message = `${entry.code}: se esperaba '${entry.expectKind}' y está '${outcome.found}'. No se toca.`
      console.log(`  ✗ ${message}`)
      problems.push(message)
      continue
    }

    const before = row!
    if (DRY_RUN) {
      console.log(`  → ${entry.code} (${before.name}): '${before.kind}' → '${entry.toKind}'; ${before.minimumDurationMinutes} min sin cambios.`)
      applied++
      continue
    }

    // Transacción: la fila y su entrada de historial entran juntas o no entra
    // ninguna. Una reclasificación sin constancia es exactamente lo que este
    // script viene a evitar.
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(preventionTrainingCourses)
        .set({
          kind: entry.toKind,
          ...(entry.legalBasis === null ? {} : { legalBasis: entry.legalBasis }),
        })
        .where(eq(preventionTrainingCourses.id, before.id))
        .returning()
      if (!updated) throw new Error(`No se pudo actualizar ${entry.code}.`)

      await tx.insert(preventionTrainingHistory).values({
        id: `ptrh-${nanoid()}`,
        entityType: "course",
        entityId: before.id,
        changeType: "reclassified",
        reason: `${entry.reason} ${TRACEABILITY_NOTE}`,
        beforeState: before as unknown as Record<string, unknown>,
        afterState: updated as unknown as Record<string, unknown>,
        actorUserId,
      })
    })
    console.log(`  ✓ ${entry.code} (${before.name}): '${before.kind}' → '${entry.toKind}'; base legal y constancia registradas.`)
    applied++
  }

  console.log("")
  console.log(`Resumen: ${applied} ${DRY_RUN ? "por aplicar" : "reclasificados"}, ${skipped} sin cambios, ${problems.length} con problema.`)
  if (problems.length > 0) {
    console.log("")
    console.log("Revisa lo anterior antes de reintentar; el script no adivina qué quisiste.")
    process.exit(1)
  }
  console.log("Estos cursos ya admiten crear su versión: `assessLegalFloor` sólo aplica a `legal_mandatory`.")
  process.exit(0)
}

// El bundle de esbuild se ejecuta directo; el import desde un test no debe
// disparar `main`.
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
