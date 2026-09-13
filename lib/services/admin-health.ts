/**
 * admin-health.ts — Señales operativas del panel de administración (`/admin`).
 *
 * Responde a lo único que un administrador no puede averiguar navegando el
 * sidebar: si algo que sólo él repara está caído. Cuatro señales, el tope que
 * fija la regla de densidad A1, y cada una lleva a la pantalla donde se
 * arregla.
 *
 * El módulo está partido en dos a propósito:
 *
 * - `buildAdminSignals` es puro y recibe el `now`. Los umbrales (26 h, 48 h)
 *   son lo único que puede equivocarse aquí, y comprobarlos no debería exigir
 *   Postgres ni un reloj falso.
 * - `getAdminHealthFacts` consulta, y **sólo consulta lo que la sesión puede
 *   ver**. Una clave ausente en `AdminHealthFacts` significa "sin permiso",
 *   no "sin datos": mostrarle a una sesión sin acceso a `/admin/dte` que la
 *   sincronización está caída la mandaría a un /forbidden.
 *
 * La antigüedad se mide **contra la última corrida correcta**, nunca contra la
 * última corrida a secas. Un cron roto que arranca una corrida por hora y
 * ninguna termina deja siempre una fila `running` reciente: mirando sólo la
 * última, el panel diría "en curso" para siempre mientras la instalación lleva
 * días sin un respaldo completo, que es exactamente el fallo que esta pantalla
 * existe para delatar.
 */

import { desc, eq, gt, sql } from "drizzle-orm"
import { db } from "@/db"
import { backupLog, dteSyncRuns, rateLimits } from "@/db/schema"
import type { AreaNode } from "@/components/layout/nav-items"
import { formatDateRelative } from "@/lib/utils"
import { getPlatformHealth } from "./platform-health"
import { getLastDeliveryTest, getResendStatus } from "./smtp-settings"

/** Horas tras las cuales un respaldo correcto deja de considerarse al día. */
const BACKUP_STALE_HOURS = 26
/** Horas tras las cuales la falta de una corrida correcta es un problema abierto. */
const CRITICAL_STALE_HOURS = 48

/** Destinos cuyo estado se resume. La señal se muestra sólo si su href es visible. */
const BACKUP_HREF   = "/admin/backups"
const EMAIL_HREF    = "/admin/correo-smtp"
const DTE_HREF      = "/admin/dte"
const LOCKOUTS_HREF = "/admin/seguridad"
const INFRA_HREF    = "/admin/modulos"

/**
 * Tope de tiles de la pantalla (regla de densidad A1).
 *
 * Los candidatos son cinco y caben cuatro, así que la fila se arma con los
 * **peores cuatro**, no con una lista fija. Una señal sana nunca desplaza a una
 * rota: con un conjunto fijo, el día que el disco se llene la noticia se vería
 * sólo entrando a /admin/modulos, mientras el panel sigue mostrando cuatro
 * verdes. Los empates conservan el orden de catálogo, así que para un mismo
 * estado la fila no cambia de un render a otro.
 */
const MAX_SIGNALS = 4

export type AdminSignalTone = "ok" | "warn" | "critical"

export interface AdminSignal {
  id:       "backup" | "email" | "dte" | "lockouts" | "infra"
  label:    string
  /** Estado en una o dos palabras. Nunca un "0" ni un "—" pelados (A1). */
  value:    string
  /** Qué significa y qué hacer, en lenguaje de usuario. */
  detail:   string
  tone:     AdminSignalTone
  href:     string
  iconName: string
}

interface RunFact {
  status:    string
  startedAt: string
}

/** Hechos de un proceso por corridas: la última, y la última que salió bien. */
interface RunHistoryFact {
  latest:        RunFact | null
  lastSuccessAt: string | null
}

/** Sondas de `platform-health`: base, volumen de almacenamiento y disco. */
interface InfraFact {
  db:          "connected" | "disconnected"
  storage:     "writable" | "unreachable" | "unknown"
  disk:        "ok" | "low_space" | "unknown"
  freePercent: number | null
}

export interface AdminHealthFacts {
  backup?:   RunHistoryFact
  email?:    { configured: boolean; lastTest: { ok: boolean; attemptedAt: string } | null }
  dte?:      RunHistoryFact
  lockouts?: { activeLocks: number }
  infra?:    InfraFact
}

const TONE_ORDER: Record<AdminSignalTone, number> = { critical: 0, warn: 1, ok: 2 }

function hoursSince(iso: string, now: Date): number {
  const started = Date.parse(iso)
  if (Number.isNaN(started)) return Number.POSITIVE_INFINITY
  return (now.getTime() - started) / 3_600_000
}

/**
 * Antigüedad en palabras, en horas mientras la diferencia importe.
 *
 * `formatDateRelative` cuenta días civiles chilenos y los umbrales cuentan
 * horas: con él solo, un respaldo de 25 h ("Al día") y uno de 30 h
 * ("Atrasado") decían los dos "ayer", y el usuario no tenía cómo saber por qué
 * uno estaba en ámbar. Bajo 48 h se dicen las horas; sobre eso el día civil
 * vuelve a ser la unidad que se lee sin restar.
 */
function formatAge(iso: string, now: Date): string {
  const h = hoursSince(iso, now)
  if (!Number.isFinite(h)) return "en una fecha que no se pudo leer"
  if (h < 1) return "hace menos de una hora"
  if (h < CRITICAL_STALE_HOURS) return `hace ${Math.round(h)} horas`
  return formatDateRelative(iso, now)
}

function buildBackupSignal(f: RunHistoryFact, now: Date): AdminSignal {
  const base = { id: "backup", label: "Respaldos", href: BACKUP_HREF, iconName: "HardDrives" } as const

  if (!f.latest) {
    return { ...base, tone: "critical", value: "Sin respaldo", detail: "Nunca se ha ejecutado uno. Configura el respaldo automático." }
  }
  if (!f.lastSuccessAt) {
    return { ...base, tone: "critical", value: "Sin respaldo", detail: "Ningún respaldo ha terminado bien. Revisa el proceso." }
  }

  const cuando = formatAge(f.lastSuccessAt, now)
  const successAge = hoursSince(f.lastSuccessAt, now)
  const running = f.latest.status === "running"

  if (f.latest.status === "failed") {
    return { ...base, tone: "critical", value: "Falló", detail: `El último intento falló. El correcto más reciente, ${cuando}.` }
  }
  // Una corrida que lleva días "en curso" no está corriendo: quedó colgada.
  if (running && hoursSince(f.latest.startedAt, now) > CRITICAL_STALE_HOURS) {
    return { ...base, tone: "critical", value: "Detenido", detail: `Un respaldo quedó a medias. El último correcto, ${cuando}.` }
  }
  if (successAge > CRITICAL_STALE_HOURS) {
    return { ...base, tone: "critical", value: "Atrasado", detail: `Último correcto ${cuando}. Ejecuta uno y revisa el cron.` }
  }
  if (successAge > BACKUP_STALE_HOURS) {
    return { ...base, tone: "warn", value: "Atrasado", detail: `Último correcto ${cuando}. Debería haber uno diario.` }
  }
  return running
    ? { ...base, tone: "ok", value: "En curso", detail: `Hay uno ejecutándose. El último correcto, ${cuando}.` }
    : { ...base, tone: "ok", value: "Al día", detail: `Último respaldo correcto ${cuando}.` }
}

function buildEmailSignal(facts: NonNullable<AdminHealthFacts["email"]>, now: Date): AdminSignal {
  const base = { id: "email", label: "Correo saliente", href: EMAIL_HREF, iconName: "EnvelopeSimple" } as const

  if (!facts.configured) {
    return { ...base, tone: "critical", value: "Inactivo", detail: "No hay proveedor de envío configurado: no salen correos." }
  }
  if (!facts.lastTest) {
    return { ...base, tone: "warn", value: "Sin probar", detail: "Configurado, pero nunca se probó un envío real." }
  }
  const cuando = formatAge(facts.lastTest.attemptedAt, now)
  return facts.lastTest.ok
    ? { ...base, tone: "ok", value: "Operativo", detail: `La última prueba (${cuando}) llegó sin problemas.` }
    : { ...base, tone: "critical", value: "Falló", detail: `La prueba de envío de ${cuando} falló. Revisa las credenciales.` }
}

function buildDteSignal(f: RunHistoryFact, now: Date): AdminSignal {
  const base = { id: "dte", label: "Sincronización DTE", href: DTE_HREF, iconName: "Receipt" } as const

  if (!f.latest) {
    return { ...base, tone: "warn", value: "Sin corridas", detail: "Nunca se ha sincronizado. Carga las credenciales del portal." }
  }
  if (f.latest.status === "failed") {
    return { ...base, tone: "critical", value: "Falló", detail: `La corrida de ${formatAge(f.latest.startedAt, now)} falló. Pueden faltar facturas.` }
  }
  if (f.latest.status === "partial") {
    return { ...base, tone: "warn", value: "Parcial", detail: `La corrida de ${formatAge(f.latest.startedAt, now)} trajo sólo parte del período.` }
  }

  const running = f.latest.status === "running"
  if (running && hoursSince(f.latest.startedAt, now) > CRITICAL_STALE_HOURS) {
    return { ...base, tone: "critical", value: "Detenida", detail: "Una sincronización quedó a medias. Revisa el proceso del portal." }
  }
  if (!f.lastSuccessAt) {
    return { ...base, tone: "warn", value: "Sin éxito", detail: "Ninguna sincronización ha terminado bien. Revisa las credenciales." }
  }

  const cuando = formatAge(f.lastSuccessAt, now)
  if (hoursSince(f.lastSuccessAt, now) > CRITICAL_STALE_HOURS) {
    return { ...base, tone: "warn", value: "Atrasada", detail: `Última correcta ${cuando}. Revisa el cron del portal.` }
  }
  return running
    ? { ...base, tone: "ok", value: "En curso", detail: `Hay una ejecutándose. La última correcta, ${cuando}.` }
    : { ...base, tone: "ok", value: "Al día", detail: `Última sincronización correcta ${cuando}.` }
}

function buildLockoutSignal(facts: NonNullable<AdminHealthFacts["lockouts"]>): AdminSignal {
  const base = { id: "lockouts", label: "Bloqueos activos", href: LOCKOUTS_HREF, iconName: "LockKey" } as const
  const n = facts.activeLocks

  if (n === 0) {
    return { ...base, tone: "ok", value: "Sin bloqueos", detail: "Nadie está bloqueado por intentos fallidos de acceso." }
  }
  // "Accesos" y no "claves": `rate_limits.key` es un correo o una IP, y en
  // Chile "clave" se lee como contraseña — invitaba al modelo mental errado.
  return {
    ...base,
    tone:   "warn",
    value:  String(n),
    detail: n === 1
      ? "1 acceso bloqueado por intentos fallidos. Libéralo si fue un error."
      : `${n} accesos bloqueados por intentos fallidos. Libéralos si corresponde.`,
  }
}

function buildInfraSignal(f: InfraFact): AdminSignal {
  const base = { id: "infra", label: "Infraestructura", href: INFRA_HREF, iconName: "Stack" } as const

  if (f.db === "disconnected") {
    return { ...base, tone: "critical", value: "Base caída", detail: "La base de datos no responde. Nada de lo que se guarde llegará." }
  }
  if (f.storage === "unreachable") {
    return { ...base, tone: "critical", value: "Sin volumen", detail: "No se puede escribir en el almacenamiento: fallarán las cargas." }
  }
  if (f.disk === "low_space") {
    const pct = f.freePercent
    const cuanto = pct == null ? "Queda poco espacio" : `Queda ${pct}% libre`
    return pct != null && pct < 5
      ? { ...base, tone: "critical", value: "Disco lleno", detail: `${cuanto} en el disco. Libera espacio antes de que falle todo.` }
      : { ...base, tone: "warn", value: "Disco lleno", detail: `${cuanto} en el disco. Libera espacio o amplía el volumen.` }
  }
  return { ...base, tone: "ok", value: "Operativa", detail: "Base, almacenamiento y disco responden." }
}

/**
 * Señales a mostrar, ordenadas por gravedad. Máximo cuatro: el tope de A1 no
 * es una casualidad del catálogo actual, es el contrato de la pantalla.
 */
export function buildAdminSignals(facts: AdminHealthFacts, now: Date = new Date()): AdminSignal[] {
  const signals: AdminSignal[] = []

  if (facts.backup)   signals.push(buildBackupSignal(facts.backup, now))
  if (facts.email)    signals.push(buildEmailSignal(facts.email, now))
  if (facts.dte)      signals.push(buildDteSignal(facts.dte, now))
  if (facts.lockouts) signals.push(buildLockoutSignal(facts.lockouts))
  if (facts.infra)    signals.push(buildInfraSignal(facts.infra))

  // `sort` es estable en JS, y los candidatos se empujan en orden de catálogo:
  // a igual gravedad la fila no baila entre renders.
  return signals
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])
    .slice(0, MAX_SIGNALS)
}

/** Hrefs que esta sesión ve en el árbol de administración, hijos incluidos. */
export function visibleAdminHrefs(areas: AreaNode[]): Set<string> {
  const hrefs = new Set<string>()
  for (const area of areas) {
    for (const item of area.items) {
      hrefs.add(item.href)
      for (const child of item.children ?? []) hrefs.add(child.href)
    }
  }
  return hrefs
}

/**
 * Lee los hechos que esta sesión tiene derecho a ver.
 *
 * El permiso no se vuelve a evaluar aquí: se deriva del árbol que ya calculó
 * `getAdminAreas`, que es la fuente de verdad del sidebar. Comprobar el
 * permiso por separado con `can()` habría divergido en silencio el día que a
 * un destino se le agregue un `roles:` —`canSeeNav` concede por permiso **o**
 * por rol— dejando el enlace visible y la señal muda.
 *
 * Cada consulta va envuelta en su propio `catch`: el panel de administración
 * es la pantalla a la que se entra **cuando algo anda mal**, así que una
 * integración caída debe degradar su tile, nunca tumbar la página entera.
 */
export async function getAdminHealthFacts(areas: AreaNode[]): Promise<AdminHealthFacts> {
  const hrefs = visibleAdminHrefs(areas)
  const wantsBackup = hrefs.has(BACKUP_HREF)
  const wantsEmail  = hrefs.has(EMAIL_HREF)
  const wantsDte    = hrefs.has(DTE_HREF)
  const wantsLocks  = hrefs.has(LOCKOUTS_HREF)
  const wantsInfra  = hrefs.has(INFRA_HREF)

  // `try/catch` y no `.catch()`: si `db.select` revienta de forma síncrona
  // —un `db` que no logró inicializarse— el rechazo nunca llega a la cadena y
  // se lleva la página entera por delante.
  const lastBackup = async (onlySuccess: boolean): Promise<RunFact | null> => {
    try {
      const rows = await db
        .select({ status: backupLog.status, startedAt: backupLog.startedAt })
        .from(backupLog)
        .where(onlySuccess ? eq(backupLog.status, "success") : undefined)
        .orderBy(desc(backupLog.startedAt))
        .limit(1)
      return rows[0] ?? null
    } catch { return null }
  }

  const lastDte = async (onlySuccess: boolean): Promise<RunFact | null> => {
    try {
      const rows = await db
        .select({ status: dteSyncRuns.status, startedAt: dteSyncRuns.startedAt })
        .from(dteSyncRuns)
        .where(onlySuccess ? eq(dteSyncRuns.status, "success") : undefined)
        .orderBy(desc(dteSyncRuns.startedAt))
        .limit(1)
      return rows[0] ?? null
    } catch { return null }
  }

  const activeLocks = async (): Promise<number> => {
    try {
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(rateLimits)
        // `lockUntil` es epoch en milisegundos y 0 significa "sin bloqueo":
        // comparar contra `Date.now()` excluye de una vez los no bloqueados y
        // los que ya expiraron.
        .where(gt(rateLimits.lockUntil, Date.now()))
      return rows[0]?.n ?? 0
    } catch { return 0 }
  }

  const lastEmailTest = async () => {
    try { return await getLastDeliveryTest() } catch { return null }
  }

  // `getPlatformHealth` escribe un archivo de sonda y ejecuta `df`; se paga
  // sólo si la sesión ve /admin/modulos, que es adonde lleva el tile.
  const infra = async (): Promise<InfraFact | null> => {
    try {
      const h = await getPlatformHealth()
      return { db: h.db, storage: h.storage, disk: h.disk.status, freePercent: h.disk.freePercent ?? null }
    } catch { return null }
  }

  const [backupLatest, backupSuccess, emailTest, dteLatest, dteSuccess, locks, infraFact] = await Promise.all([
    wantsBackup ? lastBackup(false) : Promise.resolve(null),
    wantsBackup ? lastBackup(true)  : Promise.resolve(null),
    wantsEmail  ? lastEmailTest()   : Promise.resolve(null),
    wantsDte    ? lastDte(false)    : Promise.resolve(null),
    wantsDte    ? lastDte(true)     : Promise.resolve(null),
    wantsLocks  ? activeLocks()     : Promise.resolve(0),
    wantsInfra  ? infra()           : Promise.resolve(null),
  ])

  const facts: AdminHealthFacts = {}
  if (wantsBackup) facts.backup = { latest: backupLatest, lastSuccessAt: backupSuccess?.startedAt ?? null }
  if (wantsEmail)  facts.email  = { configured: getResendStatus().configured, lastTest: emailTest }
  if (wantsDte)    facts.dte    = { latest: dteLatest, lastSuccessAt: dteSuccess?.startedAt ?? null }
  if (wantsLocks)  facts.lockouts = { activeLocks: locks }
  // Sin `infraFact` la sonda falló entera: se omite el tile en vez de afirmar
  // que la infraestructura está sana.
  if (wantsInfra && infraFact) facts.infra = infraFact
  return facts
}

/** Atajo de página: hechos + señales en una sola llamada. */
export async function getAdminHealthSignals(areas: AreaNode[]): Promise<AdminSignal[]> {
  return buildAdminSignals(await getAdminHealthFacts(areas))
}
