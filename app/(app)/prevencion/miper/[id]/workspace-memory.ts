"use client"

import { useEffect } from "react"

/**
 * Lo que el espacio de trabajo de la MIPER recuerda al ir y volver entre la
 * matriz, la tarea y el riesgo: qué actividades plegó la persona y dónde estaba
 * el scroll. Abrir una tarea desmonta la matriz, así que sin esto «volver»
 * llegaba arriba de todo y con todas las actividades abiertas.
 *
 * `sessionStorage` y no `history.state`: el estado del historial es de Next
 * (lo reescribe en cada navegación), y lo de aquí es preferencia de vista de
 * esta pestaña, no un dato. Toda lectura y escritura tolera que el
 * almacenamiento no exista o lance (modo privado, cuota, bloqueado): en ese
 * caso la pantalla simplemente no recuerda.
 */

const collapsedKey = (matrixId: string) => `miper:${matrixId}:collapsed`
const scrollKey = (url: string) => `miper:scroll:${url}`

export function readCollapsedActivities(matrixId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(collapsedKey(matrixId)) ?? "[]")
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [])
  } catch {
    return new Set()
  }
}

export function writeCollapsedActivities(matrixId: string, keys: Iterable<string>) {
  try { sessionStorage.setItem(collapsedKey(matrixId), JSON.stringify([...keys])) } catch { /* sin almacenamiento: no se recuerda */ }
}

export function rememberScroll(url: string, top: number) {
  try { sessionStorage.setItem(scrollKey(url), String(Math.round(top))) } catch { /* sin almacenamiento: no se recuerda */ }
}

export function readSavedScroll(url: string): number | null {
  try {
    const raw = sessionStorage.getItem(scrollKey(url))
    if (raw === null) return null
    const top = Number(raw)
    return Number.isFinite(top) && top >= 0 ? top : null
  } catch {
    return null
  }
}

/** El contenedor que scrollea: el pozo del shell, no `window` (STYLING.md). */
export const shellScroll = () => document.querySelector<HTMLElement>("[data-shell-scroll]")
/** La URL de la vista: ruta y query, que es lo que distingue una matriz filtrada de otra. */
export const currentViewUrl = () => `${window.location.pathname}${window.location.search}`

export function forgetScroll(url: string) {
  try { sessionStorage.removeItem(scrollKey(url)) } catch { /* sin almacenamiento: nada que olvidar */ }
}

/** La clave de un destino (`href` relativo o absoluto) con la misma forma que `currentViewUrl()`: ruta + query, sin origen. */
export function viewUrlOf(href: string): string {
  const url = new URL(href, window.location.href)
  return `${url.pathname}${url.search}`
}

/**
 * Antes de TODA navegación hacia adelante —`navigateWorkspace` (push y replace)
 * y los `router.push` de crear y duplicar un riesgo—: recuerda el scroll de la
 * vista que se deja y olvida el que tuviera el destino. Así sólo Atrás y
 * Adelante, que no pasan por aquí, encuentran algo que restaurar: cambiar de
 * pestaña o volver a abrir una tarea llega arriba, como cualquier navegación
 * (A2, fila 1). No depende del `popstate` de Next.
 *
 * `restoreScroll` es para los enlaces que para la persona SON «volver»
 * («‹ Volver a la matriz»): se guarda la vista que se deja pero no se olvida la
 * del destino, que la restaura al montarse.
 */
export function beforeForwardNavigation(href: string, options: { restoreScroll?: boolean } = {}) {
  const well = shellScroll()
  if (well) rememberScroll(currentViewUrl(), well.scrollTop)
  if (!options.restoreScroll) forgetScroll(viewUrlOf(href))
}

/**
 * Al montar la vista (matriz o tarea) vuelve al scroll que tenía esa URL la
 * última vez que se salió de ella. Como toda navegación hacia adelante borra la
 * clave de su destino (`beforeForwardNavigation`), sólo la encuentran Atrás y
 * Adelante, y los enlaces que son un «volver» (`restoreScroll`). Espera un cuadro
 * para que el contenido (y las actividades plegadas) ya tenga su alto.
 */
export function useRestoreWorkspaceScroll() {
  useEffect(() => {
    const top = readSavedScroll(currentViewUrl())
    if (top === null) return
    const frame = requestAnimationFrame(() => shellScroll()?.scrollTo({ top }))
    return () => cancelAnimationFrame(frame)
  }, [])
}

const fichaDraftKey = (matrixId: string, version: number) => `miper:ficha:${matrixId}:${version}`

/**
 * Borrador de la «Ficha del documento» (A2, fila 8): lo escrito y no guardado,
 * por MIPER y versión. «Atrás» cierra la ficha sin pasar por «¿Cerrar sin
 * guardar?» —un `popstate` no se cancela: Next ya navegó—, así que lo escrito
 * se guarda aquí y la ficha lo ofrece al reabrirse. La versión va en la clave:
 * si otra persona guardó la ficha, la versión cambió y el borrador viejo ya no
 * se ofrece sobre datos que no conoce.
 */
export function readFichaDraft(matrixId: string, version: number): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(fichaDraftKey(matrixId, version)) ?? "null")
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function writeFichaDraft(matrixId: string, version: number, draft: object) {
  try { sessionStorage.setItem(fichaDraftKey(matrixId, version), JSON.stringify(draft)) } catch { /* sin almacenamiento: no se recuerda */ }
}

export function clearFichaDraft(matrixId: string, version: number) {
  try { sessionStorage.removeItem(fichaDraftKey(matrixId, version)) } catch { /* sin almacenamiento: nada que borrar */ }
}
