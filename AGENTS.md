<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:export-rule -->
# Export Format Rule

All data exports in this app must use **XLSX** format. Never use CSV for exports. Use a library like `xlsx` or `exceljs` to generate proper `.xlsx` files with formatting support.
<!-- END:export-rule -->
