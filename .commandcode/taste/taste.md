# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# Communication
- Always communicate in Spanish. Confidence: 0.95

# Project Identity
- Project name is "Chome Solicitudes y Bodega", never "StockFlow". Confidence: 0.90

# Warehouse (Bodega) Scope
- Warehouse module is for basic EPP inventory only — track what EPP exists and how many; not a full WMS. Confidence: 0.85
- No central warehouse exists; the faena (worksite) itself acts as the warehouse for stock. Stock lives at the faena level, not in a centralized bodega. Confidence: 0.85

# Code Style
- DataTable generic constraint requires `as unknown as Record<string, unknown>[]` cast — all 9+ list components use this pattern, don't try to "fix" it. Confidence: 0.70

# Workflow Preferences
- Keep workflows simple and explicit; avoid over-engineering. Confidence: 0.85
- Approval flow: jefatura, secretaría, or prevencionista oficina approve/reject requests. Confidence: 0.90
- Worker deliveries (prevencionista oficina delivers EPP to workers) are now in scope. Confidence: 0.80
- Solicitante (requester) is always scoped per faena (worksite), never global. Confidence: 0.90

# Layout / UI Patterns
See [layout-/-ui-patterns/taste.md](layout-/-ui-patterns/taste.md)
# Design Workflow
- For UI/design tasks, use the impeccable, emil-design-eng, and design-taste-frontend skills. Confidence: 0.70

# Scope Management
- When asked to implement, first list what's missing or incomplete rather than making assumptions. Confidence: 0.80
- User actively manages scope and will push back on unnecessary complexity. Confidence: 0.75

# Role Structure
- Finanzas role should not exist; invoices are attachments only, not a financial module. Confidence: 0.85
- Role types: administrador, jefatura, secretaría, prevencionista oficina, prevencionista faena. Confidence: 0.90
