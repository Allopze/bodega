/**
 * Validador de forma de una `ChecklistDefinition`.
 *
 * Vivía en `lib/validation/prevention-module/pdtp.ts` porque nació para el
 * editor JSON del motor de checklist del PDTP. Ese motor se retiró, y el
 * catálogo `lib/sst/definitions/*` pasó a pertenecer al motor de inspecciones,
 * así que el validador se mudó acá: es el único control automático que tiene el
 * catálogo sobre su propia forma.
 *
 * El enum de `kind` está **atado al tipo**: agregar un `FieldKind` sin sumarlo
 * a `FIELD_KINDS` es un error de compilación. Así nació el defecto que esto
 * cierra — `si_no_na_obs` estaba en el catálogo y no en el enum, y la
 * definición de EPP no pasaba su propio validador. Hoy le faltaban además
 * `bueno_malo_obs`, `cumple_parcial_nocumple_na_obs` y `number`, los tres en
 * uso por definiciones reales.
 */

import { z } from "zod"
import type { FieldKind } from "./types"

const FIELD_KINDS = [
  "cumple_nocumple_obs", "cumple_nocumple_na_obs", "bueno_malo_obs", "si_no_na_obs",
  "cumple_parcial_nocumple_na_obs", "entregado_obs", "apto_obs", "si_no_obs",
  "bueno_regular_malo_obs", "bueno_regular_malo_na_obs", "bueno_regular_malo_na_nt_obs",
  "text", "textarea", "number", "date", "select", "multiselect", "signature", "readonly",
] as const satisfies readonly FieldKind[]

/* Si alguien agrega un `FieldKind` y no lo lista arriba, esto deja de compilar.
 * Es la guarda que faltaba: el enum divergía en silencio del catálogo. */
type MissingKind = Exclude<FieldKind, (typeof FIELD_KINDS)[number]>
const _allKindsCovered: MissingKind extends never ? true : never = true
void _allKindsCovered

const selectOptionSchema = z.object({ value: z.string(), label: z.string() })

export const checklistItemSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  kind: z.enum(FIELD_KINDS),
  options: z.array(selectOptionSchema).optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  danoPotencial: z.enum(["leve", "moderado", "grave", "fatal"]).optional(),
  /** Respuestas independientes presentadas en una misma fila (Anexo 3 EPP). */
  matrix: z.object({
    rowId: z.string(),
    rowLabel: z.string(),
    columnLabel: z.string(),
  }).optional(),
})

export const checklistSectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  items: z.array(checklistItemSchema).min(1, "La sección debe tener al menos un ítem"),
  appliesWhen: z.array(z.string()).optional(),
  countsForCompliance: z.boolean().optional(),
  hasActionCorrectiva: z.boolean().optional(),
  requiresPermission: z.string().optional(),
  weekNumber: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
})

export const checklistDefinitionSchema = z.object({
  code: z.string().trim().min(1),
  version: z.string().trim().min(1),
  revisionDate: z.string().trim().min(1),
  title: z.string().trim().min(1),
  tipo: z.enum(["nuevo", "seguimiento"]),
  subtitle: z.string().optional(),
  legalFramework: z.array(z.string()).default([]),
  applicableTo: z.string().default(""),
  objective: z.string().optional(),
  frequencySuggested: z.string().optional(),
  evaluationCriteria: z.string().optional(),
  sections: z.array(checklistSectionSchema).min(1, "Debe haber al menos una sección"),
  /* Opcional, igual que en el tipo: los instrumentos que registran desviaciones
   * no llevan acta porque el papel firmado sigue siendo el respaldo. Exigirla
   * dejaba fuera del validador a las cuatro definiciones que no la declaran. */
  closingAct: z.object({
    title: z.string(),
    resultOptions: z.array(selectOptionSchema),
    hasRestrictions: z.boolean().optional(),
    signatureRoles: z.array(z.string()),
  }).optional(),
  schedulesFollowups: z.boolean().optional(),
  scoringPolicy: z.object({
    official: z.union([
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("fixed_conforming_denominator"), denominator: z.number() }),
    ]),
    normalized: z.object({
      mode: z.literal("weighted_applicable"),
      partialWeightBasisPoints: z.number(),
    }),
  }).optional(),
  recordsDeviations: z.boolean().optional(),
  recordsPreventiveActions: z.boolean().optional(),
  closesOnCompletion: z.boolean().optional(),
})
