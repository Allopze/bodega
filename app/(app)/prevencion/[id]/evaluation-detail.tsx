"use client"

import { useEvaluationDetail } from "./evaluation-detail/use-evaluation-detail"
import { EvaluationInfoSection } from "./evaluation-detail/evaluation-info-section"
import { EvaluationSectionNav } from "./evaluation-detail/evaluation-section-nav"
import { EvaluationWeeklySection } from "./evaluation-detail/evaluation-weekly-section"
import { EvaluationActaSection } from "./evaluation-detail/evaluation-acta-section"
import { EvaluationFollowupsSection } from "./evaluation-detail/evaluation-followups-section"
import { EvaluationActionPlanSection } from "./evaluation-detail/evaluation-action-plan-section"
import type { ChecklistDefinition } from "@/lib/sst/types"
import type { SectionAccess } from "@/lib/sst/checklist"
import type { SstEvaluation, SstResponse, SstScheduledFollowup, SstWeeklyEvaluation } from "@/db/schema/sst"
import type { SstActionPlanItemView } from "@/lib/services/sst-module/capa-view"

interface Props {
  evaluation: SstEvaluation
  definition: ChecklistDefinition
  responses: SstResponse[]
  followups: SstScheduledFollowup[]
  actionPlan: SstActionPlanItemView[]
  workerName: string
  workerRut: string
  worksiteName: string
  worksiteAdminContratoLabel: string | null
  cargoLabels: string[]
  canClose: boolean
  canManage: boolean
  canViewFullEvaluation: boolean
  sectionAccess: Record<string, SectionAccess>
  weeklyEvals?: SstWeeklyEvaluation[]
}

export function EvaluationDetail(props: Props) {
  const ctx = useEvaluationDetail(props)

  return (
    <div className="space-y-6">
      <EvaluationInfoSection
        workerName={props.workerName}
        workerRut={props.workerRut}
        worksiteName={props.worksiteName}
        worksiteAdminContratoLabel={props.worksiteAdminContratoLabel}
        cargoLabels={props.cargoLabels}
        evaluation={props.evaluation}
        isCerrado={ctx.isCerrado}
        canViewFullEvaluation={ctx.canViewFullEvaluation}
        canClose={ctx.canClose}
        closePending={ctx.closePending}
        compliance={ctx.compliance}
        progress={ctx.progress}
        saveState={ctx.saveState}
        canEditAnyVisible={ctx.canEditAnyVisible}
        closeOpen={ctx.closeOpen}
        setCloseOpen={ctx.setCloseOpen}
        restricciones={ctx.restricciones}
        setRestricciones={ctx.setRestricciones}
        observaciones={ctx.observaciones}
        setObservaciones={ctx.setObservaciones}
        hasCritical={ctx.hasCritical}
        setHasCritical={ctx.setHasCritical}
        hasReincidence={ctx.hasReincidence}
        setHasReincidence={ctx.setHasReincidence}
        handleClose={ctx.handleClose}
        goToNextPending={ctx.goToNextPending}
      />

      <EvaluationSectionNav
        navigationItems={ctx.navigationItems}
        activeSection={ctx.activeSection}
        setActiveSection={ctx.setActiveSection}
        activeNavigationIndex={ctx.activeNavigationIndex}
        sectionFocusRequest={ctx.sectionFocusRequest}
      >
        {ctx.visibleSections.map((sec) => (
          <EvaluationWeeklySection
            key={sec.id}
            section={sec}
            responseMap={ctx.responseMap}
            isSectionReadOnly={ctx.isSectionReadOnly}
            weeklyEvals={ctx.weeklyEvals}
            isWeekLocked={ctx.isWeekLocked}
            isPending={ctx.isPending}
            activeNavigationIndex={ctx.activeNavigationIndex}
            navigationItems={ctx.navigationItems}
            handleResponseChange={ctx.handleResponseChange}
            moveActiveSection={ctx.moveActiveSection}
            handleMarkWeekComplete={ctx.handleMarkWeekComplete}
          />
        ))}

        {ctx.canViewFullEvaluation && <>
          <EvaluationActaSection
            definition={props.definition}
            evaluation={props.evaluation}
            isCerrado={ctx.isCerrado}
            activeNavigationIndex={ctx.activeNavigationIndex}
            navigationItems={ctx.navigationItems}
            moveActiveSection={ctx.moveActiveSection}
          />

          {props.evaluation.tipo === "seguimiento" && (
            <EvaluationFollowupsSection
              followups={ctx.followups}
              canManage={props.canManage}
              onUpdate={ctx.setFollowups}
              activeNavigationIndex={ctx.activeNavigationIndex}
              navigationItems={ctx.navigationItems}
              moveActiveSection={ctx.moveActiveSection}
            />
          )}

          <EvaluationActionPlanSection
            evaluationId={props.evaluation.id}
            items={ctx.actionPlan}
            readOnly={!props.canManage}
            onUpdate={ctx.setActionPlan}
            activeNavigationIndex={ctx.activeNavigationIndex}
            navigationItems={ctx.navigationItems}
            moveActiveSection={ctx.moveActiveSection}
          />
        </>}
      </EvaluationSectionNav>
    </div>
  )
}
