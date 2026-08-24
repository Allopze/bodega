"use server"

import { requirePermission } from "@/lib/auth/can"
import {
  getPurchaseDteXmlDetail,
  PurchaseDteXmlError,
  type DteXmlDetail,
} from "@/lib/services/dte-portal/purchase-document-xml"

export type { DteXmlDetail }

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
