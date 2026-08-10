/**
 * Reusable sub-components for the Orden de Compra A4 print sheet.
 */

export function FieldLine({ label, value, mono = false, noWrap = mono }: { label: string; value?: string | null; mono?: boolean; noWrap?: boolean }) {
  if (!value?.trim()) return null
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className={`${mono ? "field-value mono" : "field-value"}${noWrap ? " field-value-nowrap" : ""}`}>{value}</span>
    </div>
  )
}

export function TotalLine({ label, value, final = false }: { label: string; value: string; final?: boolean }) {
  return (
    <div className={final ? "total-line total-line-final" : "total-line"}>
      <span className="total-label">{label}</span>
      <span className="total-value mono">$ {value}</span>
    </div>
  )
}
