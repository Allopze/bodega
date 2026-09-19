/**
 * Estilos de la hoja A4 de la Guía de Despacho Interna.
 *
 * Misma caja de página que `A4_MARGIN` (lib/pdf/page-options.ts): el `@page` y
 * el parámetro de `printToPDF` deben coincidir o la hoja 2 arranca desalineada.
 * La identidad visual y la mecánica de paginación (thead repetido,
 * `box-decoration-break`, bloques que no se parten) son las mismas de la OC:
 * un solo lenguaje impreso para todos los documentos de la plataforma.
 */
export const GUIDE_PRINT_STYLES = `
  @page {
    size: A4;
    margin: 12mm 12mm 20mm;
  }

  *, *::before, *::after { box-sizing: border-box; }

  html { background: #e9eeeb; }

  body {
    margin: 0;
    background: #e9eeeb;
    color: #232522;
    font-family: "Source Sans 3", "Source Sans Pro", Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-toolbar {
    width: 210mm;
    max-width: calc(100vw - 32px);
    margin: 18px auto 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #45514a;
  }

  .print-action {
    min-height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 13px;
    border-radius: 7px;
    font: inherit;
    font-size: 9.5pt;
    font-weight: 650;
    text-decoration: none;
    border: 1px solid transparent;
    cursor: pointer;
  }

  .print-action:disabled { opacity: 0.7; cursor: wait; }
  .print-action-primary { background: #17422b; color: #f2f7f4; }
  .print-action-primary:hover { background: #205438; }
  .print-action-secondary { background: #f9fbfa; color: #233027; border-color: #cfd8d2; }
  .print-action-secondary:hover { background: #eef5f1; border-color: #b8c8be; }
  .print-filename { margin-left: 6px; font-size: 9pt; color: #5a655d; }
  .print-error { margin-left: 6px; font-size: 9pt; color: #b91c1c; }
  .spin { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .mobile-document-summary { display: none; }

  .sheet {
    width: 210mm;
    padding: 12mm;
    background: #ffffff;
  }

  .sheet > * + * { margin-top: 5mm; }

  @media screen {
    .sheet {
      min-height: 297mm;
      margin: 0 auto 24px;
      border: 1px solid #d8dfda;
      box-shadow: 0 18px 55px rgba(26, 36, 30, 0.14);
    }
  }

  /* ── Encabezado ── */
  .doc-header {
    display: grid;
    grid-template-columns: 1fr 52mm;
    gap: 8mm;
    padding-bottom: 6mm;
    border-bottom: 1.5px solid #17422b;
  }

  .brand-row { display: flex; align-items: center; gap: 12px; }

  .logo-mark { width: 66px; height: 66px; object-fit: contain; flex: 0 0 auto; }

  .company-name { font-size: 10.5pt; font-weight: 760; color: #17221b; line-height: 1.2; }

  .company-lines {
    margin-top: 5px;
    display: grid;
    gap: 2px;
    color: #252a26;
    font-size: 7.8pt;
  }

  .doc-box {
    justify-self: end;
    width: 52mm;
    border: 1px solid #17422b;
    color: #17422b;
    padding: 5px 7px;
    text-align: center;
  }

  .doc-box-title {
    font-size: 8.4pt;
    font-weight: 760;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 1.25;
  }

  .doc-box-code {
    margin-top: 4px;
    font-family: "GeistMono", "Cascadia Code", monospace;
    font-size: 13pt;
    font-weight: 700;
  }

  .doc-box-meta { margin-top: 4px; font-size: 7.4pt; color: #45514a; }

  .doc-box-state {
    margin-top: 4px;
    display: inline-block;
    padding: 1px 6px;
    border: 1px solid #b8c6bd;
    border-radius: 999px;
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #233027;
  }

  .doc-box-state-cancelled { border-color: #b91c1c; color: #b91c1c; }

  /* ── Ruta del traslado ── */
  .route {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 10mm minmax(0, 1fr);
    align-items: stretch;
    border: 1px solid #b8c6bd;
  }

  .route-cell { padding: 4mm 5mm; }

  .route-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    border-left: 1px solid #b8c6bd;
    border-right: 1px solid #b8c6bd;
    background: #f1f5f3;
    color: #17422b;
    font-size: 12pt;
    font-weight: 700;
  }

  .route-label {
    font-size: 7pt;
    font-weight: 760;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #5f6b63;
  }

  .route-value { margin-top: 1mm; font-size: 11pt; font-weight: 720; color: #17221b; }
  .route-sub { margin-top: 0.5mm; font-size: 8pt; color: #45514a; }

  /* ── Datos del traslado ── */
  .panel { border: 1px solid #b8c6bd; padding: 3.5mm 4mm; }

  .panel-title {
    font-size: 7pt;
    font-weight: 760;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #5f6b63;
    margin-bottom: 2mm;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2.5mm 6mm;
  }

  .field-label { font-size: 7.2pt; color: #5f6b63; text-transform: uppercase; letter-spacing: 0.04em; }
  .field-value { font-size: 9pt; color: #17221b; }
  .field-value-mono { font-family: "GeistMono", "Cascadia Code", monospace; }

  /* ── Detalle ── */
  .items-wrap {
    border: 1px solid #b8c6bd;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }

  table { width: 100%; border-collapse: collapse; }

  thead { display: table-header-group; }

  thead th {
    background: #f1f5f3;
    color: #17221b;
    padding: 4px 6px;
    text-align: left;
    vertical-align: middle;
    font-size: 7.6pt;
    font-weight: 760;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    border-bottom: 1px solid #b8c6bd;
  }

  .items-caption th {
    background: #ffffff;
    color: #17422b;
    font-size: 7.4pt;
    border-bottom: 1px solid #dde4df;
  }

  tbody td {
    padding: 4px 6px;
    vertical-align: top;
    color: #232b25;
    font-size: 8.2pt;
    border-bottom: 1px solid #e6ece8;
  }

  tbody tr:last-child td { border-bottom: 0; }

  tfoot td {
    padding: 4px 6px;
    background: #f1f5f3;
    font-size: 8.4pt;
    font-weight: 720;
    border-top: 1px solid #b8c6bd;
  }

  tr { break-inside: avoid; page-break-inside: avoid; }

  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .mono { font-family: "GeistMono", "Cascadia Code", monospace; font-variant-numeric: tabular-nums; }

  /* Los SKU del catálogo ("EPP-TRECK-037") se partían en dos líneas por el
     guion, dejando el código ilegible en la hoja impresa. */
  td.mono { white-space: nowrap; }
  .item-note { color: #5f6b63; font-size: 7.4pt; }

  /* ── Firmas ── */
  .signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .sig-box { border: 1px solid #b8c6bd; padding: 3.5mm 4mm 3mm; }

  .sig-name { margin-top: 10mm; font-size: 9.5pt; font-weight: 700; color: #232522; min-height: 11pt; }

  .sig-line { margin-top: 1.5mm; height: 0; border-bottom: 1px solid #9aa8a0; }

  .sig-caption { margin-top: 1.5mm; font-size: 6.8pt; color: #5f6b63; line-height: 1.4; }

  .sig-stamp { margin-top: 1mm; font-size: 7.4pt; color: #17422b; font-weight: 650; }

  /* ── Leyenda / pie ── */
  .legend {
    border-left: 2.5px solid #17422b;
    background: #f1f5f3;
    padding: 2.6mm 3.5mm;
    font-size: 8pt;
    font-weight: 650;
    break-inside: avoid;
  }

  .cancelled-banner {
    border: 1px solid #b91c1c;
    background: #fdf2f2;
    color: #7f1d1d;
    padding: 2.6mm 3.5mm;
    font-size: 8.4pt;
    break-inside: avoid;
  }

  .doc-footer { font-size: 7pt; color: #6a746d; text-align: center; }

  /* "screen and" es obligatorio: al imprimir, el ancho de la media query es el
     de la caja de página (186mm ≈ 703px) y sin esa restricción la rama móvil
     escondería la hoja — el PDF saldría en blanco. */
  @media screen and (max-width: 760px) {
    .print-toolbar,
    .mobile-document-summary { width: calc(100vw - 24px); }

    .print-toolbar {
      position: sticky;
      top: 0;
      z-index: 1;
      flex-wrap: wrap;
      padding: 8px 0;
      background: #e9eeeb;
    }

    .print-action { min-height: 44px; }
    .print-filename { display: none; }
    .print-error { margin: 0; width: 100%; }

    .sheet { display: none; }

    .mobile-document-summary {
      display: block;
      margin: 16px auto 28px;
      padding: 20px;
      border: 1px solid #d8dfda;
      border-radius: 14px;
      background: #ffffff;
      color: #232522;
    }
    .mobile-document-summary-code { margin: 0; color: #5a655d; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .mobile-document-summary h1 { margin: 4px 0 0; font-size: 24px; line-height: 1.15; }
    .mobile-document-summary-description { margin: 8px 0 0; color: #45514a; font-size: 15px; }
    .mobile-document-summary-notice { margin: 16px 0; padding: 10px 12px; border-radius: 8px; background: #f1f5f3; color: #45514a; font-size: 14px; line-height: 1.45; }
    .mobile-document-summary-section { margin-top: 18px; }
    .mobile-document-summary-section h2 { margin: 0 0 8px; font-size: 14px; color: #17422b; }
    .mobile-document-summary-section dl { margin: 0; }
    .mobile-document-summary-section dl > div { padding: 10px 0; border-top: 1px solid #e5ebe6; }
    .mobile-document-summary-section dt { color: #5a655d; font-size: 12px; }
    .mobile-document-summary-section dd { margin: 3px 0 0; font-size: 15px; font-weight: 600; }
  }

  @media print {
    html, body { background: #ffffff; }

    .print-toolbar,
    .mobile-document-summary { display: none; }

    .sheet {
      width: auto;
      padding: 0;
      margin: 0;
      border: 0;
      box-shadow: none;
    }
  }
`
