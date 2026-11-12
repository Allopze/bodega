"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { Session } from "next-auth"
import { guardPermission } from "@/lib/auth/can"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import { MANT_CATALOG_KEYS } from "@/lib/services/mantencion/catalogs"
import {
  createCatalogEntry, renameCatalogEntry, setCatalogEntryActive,
  type CreateCatalogEntryResult,
} from "@/lib/services/mantencion/catalog-admin"
import type { MantActionResult } from "@/lib/services/mantencion/result"

const PATH = "/mantencion/catalogos"
const PERMISSION = "mant:equipment:manage"

/*
 * Los tres cambios exigen `mant:equipment:manage` aquí, en el servidor: el botón
 * de la tabla y el ítem del menú sólo lo reflejan. El nombre se valida a fondo
 * en el servicio (limpieza, largo y colisión por `name_key`); aquí sólo se
 * acota la forma para no pasar basura de tamaño arbitrario.
 */
const catalogSchema = z.enum(MANT_CATALOG_KEYS as [(typeof MANT_CATALOG_KEYS)[number], ...(typeof MANT_CATALOG_KEYS)[number][]])
const idSchema = z.string().trim().min(1).max(64)
const nameSchema = z.string().max(400)

/**
 * Los catálogos son comunes a todas las faenas: editarlos exige ver todas, igual
 * que crear una marca al importar o incorporar (revisión final 2026-11-11). Un
 * encargado de una faena los ve, pero no los cambia.
 */
const GLOBAL_ONLY: MantActionResult<never> = { ok: false, message: "Los catálogos son comunes a todas las faenas: sólo la jefatura que ve todas puede cambiarlos." }
const canEditCatalogs = (session: Session) => equipmentScope(viewerFromSession(session)) === "all"

const INVALID: MantActionResult<never> = { ok: false, message: "Los datos del formulario no son válidos. Recarga la página e inténtalo de nuevo." }

export async function createCatalogEntryAction(input: { catalog: string; name: string }): Promise<MantActionResult<CreateCatalogEntryResult>> {
  const guard = await guardPermission(PERMISSION, PATH)
  if (guard.error) return guard.error
  if (!canEditCatalogs(guard.session)) return GLOBAL_ONLY
  const parsed = z.object({ catalog: catalogSchema, name: nameSchema }).safeParse(input)
  if (!parsed.success) return INVALID
  const result = await createCatalogEntry({
    catalog: parsed.data.catalog,
    name: parsed.data.name,
    actor: { userId: guard.session.user.id, email: guard.session.user.email },
  })
  if (result.ok) revalidatePath(PATH)
  return result
}

export async function renameCatalogEntryAction(input: { catalog: string; id: string; name: string }): Promise<MantActionResult<{ id: string; name: string }>> {
  const guard = await guardPermission(PERMISSION, PATH)
  if (guard.error) return guard.error
  if (!canEditCatalogs(guard.session)) return GLOBAL_ONLY
  const parsed = z.object({ catalog: catalogSchema, id: idSchema, name: nameSchema }).safeParse(input)
  if (!parsed.success) return INVALID
  const result = await renameCatalogEntry({
    catalog: parsed.data.catalog,
    id: parsed.data.id,
    name: parsed.data.name,
    actor: { userId: guard.session.user.id, email: guard.session.user.email },
  })
  if (result.ok) revalidatePath(PATH)
  return result
}

export async function setCatalogEntryActiveAction(input: { catalog: string; id: string; active: boolean }): Promise<MantActionResult<{ id: string; isActive: boolean }>> {
  const guard = await guardPermission(PERMISSION, PATH)
  if (guard.error) return guard.error
  if (!canEditCatalogs(guard.session)) return GLOBAL_ONLY
  const parsed = z.object({ catalog: catalogSchema, id: idSchema, active: z.boolean() }).safeParse(input)
  if (!parsed.success) return INVALID
  const result = await setCatalogEntryActive({
    catalog: parsed.data.catalog,
    id: parsed.data.id,
    active: parsed.data.active,
    actor: { userId: guard.session.user.id, email: guard.session.user.email },
  })
  if (result.ok) revalidatePath(PATH)
  return result
}
