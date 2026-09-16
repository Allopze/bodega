import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityExecutorAssignments,
  pdtpPrograms,
  permissions,
  rolePermissions,
  roles,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState } from "./helpers"

export type PdtpExecutorRoleOption = {
  id: string
  name: string
  label: string
  permissions: string[]
}

export type PdtpActivityExecutorAssignmentView = {
  activityId: string
  roleId: string
  roleName: string
  roleLabel: string
}

/** Roles y permisos reales. Nunca se basa en el manifest ni crea grants. */
export async function listPdtpExecutorRoleOptions(): Promise<PdtpExecutorRoleOption[]> {
  const rows = await db.select({
    id: roles.id,
    name: roles.name,
    label: roles.label,
    permission: permissions.name,
  })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .orderBy(roles.label)

  const byId = new Map<string, PdtpExecutorRoleOption>()
  for (const row of rows) {
    const option = byId.get(row.id) ?? {
      id: row.id,
      name: row.name,
      label: row.label,
      permissions: [],
    }
    if (row.permission) option.permissions.push(row.permission)
    byId.set(row.id, option)
  }
  return [...byId.values()]
}

export async function listPdtpActivityExecutorAssignments(programId: string): Promise<PdtpActivityExecutorAssignmentView[]> {
  return db.select({
    activityId: pdtpActivityExecutorAssignments.activityId,
    roleId: roles.id,
    roleName: roles.name,
    roleLabel: roles.label,
  })
    .from(pdtpActivityExecutorAssignments)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpActivityExecutorAssignments.activityId))
    .innerJoin(roles, eq(roles.id, pdtpActivityExecutorAssignments.roleId))
    .where(eq(pdtpActivities.programId, programId))
    .orderBy(pdtpActivities.n, roles.label)
}

/**
 * Reemplaza explícitamente los roles acreditadores de una actividad borrador.
 * Una lista vacía es válida mientras se configura, pero la compuerta de
 * cobertura impedirá enviar o activar la nueva revisión si el destino exige
 * un permiso y no queda ningún ejecutor válido.
 */
export async function setPdtpActivityExecutorAssignments(input: {
  programId: string
  activityId: string
  roleIds: string[]
  userId: string
}) {
  const roleIds = [...new Set(input.roleIds.filter(Boolean))]
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, input.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    const [activity] = await tx.select({ id: pdtpActivities.id, n: pdtpActivities.n })
      .from(pdtpActivities)
      .where(and(eq(pdtpActivities.id, input.activityId), eq(pdtpActivities.programId, input.programId)))
      .limit(1)
    if (!activity) throw new Error("Actividad PDTP no encontrada en este programa.")

    if (roleIds.length > 0) {
      const existingRoles = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds))
      if (existingRoles.length !== roleIds.length) throw new Error("Uno de los roles acreditadores ya no existe.")
    }

    const previous = await tx.select({ roleId: pdtpActivityExecutorAssignments.roleId })
      .from(pdtpActivityExecutorAssignments)
      .where(eq(pdtpActivityExecutorAssignments.activityId, activity.id))
    const now = new Date().toISOString()
    await tx.delete(pdtpActivityExecutorAssignments)
      .where(eq(pdtpActivityExecutorAssignments.activityId, activity.id))
    if (roleIds.length > 0) {
      await tx.insert(pdtpActivityExecutorAssignments).values(roleIds.map((roleId) => ({
        id: `pdtp-executor-${nanoid()}`,
        activityId: activity.id,
        roleId,
        createdAt: now,
        updatedAt: now,
      })))
    }
    await addPdtpChangeLogEntry(
      program.id,
      program.version,
      input.userId,
      "executors",
      { activityId: activity.id, roleIds: previous.map((row) => row.roleId) },
      { activityId: activity.id, roleIds },
      `Ejecutores acreditadores actualizados para actividad N°${activity.n}.`,
      tx,
    )
    return { activityId: activity.id, roleIds }
  })
}
