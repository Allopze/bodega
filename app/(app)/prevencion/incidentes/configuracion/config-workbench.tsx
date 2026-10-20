"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { CatalogPanel } from "./catalog-panel"
import { catalogListLabel, catalogListOrder, isLegacyCategory, AGENT_CATEGORY_LIST, type Re20PolicyKey } from "./catalog-labels"
import type { CatalogRow } from "./catalog-types"
import { OptionSheet } from "./option-sheet"
import { PolicyPanel } from "./policy-panel"

export type ConfigOption = {
  id: string
  category: string
  code: string
  name: string
  isActive: boolean
  sortOrder: number
  parentCode: string | null
}

export function ConfigWorkbench({ options, policy, policyVersion }: {
  options: ConfigOption[]
  policy: Record<Re20PolicyKey, number>
  policyVersion: number
}) {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<CatalogRow | null>(null)

  const { rows, legacyRows } = React.useMemo(() => {
    const parentNames = new Map(options.filter((option) => option.category === AGENT_CATEGORY_LIST).map((option) => [option.code, option.name]))
    const sorted = [...options].sort((a, b) =>
      catalogListOrder(a.category) - catalogListOrder(b.category) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"))
    const all: CatalogRow[] = sorted.map((option, index) => {
      const row: CatalogRow = {
        ...option,
        listLabel: catalogListLabel(option.category),
        parentLabel: option.parentCode ? (parentNames.get(option.parentCode) ?? "") : "",
        firstInList: index === 0 || sorted[index - 1]!.category !== option.category,
        statusLabel: option.isActive ? "Activo" : "Inactivo",
      }
      return row
    })
    return { rows: all.filter((row) => !isLegacyCategory(row.category)), legacyRows: all.filter((row) => isLegacyCategory(row.category)) }
  }, [options])

  function openCreate() { setEditing(null); setSheetOpen(true) }
  function openEdit(row: CatalogRow) { setEditing(row); setSheetOpen(true) }

  return (
    <PageContainer>
      <PageHeader
        title="Configuración RE-20"
        description="Listas desplegables del expediente de investigación y plazos operacionales internos."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención" }, { label: "Incidentes", href: "/prevencion/incidentes" }, { label: "Configuración RE-20" }]} />}
        actions={<Button type="button" variant="primary" onClick={openCreate}><Plus className="size-4" />Nuevo valor</Button>}
      />
      <div className="space-y-4">
        <PolicyPanel policy={policy} version={policyVersion} />
        <CatalogPanel rows={rows} legacyRows={legacyRows} onEdit={openEdit} onCreate={openCreate} />
      </div>
      <OptionSheet open={sheetOpen} onOpenChange={setSheetOpen} option={editing} rows={rows} />
    </PageContainer>
  )
}
