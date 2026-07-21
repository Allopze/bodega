"use server"

import { revalidatePath } from "next/cache"
import { REVALIDATE } from "./shared"

export async function revalidateBiblioteca(documentId?: string) {
  revalidatePath(REVALIDATE)
  if (documentId) revalidatePath(`${REVALIDATE}/${documentId}`)
}
