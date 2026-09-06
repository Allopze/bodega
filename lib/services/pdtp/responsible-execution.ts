/**
 * lib/services/pdtp/responsible-execution.ts
 *
 * ¿Cada actividad del programa tiene forma de ser ejecutada por su responsable?
 *
 * La compuerta de cumplimiento responde una pregunta vecina —"¿existe el camino
 * y está declarado?"— y la responde por actividad. Ésta la mira desde el otro
 * lado: por **persona**. La diferencia importa porque un programa puede estar
 * enteramente cableado y aun así repartir trabajo a roles que no pueden hacerlo,
 * que es exactamente lo que la auditoría del 2026-09-05 encontró: 21 de 81
 * actividades cuyo responsable declarado no tenía el permiso del acto que las
 * acredita, y un supervisor de terreno declarado en 15 y capaz de 2.
 *
 * Se calcula sin base de datos a propósito: el llamador trae las filas y esto
 * decide, así que la regla se puede probar sin migrar un esquema entero.
 *
 * Las tres respuestas posibles por actividad:
 *
 *   `ok`           alguno de sus responsables tiene el permiso del acto que la
 *                  acredita: la ejecuta en su módulo y el PDTP se entera solo.
 *   `segregada`    ninguno lo tiene **y no debe tenerlo**: el contrato declara
 *                  por qué (quien redacta el plan de emergencia no lo firma).
 *   `solo_manual`  ninguno lo tiene y nadie declaró por qué. Se puede marcar a
 *                  mano en la planilla —todos los roles responsables tienen
 *                  `prevention:pdtp:execute`— pero con evidencia autodeclarada
 *                  en vez del registro del módulo. Es la lista a revisar.
 */

import { engancheDestinationFor } from "@/lib/services/pdtp-adapters/fulfillment-contract-2026"

export type ResponsibleExecutionStatus = "ok" | "segregada" | "solo_manual"

export type ActivityExecutionRow = {
  n: number
  activity: string
  mechanism: string
  responsibleSlugs: string[]
}

export type ResponsibleCatalogRow = {
  slug: string
  /** Rol RBAC del responsable, o el rol que opera la plataforma por él (D21). */
  roleName: string | null
  operatedByRoleName: string | null
  isActive: boolean
}

export type ActivityExecutionVerdict = {
  n: number
  activity: string
  status: ResponsibleExecutionStatus
  /** Permiso del acto que la acredita. `null` si se cumple en el propio PDTP. */
  permission: string | null
  module: string
  roles: string[]
  /** Los que sí tienen el permiso. Vacío salvo en `ok`. */
  rolesWithPermission: string[]
  reason: string
}

export type ResponsibleExecutionReport = {
  total: number
  ok: number
  segregada: number
  soloManual: number
  /** Sólo las que hay que revisar: ordenadas por número. */
  needsReview: ActivityExecutionVerdict[]
  /** Por rol: en cuántas está declarado y cuántas puede ejecutar de verdad. */
  byRole: { role: string; declaredIn: number; canExecute: number; cannot: number[] }[]
}

/**
 * El permiso del acto que acredita una actividad.
 *
 * Para `constancia` y `formulario` el destino es el propio PDTP; para el resto
 * lo dice el contrato anual. No se duplica ninguna de las dos reglas: si el
 * contrato cambia, esto cambia con él.
 */
function accreditingPermissionFor(activity: { n: number; mechanism: string }): {
  permission: string | null
  module: string
  segregated?: string
} {
  if (activity.mechanism === "constancia") {
    return { permission: "prevention:constancias:execute", module: "constancias" }
  }
  if (activity.mechanism === "formulario") {
    return { permission: "prevention:pdtp:execute", module: "pdtp" }
  }
  const destination = engancheDestinationFor(activity.n)
  if (!destination) return { permission: null, module: "pdtp" }
  return { permission: destination.permission, module: destination.module, segregated: destination.segregated }
}

export function classifyPdtpResponsibleExecution(input: {
  activities: ActivityExecutionRow[]
  catalog: ResponsibleCatalogRow[]
  permissionsByRole: Map<string, Set<string>>
}): ResponsibleExecutionReport {
  const roleBySlug = new Map(
    input.catalog
      .filter((row) => row.isActive)
      .map((row) => [row.slug, row.roleName ?? row.operatedByRoleName]),
  )

  const verdicts: ActivityExecutionVerdict[] = []
  const perRole = new Map<string, { declaredIn: number; canExecute: number; cannot: number[] }>()

  for (const activity of input.activities) {
    const roles = activity.responsibleSlugs
      .map((slug) => roleBySlug.get(slug))
      .filter((role): role is string => Boolean(role))
    const destination = accreditingPermissionFor(activity)
    const holders = destination.permission
      ? roles.filter((role) => input.permissionsByRole.get(role)?.has(destination.permission!))
      : roles

    for (const role of roles) {
      const entry = perRole.get(role) ?? { declaredIn: 0, canExecute: 0, cannot: [] }
      entry.declaredIn++
      if (!destination.permission || input.permissionsByRole.get(role)?.has(destination.permission)) entry.canExecute++
      else entry.cannot.push(activity.n)
      perRole.set(role, entry)
    }

    let status: ResponsibleExecutionStatus
    let reason: string
    if (roles.length === 0) {
      status = "solo_manual"
      reason = "Ninguno de sus responsables declarados mapea a un rol RBAC real ni a un operador de plataforma."
    } else if (!destination.permission) {
      status = "ok"
      reason = "Se cumple en el propio PDTP: no hay un módulo de destino con permiso propio."
    } else if (holders.length > 0) {
      status = "ok"
      reason = `${holders.join(", ")} tiene ${destination.permission}.`
    } else if (destination.segregated) {
      status = "segregada"
      reason = destination.segregated
    } else {
      status = "solo_manual"
      reason = `Se cumple en ${destination.module} y ninguno de sus responsables (${roles.join(", ")}) tiene ${destination.permission}.`
    }

    verdicts.push({
      n: activity.n,
      activity: activity.activity,
      status,
      permission: destination.permission,
      module: destination.module,
      roles,
      rolesWithPermission: status === "ok" ? holders : [],
      reason,
    })
  }

  return {
    total: verdicts.length,
    ok: verdicts.filter((v) => v.status === "ok").length,
    segregada: verdicts.filter((v) => v.status === "segregada").length,
    soloManual: verdicts.filter((v) => v.status === "solo_manual").length,
    needsReview: verdicts.filter((v) => v.status === "solo_manual").sort((a, b) => a.n - b.n),
    byRole: [...perRole.entries()]
      .map(([role, entry]) => ({ role, ...entry, cannot: entry.cannot.sort((a, b) => a - b) }))
      .sort((a, b) => b.declaredIn - a.declaredIn),
  }
}
