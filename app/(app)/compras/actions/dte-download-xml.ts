"use server"

import { requirePermission } from "@/lib/auth/can"
import {
  getPurchaseDteXmlDetail,
  PurchaseDteXmlError,
  type DteXmlDetail,
} from "@/lib/services/dte-portal/purchase-document-xml"

// El tipo NO se re-exporta desde acá: en un archivo "use server" todo export
// named se trata como acción, y Turbopack emitía
// `registerServerReference(DteXmlDetail, …)` sobre un binding que TypeScript
// borra al compilar — `ReferenceError` al evaluar el módulo, en producción.
// Quien lo necesite lo importa del módulo que lo declara.

export type DteXmlDownloadResult =
  | { ok: true; detail: DteXmlDetail }
  | { ok: false; error: string }

export async function downloadDteDocumentXml(
  dteDocumentId: string,
): Promise<DteXmlDownloadResult> {
  await requirePermission("purchasing:view")

  try {
    return {
      ok: true,
      detail: await getPurchaseDteXmlDetail(dteDocumentId),
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof PurchaseDteXmlError
          ? error.message
          : "No se pudo obtener el XML del DTE",
    }
  }
}
