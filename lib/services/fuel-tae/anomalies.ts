import { and, asc, desc, eq, gt, lt, ne, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { nanoid } from "@/lib/id"
import { requiredEvidenceKinds } from "@/lib/combustibles/field-load-rules"
import { maxLoadsOf, requiredEvidenceCountOf, severityOf, windowHoursOf } from "@/lib/combustibles/anomaly-detector"
import { fuelAnomalyCases, fuelAnomalyRules, fuelTaeEvidence, fuelTaeSubmissions, fuelVehicles } from "@/db/schema"
import type { TaeSubmissionRow } from "./types"

const WEEKDAY_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/** true si `loadedAtIso` cae fuera de los días/horas declarados en `operatingSchedule` del equipo. */
export function isOutsideOperatingSchedule(loadedAtIso: string, schedule: { timezone: string; days: number[]; start: string; end: string }): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(loadedAtIso))
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00"
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00"
  const isoDay = WEEKDAY_ISO[weekday]
  if (!isoDay || !schedule.days.includes(isoDay)) return true
  const time = `${hour}:${minute}`
  return time < schedule.start || time > schedule.end
}

/** Auto-detectar anomalías dentro de la transacción de revisión TAE.
 *  Escanea: sello repetido, sello no correlativo, lectura regresiva,
 *  evidencia faltante, baja confianza OCR. */
export async function detectTaeAnomaliesInTx(
  submission: TaeSubmissionRow,
  tx: Tx,
  userId: string,
  newStatus: string,
) {
  if (newStatus !== "validated" && newStatus !== "observed") return

  const now = new Date().toISOString()
  const base = {
    worksiteId: submission.worksiteId,
    vehicleId: submission.vehicleId,
    referenceEntityType: "fuel_tae_submission",
    referenceEntityId: submission.id,
  }

  // Sello repetido
  if (submission.installedSealNumber) {
    const reused = await tx.select({ id: fuelTaeSubmissions.id })
      .from(fuelTaeSubmissions)
      .where(and(
        eq(fuelTaeSubmissions.installedSealNumber, submission.installedSealNumber),
        eq(fuelTaeSubmissions.worksiteId, submission.worksiteId),
        ne(fuelTaeSubmissions.id, submission.id),
        // Una carga anulada no ocupa el sello: sin esto, corregir una carga
        // anulándola y recargándola con el mismo sello abría un caso falso.
        ne(fuelTaeSubmissions.status, "voided"),
      )).limit(1)
    if (reused.length > 0) {
      const rule = await tx.select({ id: fuelAnomalyRules.id, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules).where(and(eq(fuelAnomalyRules.code, "sello_repetido"), eq(fuelAnomalyRules.isActive, true))).limit(1)
      if (rule[0]) {
        await tx.insert(fuelAnomalyCases).values({
          id: nanoid(), ruleId: rule[0]!.id, ruleCode: "sello_repetido", severity: severityOf(rule[0]!, "high"),
          ...base, description: `Sello instalado ${submission.installedSealNumber} ya fue usado en otra carga (${reused[0]!.id}).`,
          observedValue: submission.installedSealNumber, status: "open", detectedAt: now,
        }).onConflictDoNothing()
      }
    }
  }

  // Sello no correlativo (instalado != siguiente retirado)
  if (submission.installedSealNumber && submission.vehicleId) {
    // ASC: con `desc` esto no traía "la carga siguiente" sino la ÚLTIMA carga
    // del equipo, así que la regla comparaba el sello instalado contra un sello
    // retirado meses después. Sólo cargas vigentes.
    const next = await tx.select({ id: fuelTaeSubmissions.id, removedSealNumber: fuelTaeSubmissions.removedSealNumber })
      .from(fuelTaeSubmissions)
      .where(and(
        eq(fuelTaeSubmissions.vehicleId, submission.vehicleId),
        gt(fuelTaeSubmissions.loadedAt, submission.loadedAt),
        ne(fuelTaeSubmissions.status, "voided"),
      ))
      .orderBy(asc(fuelTaeSubmissions.loadedAt))
      .limit(1)
    if (next.length > 0 && next[0]!.removedSealNumber && next[0]!.removedSealNumber !== submission.installedSealNumber) {
      const rule = await tx.select({ id: fuelAnomalyRules.id, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules).where(and(eq(fuelAnomalyRules.code, "sello_no_correlativo"), eq(fuelAnomalyRules.isActive, true))).limit(1)
      if (rule[0]) {
        await tx.insert(fuelAnomalyCases).values({
          id: nanoid(), ruleId: rule[0]!.id, ruleCode: "sello_no_correlativo", severity: severityOf(rule[0]!, "medium"),
          ...base, description: `Sello instalado ${submission.installedSealNumber} no coincide con el sello retirado en la carga siguiente (${next[0]!.removedSealNumber}).`,
          observedValue: submission.installedSealNumber, expectedValue: next[0]!.removedSealNumber, status: "open", detectedAt: now,
        }).onConflictDoNothing()
      }
    }
  }

  // Lectura regresiva
  if (submission.meterReading != null && submission.vehicleId) {
    const prev = await tx.select({ id: fuelTaeSubmissions.id, meterReading: fuelTaeSubmissions.meterReading })
      .from(fuelTaeSubmissions)
      .where(and(
        eq(fuelTaeSubmissions.vehicleId, submission.vehicleId),
        lt(fuelTaeSubmissions.loadedAt, submission.loadedAt),
        eq(fuelTaeSubmissions.meterType, submission.meterType),
        // Una lectura anulada no es la lectura anterior válida del equipo.
        ne(fuelTaeSubmissions.status, "voided"),
      ))
      .orderBy(desc(fuelTaeSubmissions.loadedAt))
      .limit(1)
    if (prev.length > 0 && prev[0]!.meterReading != null) {
      const meterLabel = submission.meterType === "hour_meter" ? "de horómetro" : "de odómetro"
      if (Number(prev[0]!.meterReading) > Number(submission.meterReading)) {
        const ruleCode = submission.meterType === "hour_meter" ? "horometro_regresivo" : "kilometraje_regresivo"
        const rule = await tx.select({ id: fuelAnomalyRules.id, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules).where(and(eq(fuelAnomalyRules.code, ruleCode), eq(fuelAnomalyRules.isActive, true))).limit(1)
        if (rule[0]) {
          await tx.insert(fuelAnomalyCases).values({
            id: nanoid(), ruleId: rule[0]!.id, ruleCode, severity: severityOf(rule[0]!, "high"),
            ...base, description: `Lectura ${meterLabel} (${submission.meterReading}) menor que la carga anterior (${prev[0]!.meterReading}).`,
            observedValue: String(submission.meterReading), expectedValue: `> ${prev[0]!.meterReading}`, status: "open", detectedAt: now,
          }).onConflictDoNothing()
        }
      } else if (Number(prev[0]!.meterReading) === Number(submission.meterReading)) {
        const ruleCode = submission.meterType === "hour_meter" ? "horometro_sin_variacion" : "kilometraje_sin_variacion"
        const rule = await tx.select({ id: fuelAnomalyRules.id, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules).where(and(eq(fuelAnomalyRules.code, ruleCode), eq(fuelAnomalyRules.isActive, true))).limit(1)
        if (rule[0]) {
          await tx.insert(fuelAnomalyCases).values({
            id: nanoid(), ruleId: rule[0]!.id, ruleCode, severity: severityOf(rule[0]!, "medium"),
            ...base, description: `Lectura ${meterLabel} (${submission.meterReading}) idéntica a la carga anterior: el equipo no registra actividad entre ambas cargas.`,
            observedValue: String(submission.meterReading), expectedValue: `≠ ${prev[0]!.meterReading}`, status: "open", detectedAt: now,
          }).onConflictDoNothing()
        }
      }
    }
  }

  // Sello inicial o final faltante (la carga permite omitirlo con `noSealReason`, pero
  // igual debe quedar como caso revisable — la justificación no exime la revisión).
  if (!submission.removedSealNumber || !submission.installedSealNumber) {
    const missing: Array<{ code: "sello_inicial_faltante" | "sello_final_faltante"; label: string }> = []
    if (!submission.removedSealNumber) missing.push({ code: "sello_inicial_faltante", label: "inicial (retirado)" })
    if (!submission.installedSealNumber) missing.push({ code: "sello_final_faltante", label: "final (instalado)" })
    for (const { code, label } of missing) {
      const rule = await tx.select({ id: fuelAnomalyRules.id, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules).where(and(eq(fuelAnomalyRules.code, code), eq(fuelAnomalyRules.isActive, true))).limit(1)
      if (rule[0]) {
        await tx.insert(fuelAnomalyCases).values({
          id: nanoid(), ruleId: rule[0]!.id, ruleCode: code, severity: severityOf(rule[0]!, "medium"),
          ...base, description: `Falta el sello ${label} en esta carga.${submission.noSealReason ? ` Motivo declarado: "${submission.noSealReason}".` : ""}`,
          observedValue: "sin sello", status: "open", detectedAt: now,
        }).onConflictDoNothing()
      }
    }
  }

  // Identidad no verificada (conductor y/o supervisor identificados manualmente, sin match en catálogo)
  if (submission.manualIdentity) {
    const rule = await tx.select({ id: fuelAnomalyRules.id, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules).where(and(eq(fuelAnomalyRules.code, "identidad_incompleta"), eq(fuelAnomalyRules.isActive, true))).limit(1)
    if (rule[0]) {
      await tx.insert(fuelAnomalyCases).values({
        id: nanoid(), ruleId: rule[0]!.id, ruleCode: "identidad_incompleta", severity: severityOf(rule[0]!, "low"),
        ...base, description: `Conductor ("${submission.driverNameSnapshot}") o supervisor ("${submission.supervisorNameSnapshot}") ingresado manualmente, sin coincidencia verificada en el catálogo de trabajadores.`,
        observedValue: "identidad manual", status: "open", detectedAt: now,
      }).onConflictDoNothing()
    }
  }

  // Evidencia faltante (menos de N fotos en carga de terreno; N configurable por regla, default 4).
  // Las fotos de sello solo se exigen cuando hay número de sello (D-9), así que
  // el mínimo nunca supera lo que esa carga estaba obligada a adjuntar.
  if (submission.source === "public_pwa" || submission.source === "internal_app") {
    const rule = await tx.select({ id: fuelAnomalyRules.id, config: fuelAnomalyRules.config, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules)
      .where(and(eq(fuelAnomalyRules.code, "evidencia_faltante"), eq(fuelAnomalyRules.isActive, true))).limit(1)
    if (rule[0]) {
      const requiredCount = Math.min(requiredEvidenceCountOf(rule[0]!, 4), requiredEvidenceKinds(submission).length)
      const evidenceCount = await tx.select({ count: sql<number>`count(*)::int` })
        .from(fuelTaeEvidence).where(eq(fuelTaeEvidence.submissionId, submission.id))
      if (evidenceCount[0]!.count < requiredCount) {
        await tx.insert(fuelAnomalyCases).values({
          id: nanoid(), ruleId: rule[0]!.id, ruleCode: "evidencia_faltante", severity: severityOf(rule[0]!, "medium"),
          ...base, description: `Sólo ${evidenceCount[0]!.count}/${requiredCount} evidencias en esta carga.`,
          observedValue: String(evidenceCount[0]!.count), expectedValue: String(requiredCount), status: "open", detectedAt: now,
        }).onConflictDoNothing()
      }
    }
  }

  if (submission.vehicleId) {
    const vehicle = await tx.query.fuelVehicles.findFirst({
      where: eq(fuelVehicles.id, submission.vehicleId),
      columns: { worksiteId: true, operatingSchedule: true, plate: true },
    })

    // Carga en faena distinta de la asignada al equipo
    if (vehicle && vehicle.worksiteId !== submission.worksiteId) {
      const rule = await tx.select({ id: fuelAnomalyRules.id, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules).where(and(eq(fuelAnomalyRules.code, "carga_faena_distinta"), eq(fuelAnomalyRules.isActive, true))).limit(1)
      if (rule[0]) {
        await tx.insert(fuelAnomalyCases).values({
          id: nanoid(), ruleId: rule[0]!.id, ruleCode: "carga_faena_distinta", severity: severityOf(rule[0]!, "medium"),
          ...base, description: `El equipo ${vehicle.plate} tiene asignada otra faena; esta carga se registró en una faena distinta.`,
          observedValue: submission.worksiteId, expectedValue: vehicle.worksiteId, status: "open", detectedAt: now,
        }).onConflictDoNothing()
      }
    }

    // Carga fuera del horario operativo declarado del equipo
    if (vehicle?.operatingSchedule && isOutsideOperatingSchedule(submission.loadedAt, vehicle.operatingSchedule)) {
      const rule = await tx.select({ id: fuelAnomalyRules.id, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules).where(and(eq(fuelAnomalyRules.code, "carga_fuera_horario"), eq(fuelAnomalyRules.isActive, true))).limit(1)
      if (rule[0]) {
        await tx.insert(fuelAnomalyCases).values({
          id: nanoid(), ruleId: rule[0]!.id, ruleCode: "carga_fuera_horario", severity: severityOf(rule[0]!, "low"),
          ...base, description: `Carga registrada fuera del horario operativo declarado para ${vehicle.plate}.`,
          observedValue: submission.loadedAt, status: "open", detectedAt: now,
        }).onConflictDoNothing()
      }
    }

    // Exceso de cargas dentro de una ventana temporal (umbral configurable, default 3 cargas en 2 horas)
    const freqRule = await tx.select({ id: fuelAnomalyRules.id, config: fuelAnomalyRules.config, severity: fuelAnomalyRules.severity }).from(fuelAnomalyRules)
      .where(and(eq(fuelAnomalyRules.code, "exceso_cargas_ventana"), eq(fuelAnomalyRules.isActive, true))).limit(1)
    if (freqRule[0]) {
      const maxLoads = maxLoadsOf(freqRule[0]!, 3)
      const windowHours = windowHoursOf(freqRule[0]!, 2)
      const windowStart = new Date(new Date(submission.loadedAt).getTime() - windowHours * 3_600_000).toISOString()
      const recent = await tx.select({ id: fuelTaeSubmissions.id }).from(fuelTaeSubmissions)
        .where(and(
          eq(fuelTaeSubmissions.vehicleId, submission.vehicleId),
          ne(fuelTaeSubmissions.status, "voided"),
          gt(fuelTaeSubmissions.loadedAt, windowStart),
          lt(fuelTaeSubmissions.loadedAt, submission.loadedAt),
        ))
      if (recent.length + 1 >= maxLoads) {
        await tx.insert(fuelAnomalyCases).values({
          id: nanoid(), ruleId: freqRule[0]!.id, ruleCode: "exceso_cargas_ventana", severity: severityOf(freqRule[0]!, "medium"),
          ...base, description: `${recent.length + 1} cargas del mismo equipo en menos de ${windowHours}h (umbral: ${maxLoads}).`,
          observedValue: String(recent.length + 1), expectedValue: `< ${maxLoads}`, status: "open", detectedAt: now,
        }).onConflictDoNothing()
      }
    }
  }
}
