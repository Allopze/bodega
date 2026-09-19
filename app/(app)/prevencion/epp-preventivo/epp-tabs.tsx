"use client"

import * as React from "react"
import type { EppCoverageGap } from "@/lib/prevention/epp"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EppGapList } from "./epp-gap-list"
import { EppRequirementList, type RequirementItem } from "./epp-requirement-list"

interface Props {
  gaps: EppCoverageGap[]
  requirements: RequirementItem[]
  eppTypes: { id: string; label: string }[]
  families: { id: string; name: string; eppTypeId: string | null }[]
  worksites: { id: string; name: string }[]
  canManage: boolean
}

export function EppTabs({ gaps, requirements, eppTypes, families, worksites, canManage }: Props) {
  const [tab, setTab] = React.useState<"coverage" | "requirements">("coverage")

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(value) => setTab(value as "coverage" | "requirements")}>
        <TabsList>
          <TabsTrigger value="coverage">Cobertura ({gaps.length})</TabsTrigger>
          <TabsTrigger value="requirements">Requisitos ({requirements.length})</TabsTrigger>
        </TabsList>
        {/* `TabsContent` real: el trigger activo emitía `aria-controls` hacia un
            panel que nunca existía (axe `aria-valid-attr-value`). Mismo contenido,
            mismo gating por `tab`, ahora con el id que Radix genera y el trigger
            referencia. */}
        <TabsContent value="coverage"><EppGapList gaps={gaps} canEscalate={canManage} /></TabsContent>
        <TabsContent value="requirements">
          <EppRequirementList requirements={requirements} eppTypes={eppTypes} families={families} worksites={worksites} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
