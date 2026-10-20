import { requireAuth } from "@/lib/auth/can"
import { getPdtpExecutionConnector } from "@/lib/services/pdtp/connectors"
import { listPdtpExecutableInstances } from "@/lib/services/pdtp/executable-instances"
import { PdtpScheduledActivityPanel } from "./pdtp-scheduled-activity-panel"

export async function PdtpScheduledActivityPanelServer({ connectorKey, searchQuery, worksiteId, presentation }: {
  connectorKey: string
  /** Búsqueda propia de la pantalla; ver el prop homónimo del panel. */
  searchQuery?: string
  /** Faena elegida por la pantalla; ver el prop homónimo del panel. */
  worksiteId?: string
  /** `panel` por defecto; `summary` lo reduce a un aviso plegable. Ver el prop homónimo del panel. */
  presentation?: "panel" | "summary"
}) {
  let session
  try {
    session = await requireAuth()
  } catch {
    return null
  }
  const connector = getPdtpExecutionConnector(connectorKey)
  if (!connector || !session.user.permissions.includes(connector.executePermission)) return null
  const rows = await listPdtpExecutableInstances(session, { connectorKey })
  return (
    <PdtpScheduledActivityPanel
      rows={rows}
      connectorLabel={connector.label}
      searchQuery={searchQuery}
      worksiteId={worksiteId}
      presentation={presentation}
    />
  )
}
