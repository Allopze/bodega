import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  workerCapabilities,
  workerCapabilityOverrides,
  workerPositionAliases,
  workerPositionCapabilities,
  workerPositionHistory,
  workerPositions,
  workers,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  buildWorkerPositionAutoCode,
  cleanWorkerPositionDisplayName,
  normalizeWorkerPositionKey,
  WORKER_CAPABILITY_CODE_PATTERN,
} from "./normalization"

type Client = DB | Tx
type WorkerPosition = typeof workerPositions.$inferSelect
type WorkerCapability = typeof workerCapabilities.$inferSelect

export class WorkerPositionDomainError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "CONFLICT"
      | "INACTIVE"
      | "IN_USE"
      | "SYSTEM_RECORD",
  ) {
    super(message)
    this.name = "WorkerPositionDomainError"
  }
}

export type ResolveWorkerPositionInput = {
  id?: string | null
  code?: string | null
  name?: string | null
}

export type ResolveWorkerPositionOptions = {
  createIfMissing?: boolean
  allowInactive?: boolean
}

export type CreateWorkerPositionInput = {
  code: string
  name: string
  isActive?: boolean
  needsReview?: boolean
}

export type UpdateWorkerPositionInput = CreateWorkerPositionInput

export type WorkerPositionListItem = WorkerPosition & {
  aliases: Array<{ id: string; alias: string }>
  capabilities: Array<{ id: string; code: string; name: string }>
  workerCount: number
}

export type WorkerCapabilityInput = {
  code: string
  name: string
  description?: string | null
  isActive?: boolean
}

export type WorkerCapabilityListItem = WorkerCapability & {
  positionCount: number
  overrideCount: number
}

export type AddWorkerPositionAliasInput = {
  positionId: string
  alias: string
  source?: "manual" | "import" | "migration" | "merge"
  actorUserId?: string | null
}

export type ReplaceWorkerPositionCapabilitiesInput = {
  positionId: string
  capabilityIds: string[]
  actorUserId?: string | null
}

export type WorkerCapabilityOverrideInput = {
  workerId: string
  capabilityId: string
  mode: "include" | "exclude"
  reason: string
  actorUserId?: string | null
}

export type RecordWorkerPositionChangeInput = {
  workerId: string
  previousPositionId?: string | null
  previousPositionLabel?: string | null
  nextPosition: Pick<WorkerPosition, "id" | "name">
  source: "migration" | "admin" | "import" | "system"
  reason?: string | null
  actorUserId?: string | null
}

/** Espejo de los CHECK `worker_positions_{code,name}_valid`. Validarlos acá
 *  convierte un error crudo de Postgres —que aborta la importación entera— en
 *  un mensaje accionable que nombra el cargo culpable. */
const POSITION_NAME_MAX = 120
const POSITION_CODE_MAX = 80

function normalizedCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase()
  return code || null
}

function normalizeCapabilityCode(value: string): string {
  return normalizeWorkerPositionKey(value).replace(/ /g, "_")
}

function ensureAssignable(position: WorkerPosition, allowInactive: boolean): WorkerPosition {
  if (!position.isActive && !allowInactive) {
    throw new WorkerPositionDomainError(`El cargo "${position.name}" está inactivo.`, "INACTIVE")
  }
  return position
}

async function findByNormalizedKey(client: Client, normalizedKey: string): Promise<WorkerPosition | undefined> {
  const canonical = await client.query.workerPositions.findFirst({
    where: eq(workerPositions.normalizedKey, normalizedKey),
  })
  if (canonical) return canonical

  const alias = await client.query.workerPositionAliases.findFirst({
    where: eq(workerPositionAliases.normalizedKey, normalizedKey),
    with: { position: true },
  })
  return alias?.position
}

export async function createWorkerPosition(
  input: CreateWorkerPositionInput,
  client: Client = db,
): Promise<WorkerPosition> {
  const name = cleanWorkerPositionDisplayName(input.name)
  const normalizedKey = normalizeWorkerPositionKey(name)
  const code = normalizedCode(input.code)
  if (name.length < 2 || normalizedKey.length < 2 || !code || code.length < 2) {
    throw new WorkerPositionDomainError("Código y nombre de cargo son obligatorios.", "INVALID_INPUT")
  }
  if (name.length > POSITION_NAME_MAX || code.length > POSITION_CODE_MAX) {
    throw new WorkerPositionDomainError("El código o nombre del cargo es demasiado largo.", "INVALID_INPUT")
  }

  const normalizedConflict = await findByNormalizedKey(client, normalizedKey)
  if (normalizedConflict) {
    throw new WorkerPositionDomainError(
      `Ya existe el cargo "${normalizedConflict.name}" con una escritura equivalente.`,
      "CONFLICT",
    )
  }
  const codeConflict = await client.query.workerPositions.findFirst({ where: eq(workerPositions.code, code) })
  if (codeConflict) {
    throw new WorkerPositionDomainError(`El código ${code} ya está en uso.`, "CONFLICT")
  }

  const [created] = await client.insert(workerPositions).values({
    id: `worker-position-${nanoid()}`,
    code,
    name,
    normalizedKey,
    isActive: input.isActive ?? true,
    needsReview: input.needsReview ?? false,
    isSystem: false,
  }).onConflictDoNothing().returning()
  if (created) return created

  throw new WorkerPositionDomainError("Otro usuario creó un cargo con el mismo código o nombre.", "CONFLICT")
}

export async function updateWorkerPosition(
  positionId: string,
  input: UpdateWorkerPositionInput,
  client: Client = db,
): Promise<WorkerPosition> {
  const current = await client.query.workerPositions.findFirst({ where: eq(workerPositions.id, positionId) })
  if (!current) throw new WorkerPositionDomainError("Cargo no encontrado.", "NOT_FOUND")
  if (current.isSystem) {
    throw new WorkerPositionDomainError("Los cargos de sistema no pueden modificarse.", "SYSTEM_RECORD")
  }

  const name = cleanWorkerPositionDisplayName(input.name)
  const normalizedKey = normalizeWorkerPositionKey(name)
  const code = normalizedCode(input.code)
  if (name.length < 2 || normalizedKey.length < 2 || !code || code.length < 2) {
    throw new WorkerPositionDomainError("Código y nombre de cargo son obligatorios.", "INVALID_INPUT")
  }
  if (name.length > POSITION_NAME_MAX || code.length > POSITION_CODE_MAX) {
    throw new WorkerPositionDomainError("El código o nombre del cargo es demasiado largo.", "INVALID_INPUT")
  }

  const normalizedConflict = await findByNormalizedKey(client, normalizedKey)
  if (normalizedConflict && normalizedConflict.id !== current.id) {
    throw new WorkerPositionDomainError(
      `Ya existe el cargo "${normalizedConflict.name}" con una escritura equivalente.`,
      "CONFLICT",
    )
  }
  const codeConflict = await client.query.workerPositions.findFirst({ where: eq(workerPositions.code, code) })
  if (codeConflict && codeConflict.id !== current.id) {
    throw new WorkerPositionDomainError(`El código ${code} ya está en uso.`, "CONFLICT")
  }

  const [updated] = await client.update(workerPositions).set({
    code,
    name,
    normalizedKey,
    isActive: input.isActive ?? current.isActive,
    needsReview: input.needsReview ?? current.needsReview,
    updatedAt: new Date().toISOString(),
  }).where(eq(workerPositions.id, current.id)).returning()
  if (!updated) throw new Error("No se pudo actualizar el cargo.")
  return updated
}

export async function listWorkerPositions(client: Client = db): Promise<WorkerPositionListItem[]> {
  const [positionRows, aliasRows, capabilityLinks, workerCounts] = await Promise.all([
    client.select().from(workerPositions).orderBy(asc(workerPositions.name)),
    client.select({ id: workerPositionAliases.id, positionId: workerPositionAliases.positionId, alias: workerPositionAliases.alias })
      .from(workerPositionAliases)
      .orderBy(asc(workerPositionAliases.alias)),
    client.select({
      positionId: workerPositionCapabilities.positionId,
      id: workerCapabilities.id,
      code: workerCapabilities.code,
      name: workerCapabilities.name,
    }).from(workerPositionCapabilities)
      .innerJoin(workerCapabilities, eq(workerCapabilities.id, workerPositionCapabilities.capabilityId))
      .orderBy(asc(workerCapabilities.name)),
    client.select({ positionId: workers.positionId, count: sql<number>`count(*)::integer` })
      .from(workers)
      .where(sql`${workers.positionId} IS NOT NULL`)
      .groupBy(workers.positionId),
  ])

  const countByPosition = new Map(workerCounts.map((row) => [row.positionId!, Number(row.count)]))
  return positionRows.map((position) => ({
    ...position,
    aliases: aliasRows
      .filter((alias) => alias.positionId === position.id)
      .map(({ id, alias }) => ({ id, alias })),
    capabilities: capabilityLinks
      .filter((link) => link.positionId === position.id)
      .map(({ id, code, name }) => ({ id, code, name })),
    workerCount: countByPosition.get(position.id) ?? 0,
  }))
}

export async function addWorkerPositionAlias(
  input: AddWorkerPositionAliasInput,
  client: Client = db,
) {
  const alias = cleanWorkerPositionDisplayName(input.alias)
  const normalizedKey = normalizeWorkerPositionKey(alias)
  if (normalizedKey.length < 2 || alias.length > 120) {
    throw new WorkerPositionDomainError("El alias debe tener entre 2 y 120 caracteres.", "INVALID_INPUT")
  }
  const position = await client.query.workerPositions.findFirst({
    where: eq(workerPositions.id, input.positionId),
  })
  if (!position) throw new WorkerPositionDomainError("Cargo no encontrado.", "NOT_FOUND")

  const canonicalConflict = await client.query.workerPositions.findFirst({
    where: eq(workerPositions.normalizedKey, normalizedKey),
  })
  if (canonicalConflict) {
    throw new WorkerPositionDomainError(
      `El alias ya corresponde al cargo "${canonicalConflict.name}".`,
      "CONFLICT",
    )
  }

  const [created] = await client.insert(workerPositionAliases).values({
    id: `worker-position-alias-${nanoid()}`,
    positionId: position.id,
    alias,
    normalizedKey,
    source: input.source ?? "manual",
    createdByUserId: input.actorUserId ?? null,
  }).onConflictDoNothing().returning()
  if (created) return created

  const existing = await client.query.workerPositionAliases.findFirst({
    where: eq(workerPositionAliases.normalizedKey, normalizedKey),
  })
  if (existing?.positionId === position.id) return existing
  throw new WorkerPositionDomainError("Ese alias ya está asociado a otro cargo.", "CONFLICT")
}

export async function removeWorkerPositionAlias(aliasId: string, client: Client = db): Promise<void> {
  const deleted = await client.delete(workerPositionAliases)
    .where(eq(workerPositionAliases.id, aliasId))
    .returning({ id: workerPositionAliases.id })
  if (deleted.length === 0) throw new WorkerPositionDomainError("Alias no encontrado.", "NOT_FOUND")
}

function validateCapabilityInput(input: WorkerCapabilityInput) {
  const code = normalizeCapabilityCode(input.code)
  const name = cleanWorkerPositionDisplayName(input.name)
  const description = input.description?.trim() || null
  if (!WORKER_CAPABILITY_CODE_PATTERN.test(code)) {
    throw new WorkerPositionDomainError("El código de capacidad no es válido.", "INVALID_INPUT")
  }
  if (name.length < 2 || name.length > 120) {
    throw new WorkerPositionDomainError("El nombre de capacidad debe tener entre 2 y 120 caracteres.", "INVALID_INPUT")
  }
  return { code, name, description }
}

export async function createWorkerCapability(
  input: WorkerCapabilityInput,
  client: Client = db,
): Promise<WorkerCapability> {
  const values = validateCapabilityInput(input)
  const existing = await client.query.workerCapabilities.findFirst({
    where: eq(workerCapabilities.code, values.code),
  })
  if (existing) throw new WorkerPositionDomainError(`La capacidad ${values.code} ya existe.`, "CONFLICT")
  const [created] = await client.insert(workerCapabilities).values({
    id: `worker-capability-${nanoid()}`,
    ...values,
    isActive: input.isActive ?? true,
  }).onConflictDoNothing().returning()
  if (!created) throw new WorkerPositionDomainError("Otro usuario creó la misma capacidad.", "CONFLICT")
  return created
}

export async function updateWorkerCapability(
  capabilityId: string,
  input: WorkerCapabilityInput,
  client: Client = db,
): Promise<WorkerCapability> {
  const current = await client.query.workerCapabilities.findFirst({
    where: eq(workerCapabilities.id, capabilityId),
  })
  if (!current) throw new WorkerPositionDomainError("Capacidad no encontrada.", "NOT_FOUND")
  const values = validateCapabilityInput(input)
  const conflict = await client.query.workerCapabilities.findFirst({
    where: eq(workerCapabilities.code, values.code),
  })
  if (conflict && conflict.id !== current.id) {
    throw new WorkerPositionDomainError(`La capacidad ${values.code} ya existe.`, "CONFLICT")
  }
  const [updated] = await client.update(workerCapabilities).set({
    ...values,
    isActive: input.isActive ?? current.isActive,
    updatedAt: new Date().toISOString(),
  }).where(eq(workerCapabilities.id, current.id)).returning()
  if (!updated) throw new Error("No se pudo actualizar la capacidad.")
  return updated
}

export async function listWorkerCapabilities(client: Client = db): Promise<WorkerCapabilityListItem[]> {
  const [capabilityRows, positionCounts, overrideCounts] = await Promise.all([
    client.select().from(workerCapabilities).orderBy(asc(workerCapabilities.name)),
    client.select({ capabilityId: workerPositionCapabilities.capabilityId, count: sql<number>`count(*)::integer` })
      .from(workerPositionCapabilities)
      .groupBy(workerPositionCapabilities.capabilityId),
    client.select({ capabilityId: workerCapabilityOverrides.capabilityId, count: sql<number>`count(*)::integer` })
      .from(workerCapabilityOverrides)
      .groupBy(workerCapabilityOverrides.capabilityId),
  ])
  const positionCountById = new Map(positionCounts.map((row) => [row.capabilityId, Number(row.count)]))
  const overrideCountById = new Map(overrideCounts.map((row) => [row.capabilityId, Number(row.count)]))
  return capabilityRows.map((capability) => ({
    ...capability,
    positionCount: positionCountById.get(capability.id) ?? 0,
    overrideCount: overrideCountById.get(capability.id) ?? 0,
  }))
}

export async function replaceWorkerPositionCapabilities(
  input: ReplaceWorkerPositionCapabilitiesInput,
  client?: Client,
): Promise<void> {
  const work = async (tx: Client) => {
    const position = await tx.query.workerPositions.findFirst({
      where: eq(workerPositions.id, input.positionId),
    })
    if (!position) throw new WorkerPositionDomainError("Cargo no encontrado.", "NOT_FOUND")

    const capabilityIds = [...new Set(input.capabilityIds.filter(Boolean))]
    if (capabilityIds.length > 0) {
      const existing = await tx.select({ id: workerCapabilities.id })
        .from(workerCapabilities)
        .where(and(inArray(workerCapabilities.id, capabilityIds), eq(workerCapabilities.isActive, true)))
      if (existing.length !== capabilityIds.length) {
        throw new WorkerPositionDomainError("Una o más capacidades no existen o están inactivas.", "NOT_FOUND")
      }
    }

    await tx.delete(workerPositionCapabilities)
      .where(eq(workerPositionCapabilities.positionId, position.id))
    if (capabilityIds.length > 0) {
      await tx.insert(workerPositionCapabilities).values(capabilityIds.map((capabilityId) => ({
        positionId: position.id,
        capabilityId,
        createdByUserId: input.actorUserId ?? null,
      })))
    }
  }

  if (client) return work(client)
  return db.transaction(work)
}

export async function upsertWorkerCapabilityOverride(
  input: WorkerCapabilityOverrideInput,
  client: Client = db,
) {
  const reason = input.reason.trim()
  if (reason.length < 5 || reason.length > 1000) {
    throw new WorkerPositionDomainError("El motivo debe tener entre 5 y 1000 caracteres.", "INVALID_INPUT")
  }
  const [worker, capability] = await Promise.all([
    client.query.workers.findFirst({ where: eq(workers.id, input.workerId) }),
    client.query.workerCapabilities.findFirst({ where: eq(workerCapabilities.id, input.capabilityId) }),
  ])
  if (!worker) throw new WorkerPositionDomainError("Trabajador no encontrado.", "NOT_FOUND")
  if (!capability || !capability.isActive) {
    throw new WorkerPositionDomainError("Capacidad no encontrada o inactiva.", "NOT_FOUND")
  }

  const now = new Date().toISOString()
  const [saved] = await client.insert(workerCapabilityOverrides).values({
    id: `worker-capability-override-${nanoid()}`,
    workerId: worker.id,
    capabilityId: capability.id,
    mode: input.mode,
    reason,
    createdByUserId: input.actorUserId ?? null,
    updatedByUserId: input.actorUserId ?? null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [workerCapabilityOverrides.workerId, workerCapabilityOverrides.capabilityId],
    set: {
      mode: input.mode,
      reason,
      updatedByUserId: input.actorUserId ?? null,
      updatedAt: now,
    },
  }).returning()
  if (!saved) throw new Error("No se pudo guardar la excepción de capacidad.")
  return saved
}

export async function removeWorkerCapabilityOverride(
  workerId: string,
  capabilityId: string,
  client: Client = db,
): Promise<void> {
  const deleted = await client.delete(workerCapabilityOverrides).where(and(
    eq(workerCapabilityOverrides.workerId, workerId),
    eq(workerCapabilityOverrides.capabilityId, capabilityId),
  )).returning({ id: workerCapabilityOverrides.id })
  if (deleted.length === 0) throw new WorkerPositionDomainError("Excepción de capacidad no encontrada.", "NOT_FOUND")
}

export type EffectiveWorkerCapability = {
  id: string
  code: string
  name: string
  source: "position" | "override"
}

export async function getWorkerEffectiveCapabilities(
  workerId: string,
  client: Client = db,
): Promise<EffectiveWorkerCapability[]> {
  const worker = await client.query.workers.findFirst({ where: eq(workers.id, workerId) })
  if (!worker) throw new WorkerPositionDomainError("Trabajador no encontrado.", "NOT_FOUND")

  const inherited = worker.positionId
    ? await client.select({
        id: workerCapabilities.id,
        code: workerCapabilities.code,
        name: workerCapabilities.name,
      })
        .from(workerPositionCapabilities)
        .innerJoin(workerCapabilities, eq(workerCapabilities.id, workerPositionCapabilities.capabilityId))
        .where(and(
          eq(workerPositionCapabilities.positionId, worker.positionId),
          eq(workerCapabilities.isActive, true),
        ))
    : []
  const overrides = await client.select({
    id: workerCapabilities.id,
    code: workerCapabilities.code,
    name: workerCapabilities.name,
    mode: workerCapabilityOverrides.mode,
  })
    .from(workerCapabilityOverrides)
    .innerJoin(workerCapabilities, eq(workerCapabilities.id, workerCapabilityOverrides.capabilityId))
    .where(and(
      eq(workerCapabilityOverrides.workerId, worker.id),
      eq(workerCapabilities.isActive, true),
    ))

  const byId = new Map<string, EffectiveWorkerCapability>(
    inherited.map((capability) => [capability.id, { ...capability, source: "position" as const }]),
  )
  for (const override of overrides) {
    if (override.mode === "exclude") byId.delete(override.id)
    else byId.set(override.id, {
      id: override.id,
      code: override.code,
      name: override.name,
      source: "override",
    })
  }
  return [...byId.values()].sort((left, right) => left.code.localeCompare(right.code))
}

export async function recordWorkerPositionChange(
  input: RecordWorkerPositionChangeInput,
  client: Client = db,
): Promise<boolean> {
  if (input.previousPositionId === input.nextPosition.id) return false
  await client.insert(workerPositionHistory).values({
    id: `worker-position-history-${nanoid()}`,
    workerId: input.workerId,
    previousPositionId: input.previousPositionId ?? null,
    nextPositionId: input.nextPosition.id,
    previousPositionLabel: input.previousPositionLabel ?? null,
    nextPositionLabel: input.nextPosition.name,
    source: input.source,
    reason: input.reason?.trim() || null,
    changedByUserId: input.actorUserId ?? null,
  })
  return true
}

/**
 * Resuelve la referencia humana del cargo dentro del cliente recibido.
 *
 * Orden: id explícito → código → nombre/alias normalizado. Si no existe y hay
 * nombre, crea un cargo pendiente y sin capacidades. El INSERT tolera la carrera
 * entre dos importaciones: la que pierde relee la fila ganadora por su clave
 * única en vez de producir un duplicado.
 */
export async function resolveWorkerPosition(
  input: ResolveWorkerPositionInput,
  options: ResolveWorkerPositionOptions = {},
  client: Client = db,
): Promise<{ position: WorkerPosition; created: boolean }> {
  const allowInactive = options.allowInactive ?? false

  if (input.id?.trim()) {
    const position = await client.query.workerPositions.findFirst({
      where: eq(workerPositions.id, input.id.trim()),
    })
    if (!position) throw new WorkerPositionDomainError("El cargo seleccionado no existe.", "NOT_FOUND")
    return { position: ensureAssignable(position, allowInactive), created: false }
  }

  const code = normalizedCode(input.code)
  if (code && code.length > POSITION_CODE_MAX) {
    throw new WorkerPositionDomainError(
      `El código de cargo "${code.slice(0, 40)}…" supera los ${POSITION_CODE_MAX} caracteres.`,
      "INVALID_INPUT",
    )
  }
  if (code) {
    const position = await client.query.workerPositions.findFirst({
      where: eq(workerPositions.code, code),
    })
    if (position) return { position: ensureAssignable(position, allowInactive), created: false }
  }

  const name = cleanWorkerPositionDisplayName(input.name ?? "")
  const normalizedKey = normalizeWorkerPositionKey(name)
  if (normalizedKey.length < 2) {
    if (code) {
      throw new WorkerPositionDomainError(`No existe el cargo con código "${code}" y falta su nombre.`, "NOT_FOUND")
    }
    const unclassified = await client.query.workerPositions.findFirst({
      where: eq(workerPositions.code, "SIN-CLASIFICAR"),
    })
    if (!unclassified) throw new Error("No existe el cargo de sistema Sin clasificar.")
    return { position: ensureAssignable(unclassified, allowInactive), created: false }
  }

  if (name.length > POSITION_NAME_MAX || normalizedKey.length > POSITION_NAME_MAX) {
    throw new WorkerPositionDomainError(
      `El nombre de cargo "${name.slice(0, 40)}…" supera los ${POSITION_NAME_MAX} caracteres.`,
      "INVALID_INPUT",
    )
  }

  const matched = await findByNormalizedKey(client, normalizedKey)
  if (matched) {
    if (code && matched.code !== code) {
      throw new WorkerPositionDomainError(
        `El nombre "${name}" ya corresponde al código ${matched.code}.`,
        "CONFLICT",
      )
    }
    return { position: ensureAssignable(matched, allowInactive), created: false }
  }

  if (options.createIfMissing === false) {
    throw new WorkerPositionDomainError(`El cargo "${name}" no existe.`, "NOT_FOUND")
  }

  const targetCode = code ?? buildWorkerPositionAutoCode(normalizedKey)
  const inserted = await client.insert(workerPositions).values({
    id: `worker-position-${nanoid()}`,
    code: targetCode,
    name,
    normalizedKey,
    isActive: true,
    needsReview: true,
    isSystem: false,
  }).onConflictDoNothing().returning()

  if (inserted[0]) return { position: inserted[0], created: true }

  // Otra transacción pudo insertar la misma clave mientras esta resolvía.
  const raced = await findByNormalizedKey(client, normalizedKey)
  if (raced) {
    if (raced.code !== targetCode && code) {
      throw new WorkerPositionDomainError(
        `El nombre "${name}" ya corresponde al código ${raced.code}.`,
        "CONFLICT",
      )
    }
    return { position: ensureAssignable(raced, allowInactive), created: false }
  }

  const codeConflict = await client.query.workerPositions.findFirst({
    where: eq(workerPositions.code, targetCode),
  })
  if (codeConflict) {
    throw new WorkerPositionDomainError(
      `El código ${targetCode} ya pertenece al cargo "${codeConflict.name}".`,
      "CONFLICT",
    )
  }
  throw new Error("No se pudo crear ni resolver el cargo.")
}

export type MergeWorkerPositionsInput = {
  sourceId: string
  targetId: string
  actorUserId?: string | null
}

export type MergeWorkerPositionsResult = {
  target: WorkerPosition
  movedWorkers: number
  movedAliases: number
}

/**
 * Fusiona dos cargos que resultaron ser el mismo.
 *
 * Es la operación que de verdad hace falta cuando una importación deja dos
 * entradas para un mismo puesto: borrar no sirve, porque `worker_position_history`
 * referencia el cargo con `ON DELETE restrict` y el historial es inmutable, así
 * que el origen no puede desaparecer.
 *
 * En su lugar el origen queda como lápida inactiva —el historial sigue
 * apuntando a algo real— y su grafía pasa a ser alias del destino, de modo que
 * la siguiente importación con el nombre viejo resuelva al cargo bueno en vez
 * de volver a crear el duplicado.
 *
 * La clave normalizada del origen se reemplaza por una marca que el
 * normalizador no puede generar jamás (sólo produce `[a-z0-9 ]`), porque esa
 * clave tiene que quedar libre para el alias y el índice único es global.
 */
export async function mergeWorkerPositions(
  input: MergeWorkerPositionsInput,
  client?: Client,
): Promise<MergeWorkerPositionsResult> {
  const work = async (tx: Client): Promise<MergeWorkerPositionsResult> => {
    if (input.sourceId === input.targetId) {
      throw new WorkerPositionDomainError("Un cargo no puede fusionarse consigo mismo.", "INVALID_INPUT")
    }

    const [source, target] = await Promise.all([
      tx.query.workerPositions.findFirst({ where: eq(workerPositions.id, input.sourceId) }),
      tx.query.workerPositions.findFirst({ where: eq(workerPositions.id, input.targetId) }),
    ])
    if (!source) throw new WorkerPositionDomainError("El cargo de origen no existe.", "NOT_FOUND")
    if (!target) throw new WorkerPositionDomainError("El cargo de destino no existe.", "NOT_FOUND")
    if (source.isSystem) {
      throw new WorkerPositionDomainError("Los cargos de sistema no pueden fusionarse.", "SYSTEM_RECORD")
    }
    ensureAssignable(target, false)

    // Los trabajadores se mueven de a uno para poder dejar su traza individual:
    // el historial es lo que explica por qué alguien cambió de cargo sin que
    // nadie editara su ficha.
    const affected = await tx.select({ id: workers.id }).from(workers).where(eq(workers.positionId, source.id))
    if (affected.length > 0) {
      await tx.update(workers)
        .set({ positionId: target.id, position: target.name })
        .where(eq(workers.positionId, source.id))
      for (const worker of affected) {
        await recordWorkerPositionChange({
          workerId: worker.id,
          previousPositionId: source.id,
          previousPositionLabel: source.name,
          nextPosition: target,
          source: "admin",
          reason: `Fusión del cargo "${source.name}" en "${target.name}"`,
          actorUserId: input.actorUserId,
        }, tx)
      }
    }

    // Los alias del origen apuntaban al cargo equivocado; pasan al destino.
    const movedAliases = await tx.update(workerPositionAliases)
      .set({ positionId: target.id })
      .where(eq(workerPositionAliases.positionId, source.id))
      .returning({ id: workerPositionAliases.id })

    // Las capacidades del destino son las que mandan; las del origen dejarían
    // contadores fantasma en el catálogo de capacidades.
    await tx.delete(workerPositionCapabilities).where(eq(workerPositionCapabilities.positionId, source.id))

    // Liberar la clave ANTES de insertar el alias: el trigger de unicidad
    // rechaza que una misma clave sea cargo canónico y alias a la vez.
    const originalKey = source.normalizedKey
    await tx.update(workerPositions)
      .set({ normalizedKey: `#fusionado-${source.id}`, isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(workerPositions.id, source.id))

    await tx.insert(workerPositionAliases).values({
      id: `worker-position-alias-${nanoid()}`,
      positionId: target.id,
      alias: source.name,
      normalizedKey: originalKey,
      source: "merge",
      createdByUserId: input.actorUserId ?? null,
    }).onConflictDoNothing()

    return { target, movedWorkers: affected.length, movedAliases: movedAliases.length }
  }
  if (client) return work(client)
  return db.transaction(work)
}
