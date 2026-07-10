"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { syncCopecReports } from "@/lib/combustibles/copec-sync"

export async function runCopecSyncAction(): Promise<
  | { ok: true; imported: number; pending: number; from: string; to: string }
  | { ok: false; message: string }
> {
  try {
    await requirePermission("combustibles:import")
    const result = await syncCopecReports()
    revalidatePath("/combustibles")
    revalidatePath("/combustibles/importar")
    return { ok: true, imported: result.imported, pending: result.pending, from: result.from, to: result.to }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No fue posible sincronizar Copec" }
  }
}
