/** Styles shared by the delivery preview and its server-side A4 PDF. */
export const DELIVERY_PRINT_STYLES = `
  /* 20mm abajo reservan la banda del pie numerado. Debe coincidir con el margen
     que pasa la ruta a a4PdfOptions(). */
  @page { size: A4; margin: 12mm 14mm 20mm; }

  *, *::before, *::after { box-sizing: border-box; }

  html, body { background: #e9eeeb; }

  body {
    margin: 0;
    color: #111827;
    font-family: "Inter", system-ui, -apple-system, sans-serif;
    font-size: 12px;
    line-height: 1.5;
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
    border: 1px solid transparent;
    border-radius: 7px;
    cursor: pointer;
    font: inherit;
    font-size: 9.5pt;
    font-weight: 650;
    text-decoration: none;
  }

  .print-action:active { transform: scale(0.97); }
  .print-action:disabled { cursor: wait; opacity: 0.7; }
  .print-action-primary { background: #17422b; color: #f2f7f4; }
  .print-action-primary:hover { background: #205438; }
  .print-action-secondary { background: #f9fbfa; border-color: #cfd8d2; color: #233027; }
  .print-action-secondary:hover { background: #eef5f1; border-color: #b8c8be; }
  .print-filename { margin-left: 6px; color: #647067; font-size: 9pt; }
  .print-error { margin-left: 6px; color: #b91c1c; font-size: 9pt; }

  .mobile-document-summary { display: none; }

  .delivery-sheet {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto 24px;
    padding: 12mm 14mm;
    background: #ffffff;
    border: 1px solid #d8dfda;
    box-shadow: 0 18px 55px rgba(26, 36, 30, 0.14);
  }

  .delivery-sheet .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .delivery-sheet h1 { margin: 0; font-size: 18px; font-weight: 700; }
  .delivery-sheet .code { margin: 0; color: #6b7280; font-family: "JetBrains Mono", monospace; font-size: 11px; }
  .delivery-sheet .section { margin-bottom: 20px; }
  .delivery-sheet .section h2 { margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; color: #374151; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
  .delivery-sheet .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .delivery-sheet .field { display: flex; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
  .delivery-sheet .field dt { width: 110px; flex-shrink: 0; color: #6b7280; font-weight: 500; }
  .delivery-sheet .field dd { flex: 1; margin: 0; font-weight: 400; }
  .delivery-sheet .field dd.document-value-nowrap { white-space: nowrap; }
  .delivery-sheet table { width: 100%; margin-top: 8px; border-collapse: collapse; }
  .delivery-sheet th { padding: 6px 4px; border-bottom: 2px solid #e5e7eb; color: #6b7280; font-size: 10px; font-weight: 600; text-align: left; text-transform: uppercase; }
  .delivery-sheet td { padding: 6px 4px; border-bottom: 1px solid #f3f4f6; font-size: 11px; }
  .delivery-sheet .total { font-weight: 700; }
  .delivery-sheet .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 9px; text-align: center; }

  /* "screen and" es obligatorio: al imprimir, el ancho de la media query es el
     de la caja de página, así que sin esto la rama móvil oculta la hoja y
     @media print oculta el resumen — el PDF sale en blanco. */
  @media screen and (max-width: 760px) {
    .print-toolbar, .mobile-document-summary { width: calc(100vw - 24px); }
    .print-toolbar { position: sticky; top: 0; z-index: 1; flex-wrap: wrap; padding: 8px 0; background: #e9eeeb; }
    .print-action { min-height: 44px; }
    .print-filename { display: none; }
    .print-error { width: 100%; margin: 0; }
    .delivery-sheet { display: none; }

    .mobile-document-summary { display: block; margin: 16px auto 28px; padding: 20px; border: 1px solid #d8dfda; border-radius: 14px; background: #ffffff; color: #232522; }
    .mobile-document-summary-code { margin: 0; color: #647067; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .mobile-document-summary h1 { margin: 4px 0 0; font-size: 24px; line-height: 1.15; }
    .mobile-document-summary-description { margin: 8px 0 0; color: #45514a; font-size: 15px; }
    .mobile-document-summary-notice { margin: 16px 0; padding: 10px 12px; border-radius: 8px; background: #f1f5f3; color: #45514a; font-size: 14px; line-height: 1.45; }
    .mobile-document-summary-section { margin-top: 18px; }
    .mobile-document-summary-section h2 { margin: 0 0 8px; color: #17422b; font-size: 14px; }
    .mobile-document-summary-section dl { margin: 0; }
    .mobile-document-summary-section dl > div { padding: 10px 0; border-top: 1px solid #e5ebe6; }
    .mobile-document-summary-section dt { color: #647067; font-size: 12px; }
    .mobile-document-summary-section dd { margin: 3px 0 0; font-size: 15px; font-weight: 600; }
  }

  @media print {
    html, body { background: #ffffff; }
    .print-toolbar, .mobile-document-summary { display: none; }
    .delivery-sheet { width: auto; min-height: 0; margin: 0; padding: 0; border: 0; box-shadow: none; }
  }
`
