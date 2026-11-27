/**
 * La clave del borrador de «Nueva nota de pedido» en `localStorage` y su limpieza por prefijo. Va aparte de
 * `new-note-storage.ts` (que arrastra el modelo del formulario) para que el cierre de sesión (`use-sign-out`) la importe sin
 * cargar nada más: es sincrónica, no depende de nada y no lanza.
 */

export const NEW_NOTE_DRAFT_KEY_PREFIX = "chome:np-nueva-borrador:"

export const draftStorageKey = (userId: string) => `${NEW_NOTE_DRAFT_KEY_PREFIX}${userId}`

/**
 * Borra los borradores de nota de pedido de TODAS las personas de este equipo (cerrar sesión): lo escrito a medias vive en claro
 * en el dispositivo y un equipo de faena compartido no puede heredárselo a la persona siguiente. Por prefijo, sin conocer el
 * usuario y sin tocar claves ajenas. El almacenamiento bloqueado no lanza.
 */
export function clearAllNewNoteDrafts(): void {
  try {
    const stale: string[] = []
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key !== null && key.startsWith(NEW_NOTE_DRAFT_KEY_PREFIX)) stale.push(key)
    }
    for (const key of stale) localStorage.removeItem(key)
  } catch {
    /* almacenamiento bloqueado: no es requisito */
  }
}
