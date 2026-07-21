"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createDocumentFolder,
  renameDocumentFolder,
  moveDocumentFolder,
  archiveDocumentFolder,
  restoreDocumentFolder,
  moveDocumentToFolder,
} from "@/lib/services/prevention-documents-library"
import {
  sstDocumentFolderCreateSchema,
  sstDocumentFolderUpdateSchema,
  sstDocumentFolderMoveSchema,
  sstDocumentMoveSchema,
} from "@/lib/validation/prevention"
import type { ActionState } from "@/lib/validation/masters"
import { clientCtx, fail, REVALIDATE } from "./shared"

export async function createSstDocumentFolderAction(input: { name: string; parentId?: string | null; worksiteId?: string | null }): Promise<ActionState & { data?: { id: string } }> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentFolderCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa el nombre de la carpeta.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const folder = await createDocumentFolder({
      input: parsed.data,
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta creada.", data: { id: folder.id } }
  } catch (e) {
    return fail(e)
  }
}

export async function renameSstDocumentFolderAction(input: { id: string; name: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentFolderUpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Revisa el nombre de la carpeta." }
  try {
    await renameDocumentFolder({ input: parsed.data, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta renombrada." }
  } catch (e) {
    return fail(e)
  }
}

export async function moveSstDocumentFolderAction(input: { id: string; parentId?: string | null }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentFolderMoveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Destino inválido." }
  try {
    await moveDocumentFolder({ input: parsed.data, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta movida." }
  } catch (e) {
    return fail(e)
  }
}

export async function archiveSstDocumentFolderAction(input: { id: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:archive")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await archiveDocumentFolder({ input, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta archivada." }
  } catch (e) {
    return fail(e)
  }
}

export async function restoreSstDocumentFolderAction(input: { id: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:archive")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await restoreDocumentFolder({ input, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carpeta restaurada." }
  } catch (e) {
    return fail(e)
  }
}

export async function moveSstDocumentAction(input: { id: string; folderId?: string | null }): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = sstDocumentMoveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Destino inválido." }
  try {
    await moveDocumentToFolder({ input: parsed.data, ctx: await clientCtx(session), scope: resolveWorksiteScope(session) })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.data.id}`)
    return { ok: true, message: "Documento movido." }
  } catch (e) {
    return fail(e)
  }
}
