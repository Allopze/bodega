import { STORE, idbGet, idbGetAllByIndex, idbPut, idbDelete } from "./db"
import { emit } from "./events"
import { deletePhotos } from "./photo-store"
import { draftKey, draftPhotoIds, type FlowDraft } from "./flow-types"
import { listQueue } from "./queue"

/**
 * Borradores: uno por cuenta y tipo de registro. Se guardan solos con un breve
 * debounce y se sueltan al firmar (misma transacción que entra a la cola) o al
 * descartar. Las fotos de un borrador sólo se borran al descartarlo, y nunca las
 * que un envío vivo (p. ej. un rechazado que se está corrigiendo) sigue usando.
 */

interface StoredDraft {
  key: string
  userId: string
  kind: "P" | "C"
  updatedAt: string
  draft: FlowDraft
}

export async function loadDraft(userId: string, kind: "P" | "C"): Promise<FlowDraft | null> {
  return (await idbGet<StoredDraft>(STORE.drafts, draftKey(userId, kind)))?.draft ?? null
}

/** Los borradores de una cuenta, el más reciente primero. */
export async function listDrafts(userId: string): Promise<FlowDraft[]> {
  const stored = await idbGetAllByIndex<StoredDraft>(STORE.drafts, "userId", userId)
  return stored.map((entry) => entry.draft).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function saveDraft(draft: FlowDraft): Promise<void> {
  const stored: StoredDraft = { key: draftKey(draft.userId, draft.kind), userId: draft.userId, kind: draft.kind, updatedAt: draft.updatedAt, draft }
  await idbPut(STORE.drafts, stored)
  emit("drafts")
}

/** Descarta el borrador y sus fotos (menos las que otro envío todavía usa). */
export async function discardDraft(draft: FlowDraft): Promise<void> {
  const inUse = new Set((await listQueue()).flatMap((item) => (item.type === "record" ? item.photoIds : [])))
  await idbDelete(STORE.drafts, draftKey(draft.userId, draft.kind))
  await deletePhotos(draftPhotoIds(draft).filter((id) => !inUse.has(id)))
  emit("drafts")
}

/**
 * Quita una foto que el mecánico repitió o quitó, salvo que un envío (p. ej. un
 * rechazado que se está corrigiendo) todavía la necesite: ese la suelta solo al
 * confirmarse. Nunca se borra una foto de la que depende un registro.
 */
export async function releasePhoto(photoId: string): Promise<void> {
  const inUse = (await listQueue()).some((item) => item.type === "record" && item.photoIds.includes(photoId))
  if (!inUse) await deletePhotos([photoId])
}

/** Todas las fotos que un borrador o un envío todavía necesitan (para la limpieza de huérfanas). */
export async function referencedPhotoIds(userIds: readonly string[]): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const userId of userIds) for (const draft of await listDrafts(userId)) for (const id of draftPhotoIds(draft)) ids.add(id)
  for (const item of await listQueue()) if (item.type === "record") for (const id of item.photoIds) ids.add(id)
  return ids
}

export interface DraftSaver {
  /** Programa el guardado; varios cambios seguidos se guardan una sola vez. */
  schedule(draft: FlowDraft): void
  /** Guarda ya lo pendiente (al salir de la app o cambiar de pantalla). */
  flush(): Promise<void>
  /** Descarta lo pendiente sin guardarlo. */
  cancel(): void
}

export function createDraftSaver(options: { delayMs?: number; onError: (error: unknown) => void }): DraftSaver {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: FlowDraft | null = null
  const write = async () => {
    const draft = pending
    pending = null
    timer = null
    if (!draft) return
    try { await saveDraft(draft) } catch (error) { options.onError(error) }
  }
  return {
    schedule(draft) {
      pending = draft
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void write() }, options.delayMs ?? 400)
    },
    async flush() {
      if (timer) clearTimeout(timer)
      await write()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}
