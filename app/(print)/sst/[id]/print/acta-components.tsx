/**
 * Reusable sub-components for the SST Acta A4 print sheet.
 */

export function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null
  return (
    <div className="field-row">
      <span className="field-label">{label}:</span>
      <span className="field-value">{value}</span>
    </div>
  )
}
