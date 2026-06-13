# Layout / UI Patterns
- For task-heavy desktop screens, use two-column workspaces: main content area + sticky right rail (e.g., `lg:grid-cols-[minmax(0,1fr)_320px]`). Right rail holds summary, actions, timeline, or secondary tools. Confidence: 0.70
- Sidebar and header must be visually and structurally separated — they are independent surfaces, not a single unified bar. Confidence: 0.80
- Section title and breadcrumbs must be placed inside the header pill, not outside or above it. Confidence: 0.65
- Header pill elements (search bar, notification bell, breadcrumbs, title) should be placed directly without wrapping cards or containers. Confidence: 0.75
- Minimize padding/margin between the header pill and main page content for tight visual integration. Confidence: 0.65
- Use green only as accent for status indicators and affordance (badges, icons, small details). Never use green as a large filled surface (hero cards, full-card backgrounds, saturated blocks). Dashboard should read as an internal operations surface, not a marketing panel. Confidence: 0.70
