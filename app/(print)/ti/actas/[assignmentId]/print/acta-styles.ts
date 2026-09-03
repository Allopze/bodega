/** Styles shared by the acta preview and its server-side A4 PDF. */
export const ACTA_PRINT_STYLES = `
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

  .acta-sheet {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto 24px;
    padding: 12mm 14mm;
    background: #ffffff;
    border: 1px solid #d8dfda;
    box-shadow: 0 18px 55px rgba(26, 36, 30, 0.14);
  }

  .acta-sheet .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  .acta-sheet h1 { margin: 0; font-size: 17px; font-weight: 700; }
  .acta-sheet .code { margin: 0; color: #6b7280; font-family: "JetBrains Mono", monospace; font-size: 11px; }
  .acta-sheet .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 650;
  }
  .acta-sheet .badge-delivery { background: #dbeafe; color: #1d4ed8; }
  .acta-sheet .badge-return { background: #fee2e2; color: #b91c1c; }
  .acta-sheet .badge-active { background: #dcfce7; color: #15803d; }

  .acta-sheet .section { margin-bottom: 18px; }
  .acta-sheet .section h2 { margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; color: #374151; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
  .acta-sheet .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .acta-sheet .field { display: flex; padding: 5px 0; border-bottom: 1px solid #f3f4f6; }
  .acta-sheet .field dt { width: 130px; flex-shrink: 0; color: #6b7280; font-weight: 500; }
  .acta-sheet .field dd { flex: 1; margin: 0; font-weight: 400; white-space: pre-wrap; }
  .acta-sheet .accessories { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .acta-sheet .accessory { padding: 2px 10px; border: 1px solid #d1d5db; border-radius: 999px; font-size: 10.5px; }
  .acta-sheet .photos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
  .acta-sheet .photo-cell { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
  .acta-sheet .photo-cell img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
  .acta-sheet .photo-cell .caption { padding: 4px 6px; font-size: 9px; color: #6b7280; }
  .acta-sheet .signature-block { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .acta-sheet .signature { border-top: 1px solid #374151; padding-top: 6px; font-size: 10px; color: #6b7280; text-align: center; }
  .acta-sheet .footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 9px; text-align: center; }

  @media print {
    html, body { background: #ffffff; }
    .print-toolbar { display: none; }
    .acta-sheet { box-shadow: none; border: none; margin: 0; padding: 0; min-height: auto; }
  }
`
