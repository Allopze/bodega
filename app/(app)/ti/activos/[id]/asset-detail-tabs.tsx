"use client"

import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { OptionSelect } from "@/components/ui/option-select"

interface AssetDetailTabsProps {
  assetId: string
  summary: React.ReactNode
  assignments: React.ReactNode
  maintenance: React.ReactNode
  tickets: React.ReactNode
  documents: React.ReactNode
  history: React.ReactNode
  counts: {
    assignments: number
    maintenance: number
    tickets: number
    documents: number
    history: number
  }
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">{children}</span>
}

const TABS = ["resumen", "asignaciones", "mantenciones", "tickets", "documentos", "historial"] as const

export function AssetDetailTabs({ summary, assignments, maintenance, tickets, documents, history, counts }: AssetDetailTabsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlTab = searchParams.get("tab")
  const [tab, setTab] = React.useState<string>(urlTab && TABS.includes(urlTab as typeof TABS[number]) ? urlTab : "resumen")

  React.useEffect(() => {
    const next = urlTab && TABS.includes(urlTab as typeof TABS[number]) ? urlTab : "resumen"
    setTab(next)
  }, [urlTab])

  function handleChange(value: string) {
    setTab(value)
    router.replace(value === "resumen" ? pathname : `${pathname}?tab=${value}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={handleChange}>
      <div className="mb-3 md:hidden">
        <OptionSelect
          value={tab}
          onValueChange={handleChange}
          options={[
            { value: "resumen", label: "Resumen" },
            { value: "asignaciones", label: `Asignaciones (${counts.assignments})` },
            { value: "mantenciones", label: `Mantenciones (${counts.maintenance})` },
            { value: "tickets", label: `Tickets (${counts.tickets})` },
            { value: "documentos", label: `Documentos (${counts.documents})` },
            { value: "historial", label: `Historial (${counts.history})` },
          ]}
        />
      </div>
      <TabsList className="hidden flex-nowrap md:inline-flex">
        <TabsTrigger value="resumen">Resumen</TabsTrigger>
        <TabsTrigger value="asignaciones">Asignaciones <Count>{counts.assignments}</Count></TabsTrigger>
        <TabsTrigger value="mantenciones">Mantenciones <Count>{counts.maintenance}</Count></TabsTrigger>
        <TabsTrigger value="tickets">Tickets <Count>{counts.tickets}</Count></TabsTrigger>
        <TabsTrigger value="documentos">Documentos <Count>{counts.documents}</Count></TabsTrigger>
        <TabsTrigger value="historial">Historial <Count>{counts.history}</Count></TabsTrigger>
      </TabsList>

      <TabsContent value="resumen">{summary}</TabsContent>
      <TabsContent value="asignaciones">{assignments}</TabsContent>
      <TabsContent value="mantenciones">{maintenance}</TabsContent>
      <TabsContent value="tickets">{tickets}</TabsContent>
      <TabsContent value="documentos">{documents}</TabsContent>
      <TabsContent value="historial">{history}</TabsContent>
    </Tabs>
  )
}
