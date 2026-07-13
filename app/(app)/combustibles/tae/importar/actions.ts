"use server"

import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeImportBatches, fuelTaeSubmissions } from "@/db/schema"
import { can, guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { generateTaeImportDryRunReport } from "@/lib/services/fuel-tae"
import { importTaeLegacyWorkbook } from "@/lib/combustibles/tae-import-service"
import { recordAudit, recordStatusChange } from "@/lib/audit"

const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024

export async function generateTaeImportReportAction(formData: FormData) {
  const guard = await guardPermission("combustibles:tae_import")
  if (guard.error) return guard.error

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecciona el archivo Excel del histórico TAE" }
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, message: "El archivo supera el máximo de 20 MB" }
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const report = await generateTaeImportDryRunReport(buffer)
    return {
      ok: true as const,
      data: {
        base64: report.toString("base64"),
        filename: `tae_reporte_mapeo_${new Date().toISOString().split("T")[0]}.xlsx`,
      },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo generar el reporte" }
  }
}

export async function importTaeHistoryAction(formData: FormData) {
  const guard = await guardPermission("combustibles:tae_import")
  if (guard.error) return guard.error
  if (formData.get("confirmation") !== "IMPORTAR") return { ok: false, message: "Debes confirmar que revisaste el reporte de mapeo" }
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Selecciona el archivo Excel del histórico TAE" }
  if (file.size > MAX_IMPORT_FILE_BYTES) return { ok: false, message: "El archivo supera el máximo de 20 MB" }
  try {
    const scope = resolveWorksiteScope(guard.session)
    const result = await importTaeLegacyWorkbook({
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      userId: guard.session.user.id,
      allowedWorksiteIds: scope.mode === "all" ? undefined : new Set(scope.mode === "some" ? scope.ids : []),
    })
    return { ok: true as const, data: result, message: `${result.importedRows} cargas históricas importadas` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo importar el histórico TAE" }
  }
}

export async function revertTaeImportBatchAction(batchId: string) {
  const guard = await guardPermission("combustibles:tae_import")
  if (guard.error) return guard.error
  if (!can(guard.session, "combustibles:revert")) {
    return { ok: false as const, message: "No tienes permiso para revertir lotes" }
  }
  if (!batchId) return { ok: false as const, message: "Lote requerido" }

  try {
    const result = await db.transaction(async (tx) => {
      const [batch] = await tx
        .update(fuelTaeImportBatches)
        .set({ status: "reverted", updatedAt: new Date().toISOString() })
        .where(and(eq(fuelTaeImportBatches.id, batchId), eq(fuelTaeImportBatches.status, "imported")))
        .returning()

      if (!batch) {
        const existing = await tx.query.fuelTaeImportBatches.findFirst({
          where: eq(fuelTaeImportBatches.id, batchId),
          columns: { status: true },
        })
        if (!existing) throw new Error("Lote no encontrado")
        throw new Error("Este lote ya fue revertido")
      }

      const removed = await tx
        .delete(fuelTaeSubmissions)
        .where(eq(fuelTaeSubmissions.importBatchId, batchId))
        .returning({ id: fuelTaeSubmissions.id })

      await recordAudit({
        userId: guard.session.user.id,
        userEmail: guard.session.user.email ?? undefined,
        action: "delete",
        entityType: "fuel_tae_import_batch",
        entityId: batchId,
        oldState: { status: "imported", submissions: removed.length },
        newState: { status: "reverted", submissions: 0 },
        reason: "Reversa de importación histórica TAE",
      }, tx)
      await recordStatusChange({
        entityType: "fuel_tae_import_batch",
        entityId: batchId,
        fromStatus: "imported",
        toStatus: "reverted",
        changedBy: guard.session.user.id,
        reason: `Reversa transaccional de ${removed.length} cargas`,
      }, tx)

      return { removed: removed.length }
    })

    revalidatePath("/combustibles")
    revalidatePath("/combustibles/tae")
    revalidatePath("/combustibles/tae/importar")
    revalidatePath("/combustibles/tae/importar/historial")
    revalidatePath(`/combustibles/tae/importar/${batchId}`)
    return { ok: true as const, message: `Lote revertido: ${result.removed} cargas eliminadas`, data: result }
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "No se pudo revertir el lote" }
  }
}
