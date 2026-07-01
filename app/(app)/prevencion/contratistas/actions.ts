"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import {
  createContractor,
  addContractorWorker,
  addContractorDocument,
} from "@/lib/services/prevention-contractors"
import {
  contractorCreateSchema,
  contractorWorkerAddSchema,
  contractorDocumentAddSchema,
  type ActionState,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/contratistas"

export async function createContractorAction(input: unknown): Promise<ActionState> {
  const { error } = await guardPermission("prevention:contractors:manage")
  if (error) return error
  const parsed = contractorCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await createContractor(parsed.data)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Contratista registrado." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar el contratista." }
  }
}

export async function addContractorWorkerAction(input: unknown): Promise<ActionState> {
  const { error } = await guardPermission("prevention:contractors:manage")
  if (error) return error
  const parsed = contractorWorkerAddSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await addContractorWorker(parsed.data)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Trabajador asociado al contratista." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al asociar el trabajador." }
  }
}

export async function addContractorDocumentAction(input: unknown): Promise<ActionState> {
  const { error } = await guardPermission("prevention:contractors:manage")
  if (error) return error
  const parsed = contractorDocumentAddSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await addContractorDocument(parsed.data)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Documento registrado." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar el documento." }
  }
}
