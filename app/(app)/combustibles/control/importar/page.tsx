import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { UploadSimple } from "@phosphor-icons/react/dist/ssr"
import { asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelSupplyMedia } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import { listControlImportBatches, type ControlImportBatchRow } from "@/lib/combustibles/control/imports/service"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { loadControlContext } from "../_components/control-context"
import { ControlNav } from "../_components/control-nav"
import { ConfigSection } from "../configuracion/config-section"
import { ImportHistory } from "./import-history"
import { ImportLauncher } from "./import-launcher"
import type { MediumOption } from "./import-types"

export const metadata: Metadata = { title: "Importar datos del control de combustible" }

export default async function ControlImportPage() {
  let session
  try { session = await requirePermission("combustibles:import") } catch { redirect("/forbidden") }

  const failed = Symbol("failed")
  const [context, batchesResult, mediaResult] = await Promise.all([
    loadControlContext(session),
    settle<ControlImportBatchRow[] | typeof failed>(listControlImportBatches(session), failed, "control-import-batches"),
    settle<MediumOption[] | typeof failed>(
      db.select({ id: fuelSupplyMedia.id, name: fuelSupplyMedia.name }).from(fuelSupplyMedia)
        .where(eq(fuelSupplyMedia.isActive, true)).orderBy(asc(fuelSupplyMedia.sortOrder), asc(fuelSupplyMedia.name)),
      failed,
      "control-import-media",
    ),
  ])
  const batches = batchesResult === failed ? [] : batchesResult
  const media = mediaResult === failed ? [] : mediaResult
  const degraded = [batchesResult === failed ? "historial de importaciones" : null, mediaResult === failed ? "medios de suministro" : null].filter((label): label is string => label !== null)
  const canRevert = can(session, "combustibles:revert")

  return (
    <PageContainer>
      <PageHeader
        title="Importar datos del control"
        description="Telemetría diaria y entradas de surtidor o tarjeta, con revisión antes de guardar"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control", href: "/combustibles/control" }, { label: "Importar" }]} />}
        actions={<ImportLauncher media={media} />}
      />
      <ControlNav items={context.navItems} />
      <DegradedDataBanner degraded={degraded} total={2} />

      <ConfigSection
        id="historial"
        title="Historial de importaciones"
        description="Quién importó qué y cuántas filas entraron, se actualizaron o se rechazaron. Reimportar el mismo archivo se bloquea; reimportar datos que se superponen actualiza sin duplicar."
      >
        {batchesResult !== failed && batches.length === 0 ? (
          <EmptyState
            compact
            align="start"
            icon={<UploadSimple size={20} />}
            title="Aún no hay importaciones"
            description="Importa la telemetría diaria del equipo (VisionLink u otra fuente) para ver el ralentí, o las entradas de un surtidor o tarjeta sin integración para conciliar por mandante. Cada archivo se revisa antes de guardarse."
            action={<ImportLauncher media={media} label="Importar un archivo" />}
          />
        ) : (
          <ImportHistory batches={batches} canRevert={canRevert} />
        )}
      </ConfigSection>
    </PageContainer>
  )
}
