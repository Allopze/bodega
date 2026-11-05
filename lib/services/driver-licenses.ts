/**
 * Licencias de conducir de trabajadores (2026-11).
 *
 * Las firmas son el contrato con `/flota/conductores`, la exportación y el
 * script de carga (ver `driver-licenses-contract.ts`).
 *
 * **Quién aparece.** La nómina une a quienes tienen licencia registrada con
 * quienes la exigen por su cargo: capacidad efectiva `drives_vehicle` u
 * `operates_equipment` (capacidades del cargo, menos las excepciones `exclude`
 * del trabajador, más las `include`; mismo criterio que
 * `resolveCapabilityRoster` del PDTP). Sin cargo clasificado el sistema no sabe
 * quién debería tener licencia, por eso `unclassifiedWorkers` existe: la pantalla
 * lo muestra como aviso en vez de fingir que esa gente no conduce.
 *
 * **Un solo estado.** Lo calcula `resolveDriverStatus`, el mismo que usa el aviso
 * diario (`remindDriverLicenses`): si cada consumidor lo recalculara, el correo
 * diría «vencida» de alguien que la pantalla muestra vigente.
 */

import { and, asc, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import type { ZodError } from "zod"
import { db, type DB, type Tx } from "@/db"
import {
  workerCapabilities,
  workerCapabilityOverrides,
  workerDriverLicenses,
  workerPositionCapabilities,
  workerPositions,
  workers,
  worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { canAccessWorksite, serviceWorksiteScope, worksiteScopeSqlFor } from "@/lib/auth/scope"
import { DRIVER_STATUS_RANK, resolveDriverStatus } from "@/lib/driver-license-status"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { todayInChile } from "@/lib/utils"
import {
  driverLicenseSchema,
  sortLicenseClasses,
  type DriverLicenseClass,
  type DriverLicenseInput,
} from "@/lib/validation/driver-licenses"
import type {
  DriverCandidate,
  DriverLicenseMutationResult,
  DriverRoster,
  DriverRosterRow,
} from "./driver-licenses-contract"

type Client = DB | Tx

/** Actor para auditoría cuando no hay sesión (script de carga). */
export interface DriverLicenseActor {
  userId: string
  userEmail: string
}

/** Capacidades que, por sí solas, hacen que el cargo exija licencia de conducir. */
const LICENSE_CAPABILITY_CODES = ["drives_vehicle", "operates_equipment"] as const

/** Cargo de sistema que ocupa quien aún no se clasifica (migración 0264). */
const UNCLASSIFIED_POSITION_CODE = "SIN-CLASIFICAR"

const FORBIDDEN_MESSAGE = "No tienes permisos para gestionar licencias de conducir"
const WORKER_NOT_FOUND_MESSAGE = "Trabajador no encontrado"

type WorksiteScope = string[] | "all"

/**
 * Mismo criterio que `can()` de `lib/auth/can`, sin importarlo: ese módulo
 * arrastra next-auth y `next/headers`, y este servicio lo cargan también el
 * aviso diario y el script de carga, que corren fuera de una petición de Next.
 */
const canManageLicenses = (session: Session | null): boolean =>
  Boolean(session?.user?.permissions?.includes("flota:manage_licenses"))

/* ── Lectura base ─────────────────────────────────────────────────────────── */

interface WorkerBase {
  workerId: string
  firstName: string
  lastName: string
  rut: string | null
  worksiteId: string
  worksiteName: string
  positionId: string | null
  positionCode: string | null
  positionName: string | null
  requiredClasses: string[]
  license: { classes: string[]; expiresAt: string | null; notes: string | null; updatedAt: string } | null
}

interface LicenseCapabilities {
  /** `positionId` → códigos de capacidad de licencia que el cargo hereda. */
  byPosition: Map<string, Set<string>>
  /** `workerId` → excepción individual por código de capacidad. */
  overrides: Map<string, Map<string, "include" | "exclude">>
}

/**
 * Trabajadores activos del alcance, con cargo y licencia (si la tienen). Un
 * alcance vacío (`[]`) no devuelve filas: `worksiteScopeSqlFor` lo traduce a
 * `false`, nunca a «sin filtro».
 */
async function loadWorkerBases(client: Client, scope: WorksiteScope, workerId?: string): Promise<WorkerBase[]> {
  const rows = await client
    .select({
      workerId: workers.id,
      firstName: workers.firstName,
      lastName: workers.lastName,
      rut: workers.rut,
      worksiteId: workers.worksiteId,
      worksiteName: worksites.name,
      positionId: workers.positionId,
      positionCode: workerPositions.code,
      positionName: workerPositions.name,
      requiredClasses: workerPositions.requiredLicenseClasses,
      licenseClasses: workerDriverLicenses.classes,
      licenseExpiresAt: workerDriverLicenses.expiresAt,
      licenseNotes: workerDriverLicenses.notes,
      licenseUpdatedAt: workerDriverLicenses.updatedAt,
    })
    .from(workers)
    .innerJoin(worksites, eq(worksites.id, workers.worksiteId))
    .leftJoin(workerPositions, eq(workerPositions.id, workers.positionId))
    .leftJoin(workerDriverLicenses, eq(workerDriverLicenses.workerId, workers.id))
    .where(and(
      eq(workers.isActive, true),
      worksiteScopeSqlFor(scope, workers.worksiteId),
      workerId ? eq(workers.id, workerId) : undefined,
    ))

  return rows.map((row) => ({
    workerId: row.workerId,
    firstName: row.firstName,
    lastName: row.lastName,
    rut: row.rut,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    positionId: row.positionId,
    positionCode: row.positionCode,
    positionName: row.positionName,
    requiredClasses: row.requiredClasses ?? [],
    license: row.licenseClasses
      ? {
          classes: row.licenseClasses,
          expiresAt: row.licenseExpiresAt,
          notes: row.licenseNotes,
          updatedAt: row.licenseUpdatedAt ?? "",
        }
      : null,
  }))
}

async function loadLicenseCapabilities(client: Client, workerId?: string): Promise<LicenseCapabilities> {
  const codes = [...LICENSE_CAPABILITY_CODES]
  const inherited = await client
    .select({ positionId: workerPositionCapabilities.positionId, code: workerCapabilities.code })
    .from(workerPositionCapabilities)
    .innerJoin(workerCapabilities, eq(workerCapabilities.id, workerPositionCapabilities.capabilityId))
    .where(and(inArray(workerCapabilities.code, codes), eq(workerCapabilities.isActive, true)))
  const overrideRows = await client
    .select({
      workerId: workerCapabilityOverrides.workerId,
      code: workerCapabilities.code,
      mode: workerCapabilityOverrides.mode,
    })
    .from(workerCapabilityOverrides)
    .innerJoin(workerCapabilities, eq(workerCapabilities.id, workerCapabilityOverrides.capabilityId))
    .where(and(
      inArray(workerCapabilities.code, codes),
      eq(workerCapabilities.isActive, true),
      workerId ? eq(workerCapabilityOverrides.workerId, workerId) : undefined,
    ))

  const byPosition = new Map<string, Set<string>>()
  for (const row of inherited) {
    const set = byPosition.get(row.positionId) ?? new Set<string>()
    set.add(row.code)
    byPosition.set(row.positionId, set)
  }
  const overrides = new Map<string, Map<string, "include" | "exclude">>()
  for (const row of overrideRows) {
    if (row.mode !== "include" && row.mode !== "exclude") continue
    const map = overrides.get(row.workerId) ?? new Map<string, "include" | "exclude">()
    map.set(row.code, row.mode)
    overrides.set(row.workerId, map)
  }
  return { byPosition, overrides }
}

/**
 * Capacidad efectiva = la del cargo, sin lo que la excepción individual
 * excluye, más lo que incluye. Exige licencia si queda alguna de las dos.
 */
function requiresDriverLicense(base: WorkerBase, capabilities: LicenseCapabilities): boolean {
  const effective = new Set<string>(base.positionId ? capabilities.byPosition.get(base.positionId) ?? [] : [])
  const individual = capabilities.overrides.get(base.workerId)
  if (individual) {
    for (const [code, mode] of individual) {
      if (mode === "include") effective.add(code)
      else effective.delete(code)
    }
  }
  return effective.size > 0
}

const fullName = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`.trim()

/** Fila de la nómina, o null si el trabajador ni tiene licencia ni la exige. */
function toRosterRow(
  base: WorkerBase,
  capabilities: LicenseCapabilities,
  today: string,
  warningDays: number,
): DriverRosterRow | null {
  const requiresLicense = requiresDriverLicense(base, capabilities)
  if (!base.license && !requiresLicense) return null

  const requiredClasses = sortLicenseClasses(base.requiredClasses)
  const heldClasses = base.license ? sortLicenseClasses(base.license.classes) : []
  const { status, expiry, missingClasses } = resolveDriverStatus({
    requiresLicense,
    requiredClasses,
    license: base.license ? { classes: heldClasses, expiresAt: base.license.expiresAt } : null,
    today,
    warningDays,
  })
  return {
    workerId: base.workerId,
    name: fullName(base),
    rut: base.rut,
    worksiteId: base.worksiteId,
    worksiteName: base.worksiteName,
    positionId: base.positionId,
    positionName: base.positionName,
    requiresLicense,
    requiredClasses,
    license: base.license
      ? {
          classes: heldClasses,
          expiresAt: base.license.expiresAt,
          notes: base.license.notes,
          updatedAt: base.license.updatedAt,
        }
      : null,
    status,
    expiry,
    missingClasses,
  }
}

/**
 * Orden de «Requieren atención»: por urgencia del estado; dentro de un estado,
 * lo vencido más antiguo primero y lo por vencer más próximo primero (ambos son
 * `days` ascendente); después el nombre para que el orden sea estable.
 */
function compareRosterRows(a: DriverRosterRow, b: DriverRosterRow): number {
  const byStatus = DRIVER_STATUS_RANK[a.status] - DRIVER_STATUS_RANK[b.status]
  if (byStatus !== 0) return byStatus
  const aDays = a.expiry?.days ?? null
  const bDays = b.expiry?.days ?? null
  if (aDays !== bDays) {
    if (aDays === null) return 1
    if (bDays === null) return -1
    return aDays - bDays
  }
  return a.name.localeCompare(b.name, "es")
}

function buildRoster(
  bases: WorkerBase[],
  capabilities: LicenseCapabilities,
  today: string,
  warningDays: number,
): DriverRosterRow[] {
  const rows: DriverRosterRow[] = []
  for (const base of bases) {
    const row = toRosterRow(base, capabilities, today, warningDays)
    if (row) rows.push(row)
  }
  return rows.sort(compareRosterRows)
}

function assertCanManageLicenses(session: Session): void {
  if (!canManageLicenses(session)) throw new Error(FORBIDDEN_MESSAGE)
}

/* ── Lecturas públicas ────────────────────────────────────────────────────── */

/**
 * Conductores visibles para la sesión: licencia registrada ∪ cargo que la exige
 * (capacidad efectiva `drives_vehicle` u `operates_equipment`), trabajadores
 * activos, con alcance de faena. Exige `flota:manage_licenses`.
 *
 * `unclassifiedWorkers` cuenta sobre todo el alcance del usuario, no sobre la
 * faena filtrada: el aviso dice «de tus faenas» y no debería moverse con el filtro.
 */
export async function listDriverRoster(session: Session, options?: { worksiteId?: string }): Promise<DriverRoster> {
  assertCanManageLicenses(session)
  const scope = serviceWorksiteScope(session)
  const today = todayInChile()
  const { warningDays } = await getFleetAdminSettings()

  const bases = await loadWorkerBases(db, scope)
  const capabilities = await loadLicenseCapabilities(db)
  const visibleWorksites = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(eq(worksites.isActive, true), worksiteScopeSqlFor(scope, worksites.id)))
    .orderBy(asc(worksites.name))

  const unclassifiedWorkers = bases.filter(
    (base) => base.positionId === null || base.positionCode === UNCLASSIFIED_POSITION_CODE,
  ).length
  const worksiteId = options?.worksiteId
  const filtered = worksiteId ? bases.filter((base) => base.worksiteId === worksiteId) : bases

  return {
    rows: buildRoster(filtered, capabilities, today, warningDays),
    today,
    warningDays,
    worksites: visibleWorksites,
    unclassifiedWorkers,
  }
}

async function loadRosterRow(client: Client, scope: WorksiteScope, workerId: string): Promise<DriverRosterRow | null> {
  const today = todayInChile()
  const { warningDays } = await getFleetAdminSettings()
  const [base] = await loadWorkerBases(client, scope, workerId)
  if (!base) return null
  const capabilities = await loadLicenseCapabilities(client, workerId)
  return toRosterRow(base, capabilities, today, warningDays)
}

/** Una fila, para refrescar tras guardar o abrir `?editar=`. Null si no existe o está fuera de alcance. */
export async function getDriverRosterRow(session: Session, workerId: string): Promise<DriverRosterRow | null> {
  assertCanManageLicenses(session)
  return loadRosterRow(db, serviceWorksiteScope(session), workerId)
}

/** Trabajadores activos del alcance sin licencia registrada, para «Registrar licencia». */
export async function listDriverCandidates(session: Session): Promise<DriverCandidate[]> {
  assertCanManageLicenses(session)
  const bases = await loadWorkerBases(db, serviceWorksiteScope(session))
  return bases
    .filter((base) => base.license === null)
    .map((base): DriverCandidate => ({
      workerId: base.workerId,
      name: fullName(base),
      rut: base.rut,
      worksiteName: base.worksiteName,
      positionName: base.positionName,
      requiredClasses: sortLicenseClasses(base.requiredClasses),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
}

/**
 * Todas las filas activas, sin alcance de faena y sin sesión: el aviso diario
 * no es un usuario (un cron no puede fabricarse una sesión) y reparte a cada
 * faena sus destinatarios con `getUserIdsWithPermissionForWorksite`; cada fila
 * trae su `worksiteId`. `today` y `warningDays` los fija quien llama para que el
 * aviso y el resto de sus barridos midan con el mismo día y la misma ventana.
 */
export async function loadDriverRosterForReminders(
  today: string,
  warningDays: number,
  client: Client = db,
): Promise<DriverRosterRow[]> {
  const bases = await loadWorkerBases(client, "all")
  const capabilities = await loadLicenseCapabilities(client)
  return buildRoster(bases, capabilities, today, warningDays)
}

/* ── Escritura ────────────────────────────────────────────────────────────── */

interface LicenseWorker {
  id: string
  rut: string | null
  firstName: string
  lastName: string
  worksiteId: string
  isActive: boolean
}

async function findLicenseWorker(client: Client, workerId: string): Promise<LicenseWorker | null> {
  const [worker] = await client
    .select({
      id: workers.id,
      rut: workers.rut,
      firstName: workers.firstName,
      lastName: workers.lastName,
      worksiteId: workers.worksiteId,
      isActive: workers.isActive,
    })
    .from(workers)
    .where(eq(workers.id, workerId))
    .limit(1)
  return worker ?? null
}

interface LicenseSnapshot {
  classes: DriverLicenseClass[]
  expiresAt: string | null
  notes: string | null
}

/**
 * El formulario manda cadenas vacías donde el contrato dice `null`: «sin fecha»
 * y «sin observación» se guardan siempre como `null`, nunca como `""`.
 */
function normalizeInput(input: DriverLicenseInput): DriverLicenseInput {
  return { ...input, expiresAt: input.expiresAt || null, notes: input.notes?.trim() || null }
}

type LicenseFieldErrors = Partial<Record<"classes" | "expiresAt" | "notes" | "workerId", string>>

function fieldErrorsFromZod(error: ZodError): LicenseFieldErrors {
  const out: LicenseFieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if ((key === "classes" || key === "expiresAt" || key === "notes" || key === "workerId") && !out[key]) {
      out[key] = issue.message
    }
  }
  return out
}

/** Upsert + auditoría dentro del cliente recibido. `input` ya viene validado y normalizado. */
async function writeLicense(
  client: Client,
  input: DriverLicenseInput,
  worker: LicenseWorker,
  actor: DriverLicenseActor,
  reason: string,
): Promise<"created" | "updated" | "unchanged"> {
  const next: LicenseSnapshot = {
    classes: sortLicenseClasses(input.classes),
    expiresAt: input.expiresAt ?? null,
    notes: input.notes ?? null,
  }
  const [existing] = await client
    .select()
    .from(workerDriverLicenses)
    .where(eq(workerDriverLicenses.workerId, worker.id))
    .limit(1)

  const entityCode = worker.rut ?? fullName(worker)
  if (existing) {
    const previous: LicenseSnapshot = {
      classes: sortLicenseClasses(existing.classes),
      expiresAt: existing.expiresAt ?? null,
      notes: existing.notes ?? null,
    }
    const unchanged = previous.classes.join(",") === next.classes.join(",")
      && previous.expiresAt === next.expiresAt
      && previous.notes === next.notes
    if (unchanged) return "unchanged"

    await client
      .update(workerDriverLicenses)
      .set({ ...next, updatedByUserId: actor.userId, updatedAt: new Date().toISOString() })
      .where(eq(workerDriverLicenses.workerId, worker.id))
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "worker_driver_license",
      entityId: worker.id,
      entityCode,
      oldState: { ...previous },
      newState: { ...next },
      reason,
      worksiteId: worker.worksiteId,
    }, client)
    return "updated"
  }

  await client.insert(workerDriverLicenses).values({
    workerId: worker.id,
    ...next,
    updatedByUserId: actor.userId,
  })
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.userEmail,
    action: "create",
    entityType: "worker_driver_license",
    entityId: worker.id,
    entityCode,
    newState: { ...next },
    reason,
    worksiteId: worker.worksiteId,
  }, client)
  return "created"
}

const actorOf = (session: Session): DriverLicenseActor => ({
  userId: session.user.id,
  userEmail: session.user.email ?? "",
})

/** Crea o reemplaza la licencia. Valida permiso, alcance de faena y datos; audita. */
export async function upsertDriverLicense(session: Session, input: DriverLicenseInput): Promise<DriverLicenseMutationResult> {
  if (!canManageLicenses(session)) return { ok: false, message: FORBIDDEN_MESSAGE }

  const parsed = driverLicenseSchema.safeParse(normalizeInput(input))
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Revisa los datos de la licencia",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    }
  }

  // Un trabajador fuera de alcance responde igual que uno inexistente: no le
  // confirma a quien no puede verlo que la persona existe.
  const worker = await findLicenseWorker(db, parsed.data.workerId)
  if (!worker || !canAccessWorksite(session, worker.worksiteId)) {
    return { ok: false, message: WORKER_NOT_FOUND_MESSAGE, fieldErrors: { workerId: WORKER_NOT_FOUND_MESSAGE } }
  }
  if (!worker.isActive) {
    const message = "El trabajador está inactivo: no se le puede registrar una licencia"
    return { ok: false, message, fieldErrors: { workerId: message } }
  }

  const actor = actorOf(session)
  await db.transaction((tx) =>
    writeLicense(tx, parsed.data, worker, actor, "Licencia de conducir registrada desde Flota → Conductores"))

  const row = await loadRosterRow(db, serviceWorksiteScope(session), worker.id)
  if (!row) return { ok: false, message: "No se pudo leer la licencia guardada" }
  return { ok: true, row }
}

/** Quita la licencia registrada. Valida permiso y alcance; audita con el estado anterior. */
export async function removeDriverLicense(session: Session, workerId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!canManageLicenses(session)) return { ok: false, message: FORBIDDEN_MESSAGE }

  const worker = await findLicenseWorker(db, workerId)
  if (!worker || !canAccessWorksite(session, worker.worksiteId)) return { ok: false, message: WORKER_NOT_FOUND_MESSAGE }

  const actor = actorOf(session)
  const removed = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(workerDriverLicenses)
      .where(eq(workerDriverLicenses.workerId, worker.id))
      .limit(1)
    if (!existing) return false
    await tx.delete(workerDriverLicenses).where(eq(workerDriverLicenses.workerId, worker.id))
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "delete",
      entityType: "worker_driver_license",
      entityId: worker.id,
      entityCode: worker.rut ?? fullName(worker),
      oldState: {
        classes: sortLicenseClasses(existing.classes),
        expiresAt: existing.expiresAt ?? null,
        notes: existing.notes ?? null,
      },
      reason: "Licencia de conducir quitada desde Flota → Conductores",
      worksiteId: worker.worksiteId,
    }, tx)
    return true
  })
  if (!removed) return { ok: false, message: "El trabajador no tiene una licencia registrada" }
  return { ok: true }
}

/**
 * Escritura sin sesión para el script de carga: mismo upsert y misma auditoría,
 * dentro del cliente/transacción recibido. No verifica permisos (el script
 * exige un actor activo). Devuelve si cambió algo, para el informe idempotente.
 */
export async function writeDriverLicense(
  client: Client,
  input: DriverLicenseInput,
  actor: DriverLicenseActor,
  reason: string,
): Promise<"created" | "updated" | "unchanged"> {
  const parsed = driverLicenseSchema.parse(normalizeInput(input))
  const worker = await findLicenseWorker(client, parsed.workerId)
  if (!worker) throw new Error(`writeDriverLicense: el trabajador ${parsed.workerId} no existe`)
  return writeLicense(client, parsed, worker, actor, reason)
}
