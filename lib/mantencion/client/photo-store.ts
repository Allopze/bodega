import { STORE, idbDelete, idbGet, idbGetAll, idbPut, req, runTx } from "./db"
import { emit } from "./events"
import type { StoredPhoto } from "./types"

/**
 * Fotos como Blob en IndexedDB. Una foto sólo se borra por tres caminos, todos
 * explícitos: el mecánico la quita o la repite, descarta el borrador, o el
 * servidor confirmó el registro completo (ver `markSent` en queue.ts). Una
 * escritura sin espacio lanza `StorageFullError`: la foto no se da por guardada.
 */

export async function putPhoto(photo: StoredPhoto): Promise<void> {
  await idbPut(STORE.photos, photo)
}

export async function getPhoto(id: string): Promise<StoredPhoto | null> {
  return (await idbGet<StoredPhoto>(STORE.photos, id)) ?? null
}

export async function getPhotos(ids: readonly string[]): Promise<Array<StoredPhoto | null>> {
  return runTx([STORE.photos], "readonly", (s) => Promise.all(ids.map(async (id) => ((await req(s.photos.get(id))) as StoredPhoto | undefined) ?? null)))
}

export async function deletePhoto(id: string): Promise<void> {
  await idbDelete(STORE.photos, id)
}

export async function deletePhotos(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await runTx([STORE.photos], "readwrite", async (s) => { await Promise.all(ids.map((id) => req(s.photos.delete(id)))) })
}

export async function setPhotoUploaded(id: string, uploaded: boolean): Promise<void> {
  await runTx([STORE.photos], "readwrite", async (s) => {
    const photo = (await req(s.photos.get(id))) as StoredPhoto | undefined
    if (photo && photo.uploaded !== uploaded) await req(s.photos.put({ ...photo, uploaded }))
  })
}

/** El servidor pidió volver a subir las fotos (`missing_photos`): se marcan todas como no subidas. */
export async function resetUploaded(ids: readonly string[]): Promise<void> {
  await runTx([STORE.photos], "readwrite", async (s) => {
    for (const id of ids) {
      const photo = (await req(s.photos.get(id))) as StoredPhoto | undefined
      if (photo?.uploaded) await req(s.photos.put({ ...photo, uploaded: false }))
    }
  })
}

/** Plazo mínimo antes de limpiar una foto que ningún borrador ni envío referencia. */
export const ORPHAN_PHOTO_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Limpieza conservadora: sólo borra fotos que nada referencia Y tienen más de
 * `ORPHAN_PHOTO_MS`. Nunca toca una foto de un borrador o de un envío vivo.
 */
export async function collectOrphanPhotos(referenced: ReadonlySet<string>, now = Date.now()): Promise<number> {
  const photos = await idbGetAll<StoredPhoto>(STORE.photos)
  const orphans = photos.filter((photo) => !referenced.has(photo.id) && now - Date.parse(photo.createdAt) > ORPHAN_PHOTO_MS).map((photo) => photo.id)
  await deletePhotos(orphans)
  if (orphans.length) emit("queue")
  return orphans.length
}
