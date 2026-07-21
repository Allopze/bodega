"use client"

import * as React from "react"
import type { EppCoverageGap } from "@/lib/prevention/epp"
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
      <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-1 w-fit">
        <button type="button" onClick={() => setTab("coverage")} aria-pressed={tab === "coverage"}
          className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
          Cobertura ({gaps.length})
        </button>
        <button type="button" onClick={() => setTab("requirements")} aria-pressed={tab === "requirements"}
          className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
          Requisitos ({requirements.length})
        </button>
      </div>

      {tab === "coverage" && <EppGapList gaps={gaps} canEscalate={canManage} />}
      {tab === "requirements" && (
        <EppRequirementList requirements={requirements} eppTypes={eppTypes} families={families} worksites={worksites} canManage={canManage} />
      )}
    </div>
  )
}
