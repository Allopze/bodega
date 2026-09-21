"use client"

import * as React from "react"
import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select"

export interface InspectionAssigneeOption {
  id: string
  name: string
  worksiteIds?: string[]
  isFaenaPreventionist?: boolean
  isGlobalPreventionist?: boolean
}

/**
 * Encuentra al prevencionista sugerido para una faena dada.
 * Devuelve el id del prevencionista de faena si existe, o "_none".
 */
export function findWorksiteSuggestedAssignee(
  assignees: InspectionAssigneeOption[],
  worksiteId: string,
): string {
  if (!worksiteId) return "_none"
  const prev = assignees.find(
    (a) => a.isFaenaPreventionist && a.worksiteIds?.includes(worksiteId),
  )
  return prev?.id ?? "_none"
}

/**
 * Clasifica a los responsables respecto a la faena elegida:
 * 1. Prevencionistas asignados a esa faena (prioritarios)
 * 2. Otros usuarios asignados a esa faena
 * 3. Otros usuarios / jefatura global
 */
export function partitionAssignees(
  assignees: InspectionAssigneeOption[],
  worksiteId: string,
) {
  if (!worksiteId) {
    return {
      faenaPreventionists: [],
      otherWorksiteAssignees: [],
      otherAssignees: assignees,
    }
  }

  const faenaPreventionists: InspectionAssigneeOption[] = []
  const otherWorksiteAssignees: InspectionAssigneeOption[] = []
  const otherAssignees: InspectionAssigneeOption[] = []

  for (const a of assignees) {
    const inWorksite = Boolean(a.worksiteIds?.includes(worksiteId))
    if (inWorksite && a.isFaenaPreventionist) {
      faenaPreventionists.push(a)
    } else if (inWorksite) {
      otherWorksiteAssignees.push(a)
    } else {
      otherAssignees.push(a)
    }
  }

  return { faenaPreventionists, otherWorksiteAssignees, otherAssignees }
}

/**
 * Opciones para el <SelectContent> de responsable/asignado,
 * destacando al prevencionista de la faena en un grupo preferente.
 */
export function AssigneeSelectOptions({
  assignees,
  worksiteId,
  noneLabel = "Sin asignar",
}: {
  assignees: InspectionAssigneeOption[]
  worksiteId: string
  noneLabel?: string
}) {
  const { faenaPreventionists, otherWorksiteAssignees, otherAssignees } = partitionAssignees(assignees, worksiteId)

  return (
    <>
      <SelectItem value="_none">{noneLabel}</SelectItem>
      {faenaPreventionists.length > 0 && (
        <SelectGroup>
          <SelectLabel>Prevencionista{faenaPreventionists.length > 1 ? "s" : ""} de la faena (sugerido)</SelectLabel>
          {faenaPreventionists.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectGroup>
      )}
      {otherWorksiteAssignees.length > 0 && (
        <SelectGroup>
          <SelectLabel>Otros ejecutores en faena</SelectLabel>
          {otherWorksiteAssignees.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectGroup>
      )}
      {otherAssignees.length > 0 && (
        <SelectGroup>
          {worksiteId && (faenaPreventionists.length > 0 || otherWorksiteAssignees.length > 0) && (
            <SelectLabel>Otros usuarios</SelectLabel>
          )}
          {otherAssignees.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectGroup>
      )}
    </>
  )
}
