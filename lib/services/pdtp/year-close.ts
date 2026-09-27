/**
 * lib/services/pdtp/year-close.ts
 *
 * PREV-C03.6 (tanda T5): cierre formal del año del programa.
 *
 * Hasta ahora `closed` sólo aparecía cuando una versión reemplazaba a otra, y
 * un año terminado seguía recibiendo créditos sin límite (la acreditación por
 * evento acepta `closed` a propósito, para los reintentos de una v1 superada).
 * El cierre anual es el acto explícito que dice "este año ya no admite hechos":
 *
 * - **Manual y estricto (D21).** Lo decide una persona con permiso de ciclo de
 *   vida, con motivo, y sólo si cada faena operativa tiene cerrado cada mes
 *   exigible del año. Exigible es desde la activación de la PRIMERA versión del
 *   año (o desde que la faena se incorporó, lo que ocurra después) hasta
 *   diciembre, y el cierre de cualquier versión del año vale: una v2 activada en
 *   julio no hace desaparecer los cierres de enero a junio, que son de la v1.
 *   Salvo en el mes partido por la activación de una sucesora: ahí cada
 *   versión dueña de sus semanas debe haberlo cerrado (revisión final).
 * - **No antes de que termine el año.** Diciembre tiene que poder cerrarse, y
 *   para eso el programa sigue activo en enero.
 * - **Todas las versiones a la vez.** `yearClosedAt` se escribe en cada versión
 *   del año, no sólo en la activa: la acreditación resuelve por fecha del hecho
 *   y puede caer en una versión anterior.
 */

import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpPeriodClosures, pdtpProgramWorksites, pdtpPrograms, worksites } from "@/db/schema"
import { chileDateParts, todayInChile } from "@/lib/utils"
import { addPdtpChangeLogEntry } from "./helpers"
import { effectiveActivationFor, pdtpActivationPeriod } from "./period"
import { pdtpMonthLabel } from "./period-guard"
import { listPdtpProgramOperatingWorksiteIds } from "./worksites"
import { isPdtpMonthBeforeSuccessor, resolvePdtpVersionWindows, type PdtpVersionWindow } from "./version-window"
import type { WorksiteScope } from "./helpers"

type QueryClient = Tx | typeof db

const OPEN_REVISION_STATUSES = ["draft", "in_review", "rejected"] as const

export type PdtpYearCloseMissingMonths = {
  worksiteId: string
  worksiteName: string
  /** Presente en las faenas dadas de baja, para ofrecerlas en el selector. */
  worksiteCode?: string
  /** Meses (1-12) exigibles que no tienen un cierre vigente de ninguna versión del año. */
  months: number[]
  /** La faena ya fue dada de baja: se le exigen los meses previos a la baja,
   * y la ficha del programa deja elegirla para cerrarlos. */
  deactivated?: true
  /**
   * Meses partidos por la activación de una versión sucesora en los que falta
   * el cierre de alguna de las versiones dueñas (número de versión). Un mes
   * que aparece aquí también está en `months`.
   */
  versionMonths?: Array<{ month: number; versions: number[] }>
}

export type PdtpYearCloseReadiness = {
  year: number
  /** La versión activa del año, que es la que se cierra. */
  activeProgramId: string | null
  alreadyClosed: boolean
  yearClosedAt: string | null
  canClose: boolean
  /** Motivos legibles por los que hoy no se puede cerrar, en orden de gravedad. */
  blockers: string[]
  missing: PdtpYearCloseMissingMonths[]
}

function monthsLabel(year: number, months: number[], versionMonths: PdtpYearCloseMissingMonths["versionMonths"] = []): string {
  return months.map((month) => {
    const name = pdtpMonthLabel(year, month).replace(` de ${year}`, "")
    const split = versionMonths.find((row) => row.month === month)
    return split ? `${name} (${split.versions.map((version) => `v${version}`).join(", ")})` : name
  }).join(", ")
}

/**
 * ¿La versión es dueña de alguna semana del mes? Su ventana va desde su semana
 * de activación hasta la de la sucesora (`version-window.ts`); la primera
 * versión es la línea de base de los meses anteriores a toda activación.
 */
function versionOwnsMonth(window: PdtpVersionWindow, year: number, month: number): boolean {
  if (window.from && window.from.year === year && window.from.month > month) return false
  if (window.from && window.from.year > year) return false
  return isPdtpMonthBeforeSuccessor(year, month, window.until)
}

async function computeReadiness(programId: string, client: QueryClient): Promise<PdtpYearCloseReadiness> {
  const [program] = await client.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  const year = program.year
  const versions = await client.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year))
    .orderBy(asc(pdtpPrograms.version))
  const closedVersion = versions.find((version) => version.yearClosedAt)
  if (closedVersion) {
    return {
      year,
      activeProgramId: null,
      alreadyClosed: true,
      yearClosedAt: closedVersion.yearClosedAt,
      canClose: false,
      blockers: [`El año ${year} ya está cerrado.`],
      missing: [],
    }
  }

  const blockers: string[] = []
  const active = versions.find((version) => version.status === "active") ?? null
  if (!active) blockers.push(`El año ${year} no tiene una versión activa que cerrar.`)

  // "Después de que termine el año" medido en Chile: el 31-dic a las 22:00 en
  // Santiago todavía es diciembre aunque el servidor ya diga enero en UTC.
  if (todayInChile() <= `${year}-12-31`) {
    blockers.push(`El año ${year} todavía no termina: el cierre anual se hace desde el 1 de enero de ${year + 1}, después de cerrar diciembre.`)
  }

  const openRevisions = versions.filter((version) => (OPEN_REVISION_STATUSES as readonly string[]).includes(version.status))
  if (openRevisions.length > 0) {
    blockers.push(
      `Hay ${openRevisions.length === 1 ? "una revisión abierta" : `${openRevisions.length} revisiones abiertas`} del año `
      + `(${openRevisions.map((version) => `v${version.version}`).join(", ")}): elimínala, archívala o actívala antes de cerrar el año.`,
    )
  }

  const missing: PdtpYearCloseMissingMonths[] = []
  if (active) {
    // La exigibilidad parte con la PRIMERA versión que se activó en el año; las
    // posteriores heredan los meses que la anterior ya cubría.
    const firstActivatedAt = versions
      .filter((version) => version.activatedAt)
      .map((version) => version.activatedAt!)
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null
    const operatingWorksiteIds = await listPdtpProgramOperatingWorksiteIds(active.id, client)
    const versionIds = versions.map((version) => version.id)
    const [memberships, closures, deactivatedRows] = await Promise.all([
      // Todas las versiones del año y también las membresías inactivas: una
      // faena dada de baja deja su fila con `isActive = false`.
      client.select({
        programId: pdtpProgramWorksites.programId,
        worksiteId: pdtpProgramWorksites.worksiteId,
        addedAt: pdtpProgramWorksites.addedAt,
      }).from(pdtpProgramWorksites).where(inArray(pdtpProgramWorksites.programId, versionIds)),
      client.select({
        programId: pdtpPeriodClosures.programId,
        worksiteId: pdtpPeriodClosures.worksiteId,
        month: pdtpPeriodClosures.month,
      }).from(pdtpPeriodClosures).where(and(
        inArray(pdtpPeriodClosures.programId, versionIds),
        eq(pdtpPeriodClosures.year, year),
        eq(pdtpPeriodClosures.status, "closed"),
      )),
      client.select({ id: worksites.id }).from(worksites).where(and(
        eq(worksites.isActive, false),
        isNotNull(worksites.deactivatedAt),
      )),
    ])
    // Decisión 2026-09-26: una faena dada de baja debe los meses completos
    // anteriores a su baja. Entra si operaba el programa: era miembro de alguna
    // versión del año o el programa es corporativo. Sin fecha de baja (bajas
    // anteriores a la columna) no se sabe cuándo dejó de operar y no se le exige.
    const memberIds = new Set(memberships.map((row) => row.worksiteId))
    const deactivatedCandidateIds = deactivatedRows
      .map((row) => row.id)
      .filter((id) => !operatingWorksiteIds.includes(id) && (memberIds.has(id) || active.appliesToAllWorksites))
    const candidateIds = [...operatingWorksiteIds, ...deactivatedCandidateIds]
    const worksiteRows = candidateIds.length === 0 ? [] : await client.select({
      id: worksites.id, name: worksites.name, code: worksites.code, createdAt: worksites.createdAt, deactivatedAt: worksites.deactivatedAt,
    }).from(worksites).where(inArray(worksites.id, candidateIds))
    const worksiteById = new Map(worksiteRows.map((row) => [row.id, row]))

    // La incorporación más antigua entre las versiones del año: una v2 no borra
    // lo que la faena ya debía desde la v1.
    const addedAtByWorksite = new Map<string, string>()
    for (const row of memberships) {
      const current = addedAtByWorksite.get(row.worksiteId)
      if (!current || Date.parse(row.addedAt) < Date.parse(current)) addedAtByWorksite.set(row.worksiteId, row.addedAt)
    }
    // Qué versiones cerraron cada mes de cada faena.
    const closersByWorksiteMonth = new Map<string, Set<string>>()
    for (const closure of closures) {
      const key = `${closure.worksiteId}:${closure.month}`
      const closers = closersByWorksiteMonth.get(key) ?? new Set<string>()
      closers.add(closure.programId)
      closersByWorksiteMonth.set(key, closers)
    }
    // Revisión final 2026-09-27 (hallazgo 3, T6 × T5): el mes en que se
    // activó una sucesora tiene semanas de dos versiones, y cada una lo cierra
    // revisando sólo los pendientes de sus actividades. Ahí se exige el cierre
    // de cada versión dueña que la faena opera y que todavía puede cerrar (una
    // archivada ya no). En los demás meses basta el cierre de cualquiera, como
    // antes: una v2 no hace desaparecer los cierres de la v1.
    const windows = [...resolvePdtpVersionWindows(versions).values()]
    const versionById = new Map(versions.map((version) => [version.id, version]))
    const membersByVersion = new Map<string, Set<string>>()
    for (const row of memberships) {
      const members = membersByVersion.get(row.programId) ?? new Set<string>()
      members.add(row.worksiteId)
      membersByVersion.set(row.programId, members)
    }
    const operates = (programId: string, worksiteId: string) => {
      const members = membersByVersion.get(programId)
      if (members && members.size > 0) return members.has(worksiteId)
      return Boolean(versionById.get(programId)?.appliesToAllWorksites)
    }
    const ownersByMonth = new Map<number, PdtpVersionWindow[]>()
    for (let month = 1; month <= 12; month++) {
      ownersByMonth.set(month, windows.filter((window) => versionOwnsMonth(window, year, month)))
    }
    for (const worksiteId of candidateIds) {
      const worksite = worksiteById.get(worksiteId)
      // Sin membresía (programa corporativo) la faena debe desde que existe en
      // la plataforma, no desde la activación del programa.
      const joinedAt = addedAtByWorksite.get(worksiteId) ?? worksite?.createdAt ?? null
      const activation = pdtpActivationPeriod(effectiveActivationFor(firstActivatedAt, joinedAt))
      // Activada antes del año (un programa importado) exige el año completo;
      // activada después, no exige nada.
      const firstMonth = !activation || activation.year < year ? 1 : activation.year > year ? 13 : activation.month
      const deactivated = worksite?.deactivatedAt ? chileDateParts(worksite.deactivatedAt) : null
      const lastMonth = !deactivated || deactivated.year > year ? 12 : deactivated.year < year ? 0 : deactivated.month - 1
      const months: number[] = []
      const versionMonths: NonNullable<PdtpYearCloseMissingMonths["versionMonths"]> = []
      for (let month = firstMonth; month <= lastMonth; month++) {
        const closers = closersByWorksiteMonth.get(`${worksiteId}:${month}`) ?? new Set<string>()
        const owners = ownersByMonth.get(month) ?? []
        const required = owners.length > 1
          ? owners.filter((window) => window.status !== "archived" && operates(window.programId, worksiteId))
          : []
        if (required.length > 0) {
          const pending = required.filter((window) => !closers.has(window.programId))
          if (pending.length > 0) {
            months.push(month)
            versionMonths.push({ month, versions: pending.map((window) => window.version) })
          }
        } else if (closers.size === 0) {
          months.push(month)
        }
      }
      if (months.length > 0) {
        missing.push({
          worksiteId,
          worksiteName: worksite?.name ?? worksiteId,
          months,
          ...(versionMonths.length > 0 ? { versionMonths } : {}),
          ...(deactivatedCandidateIds.includes(worksiteId) ? { worksiteCode: worksite?.code ?? "", deactivated: true as const } : {}),
        })
      }
    }
    missing.sort((left, right) => left.worksiteName.localeCompare(right.worksiteName, "es"))
    if (missing.length > 0) {
      const detail = missing.map((row) => `${row.worksiteName}: ${monthsLabel(year, row.months, row.versionMonths)}`).join("; ")
      blockers.push(`Faltan cierres mensuales del año ${year}. ${detail}.`)
    }
  }

  return {
    year,
    activeProgramId: active?.id ?? null,
    alreadyClosed: false,
    yearClosedAt: null,
    canClose: blockers.length === 0,
    blockers,
    missing,
  }
}

/** Qué falta para poder cerrar el año del programa, para mostrarlo antes de
 * pedir la confirmación. Misma regla que `closePdtpProgramYear`. */
export async function getPdtpYearCloseReadiness(programId: string): Promise<PdtpYearCloseReadiness> {
  return computeReadiness(programId, db)
}

function yearCloseReason(value: string): string {
  const reason = value.trim()
  if (reason.length < 10) throw new Error("El motivo del cierre anual debe tener al menos 10 caracteres.")
  if (reason.length > 3000) throw new Error("El motivo del cierre anual no puede superar 3000 caracteres.")
  return reason
}

/**
 * Cierra formalmente el año del programa. Idempotente para el mismo usuario y
 * motivo (un doble clic devuelve el mismo resultado).
 */
export async function closePdtpProgramYear(programId: string, userId: string, rawReason: string, scope: WorksiteScope) {
  // Cierra el año de todas las faenas a la vez: igual que editar la cobertura
  // del programa, no es una decisión que quepa en un alcance parcial.
  if (scope !== "all") throw new Error("Se requiere alcance global de faenas para cerrar el año del programa.")
  const reason = yearCloseReason(rawReason)
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ year: pdtpPrograms.year }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!target) throw new Error("Programa PDTP no encontrado.")
    // Todas las versiones del año bajo lock: un envío a revisión o una
    // activación concurrente no puede colarse entre la verificación y el cierre.
    await tx.select({ id: pdtpPrograms.id }).from(pdtpPrograms)
      .where(eq(pdtpPrograms.year, target.year)).for("update")

    const readiness = await computeReadiness(programId, tx)
    if (readiness.alreadyClosed) {
      const [closed] = await tx.select().from(pdtpPrograms)
        .where(and(eq(pdtpPrograms.year, target.year), isNotNull(pdtpPrograms.yearClosedAt)))
        .orderBy(desc(pdtpPrograms.version))
        .limit(1)
      if (closed && closed.yearClosedByUserId === userId && closed.yearCloseReason === reason) return closed
      throw new Error(readiness.blockers[0])
    }
    if (!readiness.canClose || !readiness.activeProgramId) throw new Error(readiness.blockers[0] ?? "No se puede cerrar el año.")

    const now = new Date().toISOString()
    const [closedActive] = await tx.update(pdtpPrograms)
      .set({ status: "closed", updatedAt: now })
      .where(and(eq(pdtpPrograms.id, readiness.activeProgramId), eq(pdtpPrograms.status, "active")))
      .returning()
    if (!closedActive) throw new Error("El programa cambió mientras se cerraba el año. Recarga e intenta nuevamente.")

    const closedVersions = await tx.update(pdtpPrograms)
      .set({ yearClosedAt: now, yearClosedByUserId: userId, yearCloseReason: reason, updatedAt: now })
      .where(and(eq(pdtpPrograms.year, target.year), inArray(pdtpPrograms.status, ["closed", "archived"])))
      .returning({ id: pdtpPrograms.id, version: pdtpPrograms.version })

    await addPdtpChangeLogEntry(
      closedActive.id,
      closedActive.version,
      userId,
      "lifecycle",
      { status: "active", yearClosedAt: null },
      { status: "closed", yearClosedAt: now, reason, versions: closedVersions.map((row) => row.id) },
      `Año ${target.year} cerrado formalmente: ${reason}`,
      tx,
    )
    const [updated] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, closedActive.id)).limit(1)
    return updated!
  })
}
