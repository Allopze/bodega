"use client"

import * as React from "react"
import type { EppCoverageGap } from "@/lib/prevention/epp"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EppGapList } from "./epp-gap-list"
import { EppRequirementList } from "./epp-requirement-list"

interface RequirementItem {
  id: string
  eppTypeLabel: string
  scopeType: string
  scopeValue: string | null
  worksiteName: string | null
  enforcement: string
  reason: string
  isActive: boolean
}

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
      </Tabs>

      {tab === "coverage" && <EppGapList gaps={gaps} canEscalate={canManage} />}
      {tab === "requirements" && (
        <EppRequirementList requirements={requirements} eppTypes={eppTypes} families={families} worksites={worksites} canManage={canManage} />
      )}
    </div>
  )
}
