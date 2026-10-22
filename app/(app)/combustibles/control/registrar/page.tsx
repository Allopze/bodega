import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { and, asc, eq } from "drizzle-orm"
import { GasPump } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { fuelTaeLoadingPoints } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite, worksiteScopeSql } from "@/lib/auth/scope"
import { settle } from "@/lib/async-settle"
import { buildFieldLoadConfig } from "@/lib/services/fuel-tae"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { loadControlContext } from "../_components/control-context"
import { ControlNav } from "../_components/control-nav"
import { RegistrarForm } from "./registrar-form"
import { RegistrarPicker } from "./registrar-picker"

export const metadata: Metadata = { title: "Registrar carga" }

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

export default async function RegistrarCargaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:register_load") } catch { redirect("/forbidden") }

  const raw = await searchParams
  const context = await loadControlContext(session)
  const pointsResult = await settle(
    db.select({ id: fuelTaeLoadingPoints.id, name: fuelTaeLoadingPoints.name, type: fuelTaeLoadingPoints.type, worksiteId: fuelTaeLoadingPoints.worksiteId })
      .from(fuelTaeLoadingPoints)
      .where(and(eq(fuelTaeLoadingPoints.isActive, true), worksiteScopeSql(session, fuelTaeLoadingPoints.worksiteId)))
      .orderBy(asc(fuelTaeLoadingPoints.name)),
    null,
    "registrar-loading-points",
  )
  const points = pointsResult ?? []

  // La faena y el lugar vienen de la URL, pero solo valen si el usuario los puede
  // operar y el lugar es de esa faena: el alcance se decide aquí, no en el selector.
  const worksiteId = first(raw.faena)
  const pointId = first(raw.lugar)
  const selectedPoint = points.find((point) => point.id === pointId && point.worksiteId === worksiteId)
  const allowed = worksiteId !== "" && canAccessWorksite(session, worksiteId) && context.worksites.some((worksite) => worksite.id === worksiteId)
  const config = allowed && selectedPoint
    ? await settle(buildFieldLoadConfig(worksiteId, selectedPoint.id), null, "registrar-config")
    : null

  return (
    <PageContainer width="form">
      <PageHeader
        title="Registrar carga"
        description="Anota una carga de combustible hecha en terreno, paso a paso"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control", href: "/combustibles/control" }, { label: "Registrar carga" }]} />}
      />
      <ControlNav items={context.navItems} />
      <DegradedDataBanner degraded={pointsResult === null ? ["lugares de carga"] : []} total={1} />

      {context.worksites.length === 0 || (pointsResult !== null && points.length === 0) ? (
        <EmptyState
          icon={<GasPump size={24} />}
          title="Aún no hay lugares de carga para registrar"
          description="Para registrar una carga hace falta una faena a tu alcance con un lugar de carga activo (surtidor, camión surtidor, bidón…). Se crean en Control TAE."
          action={<Button asChild variant="secondary" size="sm"><Link href="/combustibles/tae">Ir a Control TAE</Link></Button>}
        />
      ) : (
        <div className="space-y-6">
          <RegistrarPicker
            worksites={context.worksites}
            points={points.map((point) => ({ id: point.id, name: point.name, worksiteId: point.worksiteId }))}
            worksiteId={allowed ? worksiteId : ""}
            pointId={selectedPoint ? selectedPoint.id : ""}
          />
          {config ? (
            <RegistrarForm key={`${config.worksite.id}:${config.loadingPoint?.id}`} config={config} />
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">Elige la faena y el lugar de carga para empezar.</p>
          )}
        </div>
      )}
    </PageContainer>
  )
}
