"use server"

import { z } from "zod"
import { requireAnyPermission, requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { chartExportFilename } from "@/lib/reports/chart-data-export"
import { countFilterValues, LOOKER_MAX_FILTER_VALUES, LOOKER_MULTI_VALUE_PARAMS, pickFilterParams } from "@/lib/services/mantencion/looker/filters"
import { buildLookerExport, LOOKER_EXPORT_MAX_ROWS } from "@/lib/services/mantencion/looker/export"
import { todayInChile } from "@/lib/utils"
import type { ExportActionResult } from "@/components/ui/export-button"

/**
 * «Exportar Excel» de las pestañas Planificación, «Por kilómetros» y «Por horas» del Panel de mantención.
 *
 * Es el libro de la pantalla armado EN EL SERVIDOR: del navegador sólo llegan la pestaña y los parámetros de la URL
 * (`desde`, `hasta`, `faena`, `equipo`, `frecuencia` y los `x_*` del filtro cruzado). Con ellos se vuelve a consultar
 * con el alcance de quien exporta (ver `buildLookerExport`): una faena ajena no devuelve filas, y ninguna fila viaja
 * desde el navegador. Se exige `mant:export` (la misma que el Excel de `Hoy`) y el permiso que abre la página
 * (`mant:records:view_worksite` o `mant:records:view_all`); ocultar el botón no es la seguridad, esto sí.
 *
 * Es una acción propia y no una extensión de `exportPanelBoardAction`: aquella arma el libro con las tablas «Ver datos»
 * que trae el navegador (las del Panel `Hoy`), y estas pestañas no tienen esas tablas.
 */

const paramValue = z.union([z.string().max(2000), z.array(z.string().max(2000)).max(100), z.undefined()])

const lookerExportSchema = z.object({
  tab: z.enum(["planificacion", "camiones", "maquinas"]),
  params: z.record(z.string().max(40), paramValue)
    .refine((value) => Object.keys(value).length <= 40, "Demasiados parámetros")
    // Cada valor de faena, equipo o frecuencia llega a un `IN (...)` (Postgres admite 65.535 parámetros) y los parámetros quedan en la
    // auditoría: el tope cuenta los valores después de partir por comas, no el largo del texto.
    .refine(
      (value) => LOOKER_MULTI_VALUE_PARAMS.every((key) => countFilterValues(value[key]) <= LOOKER_MAX_FILTER_VALUES),
      `Más de ${LOOKER_MAX_FILTER_VALUES} valores en un filtro`,
    ),
})

export type LookerExportActionInput = z.input<typeof lookerExportSchema>

export async function exportLookerPanelAction(input: LookerExportActionInput): Promise<ExportActionResult> {
  const parsed = lookerExportSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "El panel no se pudo exportar: sus datos no son válidos." }

  let session
  try {
    session = await requirePermission("mant:export")
    await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    return { ok: false, message: "Sin permisos" }
  }

  try {
    const { tab } = parsed.data
    // Sólo valen los parámetros que mueven la pestaña: el resto (incluida `pestana`) se descarta aquí.
    const params = pickFilterParams(parsed.data.params)
    const built = await buildLookerExport(session, { tab, params })
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "board_data_export",
      entityId: nanoid(),
      newState: {
        title: built.title,
        tab,
        params,
        tables: built.sheets,
        truncated: built.truncated,
        permissions: ["mant:export"],
      },
    })
    return {
      ok: true,
      data: {
        base64: built.base64,
        filename: chartExportFilename(built.title, todayInChile()),
        ...(built.truncated ? { truncated: true, rowLimit: LOOKER_EXPORT_MAX_ROWS } : {}),
      },
    }
  } catch (error) {
    logger.error("[exportLookerPanelAction]", error)
    return { ok: false, message: "No se pudo exportar el panel. Intenta nuevamente." }
  }
}
