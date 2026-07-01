"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import {
  createLegalDocument,
  addDocumentVersion,
  deliverDocument,
  acknowledgeDelivery,
} from "@/lib/services/prevention-legal-docs"
import {
  legalDocumentCreateSchema,
  legalDocumentVersionAddSchema,
  documentDeliveryCreateSchema,
  type ActionState,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/documentacion"

export async function createLegalDocumentAction(
  input: Parameters<typeof createLegalDocument>[0],
): Promise<ActionState & { data?: { id: string } }> {
  const { error } = await guardPermission("prevention:legal_docs:manage")
  if (error) return error
  const parsed = legalDocumentCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const row = await createLegalDocument(parsed.data)
    if (!row) throw new Error("No se pudo crear el documento.")
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function addDocumentVersionAction(
  input: Parameters<typeof addDocumentVersion>[0],
): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:legal_docs:manage")
  if (error) return error
  const parsed = legalDocumentVersionAddSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await addDocumentVersion(parsed.data, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function deliverDocumentAction(
  input: Parameters<typeof deliverDocument>[0],
): Promise<ActionState> {
  const { error } = await guardPermission("prevention:legal_docs:manage")
  if (error) return error
  const parsed = documentDeliveryCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await deliverDocument(parsed.data)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function acknowledgeDeliveryAction(
  deliveryId: string,
  signature: string,
): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:legal_docs:sign")
  if (error) return error
  if (!deliveryId) return { ok: false, message: "Falta el identificador de la entrega." }
  if (!signature || signature.trim().length < 2) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: { signature: ["Firma requerida"] } }
  }
  try {
    await acknowledgeDelivery(deliveryId, session.user.id, signature.trim())
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Recepción firmada." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
