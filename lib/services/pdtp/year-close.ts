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
 * - **No antes de que termine el año.** Diciembre tiene que poder cerrarse, y
 *   para eso el programa sigue activo en enero.
 * - **Todas las versiones a la vez.** `yearClosedAt` se escribe en cada versión
 *   del año, no sólo en la activa: la acreditación resuelve por fecha del hecho
 *   y puede caer en una versión anterior.
 */

import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpPeriodClosures, pdtpProgramWorksites, pdtpPrograms, worksites } from "@/db/schema"
import { todayInChile } from "@/lib/utils"
import { addPdtpChangeLogEntry } from "./helpers"
import { effectiveActivationFor, pdtpActivationPeriod } from "./period"
import { pdtpMonthLabel } from "./period-guard"
import { listPdtpProgramOperatingWorksiteIds } from "./worksites"
import type { WorksiteScope } from "./helpers"

type QueryClient = Tx | typeof db

const OPEN_REVISION_STATUSES = ["draft", "in_review", "rejected"] as const

export type PdtpYearCloseMissingMonths = {
  worksiteId: string
  worksiteName: string
  /** Meses (1-12) exigibles que no tienen un cierre vigente de ninguna versión del año. */
  months: number[]
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

function monthsLabel(year: number, months: number[]): string {
  return months.map((month) => pdtpMonthLabel(year, month).replace(` de ${year}`, "")).join(", ")
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
    const [memberships, closures, worksiteRows] = await Promise.all([
      operatingWorksiteIds.length === 0 ? [] : client.select({
        worksiteId: pdtpProgramWorksites.worksiteId,
        addedAt: pdtpProgramWorksites.addedAt,
      }).from(pdtpProgramWorksites).where(and(
        eq(pdtpProgramWorksites.programId, active.id),
        eq(pdtpProgramWorksites.isActive, true),
        inArray(pdtpProgramWorksites.worksiteId, operatingWorksiteIds),
      )),
      client.select({
        worksiteId: pdtpPeriodClosures.worksiteId,
        month: pdtpPeriodClosures.month,
      }).from(pdtpPeriodClosures).where(and(
        inArray(pdtpPeriodClosures.programId, versions.map((version) => version.id)),
        eq(pdtpPeriodClosures.year, year),
        eq(pdtpPeriodClosures.status, "closed"),
      )),
      operatingWorksiteIds.length === 0 ? [] : client.select({ id: worksites.id, name: worksites.name })
        .from(worksites).where(inArray(worksites.id, operatingWorksiteIds)),
    ])
    const addedAtByWorksite = new Map(memberships.map((row) => [row.worksiteId, row.addedAt]))
    const closedMonthsByWorksite = new Map<string, Set<number>>()
    for (const closure of closures) {
      const months = closedMonthsByWorksite.get(closure.worksiteId) ?? new Set<number>()
      months.add(closure.month)
      closedMonthsByWorksite.set(closure.worksiteId, months)
    }
    const nameById = new Map(worksiteRows.map((row) => [row.id, row.name]))
    for (const worksiteId of operatingWorksiteIds) {
      const activation = pdtpActivationPeriod(effectiveActivationFor(firstActivatedAt, addedAtByWorksite.get(worksiteId) ?? null))
      // Activada antes del año (un programa importado) exige el año completo;
      // activada después, no exige nada.
      const firstMonth = !activation || activation.year < year ? 1 : activation.year > year ? 13 : activation.month
      const closed = closedMonthsByWorksite.get(worksiteId) ?? new Set<number>()
      const months: number[] = []
      for (let month = firstMonth; month <= 12; month++) {
        if (!closed.has(month)) months.push(month)
      }
      if (months.length > 0) missing.push({ worksiteId, worksiteName: nameById.get(worksiteId) ?? worksiteId, months })
    }
    missing.sort((left, right) => left.worksiteName.localeCompare(right.worksiteName, "es"))
    if (missing.length > 0) {
      const detail = missing.map((row) => `${row.worksiteName}: ${monthsLabel(year, row.months)}`).join("; ")
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
