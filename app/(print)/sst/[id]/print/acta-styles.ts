/**
 * Print/document CSS shared by the browser preview and the server-side PDF
 * for the SST Acta document.
 */
export const ACTA_STYLES = `
  /* El margen vive acá y no en el padding de .sheet: el padding vertical de un
     bloque fragmentado sólo se pinta en la primera y última hoja. Debe coincidir
     con A4_MARGIN de lib/pdf/page-options.ts. */
  @page {
    size: A4;
    margin: 12mm 12mm 20mm;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  html {
    background: #e9eeeb;
  }

  body {
    margin: 0;
    background: #e9eeeb;
    color: #232522;
    font-family: var(--font-myriad), "Myriad Pro", Arial, sans-serif;
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
    transition: transform 150ms, background-color 150ms, border-color 150ms;
  }

  .print-action:active { transform: scale(0.97); }

  .print-action:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  .spin {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .print-action-primary {
    background: #17422b;
    color: #f2f7f4;
  }

  .print-action-primary:hover { background: #205438; }

  .print-action-secondary {
    background: #f9fbfa;
    color: #233027;
    border-color: #cfd8d2;
  }

  .print-action-secondary:hover {
    background: #eef5f1;
    border-color: #b8c8be;
  }

  .print-filename {
    margin-left: 6px;
    font-size: 9pt;
    color: #647067;
  }

  .print-error {
    margin-left: 6px;
    font-size: 9pt;
    color: #b91c1c;
  }

  .mobile-document-summary {
    display: none;
  }

  .sheet {
    width: 210mm;
    padding: 12mm;
    background: #ffffff;
  }

  @media screen {
    .sheet {
      min-height: 297mm;
      margin: 0 auto 24px;
      border: 1px solid #d8dfda;
      box-shadow: 0 18px 55px rgba(26, 36, 30, 0.14);
    }
  }

  .sheet > * + * {
    margin-top: 6mm;
  }

  .doc-header {
    display: grid;
    grid-template-columns: 1fr 50mm;
    gap: 8mm;
    padding-bottom: 6mm;
    border-bottom: 1px solid #b8c6bd;
  }

  .brand-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .logo-mark {
    width: 60px;
    height: 60px;
    object-fit: contain;
    flex: 0 0 auto;
  }

  .company-name {
    font-size: 10pt;
    font-weight: 760;
    color: #17221b;
    line-height: 1.2;
  }

  .doc-title {
    margin-top: 4px;
    font-size: 9pt;
    color: #252a26;
  }

  .doc-meta {
    font-size: 8pt;
    color: #475569;
    line-height: 1.6;
  }

  .doc-box {
    justify-self: end;
    width: 50mm;
    border: 1px solid #17422b;
    color: #17422b;
    padding: 5px 7px;
    text-align: center;
    font-size: 8pt;
  }

  .doc-box-title {
    font-weight: 760;
    text-transform: uppercase;
    font-size: 7pt;
  }

  .doc-box-code {
    font-size: 11pt;
    font-weight: 700;
    font-family: var(--font-geist-mono), "GeistMono", "Cascadia Code", monospace;
    margin-top: 3px;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px 8mm;
    padding: 5px 7px;
    border: 1px solid #b8c6bd;
    font-size: 8.5pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .field-row {
    display: flex;
    gap: 4px;
  }

  .field-label {
    font-weight: 600;
    color: #475569;
    min-width: 100px;
    flex-shrink: 0;
  }

  .field-value {
    color: #1e293b;
  }

  .section-block {
    break-inside: avoid;
    page-break-inside: avoid;
    margin-bottom: 4mm;
  }

  .section-title {
    font-size: 9pt;
    font-weight: 760;
    color: #17422b;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 3px 5px;
    background: #f1f5f9;
    border: 1px solid #b8c6bd;
    border-bottom: 0;
    margin: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
  }

  thead {
    display: table-header-group;
  }

  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  thead th {
    background: #f8fafc;
    color: #17221b;
    padding: 4px 6px;
    text-align: left;
    vertical-align: middle;
    font-size: 7.5pt;
    font-weight: 760;
    border: 1px solid #d1d5db;
  }

  tbody td {
    padding: 4px 6px;
    vertical-align: top;
    border: 1px solid #d1d5db;
    font-size: 8pt;
  }

  .result-box {
    padding: 8px 12px;
    border: 1px solid;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .result-title {
    font-size: 8pt;
    color: #475569;
    margin-bottom: 3px;
  }

  .result-value {
    font-size: 13pt;
    font-weight: 760;
    color: #17221b;
  }

  .result-detail {
    font-size: 8pt;
    margin-top: 4px;
  }

  .section-heading {
    font-size: 9pt;
    font-weight: 760;
    color: #1e293b;
    text-transform: uppercase;
    margin: 0 0 4px;
  }

  .doc-footer {
    padding-top: 4mm;
    border-top: 1px solid #d8dfda;
    font-size: 7pt;
    color: #94a3b8;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* "screen and" es obligatorio: al imprimir, el ancho de la media query es el
     de la caja de página, así que sin esto la rama móvil oculta la hoja y
     @media print oculta el resumen — el PDF sale en blanco. */
  @media screen and (max-width: 760px) {
    .print-toolbar, .mobile-document-summary {
      width: calc(100vw - 24px);
    }
    .print-toolbar {
      position: sticky;
      top: 0;
      z-index: 1;
      flex-wrap: wrap;
      padding: 8px 0;
      background: #e9eeeb;
    }
    .print-action { min-height: 44px; }
    .sheet {
      display: none;
    }
    .mobile-document-summary {
      display: block;
      margin: 16px auto 28px;
      padding: 20px;
      border: 1px solid #d8dfda;
      border-radius: 14px;
      background: #ffffff;
      color: #232522;
    }
    .print-filename { display: none; }
    .print-error { margin: 0; width: 100%; }
    .mobile-document-summary-code { margin: 0; color: #647067; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .mobile-document-summary h1 { margin: 4px 0 0; font-size: 24px; line-height: 1.15; }
    .mobile-document-summary-description { margin: 8px 0 0; color: #45514a; font-size: 15px; }
    .mobile-document-summary-notice { margin: 16px 0; padding: 10px 12px; border-radius: 8px; background: #f1f5f3; color: #45514a; font-size: 14px; line-height: 1.45; }
    .mobile-document-summary-section { margin-top: 18px; }
    .mobile-document-summary-section h2 { margin: 0 0 8px; font-size: 14px; color: #17422b; }
    .mobile-document-summary-section dl { margin: 0; }
    .mobile-document-summary-section dl > div { padding: 10px 0; border-top: 1px solid #e5ebe6; }
    .mobile-document-summary-section dt { color: #647067; font-size: 12px; }
    .mobile-document-summary-section dd { margin: 3px 0 0; font-size: 15px; font-weight: 600; }
  }

  @media print {
    html, body { background: #ffffff; }
    .print-toolbar, .mobile-document-summary { display: none; }
    .sheet {
      width: auto;
      padding: 0;
      min-height: auto;
      margin: 0;
      border: 0;
      box-shadow: none;
    }
  }
`
