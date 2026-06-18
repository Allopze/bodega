# SST Module — Domain Documentation

**Module:** Prevención / Seguridad y Salud en el Trabajo (SST)  
**Last updated:** 2026-06-18  
**Owner:** Prevention team (Chome)

---

## Purpose

The SST module manages occupational safety evaluations for workers at each worksite (faena). It implements a schema-driven checklist engine that:

1. Defines checklist templates (checklists) as JSON/TypeScript definitions per evaluation type.
2. Creates evaluations (`evaluaciones`) linking a worker, a worksite, and a checklist definition.
3. Records per-item responses (`sst_responses`) during the inspection.
4. Tracks follow-up items (`sst_followup_items`) and corrective action plans (`sst_action_plan_items`).
5. Closes evaluations with a final result, efficacy score, and optional restrictions.

---

## Evaluation lifecycle

```
                   ┌─────────────┐
                   │   borrador  │  (responses can be edited)
                   └──────┬──────┘
                          │ closeEvaluation()
                   ┌──────▼──────┐
                   │   cerrado   │  (immutable; action plan may continue)
                   └─────────────┘
```

A `borrador` evaluation can receive any number of `saveResponses()` calls. Once closed, the record is immutable — responses and the closing act are locked. Follow-up items and action plan entries can still be created/updated after closing.

---

## Checklist definition schema

Checklist definitions live in `lib/sst/definitions/` as TypeScript modules. They are **not** stored in the database — the schema is static and versioned in source control.

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `code` | `string` | Unique identifier, e.g. `"nuevo-v1"` |
| `version` | `string` | Semantic version |
| `tipo` | `"nuevo" \| "seguimiento"` | Determines available evaluation types |
| `sections` | `ChecklistSection[]` | Ordered list of sections |
| `closingAct` | `ClosingActDefinition` | Final result options + signature roles |

### Section fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique within checklist |
| `title` | `string` | Section heading |
| `items` | `ChecklistItem[]` | Inspection items |
| `appliesWhen` | `CargoCondition[]?` | Restrict section to specific job roles (cargos) |
| `countsForCompliance` | `boolean?` | Whether items contribute to the compliance % |
| `hasActionCorrectiva` | `boolean?` | Adds a "Corrective action" column |

### Item field kinds (`FieldKind`)

| Kind | UI | Stored value |
|---|---|---|
| `cumple_nocumple_obs` | Radio: Cumple / No cumple + obs | `StatusValue` + `string?` |
| `cumple_nocumple_na_obs` | Radio + N/A + obs | `StatusValue` + `string?` |
| `entregado_obs` | Radio: Entregado / No entregado | `StatusValue` + `string?` |
| `apto_obs` | Radio: Apto / No apto | `StatusValue` + `string?` |
| `si_no_obs` | Radio: Sí / No + obs | `StatusValue` + `string?` |
| `text` | Free text area | `string` |
| `date` | Date picker | ISO date string |
| `select` | Single-choice dropdown | `string` |
| `multiselect` | Multi-choice | `string[]` (JSON) |
| `signature` | Signature pad | base64 PNG or name string |
| `readonly` | Display-only label | — |

---

## Compliance scoring (`lib/sst/compliance.ts`)

Compliance is calculated as:

```
percentage = (cumplidos / (cumplidos + noCumplidos)) × 100
```

- Items with `status = "na"` are excluded from both numerator and denominator.
- Only sections with `countsForCompliance: true` contribute.
- Result: `ComplianceResult { cumplidos, noCumplidos, na, total, percentage }`.

---

## Efficacy scoring (follow-up evaluations)

When a follow-up evaluation (`tipo = "seguimiento"`) is closed, `computeEfficacy()` compares responses to the previous evaluation's blockers:

| Classification | Condition |
|---|---|
| `eficaz` | ≥ 80% of previously non-compliant items now comply |
| `parcialmente_eficaz` | 50–79% resolved |
| `no_eficaz` | < 50% resolved |

Critical deviations (items with `kind = "cumple_nocumple_obs"` still non-compliant) always downgrade the result.

---

## Database tables

| Table | Description |
|---|---|
| `sst_evaluations` | Evaluation header (worker, worksite, checklist code, status, dates) |
| `sst_responses` | Per-item responses (itemId, status, observation) |
| `sst_followup_items` | Specific items flagged for follow-up with a due date |
| `sst_action_plan_items` | Corrective action tasks (description, responsible, due date, completed) |

Relations: `sst_evaluations` 1→N `sst_responses`, `sst_evaluations` 1→N `sst_followup_items`, `sst_evaluations` 1→N `sst_action_plan_items`.

---

## Permission model

| Permission | Grants |
|---|---|
| `sst:view` | Read evaluations, responses, dashboard stats |
| `sst:manage` | Create, edit, and close evaluations |
| `admin:sst` | Delete evaluations, manage checklist definitions |

Scope: evaluations are scoped to the user's `worksiteIds`. Global-role users see all worksites.

---

## Key service functions (`lib/services/sst.ts`)

| Function | Description |
|---|---|
| `createEvaluation(input)` | Creates a `borrador` evaluation; validates worker + worksite + checklist |
| `getEvaluation(id)` | Returns evaluation header + responses + action plan items |
| `listEvaluations(filters)` | Paginated list with optional worksite/checklist/status filters |
| `saveResponses(id, responses)` | Upserts item responses; guards against closed evaluations |
| `closeEvaluation(id, closingAct)` | Locks evaluation; records final result + efficacy |
| `markFollowup(id, itemIds, dueDate)` | Flags items for follow-up |
| `saveActionPlanItem(input)` | Creates or updates a corrective action task |
| `deleteActionPlanItem(id)` | Removes an action plan entry |
| `getDashboardStats(filters)` | Aggregated stats for the prevention dashboard |

---

## Data flow diagram

```
Prevention officer
       │
       ▼
createEvaluation() ──▶ sst_evaluations (borrador)
       │
       ▼
saveResponses() ──▶ sst_responses (upsert per itemId)
       │
       ▼
closeEvaluation() ──▶ sst_evaluations (cerrado)
                            │
              ┌─────────────┤
              ▼             ▼
   computeEfficacy()   sst_followup_items
   (seguimiento only)  sst_action_plan_items
```

---

## Legal framework

Checklist definitions reference applicable Chilean safety regulations:

- **DS 594** — Condiciones sanitarias y ambientales básicas en los lugares de trabajo
- **DS 40** — Prevención de riesgos profesionales (ACHS)  
- **Ley 16.744** — Accidentes del trabajo y enfermedades profesionales

Each checklist definition lists its `legalFramework` array with the specific regulations it covers.
