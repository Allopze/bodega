/**
 * Estilos del talonario «Orden de trabajo reparación/mantención» (vista previa y
 * PDF A4). Mismas reglas que `record-print-styles.ts`: el `@page` debe coincidir
 * con el margen de `a4PdfOptions()` por defecto y los colores van en hex porque
 * el PDF no hereda los tokens de la plataforma.
 */
export const OT_PRINT_STYLES = `
  @page { size: A4; margin: 12mm 12mm 20mm; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { background: #e9eeeb; }
  body { margin: 0; color: #1d1d1b; font-family: var(--font-sans), "Myriad Pro", system-ui, sans-serif; font-size: 10.5px; line-height: 1.45; }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .mono { font-family: var(--font-mono), ui-monospace, monospace; }

  .sheet { width: 210mm; max-width: 100%; margin: 18px auto; padding: 12mm; background: #fff; }
  @media print {
    html, body { background: #fff; }
    .sheet { width: auto; margin: 0; padding: 0; }
  }

  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid #1d1d1b; }
  .head img { height: 30px; width: auto; display: block; }
  .head h1 { margin: 8px 0 0; font-family: var(--font-display), system-ui, sans-serif; font-size: 17px; line-height: 1.15; text-transform: uppercase; letter-spacing: 0.02em; }
  .head .sub { margin: 3px 0 0; color: #4b4f54; font-size: 11px; }
  .folio { text-align: right; }
  .folio .label { color: #4b4f54; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  .folio .code { font-family: var(--font-mono), ui-monospace, monospace; font-size: 18px; font-weight: 700; letter-spacing: 0.02em; }

  .void { margin: 10px 0 0; padding: 8px 12px; border: 2px solid #b42318; background: #fbe3dc; color: #7a1a10; break-inside: avoid; }
  .void strong { display: block; font-size: 15px; letter-spacing: 0.08em; }
  .void p { margin: 2px 0 0; }

  h2 { margin: 14px 0 5px; font-family: var(--font-display), system-ui, sans-serif; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #14532d; break-after: avoid; }
  dl.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px 14px; margin: 0; }
  dl.grid > div { break-inside: avoid; padding-bottom: 3px; border-bottom: 1px solid #c9cdcb; }
  dl.grid dt { color: #33373b; font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
  dl.grid dd { margin: 0; min-height: 15px; font-weight: 600; }
  dl.grid .wide { grid-column: span 3; }
  dl.grid .half { grid-column: span 2; }

  .types { display: flex; gap: 22px; margin: 8px 0 2px; font-weight: 700; font-size: 11px; text-transform: uppercase; }
  .box { display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: -2px; border: 1.5px solid #1d1d1b; text-align: center; line-height: 9px; font-size: 11px; font-weight: 900; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9.5px; font-weight: 600; color: #33373b; border-bottom: 1px solid #8d9094; padding: 3px 6px; }
  th.num, td.num { text-align: right; }
  td.nw { white-space: nowrap; }
  tr.voided td { color: #6b6f73; text-decoration: line-through; }
  tr.voided td .note { text-decoration: none; }
  td { padding: 4px 6px; border-bottom: 1px solid #c9cdcb; vertical-align: top; }
  tr { break-inside: avoid; }
  td.n { width: 22px; text-align: right; color: #4b4f54; }
  td.yn { width: 70px; white-space: nowrap; font-weight: 700; text-align: center; }
  td.yn.no { color: #8a4300; }
  .blank { color: #8d9094; }
  .note { margin: 4px 0 0; white-space: pre-wrap; }
  .pending { margin: 0; color: #4b4f54; font-style: italic; }

  .outcome { display: flex; gap: 14px; align-items: flex-start; margin: 10px 0 2px; padding: 8px 12px; border: 1.5px solid #8d9094; border-left-width: 6px; break-inside: avoid; }
  .outcome.ok { border-color: #1e6e3e; background: #eef6f0; }
  .outcome.bad { border-color: #b42318; background: #fbe3dc; }
  .outcome.open { border-color: #8a4300; background: #fdf3e6; }
  .outcome-state { min-width: 110px; font-family: var(--font-display), system-ui, sans-serif; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
  .outcome ul { margin: 0; padding: 0; list-style: none; }
  .outcome li { margin: 0 0 2px; font-size: 11px; }

  .foot { margin-top: 14px; color: #4b4f54; font-size: 9px; }
`
