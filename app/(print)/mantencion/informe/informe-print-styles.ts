/**
 * Estilos del informe del Panel de mantención (vista previa y PDF A4). El `@page` coincide con el margen de
 * `a4PdfOptions()` por defecto y los colores van en hex porque el PDF no hereda los tokens de la plataforma.
 */
export const INFORME_PRINT_STYLES = `
  @page { size: A4; margin: 12mm 12mm 20mm; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { background: #e9eeeb; }
  body { margin: 0; color: #1d1d1b; font-family: var(--font-sans), "Myriad Pro", system-ui, sans-serif; font-size: 10.5px; line-height: 1.45; }
  .sheet { width: 210mm; max-width: 100%; margin: 18px auto; padding: 12mm; background: #fff; }
  @media print {
    html, body { background: #fff; }
    .sheet { width: auto; margin: 0; padding: 0; }
  }
  .cover { padding-bottom: 10px; border-bottom: 2px solid #1d1d1b; break-after: avoid; }
  .cover img { height: 30px; width: auto; display: block; }
  .cover h1 { margin: 10px 0 2px; font-family: var(--font-display), system-ui, sans-serif; font-size: 20px; line-height: 1.15; }
  .cover .sub { margin: 0; color: #4b4f54; font-size: 11px; }
  dl.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 14px; margin: 10px 0 0; }
  dl.meta > div { padding-bottom: 2px; border-bottom: 1px solid #c9cdcb; }
  dl.meta dt { color: #33373b; font-size: 9.5px; font-weight: 600; }
  dl.meta dd { margin: 0; font-weight: 600; }
  h2 { margin: 14px 0 4px; font-family: var(--font-display), system-ui, sans-serif; font-size: 12.5px; font-weight: 700; color: #14532d; break-after: avoid; }
  p.note { margin: 2px 0 6px; color: #4b4f54; }
  p.warn { margin: 4px 0; padding: 4px 8px; border: 1px solid #8a4300; background: #fdf1e3; color: #5c2d00; }
  .figures { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 6px 0; }
  .figure { padding: 6px 8px; border: 1px solid #c9cdcb; break-inside: avoid; }
  .figure .label { color: #33373b; font-size: 9.5px; font-weight: 600; }
  .figure .value { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .figure .aside { color: #4b4f54; font-size: 9.5px; }
  table { width: 100%; border-collapse: collapse; margin: 2px 0 6px; }
  th { text-align: left; font-size: 9.5px; font-weight: 600; color: #33373b; border-bottom: 1px solid #8d9094; padding: 3px 6px; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td { padding: 3px 6px; border-bottom: 1px solid #c9cdcb; vertical-align: top; }
  tr { break-inside: avoid; }
  .muted { color: #6b6f73; }
`
