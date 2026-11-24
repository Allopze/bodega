/**
 * Recolección de los procesos de Chromium que Playwright deja vivos.
 *
 * El bug que motiva este módulo (medido en producción el 2026-11-24):
 * `launchServer()` arranca un driver de Playwright que a su vez hace spawn de
 * Chromium. Cuando una lectura del portal se va por timeout, `server.kill()`
 * mata al driver, y Chromium —que es su hijo— queda reparentado a PID 1 y
 * **sigue girando**. Cada `ONWAY_PORTAL_TIMEOUT` dejaba así un renderer al
 * 100 % de CPU para siempre: se encontraron árboles de 4 h y 18 h, ocho
 * renderers al 100 % en total, con el host a load average 12.
 *
 * La clave que hace el arreglo determinista: en este entorno cada Chromium es
 * líder de su propio grupo de procesos (`pgid == pid`, verificado en el
 * servidor), así que matar el grupo entero con `kill(-pid)` se lleva al proceso
 * y a todos sus hijos de una vez, sin depender de que el padre haya sobrevivido.
 *
 * Es Linux-específico a propósito: el scraper corre en un contenedor Alpine en
 * el servidor, y leer `/proc` es más fiable que shell-ear a `ps`/`pgrep` (que
 * además no vienen en la imagen). En otro sistema operativo la recolección se
 * declara no disponible y el cierre se queda con el camino de Playwright; no se
 * inventa un fallback que podría matar procesos ajenos.
 */
import { readdirSync, readFileSync } from "node:fs"

/** Un proceso de Chromium visto por `/proc`. */
export interface ChromiumProcess {
  pid: number
  ppid: number
  pgid: number
  /** `Z` es un zombie: ya terminó, sólo espera que su padre lo recoja. */
  state: string
  comm: string
}

const CHROMIUM_COMM = new Set(["chromium", "chrome", "chrome_crashpad", "headless_shell"])

function readStat(pid: number): { ppid: number; pgid: number; state: string } | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    // El campo `comm` va entre paréntesis y puede contener espacios, así que se
    // corta por el último `)`: dividir todo el archivo por espacios corre los
    // índices cuando el nombre del ejecutable trae uno.
    const close = stat.lastIndexOf(")")
    if (close === -1) return null
    const fields = stat.slice(close + 2).split(" ")
    // Tras `comm`, los campos son: state ppid pgrp ... (índices 0, 1, 2).
    return {
      state: fields[0] ?? "",
      ppid: Number(fields[1]),
      pgid: Number(fields[2]),
    }
  } catch {
    return null
  }
}

function readComm(pid: number): string {
  try { return readFileSync(`/proc/${pid}/comm`, "utf8").trim() }
  catch { return "" }
}

/**
 * Procesos de Chromium vivos (no zombies) en el espacio de procesos actual.
 * Un proceso que desaparece entre el `readdir` y la lectura de `/proc` se
 * ignora: la lista es un censo, no un contrato estable.
 */
export function listChromiumProcesses(): ChromiumProcess[] {
  let entries: string[]
  try { entries = readdirSync("/proc") }
  catch { return [] }

  const processes: ChromiumProcess[] = []
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    const comm = readComm(pid)
    if (!CHROMIUM_COMM.has(comm)) continue
    const stat = readStat(pid)
    if (!stat || stat.state === "Z") continue
    processes.push({ pid, ppid: stat.ppid, pgid: stat.pgid, state: stat.state, comm })
  }
  return processes
}

/**
 * Los descendientes de `rootPid` (sin incluirlo), leídos antes de matar al
 * padre. Se captura la lista ANTES porque, una vez que el driver muere, sus
 * hijos quedan reparentados a PID 1 y el parentesco se pierde: ese es
 * exactamente el estado en el que quedaban girando.
 */
export function descendantsOf(rootPid: number, processes: ChromiumProcess[]): ChromiumProcess[] {
  const childrenByParent = new Map<number, ChromiumProcess[]>()
  for (const process of processes) {
    const siblings = childrenByParent.get(process.ppid) ?? []
    siblings.push(process)
    childrenByParent.set(process.ppid, siblings)
  }
  const found: ChromiumProcess[] = []
  const pending = [rootPid]
  const seen = new Set<number>([rootPid])
  while (pending.length > 0) {
    const parent = pending.pop() as number
    for (const child of childrenByParent.get(parent) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      found.push(child)
      pending.push(child.pid)
    }
  }
  return found
}

/** Grupos de proceso distintos de una lista: el `kill` se hace por grupo. */
export function processGroups(processes: ChromiumProcess[]): number[] {
  return [...new Set(processes.map((process) => process.pgid))]
}

/**
 * Señal a un grupo entero. `process.kill` con un pid negativo apunta al grupo
 * (POSIX). Un grupo que ya no existe lanza `ESRCH`; eso no es un fallo.
 */
function signalGroup(pgid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pgid, signal)
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Mata los grupos indicados: `SIGTERM` primero (deja que Chromium cierre sus
 * temporales) y `SIGKILL` a lo que siga vivo pasado `graceMs`. Devuelve cuántos
 * procesos quedaron vivos de esa lista, que en el caso sano es cero.
 */
export async function killProcessGroupsAndWait(
  groups: readonly number[],
  options: { graceMs?: number; now?: () => number } = {},
): Promise<{ terminated: number; killed: number; survived: number[] }> {
  const graceMs = options.graceMs ?? 3_000
  const now = options.now ?? Date.now
  const wanted = new Set(groups)

  const aliveInGroups = () => listChromiumProcesses().filter((process) => wanted.has(process.pgid))

  let terminated = 0
  for (const pgid of groups) {
    if (signalGroup(pgid, "SIGTERM")) terminated++
  }

  const giveUpAt = now() + graceMs
  while (now() < giveUpAt) {
    if (aliveInGroups().length === 0) return { terminated, killed: 0, survived: [] }
    await delay(100)
  }

  let killed = 0
  for (const pgid of groups) {
    if (signalGroup(pgid, "SIGKILL")) killed++
  }

  // El `SIGKILL` es inmediato, pero el proceso puede tardar en dejar de verse
  // como vivo: se le da un instante antes de declarar que sobrevivió.
  await delay(200)
  const survived = aliveInGroups().map((process) => process.pid)
  return { terminated, killed, survived }
}
