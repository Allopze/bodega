/**
 * Print styles for the Orden de Compra A4 sheet.
 * Extracted from page.tsx to keep components under 200 lines.
 */
export const OC_PRINT_STYLES = `
  /* El margen vive acá y no en el padding de .sheet: el padding vertical de un
     bloque fragmentado sólo se pinta en la primera y última hoja, así que la
     página 2 arrancaba más arriba que la 1. Debe coincidir con A4_MARGIN de
     lib/pdf/page-options.ts. */
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
    transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms cubic-bezier(0.23, 1, 0.32, 1), border-color 150ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .print-action:active {
    transform: scale(0.97);
  }

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

  .print-action-primary:hover {
    background: #205438;
  }

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
    color: #5a655d;
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

  .sheet > * + * {
    margin-top: 6mm;
  }

  @media screen {
    .sheet {
      min-height: 297mm;
      margin: 0 auto 24px;
      border: 1px solid #d8dfda;
      box-shadow: 0 18px 55px rgba(26, 36, 30, 0.14);
    }
  }

  .doc-header {
    display: grid;
    grid-template-columns: 1fr 45mm;
    gap: 10mm;
    padding-bottom: 9mm;
  }

  .brand-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo-mark {
    width: 72px;
    height: 72px;
    object-fit: contain;
    flex: 0 0 auto;
  }

  .company-name {
    font-size: 10pt;
    font-weight: 760;
    color: #17221b;
    line-height: 1.2;
  }

  .company-lines {
    margin-top: 6px;
    display: grid;
    gap: 2px;
    color: #252a26;
    font-size: 8pt;
  }

  .doc-box {
    justify-self: end;
    width: 45mm;
    min-height: 17mm;
    border: 1px solid #17422b;
    color: #17422b;
    padding: 5px 7px;
    text-align: center;
  }

  .doc-box-rut,
  .doc-box-title {
    font-size: 8pt;
    font-weight: 760;
    text-transform: uppercase;
  }

  .doc-box-code {
    margin-top: 5px;
    font-family: "GeistMono", "Cascadia Code", monospace;
    font-size: 12pt;
    font-weight: 700;
    color: #17422b;
  }

  .supplier-panel {
    margin-top: 6mm;
    border: 1px solid #b8c6bd;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 60mm;
    min-height: 28mm;
  }

  .supplier-left,
  .supplier-right {
    display: grid;
    align-content: start;
    padding: 6px 8px;
    gap: 3px;
  }

  .supplier-right {
    border-left: 1px solid #b8c6bd;
  }

  .field-row {
    display: grid;
    grid-template-columns: 25mm 1fr;
    gap: 4px;
    font-size: 8.2pt;
  }

  .supplier-right .field-row {
    grid-template-columns: minmax(0, 23mm) minmax(30mm, 1fr);
  }

  .field-label {
    color: #252a26;
  }

  .field-value::before {
    content: ": ";
  }

  .field-value {
    color: #17221b;
    min-width: 0;
  }

  .field-value-nowrap {
    white-space: nowrap;
  }

  .items-wrap {
    border: 1px solid #b8c6bd;
    border-top: 0;
    /* Cada fragmento dibuja sus cuatro bordes; con el "slice" por defecto la
       tabla quedaba abierta abajo en el corte de página. */
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  thead th {
    background: #ffffff;
    color: #17221b;
    padding: 4px 5px;
    text-align: left;
    vertical-align: middle;
    font-size: 7.6pt;
    font-weight: 760;
    border-bottom: 1px solid #b8c6bd;
  }

  /* Título de la tabla. Va dentro del thead a propósito: Chromium lo repite en
     cada hoja, así que una página suelta sigue diciendo de qué OC es. */
  .items-caption th {
    background: #f1f5f3;
    color: #17422b;
    font-size: 7.5pt;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  tbody td {
    padding: 4px 5px;
    vertical-align: top;
    color: #232b25;
    font-size: 7.8pt;
    border-bottom: 1px solid #e6ece8;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  thead {
    display: table-header-group;
  }

  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .item-name {
    font-weight: 520;
  }

  .item-note {
    color: #232b25;
    font-style: normal;
    line-height: 1.35;
  }

  .text-right {
    text-align: right;
  }

  .text-center {
    text-align: center;
  }

  .mono {
    font-family: "GeistMono", "Cascadia Code", monospace;
    font-variant-numeric: tabular-nums;
  }

  tfoot td {
    padding: 4px 5px;
    background: #ffffff;
    font-size: 8pt;
  }

  .summary-row {
    display: grid;
    grid-template-columns: 1fr 62mm;
    gap: 8mm;
    align-items: start;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .observations {
    display: grid;
    gap: 3mm;
    align-content: start;
  }

  .observations-title {
    font-size: 7pt;
    font-weight: 760;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #5f6b63;
    margin-bottom: 1mm;
  }

  .observations-list {
    margin: 0;
    padding-left: 4mm;
    display: grid;
    gap: 1mm;
    color: #232b25;
    font-size: 8.2pt;
  }

  .observations-list li::marker {
    color: #17422b;
  }

  .amount-words {
    margin-top: 1mm;
    padding: 2.4mm 3mm;
    background: #f1f5f3;
    border-left: 2.5px solid #17422b;
    font-size: 8pt;
    font-weight: 650;
    letter-spacing: 0.01em;
    text-transform: uppercase;
  }

  .totals {
    justify-self: end;
    width: 62mm;
    border: 1px solid #b8c6bd;
    border-radius: 2px;
    overflow: hidden;
    font-size: 8.4pt;
  }

  .total-line {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    padding: 2.2mm 3mm;
  }

  .total-line + .total-line {
    border-top: 1px solid #dde4df;
  }

  .total-label {
    color: #45514a;
  }

  .total-value {
    text-align: right;
    color: #17221b;
  }

  .total-line-final {
    background: #17422b;
    padding-top: 2.6mm;
    padding-bottom: 2.6mm;
    border-top: 1px solid #17422b;
    font-size: 9.6pt;
    font-weight: 760;
  }

  .total-line-final .total-label,
  .total-line-final .total-value {
    color: #f4f8f5;
  }

  .authorization {
    border: 1px solid #b8c6bd;
    border-radius: 2px;
    padding: 4mm 4.5mm 3mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .auth-title {
    font-size: 7pt;
    font-weight: 760;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #5f6b63;
    margin-bottom: 0;
  }

  .auth-line {
    height: 0;
    border-bottom: 1px solid #9aa8a0;
  }

  .auth-signature {
    margin-top: 14mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.6mm;
  }

  .auth-name {
    font-size: 11pt;
    font-weight: 720;
    color: #232522;
    line-height: 1.1;
    text-align: center;
  }

  .auth-name-empty {
    min-height: 12pt;
  }

  .auth-signature .auth-line {
    width: 70mm;
  }

  .auth-caption {
    color: #5f6b63;
    font-size: 6.8pt;
    line-height: 1.4;
    text-align: center;
    max-width: 80mm;
  }

  /* "screen and" es obligatorio: al imprimir, el ancho de la media query es el
     de la caja de página (162mm ≈ 612px), así que sin esto la rama móvil oculta
     la hoja y @media print oculta el resumen — el PDF sale en blanco. */
  @media screen and (max-width: 760px) {
    .print-toolbar,
    .mobile-document-summary {
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

    .print-action {
      min-height: 44px;
    }

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
    .print-filename {
      display: none;
    }

    .print-error {
      margin: 0;
      width: 100%;
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
    html,
    body {
      background: #ffffff;
    }

    .print-toolbar,
    .mobile-document-summary {
      display: none;
    }

    /* Sin ancho ni padding propios: la caja de texto la define el @page, igual
       en todas las hojas. 210mm − 12mm − 12mm = 186mm, la columna de siempre. */
    .sheet {
      width: auto;
      padding: 0;
      margin: 0;
      border: 0;
      box-shadow: none;
    }
  }
`
