import { and, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fleetGpsDriverMappings, workers } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import { readDteSettingsKeyring } from "@/lib/services/dte-portal/settings-crypto"
import {
  candidateOnwayDriverHashes,
  decryptOnwayDriverIdentity,
  encryptOnwayDriverIdentity,
} from "./onway-driver-identity"

function requireGpsManager(session: Session) {
  if (!can(session, "flota:manage_gps")) throw new Error("Sin permisos para administrar conductores de OnWay")
}

export interface OnwayDriverMappingInput {
  externalId: string
  displayName?: string | null
  workerId: string
}

export async function saveOnwayDriverMapping(session: Session, input: OnwayDriverMappingInput) {
  requireGpsManager(session)
  const keyring = readDteSettingsKeyring()
  const encrypted = encryptOnwayDriverIdentity({
    provider: "onway",
    externalId: input.externalId,
    displayName: input.displayName,
  }, keyring)
  const worker = await db.query.workers.findFirst({
    where: eq(workers.id, input.workerId),
    columns: { id: true, worksiteId: true, isActive: true },
  })
  if (!worker || !worker.isActive || !canAccessWorksite(session, worker.worksiteId)) {
    throw new Error("Trabajador no encontrado, inactivo o fuera de alcance")
  }

  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    const current = await tx.query.fleetGpsDriverMappings.findFirst({
      where: eq(fleetGpsDriverMappings.externalDriverHash, encrypted.externalDriverHash),
      columns: { id: true, workerId: true },
    })
    if (current) {
      await tx.update(fleetGpsDriverMappings).set({
        externalDriverCiphertext: encrypted.externalDriverCiphertext,
        displayNameCiphertext: encrypted.displayNameCiphertext,
        workerId: worker.id,
        mappedByUserId: session.user.id,
        isActive: true,
        updatedAt: now,
      }).where(eq(fleetGpsDriverMappings.id, current.id))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "fleet_gps_driver_mapping",
        entityId: current.id,
        oldState: { workerId: current.workerId },
        newState: { workerId: worker.id, provider: "onway" },
      }, tx)
      return
    }
    const id = `gpsdriver-${nanoid()}`
    await tx.insert(fleetGpsDriverMappings).values({
      id,
      provider: "onway",
      ...encrypted,
      workerId: worker.id,
      mappedByUserId: session.user.id,
      createdAt: now,
      updatedAt: now,
    })
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "fleet_gps_driver_mapping",
      entityId: id,
      newState: { workerId: worker.id, provider: "onway" },
    }, tx)
  })
}

/** No descifra nombres: lo invoca la sincronización para ligar observaciones. */
export async function resolveOnwayDriverMappings(externalIds: string[]): Promise<Map<string, { id: string; workerId: string }>> {
  const keyring = readDteSettingsKeyring()
  const candidates = new Map<string, string[]>()
  const hashes = new Set<string>()
  for (const externalId of [...new Set(externalIds.filter(Boolean))]) {
    const values = candidateOnwayDriverHashes(externalId, keyring)
    candidates.set(externalId, values)
    for (const value of values) hashes.add(value)
  }
  if (hashes.size === 0) return new Map()
  const rows = await db.select({
    id: fleetGpsDriverMappings.id,
    externalDriverHash: fleetGpsDriverMappings.externalDriverHash,
    workerId: fleetGpsDriverMappings.workerId,
  }).from(fleetGpsDriverMappings).where(and(
    eq(fleetGpsDriverMappings.provider, "onway"),
    eq(fleetGpsDriverMappings.isActive, true),
    inArray(fleetGpsDriverMappings.externalDriverHash, [...hashes]),
  ))
  const byHash = new Map(rows.map((row) => [row.externalDriverHash, row]))
  const resolved = new Map<string, { id: string; workerId: string }>()
  for (const [externalId, values] of candidates) {
    const row = values.map((hash) => byHash.get(hash)).find(Boolean)
    if (row) resolved.set(externalId, { id: row.id, workerId: row.workerId })
  }
  return resolved
}

export async function listOnwayDriverMappings(session: Session) {
  requireGpsManager(session)
  const keyring = readDteSettingsKeyring()
  const rows = await db.query.fleetGpsDriverMappings.findMany({
    where: eq(fleetGpsDriverMappings.provider, "onway"),
    with: { worker: { with: { worksite: true } } },
    orderBy: [fleetGpsDriverMappings.updatedAt],
  })
  return rows.flatMap((row) => {
    if (!canAccessWorksite(session, row.worker.worksiteId)) return []
    try {
      const identity = decryptOnwayDriverIdentity({
        provider: "onway",
        externalDriverHash: row.externalDriverHash,
        externalDriverCiphertext: row.externalDriverCiphertext,
        displayNameCiphertext: row.displayNameCiphertext,
      }, keyring)
      return [{
        id: row.id,
        externalId: identity.externalId,
        displayName: identity.displayName,
        workerId: row.workerId,
        workerName: `${row.worker.firstName} ${row.worker.lastName}`.trim(),
        worksiteName: row.worker.worksite.name,
        isActive: row.isActive,
      }]
    } catch {
      return []
    }
  })
}
