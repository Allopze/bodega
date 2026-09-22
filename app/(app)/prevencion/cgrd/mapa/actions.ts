"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  addRiskMapMarker,
  removeRiskMapMarker,
} from "@/lib/services/prevention-risk-map"
import type { RiskLegalAccess } from "@/lib/services/prevention-risk-legal"
import type { ActionState } from "@/lib/validation/prevention"

/*
 * El mapa exige `prevention:risk:edit`, no un permiso del CGRD: los marcadores
 * son entradas de la matriz IPER publicada. Mudar la pantalla a CGRD el
 * 2026-09-22 no mudó el dato. Ver
 * docs/superpowers/specs/2026-09-22-mapa-riesgos-en-cgrd-design.md.
 */
const REVALIDATE = "/prevencion/cgrd/mapa"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): RiskLegalAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

async function run(access: RiskLegalAccess, operation: (access: RiskLegalAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(REVALIDATE)
    // El mapa alimenta el requisito Oro `risk_map` de la certificación CPHS, que
    // la cobertura del PDTP refleja.
    revalidatePath("/prevencion/pdtp/cobertura")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    return unexpectedActionError(error, "prevencion/cgrd/mapa/actions")
  }
}

export async function addRiskMapMarkerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addRiskMapMarker(input, access))
}

export async function removeRiskMapMarkerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => removeRiskMapMarker(input, access))
}
