"use client"

import { useActionState, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle, WarningCircle, XCircle, CaretDown, CaretUp, Info } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cancelEppImportBatchAction, confirmEppImportBatchAction, reviewEppImportRowAction } from "../../actions"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
import { VALID_UNITS, VALID_COLORS, EPP_TYPES, RULE_LABELS, type NormalizedEppRow, type EppAttribute } from "@/lib/services/epp-import.types"

type ReviewRow = {
  id: string; rowNumber: number; originalJson: string; normalizedJson: string; severity: string; decision: string; targetProductId: string | null; reviewReason: string | null
  corrections: Array<{ id: string; field: string; originalValue: string | null; proposedValue: string | null; ruleId: string; confidence: number; disposition: string }>
  matches: Array<{ id: string; productId: string; score: number; reasonsJson: string; productName: string; productSku: string }>
}

type EditableNormalized = {
  name: string
  unitOfMeasure: string
  eppType: string | null
  supplierName: string | null
  price: number | null
  color: string | null
  talla: string | null
  material: string | null
  brand: string | null
  model: string | null
}

function toEditable(normalized: NormalizedEppRow): EditableNormalized {
  const findAttr = (prefix: string) => {
    const attr = normalized.attributes.find((a) => a.name.startsWith(prefix))
    if (!attr) return null
    // If multi-value, return as comma-separated so buildMultiValueAttr can detect it
    if (attr.values && attr.values.length > 1) return attr.values.join(", ")
    return attr.value
  }
  return {
    name: normalized.name,
    unitOfMeasure: normalized.unitOfMeasure,
    eppType: normalized.eppType,
    supplierName: normalized.supplierName,
    price: normalized.price,
    color: findAttr("Color"),
    talla: findAttr("Talla"),
    material: normalized.material,
    brand: normalized.brand,
    model: normalized.model,
  }
}

function buildMultiValueAttr(name: string, rawValue: string): EppAttribute {
  if (rawValue.includes(",")) {
    const values = rawValue.split(",").map((s) => s.trim()).filter(Boolean)
    return { name, value: values.join(", "), values }
  }
  return { name, value: rawValue }
}

function toNormalizedJson(edit: EditableNormalized, original: NormalizedEppRow): string {
  // Build talla attribute: detect semicolons for multi-talla
  let tallaAttr: EppAttribute | null = null
  if (edit.talla) {
    const firstVal = edit.talla.split(",")[0]?.trim() ?? ""
    const tallaName = /^\d{2}$/.test(firstVal) ? "Talla calzado" : "Talla"
    tallaAttr = buildMultiValueAttr(tallaName, edit.talla)
  }

  const attributes: EppAttribute[] = [
    ...(edit.color ? [buildMultiValueAttr("Color", edit.color)] : []),
    ...(tallaAttr ? [tallaAttr] : []),
    ...(edit.material ? [{ name: "Material", value: edit.material }] : []),
  ]

  const normalized: NormalizedEppRow = {
    ...original,
    name: edit.name,
    unitOfMeasure: edit.unitOfMeasure,
    eppType: edit.eppType,
    supplierName: edit.supplierName,
    price: edit.price,
    attributes,
    material: edit.material,
    brand: edit.brand,
    model: edit.model,
  }
  return JSON.stringify(normalized)
}

function getBlockingFields(normalized: NormalizedEppRow): string[] {
  const fields: string[] = []
  for (const issue of normalized.issues) {
    if (issue.severity !== "blocking") continue
    if (issue.message.includes("unidad")) fields.push("unitOfMeasure")
    if (issue.message.includes("tipo de EPP")) fields.push("eppType")
    if (issue.message.includes("color")) fields.push("color")
    if (issue.message.includes("nombre queda vac")) fields.push("name")
    if (issue.message.includes("precio")) fields.push("price")
  }
  return [...new Set(fields)]
}

function ruleLabel(ruleId: string): string {
  return RULE_LABELS[ruleId] ?? ruleId
}

const FIELD_LABELS: Record<string, string> = {
  name: "Nombre", unitOfMeasure: "Unidad", eppType: "Tipo EPP", color: "Color", talla: "Talla",
  supplierName: "Proveedor", price: "Precio", material: "Material", brand: "Marca", model: "Modelo",
  categoryName: "Categoria", attributes: "Atributos",
}

function effectiveDecision(row: ReviewRow, localDecisions: Record<string, string>): string {
  return localDecisions[row.id] ?? row.decision
}

export function EppImportReview({ batch }: { batch: { id: string; status: string; fileName: string; rows: ReviewRow[] } }) {
  const router = useRouter()
  const [filter, setFilter] = useState<"all" | "blocking" | "review" | "ready">("all")
  const [localDecisions, setLocalDecisions] = useState<Record<string, string>>({})
  const [confirmState, confirmAction] = useActionState(confirmEppImportBatchAction, INITIAL_STATE)
  const [cancelState, cancelAction] = useActionState(cancelEppImportBatchAction, INITIAL_STATE)

  const [edits, setEdits] = useState<Record<string, EditableNormalized>>(() => {
    const initial: Record<string, EditableNormalized> = {}
    for (const row of batch.rows) {
      try {
        const normalized = JSON.parse(row.normalizedJson) as NormalizedEppRow
        initial[row.id] = toEditable(normalized)
      } catch { /* skip */ }
    }
    return initial
  })
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Compute counters using local decisions that override batch decisions
  const blocked = useMemo(() => {
    return batch.rows.filter((row) => effectiveDecision(row, localDecisions) === "blocked").length
  }, [batch.rows, localDecisions])
  const pending = useMemo(() => {
    return batch.rows.filter((row) => effectiveDecision(row, localDecisions) === "pending").length
  }, [batch.rows, localDecisions])

  const visibleRows = useMemo(() => {
    return batch.rows.filter((row) => {
      const decision = effectiveDecision(row, localDecisions)
      if (filter === "all") return true
      if (filter === "blocking") return decision === "blocked"
      if (filter === "review") return decision === "pending"
      if (filter === "ready") return decision === "create"
      return true
    })
  }, [batch.rows, filter, localDecisions])

  const fieldsToFix = useMemo(() => {
    let count = 0
    for (const row of visibleRows) {
      try {
        const normalized = JSON.parse(row.normalizedJson) as NormalizedEppRow
        count += getBlockingFields(normalized).length
      } catch { /* skip */ }
    }
    return count
  }, [visibleRows])

  useEffect(() => {
    if (!confirmState.message) return
    if (confirmState.ok) { toast.success(confirmState.message); router.push("/admin/productos") }
    else toast.error(confirmState.message)
  }, [confirmState, router])

  useEffect(() => {
    if (!cancelState.message) return
    if (cancelState.ok) { toast.success(cancelState.message); router.push("/admin/productos") }
    else toast.error(cancelState.message)
  }, [cancelState, router])

  const handleDecisionSaved = useCallback((rowId: string, newDecision: string) => {
    setLocalDecisions((prev) => ({ ...prev, [rowId]: newDecision }))
  }, [])

  const toggleExpand = (rowId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  const updateEdit = (rowId: string, field: keyof EditableNormalized, value: string | null) => {
    setEdits((prev) => {
      const current = prev[rowId]
      if (!current) return prev
      const finalValue = field === "price" ? (value ? Number(value) : null) : (value === "" ? null : value)
      const updated: EditableNormalized = { ...current, [field]: finalValue } as EditableNormalized
      return { ...prev, [rowId]: updated }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-2) p-4">
        <div>
          <p className="text-sm font-medium text-(--color-text)">{batch.fileName}</p>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            {fieldsToFix > 0
              ? `Corrige ${fieldsToFix} campo${fieldsToFix !== 1 ? "s" : ""} para continuar`
              : blocked > 0 || pending > 0
                ? "Resuelve las filas pendientes antes de confirmar"
                : "El catálogo se actualizará en una sola transacción al confirmar"}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={blocked ? "danger" : "success"}>{blocked} bloqueantes</Badge>
          <Badge variant={pending ? "warning" : "success"}>{pending} por resolver</Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Filtrar filas de importacion">
        {([["all", "Todas"], ["blocking", "Bloqueantes"], ["review", "Revisar"], ["ready", "Listas"]] as const).map(([value, label]) => (
          <Button key={value} type="button" size="sm" variant={filter === value ? "primary" : "secondary"} onClick={() => setFilter(value)}>{label}</Button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-(--radius-lg) border border-(--color-border)">
        <table className="w-full text-xs">
          <thead className="bg-(--color-surface-2) th-type">
            <tr>
              <th scope="col" className="px-2 py-2 text-left font-medium">#</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Nombre</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Unidad</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Tipo EPP</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Color / Talla</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Proveedor</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Precio</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Estado</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Decision</th>
              <th scope="col" className="px-2 py-2 text-center font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const edit = edits[row.id]
              if (!edit) return null
              let normalized: NormalizedEppRow
              try { normalized = JSON.parse(row.normalizedJson) as NormalizedEppRow } catch { return null }
              const blockingFields = getBlockingFields(normalized)
              const isBlocked = blockingFields.length > 0
              const hasMatches = row.matches.length > 0
              const isExpanded = expandedRows.has(row.id)
              const recommendedAction = isBlocked ? null : hasMatches ? "update" : "create"

              return (
                <DecisionRow
                  key={row.id}
                  batchId={batch.id}
                  row={row}
                  edit={edit}
                  normalized={normalized}
                  blockingFields={blockingFields}
                  isBlocked={isBlocked}
                  hasMatches={hasMatches}
                  isExpanded={isExpanded}
                  recommendedAction={recommendedAction}
                  onDecisionSaved={handleDecisionSaved}
                  onToggleExpand={() => toggleExpand(row.id)}
                  onUpdate={(field, value) => updateEdit(row.id, field, value)}
                />
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-3 flex items-center justify-between gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-3 shadow-(--shadow-card)">
        <div className="flex items-center gap-3">
          <p className="text-sm text-(--color-text-muted)">{blocked || pending ? "Resuelve o descarta las filas pendientes antes de confirmar." : "El catálogo se actualizará en una sola transacción."}</p>
          {batch.status === "review" && (
            <form action={cancelAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <Button type="submit" variant="ghost" size="sm" className="text-(--color-danger)">Cancelar importación</Button>
            </form>
          )}
        </div>
        <form action={confirmAction}>
          <input type="hidden" name="batchId" value={batch.id} />
          {/* La validación real del estado se hace en el servidor (confirmEppImportBatch), el cliente solo chequea filas pendientes */}
          <Button type="submit" disabled={Boolean(blocked || pending)}>Confirmar importación</Button>
        </form>
      </div>
    </div>
  )
}

function DecisionRow({
  batchId, row, edit, normalized, blockingFields, isBlocked, hasMatches, isExpanded, recommendedAction, onDecisionSaved, onToggleExpand, onUpdate,
}: {
  batchId: string
  row: ReviewRow
  edit: EditableNormalized
  normalized: NormalizedEppRow
  blockingFields: string[]
  isBlocked: boolean
  hasMatches: boolean
  isExpanded: boolean
  recommendedAction: "create" | "update" | null
  onDecisionSaved: (rowId: string, newDecision: string) => void
  onToggleExpand: () => void
  onUpdate: (field: keyof EditableNormalized, value: string | null) => void
}) {
  const [state, action] = useActionState(reviewEppImportRowAction, INITIAL_STATE)
  const [localDecision, setLocalDecision] = useState<string>(row.decision === "blocked" || row.decision === "pending" ? (recommendedAction ?? "skip") : row.decision)

  useEffect(() => {
    if (!state.message) return
    if (state.ok) { toast.success(state.message); onDecisionSaved(row.id, localDecision) }
    else toast.error(state.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const original = useMemo(() => JSON.parse(row.originalJson) as Record<string, string>, [row.originalJson])
  const updatedJson = useMemo(() => toNormalizedJson(edit, normalized), [edit, normalized])

  const isFieldBlocking = (field: string) => blockingFields.includes(field)
  const fieldTone = (field: string) => isFieldBlocking(field) ? "ring-1 ring-(--color-danger-line) bg-(--color-danger-tint)" : ""

  return (
    <>
      <tr className="border-t border-(--color-border) bg-(--color-surface)">
        <td className="px-2 py-2 text-(--color-text-subtle)">{row.rowNumber}</td>
        <td className="px-2 py-2">
          <input
            type="text"
            value={edit.name}
            onChange={(e) => onUpdate("name", e.target.value)}
            aria-label="Nombre del producto"
            className={`w-full rounded-(--radius) border border-(--color-border) px-2 py-1 text-xs ${fieldTone("name")}`}
          />
        </td>
        <td className="px-2 py-2">
          <Select value={edit.unitOfMeasure} onValueChange={(v) => onUpdate("unitOfMeasure", v)}>
            <SelectTrigger className={`h-7 w-24 text-xs ${fieldTone("unitOfMeasure")}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALID_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </td>
        <td className="px-2 py-2">
          <Select value={edit.eppType ?? ""} onValueChange={(v) => onUpdate("eppType", v)}>
            <SelectTrigger className={`h-7 w-28 text-xs ${fieldTone("eppType")}`}>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {EPP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </td>
        <td className="px-2 py-2">
          <div className="flex gap-1">
            <Select value={edit.color ?? ""} onValueChange={(v) => onUpdate("color", v)}>
              <SelectTrigger className="h-7 w-20 text-xs">
                <SelectValue placeholder="Color" />
              </SelectTrigger>
              <SelectContent>
                {VALID_COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <input
              type="text"
              value={edit.talla ?? ""}
              onChange={(e) => onUpdate("talla", e.target.value)}
              placeholder="Talla"
              aria-label="Talla"
              className="w-14 rounded-(--radius) border border-(--color-border) px-1 py-1 text-xs"
            />
          </div>
        </td>
        <td className="px-2 py-2">
          <input
            type="text"
            value={edit.supplierName ?? ""}
            onChange={(e) => onUpdate("supplierName", e.target.value)}
            placeholder="—"
            aria-label="Proveedor"
            className="w-full rounded-(--radius) border border-(--color-border) px-2 py-1 text-xs"
          />
        </td>
        <td className="px-2 py-2">
          <input
            type="number"
            value={edit.price ?? ""}
            onChange={(e) => onUpdate("price", e.target.value)}
            placeholder="$"
            min={0}
            step={1}
            aria-label="Precio"
            className={`w-20 rounded-(--radius) border border-(--color-border) px-2 py-1 text-xs ${fieldTone("price")}`}
          />
        </td>
        <td className="px-2 py-2">
          <SeverityBadge severity={row.severity} decision={row.decision} blockingCount={blockingFields.length} />
        </td>
        <td className="px-2 py-2">
          <form action={action} className="flex items-center gap-1">
            <input type="hidden" name="batchId" value={batchId} />
            <input type="hidden" name="rowId" value={row.id} />
            <input type="hidden" name="normalizedJson" value={updatedJson} />
            <input type="hidden" name="decision" value={localDecision} />
            {localDecision === "update" && (
              <input type="hidden" name="targetProductId" value={row.targetProductId ?? row.matches[0]?.productId ?? ""} />
            )}
            <Select value={localDecision} onValueChange={setLocalDecision}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="create" disabled={isBlocked}>Crear nuevo</SelectItem>
                <SelectItem value="update" disabled={isBlocked || !hasMatches}>Actualizar existente</SelectItem>
                <SelectItem value="skip">Omitir fila</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" variant={recommendedAction === localDecision ? "primary" : "secondary"} className="h-11 px-2 text-xs sm:h-7">
              Guardar
            </Button>
          </form>
        </td>
        <td className="px-2 py-2 text-center">
          <button type="button" onClick={onToggleExpand} className="text-(--color-text-muted) hover:text-(--color-text)">
            {isExpanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-t border-(--color-border) bg-(--color-surface-2)">
          <td colSpan={10} className="px-4 py-3">
            <DetailPanel
              original={original}
              normalized={normalized}
              corrections={row.corrections}
              matches={row.matches}
              blockingFields={blockingFields}
              reviewReason={row.reviewReason}
            />
          </td>
        </tr>
      )}
    </>
  )
}

function DetailPanel({
  original, normalized, corrections, matches, blockingFields, reviewReason,
}: {
  original: Record<string, string>
  normalized: NormalizedEppRow
  corrections: ReviewRow["corrections"]
  matches: ReviewRow["matches"]
  blockingFields: string[]
  reviewReason: string | null
}) {
  const [showRules, setShowRules] = useState(false)
  const warnings = normalized.issues.filter((issue) => issue.severity === "warning")

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div>
        <p className="mb-2 text-xs font-medium text-(--color-text)">Datos detectados</p>
        <dl className="space-y-1 text-xs text-(--color-text-muted)">
          {Object.entries(original).filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-(--color-text-subtle)">{FIELD_LABELS[k] ?? k}:</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-(--color-text)">Correcciones propuestas</p>
        {corrections.length > 0 ? (
          <ul className="space-y-1 text-xs text-(--color-text-muted)">
            {corrections.map((c) => (
              <li key={c.id}>
                <span className="text-(--color-text-subtle)">{FIELD_LABELS[c.field] ?? c.field}:</span>{" "}
                <span className="line-through">{c.originalValue || "vacio"}</span>{" "}
                <span className="text-(--color-text)">{"\u2192"} {c.proposedValue || "vacio"}</span>
                {" "}
                <button
                  type="button"
                  onClick={() => setShowRules((s) => !s)}
                  className="text-(--color-primary) underline-offset-2 hover:underline"
                >
                  {showRules ? "Ocultar" : "Ver explicacion"}
                </button>
                {showRules && (
                  <span className="block pl-2 text-(--color-text-subtle)">
                    {ruleLabel(c.ruleId)} ({c.confidence}%)
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-(--color-text-subtle)">Sin correcciones automaticas</p>
        )}
        {reviewReason && <p className="mt-2 text-xs text-(--color-warning-ink)">{reviewReason}</p>}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-(--color-text)">Decision final</p>
        {blockingFields.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-(--color-danger-ink)">
              Corrige {blockingFields.length} campo{blockingFields.length !== 1 ? "s" : ""} bloqueante{blockingFields.length !== 1 ? "s" : ""}:
            </p>
            <ul className="space-y-1 text-xs">
              {blockingFields.map((f) => (
                <li key={f} className="flex items-center gap-1 text-(--color-danger-ink)">
                  <XCircle size={12} /> {FIELD_LABELS[f] ?? f}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-1 text-xs text-(--color-text-muted)">
            {matches.length > 0 ? (
              <>
                <p className="font-medium text-(--color-text)">Productos coincidentes:</p>
                <ul className="space-y-1">
                  {matches.map((m) => (
                    <li key={m.id} className="flex items-center gap-1">
                      <CheckCircle size={12} className="text-(--color-success)" />
                      {m.productSku} {"\u00b7"} {m.productName} ({m.score}%)
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="flex items-center gap-1">
                <Info size={12} /> No hay productos coincidentes. Se creara uno nuevo.
              </p>
            )}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mt-2 space-y-1">
            {warnings.map((issue) => (
              <p key={issue.message} className="flex items-center gap-1 text-xs text-(--color-warning-ink)">
                <WarningCircle size={12} /> {issue.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SeverityBadge({ severity, decision, blockingCount }: { severity: string; decision: string; blockingCount: number }) {
  if (severity === "blocking" || blockingCount > 0) return <Badge variant="danger"><XCircle size={13} />{blockingCount} bloqueo{blockingCount !== 1 ? "s" : ""}</Badge>
  if (severity === "warning") return <Badge variant="warning"><WarningCircle size={13} />Revisar</Badge>
  return <Badge variant="success"><CheckCircle size={13} />{decision === "create" ? "Lista" : decision}</Badge>
}
