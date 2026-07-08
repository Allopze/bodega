"use server"

import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import {
  parseDefaultScopeRoles,
  upsertPdtpResponsible,
  upsertPdtpSheet,
  type PdtpResponsibleInput,
  type PdtpSheetInput,
} from "@/lib/services/pdtp/admin-catalogs"
import type { ActionState } from "@/lib/validation/masters"
import { listRoleSlugs } from "@/lib/services/pdtp/admin-catalogs"

const REVALIDATE = "/admin/pdtp-catalogos"

function errorState(message: string): ActionState {
  return { ok: false, message }
}

function getFormString(form: FormData, key: string): string | undefined {
  const raw = form.get(key)
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  return trimmed.length ? trimmed : undefined
}

export async function savePdtpResponsibleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:pdtp_catalog")
  } catch {
    return errorState("Sin permisos")
  }

  const input: PdtpResponsibleInput = {
    id: getFormString(formData, "id"),
    slug: getFormString(formData, "slug") ?? "",
    displayName: getFormString(formData, "displayName") ?? "",
    roleName: getFormString(formData, "roleName"),
    kind: getFormString(formData, "kind") ?? "",
    notes: getFormString(formData, "notes"),
  }
  if (!input.displayName) return errorState("Ingresa el nombre visible del responsable")

  try {
    const row = await upsertPdtpResponsible(input)
    if (!row) return errorState("El responsable no se pudo guardar")
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "update",
      entityType: "pdtp_responsible",
      entityId:   row.slug,
      newState:   { displayName: row.displayName, kind: row.kind },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: `Responsable ${row.displayName} guardado` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function savePdtpSheetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:pdtp_catalog")
  } catch {
    return errorState("Sin permisos")
  }

  const code = getFormString(formData, "code") ?? ""
  const label = getFormString(formData, "label") ?? ""
  const area = getFormString(formData, "area") ?? ""
  const programId = getFormString(formData, "programId")
  if (!code) return errorState("Ingresa el código de la hoja")
  if (!label) return errorState("Ingresa la etiqueta de la hoja")
  if (!area) return errorState("Ingresa el área de la hoja")

  const registry = await listRoleSlugs()
  const defaultScopeRoles = parseDefaultScopeRoles(formData.get("defaultScopeRoles"), registry)
  const input: PdtpSheetInput = {
    id: getFormString(formData, "id"),
    code,
    programId: programId ?? null,
    label,
    area,
    defaultScopeRoles,
  }

  try {
    const row = await upsertPdtpSheet(input)
    if (!row) return errorState("La hoja no se pudo guardar")
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "update",
      entityType: "pdtp_sheet",
      entityId:   row.id,
      newState:   { code: row.code, label: row.label, defaultScopeRoles: row.defaultScopeRoles },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: `Hoja ${row.code} guardada` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function loadAdminRoleSlugsAction(): Promise<string[]> {
  return listRoleSlugs()
}
