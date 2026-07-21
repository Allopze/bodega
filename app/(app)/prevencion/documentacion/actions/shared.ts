"use server"

import { headers } from "next/headers"
import type { Session } from "next-auth"
import { revalidatePath } from "next/cache"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import type { ActionState } from "@/lib/validation/masters"

export const REVALIDATE = "/prevencion/documentacion"

export function fail<T extends object = Record<string, never>>(error: unknown): ActionState & { data?: T } {
  return unexpectedActionError(error, "prevencion/documentacion/actions")
}

export async function clientCtx(session: Session) {
  const h = await headers()
  return {
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  }
}

export async function revalidateBiblioteca(documentId?: string) {
  revalidatePath(REVALIDATE)
  if (documentId) revalidatePath(`${REVALIDATE}/${documentId}`)
}
