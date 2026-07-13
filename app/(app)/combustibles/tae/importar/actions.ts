"use server"

import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { generateTaeImportDryRunReport } from "@/lib/services/fuel-tae"
import { importTaeLegacyWorkbook } from "@/lib/combustibles/tae-import-service"

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
