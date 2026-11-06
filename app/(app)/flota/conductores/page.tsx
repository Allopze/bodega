import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { can, requirePermission } from "@/lib/auth/can"
import { getDriverRosterRow, listDriverCandidates, listDriverRoster } from "@/lib/services/driver-licenses"
import { DriversWorkbench } from "./drivers-workbench"
import { countDriversByEstado, defaultDriverEstado, parseDriverEstado } from "./drivers-view"

export const metadata: Metadata = { title: "Conductores" }

/** Un parámetro de la URL como texto acotado; lo que no es texto, o viene vacío, no existe. */
function textParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 80) : null
}

export default async function ConductoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("flota:manage_licenses") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const estadoParam = parseDriverEstado(sp.estado)
  const requestedFaena = textParam(sp.faena)
  const editarWorkerId = textParam(sp.editar)

  let faena = requestedFaena
  let roster = await listDriverRoster(session, faena ? { worksiteId: faena } : undefined)
  // Una faena que ya no es del alcance (enlace viejo, faena desactivada) no filtra: se muestra todo.
  if (faena && !roster.worksites.some((worksite) => worksite.id === faena)) {
    faena = null
    roster = await listDriverRoster(session)
  }

  // La fila del trabajador que abre `?editar=` puede no estar en la lista (otra faena,
  // todavía sin licencia): se busca en la lista y, si no está, se le pide al servicio.
  const listed = editarWorkerId ? roster.rows.find((row) => row.workerId === editarWorkerId) : undefined
  const [candidates, editRow] = await Promise.all([
    listDriverCandidates(session),
    editarWorkerId && !listed ? getDriverRosterRow(session, editarWorkerId) : (listed ?? null),
  ])

  const defaultEstado = defaultDriverEstado(countDriversByEstado(roster.rows))

  return (
    <PageContainer>
      <DriversWorkbench
        rows={roster.rows}
        candidates={candidates}
        worksites={roster.worksites}
        today={roster.today}
        warningDays={roster.warningDays}
        unclassifiedWorkers={roster.unclassifiedWorkers}
        canAssignPositions={can(session, "admin:workers")}
        estadoParam={estadoParam}
        defaultEstado={defaultEstado}
        faenaParam={faena}
        editarWorkerId={editarWorkerId}
        editRow={editRow}
      />
    </PageContainer>
  )
}
