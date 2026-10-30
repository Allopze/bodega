import { formatDate, formatDateRelative, formatDateTime } from "@/lib/utils"
import type { DeviceCredentialRow, DeviceCredentialStatus } from "./device-credentials"

/**
 * Vista de «Dispositivos» de la app del mecánico: las credenciales agrupadas por
 * persona y con un rótulo que se pueda leer. Módulo PURO (sólo tipos de
 * `device-credentials.ts`, que tiene la base de datos): la página de servidor
 * agrupa y la lista del cliente sólo pinta, así los textos relativos («hoy»,
 * «hace 5 días») se calculan una vez, en el servidor, y no cambian entre el HTML
 * y la hidratación.
 */

export interface DeviceView {
  id: string
  /** «Chrome en Android»: lo que `deviceLabel()` de la app guardó, dicho como lo diría una persona. */
  name: string
  status: DeviceCredentialStatus
  /** «hoy, 12:53» / «hace 5 días (25-10-2026)» / «Todavía no sincroniza». */
  lastUse: string
  /** «28-10-2026». */
  connected: string
  /** «27-11-2026»: vence, venció o fue revocada, según el estado. */
  endDate: string
  /** Primeros 8 caracteres del id del dispositivo: lo que distingue a dos teléfonos del mismo modelo. */
  code: string
  /** Texto que la búsqueda de la barra superior compara (sin normalizar). */
  searchText: string
}

export interface DevicePersonGroup {
  userId: string
  userName: string
  userEmail: string
  /** Credenciales vigentes: lo que la persona tiene conectado hoy. Las usadas hace menos primero. */
  active: DeviceView[]
  /** Vencidas y revocadas, la más reciente primero. */
  past: DeviceView[]
}

const KNOWN_SYSTEMS = new Set(["iPad", "iPhone", "Android", "Windows", "Mac"])
const KNOWN_BROWSERS = new Set(["Edge", "Firefox", "Chrome", "Safari"])

/**
 * `deviceLabel()` de la app guarda «Sistema · Navegador» («Android · Chrome») y
 * usa «Dispositivo» / «navegador» cuando no logra reconocer uno u otro. Aquí se
 * dice al revés y en cristiano; una etiqueta con otra forma se muestra tal cual.
 */
export function friendlyDeviceName(label: string | null | undefined): string {
  const text = label?.trim()
  if (!text) return "Dispositivo sin nombre"
  const match = /^(\S+) · (\S+)$/.exec(text)
  if (!match) return text
  const [, system, browser] = match as unknown as [string, string, string]
  const knownSystem = KNOWN_SYSTEMS.has(system)
  const knownBrowser = KNOWN_BROWSERS.has(browser)
  if (system !== "Dispositivo" && !knownSystem) return text
  if (knownSystem && knownBrowser) return `${browser} en ${system}`
  // Lo que no se reconoció no se dice: «sistema sin identificar» repetido en cada renglón no ayuda a distinguirlos.
  if (knownBrowser) return browser
  if (knownSystem) return system
  return "Dispositivo sin identificar"
}

/** «hoy, 12:53», «ayer, 19:10», «hace 5 días (25-10-2026)». */
export function describeLastUse(lastUsedAt: string | null, now: Date): string {
  if (!lastUsedAt) return "Todavía no sincroniza"
  const when = new Date(lastUsedAt)
  if (Number.isNaN(when.getTime())) return "Todavía no sincroniza"
  // Un reloj adelantado no puede dejar «en 2 días» en una columna de «último uso».
  const moment = when.getTime() > now.getTime() ? now : when
  const relative = formatDateRelative(moment, now)
  const time = formatDateTime(moment).slice(-5)
  return relative === "hoy" || relative === "ayer" ? `${relative}, ${time}` : `${relative} (${formatDate(moment)})`
}

function endDateOf(row: DeviceCredentialRow): string {
  return formatDate(row.status === "revocada" && row.revokedAt ? row.revokedAt : row.expiresAt)
}

function toView(row: DeviceCredentialRow, now: Date): DeviceView {
  const name = friendlyDeviceName(row.label)
  return {
    id: row.id,
    name,
    status: row.status,
    lastUse: describeLastUse(row.lastUsedAt, now),
    connected: formatDate(row.createdAt),
    endDate: endDateOf(row),
    code: row.deviceId.slice(0, 8),
    searchText: [name, row.label ?? "", row.deviceId].join(" "),
  }
}

const time = (value: string | null) => (value ? Date.parse(value) : Number.NEGATIVE_INFINITY)

/**
 * Una sección por persona. Primero quienes tienen algo conectado (la más activa
 * arriba) y después quienes sólo tienen historial, por nombre. Dentro de cada una,
 * lo vigente va aparte de lo vencido o revocado, que sólo es historia.
 */
export function groupDevicesByPerson(rows: readonly DeviceCredentialRow[], now: Date = new Date()): DevicePersonGroup[] {
  const byUser = new Map<string, DeviceCredentialRow[]>()
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row])

  const groups = [...byUser.values()].map((list) => {
    const first = list[0]!
    const active = list
      .filter((row) => row.status === "vigente")
      .sort((a, b) => time(b.lastUsedAt) - time(a.lastUsedAt) || time(b.createdAt) - time(a.createdAt))
    const past = list
      .filter((row) => row.status !== "vigente")
      .sort((a, b) => time(b.createdAt) - time(a.createdAt))
    return {
      group: { userId: first.userId, userName: first.userName, userEmail: first.userEmail, active: active.map((row) => toView(row, now)), past: past.map((row) => toView(row, now)) },
      lastActivity: active.length ? Math.max(...active.map((row) => Math.max(time(row.lastUsedAt), time(row.createdAt)))) : 0,
    }
  })

  return groups
    .sort((a, b) => {
      const aLive = a.group.active.length > 0
      const bLive = b.group.active.length > 0
      if (aLive !== bLive) return aLive ? -1 : 1
      return b.lastActivity - a.lastActivity || a.group.userName.localeCompare(b.group.userName, "es")
    })
    .map(({ group }) => group)
}
