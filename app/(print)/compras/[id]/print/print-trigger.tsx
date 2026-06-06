"use client"

export function PrintTrigger({ backHref }: { backHref: string }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 20 }} className="print-btn">
      <button
        onClick={() => window.print()}
        style={{
          padding:      "6px 16px",
          background:   "#1a1a1a",
          color:        "#fff",
          border:       "none",
          borderRadius: 4,
          cursor:       "pointer",
          fontSize:     13,
        }}
      >
        Imprimir / Guardar PDF
      </button>
      <a
        href={backHref}
        style={{
          padding:        "6px 16px",
          background:     "#fff",
          color:          "#1a1a1a",
          border:         "1px solid #ccc",
          borderRadius:   4,
          cursor:         "pointer",
          fontSize:       13,
          textDecoration: "none",
        }}
      >
        ← Volver
      </a>
    </div>
  )
}
