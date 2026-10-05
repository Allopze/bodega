import * as React from "react"
import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Callout } from "@/components/ui/callout"
import { formatDate } from "@/lib/utils"
import {
  IT_ASSET_STATUS_META, IT_RETIREMENT_REASON_META, isRetiredStatus, itStatusLabel,
} from "@/lib/services/ti/constants"
import { AssetCategoryIcon } from "./asset-category-icon"
import { WarrantyBadge } from "../warranty-badge"
import { Archive } from "@phosphor-icons/react/dist/ssr"

interface RetirementInfo {
  date: string
  reason: string
  destination: string | null
  responsibleName: string
  authorizedByName: string
  reversedAt: string | null
}

interface AssetHeaderProps {
  asset: {
    code: string
    brand: string | null
    model: string | null
    status: string
    typeName: string
    typeCategory: string
    workerName: string | null
    worksiteName: string | null
    warrantyEndDate: string | null
  }
  /** Baja vigente (no revertida) del activo, si la hay. */
  retirement: RetirementInfo | null
  /** Panel «Siguiente acción» (cliente). */
  children?: React.ReactNode
}

/**
 * Cabecera de la ficha: quién es el activo (identidad) y qué sigue (panel de
 * acción). En móvil la acción va primero: es lo que quien abre la ficha desde
 * el teléfono viene a hacer. Una sola superficie con divisor, sin tarjetas
 * anidadas.
 */
export function AssetHeader({ asset, retirement, children }: AssetHeaderProps) {
  const statusMeta = IT_ASSET_STATUS_META[asset.status] ?? { label: asset.status, variant: "default" as const }
  const terminal = isRetiredStatus(asset.status)
  const name = [asset.brand, asset.model].filter(Boolean).join(" ")

  return (
    <div className="mb-6 space-y-4">
      {terminal && <RetiredBanner status={asset.status} retirement={retirement} />}

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-0">
          <div className="order-2 lg:order-1 lg:pr-6">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]">
                <AssetCategoryIcon category={asset.typeCategory} />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[var(--color-text)]">{name || asset.typeName}</h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  <span className="font-mono whitespace-nowrap">{asset.code}</span> · {asset.typeName}
                </p>
              </div>
              <MetaBadge meta={statusMeta} dot size="lg" className="ml-auto shrink-0" />
            </div>

            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Custodio</dt>
                <dd className="font-medium text-[var(--color-text)]">{asset.workerName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Faena</dt>
                <dd className="font-medium text-[var(--color-text)]">{asset.worksiteName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Garantía</dt>
                <dd><WarrantyBadge endDate={asset.warrantyEndDate} /></dd>
              </div>
            </dl>
          </div>

          <div className="order-1 border-b border-[var(--color-border)] pb-5 lg:order-2 lg:border-b-0 lg:border-l lg:pb-0 lg:pl-6">
            {children}
          </div>
        </div>
      </section>
    </div>
  )
}

function RetiredBanner({ status, retirement }: { status: string; retirement: RetirementInfo | null }) {
  const statusLabel = itStatusLabel(status)
  const title = status === "dado_de_baja" ? "Este activo está dado de baja" : `Este activo figura como ${statusLabel.toLowerCase()}`

  return (
    <Callout tone="danger" icon={<Archive size={18} />} title={title} role="status">
      {retirement ? (
        <>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div><dt className="text-xs opacity-80">Fecha</dt><dd className="font-medium">{formatDate(retirement.date)}</dd></div>
            <div><dt className="text-xs opacity-80">Motivo</dt><dd className="font-medium">{IT_RETIREMENT_REASON_META[retirement.reason] ?? retirement.reason}</dd></div>
            <div><dt className="text-xs opacity-80">Destino</dt><dd className="font-medium">{retirement.destination ?? "—"}</dd></div>
            <div><dt className="text-xs opacity-80">Responsable</dt><dd className="font-medium">{retirement.responsibleName}</dd></div>
            <div><dt className="text-xs opacity-80">Autorizó</dt><dd className="font-medium">{retirement.authorizedByName}</dd></div>
          </dl>
          <p className="mt-2 text-sm">
            No admite entregas, mantenciones ni ediciones. Si la baja fue un error, se revierte desde Bajas con el permiso correspondiente.{" "}
            <Link href="/ti/bajas" className="inline-flex min-h-11 items-center font-semibold underline sm:min-h-0">Ver en Bajas</Link>
          </p>
        </>
      ) : (
        <p>
          Se registró a mano, sin una baja formal. Si el equipo apareció, corrige su estado desde «Más acciones».
        </p>
      )}
    </Callout>
  )
}
