/**
 * Estilos de la hoja del registro de mantención (vista previa y PDF A4).
 *
 * El `@page` debe coincidir con el margen de `a4PdfOptions()` por defecto
 * (12mm en tres lados y 20mm abajo para el pie «Página X de Y»): Chromium no
 * define con claridad quién gana entre el CSS y la opción de `printToPDF`.
 * Colores en hex porque el PDF no hereda los tokens de la plataforma y tiene
 * que verse igual en cualquier impresora; los textos pasan 4,5:1 sobre blanco.
 */
export const RECORD_PRINT_STYLES = `
  @page { size: A4; margin: 12mm 12mm 20mm; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { background: #e9eeeb; }
  body { margin: 0; color: #1d1d1b; font-family: var(--font-sans), "Myriad Pro", system-ui, sans-serif; font-size: 10.5px; line-height: 1.45; }
  .mono { font-family: var(--font-mono), ui-monospace, monospace; }

  .sheet { width: 210mm; max-width: 100%; margin: 18px auto; padding: 12mm; background: #fff; }
  @media print {
    html, body { background: #fff; }
    .sheet { width: auto; margin: 0; padding: 0; }
  }

  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid #1d1d1b; }
  .head img { height: 30px; width: auto; display: block; }
  .head h1 { margin: 8px 0 0; font-family: var(--font-display), system-ui, sans-serif; font-size: 18px; line-height: 1.15; }
  .head .sub { margin: 3px 0 0; color: #4b4f54; font-size: 11px; }
  .folio { text-align: right; }
  .folio .code { font-family: var(--font-mono), ui-monospace, monospace; font-size: 17px; font-weight: 700; letter-spacing: 0.02em; }
  .folio .kind { margin-top: 3px; color: #4b4f54; font-size: 11px; }

  .void { margin: 10px 0 0; padding: 8px 12px; border: 2px solid #b42318; background: #fbe3dc; color: #7a1a10; break-inside: avoid; }
  .void strong { display: block; font-size: 15px; letter-spacing: 0.08em; }
  .void p { margin: 2px 0 0; }

  h2 { margin: 14px 0 6px; font-family: var(--font-display), system-ui, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #1e6e3e; break-after: avoid; }
  dl.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px 14px; margin: 0; }
  dl.grid > div { break-inside: avoid; }
  dl.grid dt { color: #4b4f54; font-size: 9.5px; }
  dl.grid dd { margin: 0; font-weight: 600; }
  dl.grid .wide { grid-column: span 3; }
  dl.grid .half { grid-column: span 2; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9.5px; color: #4b4f54; border-bottom: 1px solid #8d9094; padding: 3px 6px; }
  td { padding: 3px 6px; border-bottom: 1px solid #e3e6e4; vertical-align: top; }
  tr { break-inside: avoid; }
  tr.group td { background: #f1f4f2; font-weight: 700; border-bottom: 1px solid #c9cdcb; }
  td.res { white-space: nowrap; font-weight: 600; }
  td.res.nr { color: #8a4300; }
  td.num { text-align: right; white-space: nowrap; }
  .warn { color: #6b4e00; font-size: 9.5px; }
  .note { margin: 4px 0 0; white-space: pre-wrap; }

  .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .tag { border: 1px solid #b0b4b2; border-radius: 3px; padding: 1px 6px; font-size: 9.5px; font-weight: 600; }

  .photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .photos figure { margin: 0; break-inside: avoid; }
  .photos img { width: 100%; max-height: 88mm; object-fit: contain; background: #f1f4f2; border: 1px solid #c9cdcb; display: block; }
  .photos figcaption { margin-top: 3px; font-size: 9.5px; color: #4b4f54; }
  .photos figcaption strong { color: #1d1d1b; }

  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 4px; break-inside: avoid; }
  .sig { min-height: 26mm; padding: 8px 10px; border: 1px solid #8d9094; }
  .sig.pending { border: 1px dashed #8d9094; color: #4b4f54; }
  .sig .who { margin-top: 4px; font-size: 13px; font-weight: 700; color: #1d1d1b; }
  .sig .label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #4b4f54; }
  .foot { margin-top: 14px; color: #4b4f54; font-size: 9px; }
`
