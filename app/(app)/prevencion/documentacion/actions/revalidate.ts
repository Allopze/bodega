"use server"

import { REVALIDATE } from "./shared"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

export async function revalidateBiblioteca(documentId?: string) {
  revalidateOperationalViews([REVALIDATE, ...(documentId ? [`${REVALIDATE}/${documentId}`] : [])])
}
