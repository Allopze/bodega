import { and, asc, desc, eq, gt, lt, ne } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeSubmissions } from "@/db/schema"
import type { TaeAlert, TaeSubmissionRow } from "./types"

function computeTaeAlerts(submission: TaeSubmissionRow, previous: TaeSubmissionRow | null, next: TaeSubmissionRow | null, hasDuplicate: boolean): TaeAlert[] {
  const alerts: TaeAlert[] = []
  if (submission.manualIdentity) {
    alerts.push({ code: "manual_identity", message: "Conductor o supervisor no verificado en catálogo (identificación manual)" })
  }
  if (previous) {
    if (previous.installedSealNumber && submission.removedSealNumber && previous.installedSealNumber !== submission.removedSealNumber) {
      alerts.push({ code: "seal_mismatch", message: `Sello retirado (${submission.removedSealNumber}) no coincide con el último sello instalado (${previous.installedSealNumber})` })
    }
    if (submission.installedSealNumber && previous.installedSealNumber && submission.installedSealNumber === previous.installedSealNumber) {
      alerts.push({ code: "seal_reused", message: "El sello instalado se repite respecto a la carga anterior" })
    }
    if (submission.meterReading != null && previous.meterReading != null && submission.meterType === previous.meterType && submission.meterReading < previous.meterReading) {
      alerts.push({ code: "reading_regression", message: `Lectura (${submission.meterReading}) menor que la carga anterior (${previous.meterReading})` })
    }
  }
  // `next` ya se consultaba (para la navegación de la UI) pero nunca entraba a
  // las alertas: corregir la lectura de una carga a un valor mayor que el de
  // la carga SIGUIENTE (ya validada) no disparaba nada, porque el único
  // chequeo de regresión miraba hacia atrás.
  if (next && submission.meterReading != null && next.meterReading != null && submission.meterType === next.meterType && next.meterReading < submission.meterReading) {
    alerts.push({ code: "reading_regression", message: `Lectura (${submission.meterReading}) mayor que la carga siguiente (${next.meterReading})` })
  }
  if (hasDuplicate) {
    alerts.push({ code: "possible_duplicate", message: "Otra carga del mismo equipo tiene igual fecha, litros y lectura" })
  }
  if (submission.meterReadingSource === "ocr" && submission.ocrConfidence != null && Number(submission.ocrConfidence) < 0.7) {
    alerts.push({ code: "low_ocr_confidence", message: `Lectura OCR con baja confianza (${Math.round(Number(submission.ocrConfidence) * 100)}%). Verificar manualmente.` })
  }
  return alerts
}

/** Carga anterior/siguiente del mismo equipo y alertas de continuidad de sello/lectura/duplicado. */
export async function getTaeSubmissionContext(submission: TaeSubmissionRow): Promise<{ previous: TaeSubmissionRow | null; next: TaeSubmissionRow | null; alerts: TaeAlert[] }> {
  if (!submission.vehicleId) {
    return { previous: null, next: null, alerts: computeTaeAlerts(submission, null, null, false) }
  }
  const [previous, next, sameLiters] = await Promise.all([
    db.query.fuelTaeSubmissions.findFirst({
      where: and(eq(fuelTaeSubmissions.vehicleId, submission.vehicleId), ne(fuelTaeSubmissions.status, "voided"), lt(fuelTaeSubmissions.loadedAt, submission.loadedAt)),
      orderBy: [desc(fuelTaeSubmissions.loadedAt)],
    }),
    db.query.fuelTaeSubmissions.findFirst({
      where: and(eq(fuelTaeSubmissions.vehicleId, submission.vehicleId), ne(fuelTaeSubmissions.status, "voided"), gt(fuelTaeSubmissions.loadedAt, submission.loadedAt)),
      orderBy: [asc(fuelTaeSubmissions.loadedAt)],
    }),
    db.query.fuelTaeSubmissions.findMany({
      where: and(eq(fuelTaeSubmissions.vehicleId, submission.vehicleId), ne(fuelTaeSubmissions.status, "voided"), eq(fuelTaeSubmissions.liters, submission.liters), ne(fuelTaeSubmissions.id, submission.id)),
      columns: { id: true, loadedAt: true, meterReading: true },
    }),
  ])
  const hasDuplicate = sameLiters.some((item) =>
    item.loadedAt.slice(0, 10) === submission.loadedAt.slice(0, 10) && item.meterReading === submission.meterReading
  )
  return { previous: previous ?? null, next: next ?? null, alerts: computeTaeAlerts(submission, previous ?? null, next ?? null, hasDuplicate) }
}
