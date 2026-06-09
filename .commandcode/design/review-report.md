# Design Review — Chome Solicitudes y Bodega

**Fecha**: 2026-06-09
**Score**: 34/50

---

## Primera impresión

El login tiene una personalidad clara: panel oscuro forest-green con tagline, split-screen que respira confianza. La sidebar oscura con acento emerald y badges naranja crea una identidad reconocible para una herramienta interna. El brand-mark tiene presencia. Las páginas de producto, sin embargo, tienden a verse como dashboards genéricos — cards, tablas, grids predecibles. Se siente como una app bien construida pero que no termina de tener un punto de vista visual completo más allá de la paleta.

**7/10**

---

## Jerarquía

El dashboard prioriza correctamente: tareas por urgencia arriba, métricas al medio, tabla de faenas abajo. La taxonomía de headings es inconsistente — algunas secciones usan `text-base font-semibold`, otras `text-sm font-semibold`. Bodega aplana demasiado la información entre stock, despacho y kardex; las tres secciones compiten visualmente. Las tablas tienen buenos carriles de escaneo, pero la densidad tipográfica varía entre páginas sin razón aparente.

**7/10**

---

## Color

El sistema Oklch está bien construido y razonado. Los neutros tienen un tinte cálido-verde sutil (~0.005-0.010 chroma) que evita el gris muerto. El naranja señal (`--color-signal`) reservado exclusivamente para "pendiente compra" es una decisión de UX genuina. La paleta de estados semánticos (info/success/warning/danger) es completa.

**Problemas detectados**:
- Valores oklch crudos (`oklch(0.52_0.11_85)`) dispersos en componentes en vez de usar tokens
- `primary` y `success` comparten la misma paleta visual (documentado, pero confunde al diferenciar "acción confirmada" de "completado")
- `--color-warning-700` usa `oklch(0.520 0.110 85)` que no coincide con el tono 93 del warning base

**8/10**

---

## Tipografía

Buenas elecciones: Exo 2 para display (personalidad), Source Sans 3 para cuerpo (legibilidad), Geist Mono para datos tabulares. La escala personalizada (15px sm, 17px base) mejora la legibilidad sobre los defaults de Tailwind.

**Problemas detectados**:
- La medida de línea (line length) no está controlada — las páginas de detalle de solicitud probablemente exceden 80ch
- La taxonomía de headings no tiene consistencia: a veces `text-base font-semibold`, a veces `text-sm font-semibold`, a veces `text-xl font-bold`
- No hay escalado responsivo de tipografía (mismo tamaño en 320px que en 1440px)
- `DialogTitle` usa `font-display` mientras `PageHeader` usa `font-sans` — inconsistencia de voz tipográfica

**6/10**

---

## Interacción

Base sólida: hover con translate-y en cards, active:scale en botones, focus-visible rings consistentes, skeleton loaders con shimmer. El sistema de motion (Emil-inspired) está bien diseñado con curvas custom, duraciones tokenizadas, y respeto a `prefers-reduced-motion`.

**Estados cubiertos**: idle, hover, active, focused, loading (skeleton), empty (EmptyState contextual), disabled.

**Estados débiles o ausentes**:
- Error: prácticamente inexistente a nivel de página. `Input` tiene prop `error` pero no vi páginas que muestren estados de error de formulario o fetch
- Success/feedback: no hay integración visible de toasts (sonner está instalado pero no se usa en los componentes core)
- Overflow: no hay estrategia de overflow para contenido largo en celdas o cards
- El estado "loading" de navegación entre páginas no tiene feedback visual

**6/10**

---

## Olores de AI

Este proyecto **no huele a genérico**. Las decisiones tienen intención:
- El naranja señal es una decisión de dominio real, no un reflejo de paleta
- Los tokens Oklch están calibrados manualmente con chroma reducido en extremos
- El Emil-inspired motion no es copia-pega, está adaptado al diseño
- Las etiquetas de estado en español chileno ("Pendiente compra", "Rec. parcial") muestran conocimiento del dominio

**Único olor menor**: el patrón card + grid + tabla se repite sin variación compositiva entre páginas (solicitudes, compras, recepción, bodega). Todas siguen la misma silueta: PageHeader → filtros → tabla/cards.

---

## Camino crítico (ordenado por impacto)

1. **Unificar taxonomía de headings**: definir una escala fija para h2 de sección y usarla consistentemente. Recomendado: `text-lg font-semibold` para títulos de sección, `text-base font-medium` para sub-secciones.

2. **Crear superficie de error a nivel página**: componente `ErrorState` (paralelo a `EmptyState`) con icono, mensaje, causa cuando aplique, y acción de recuperación. Integrar en páginas que hacen fetch.

3. **Reemplazar valores oklch crudos por tokens**: buscar `oklch(` en `app/` y `components/` y migrar a variables CSS. Ya hay tokens definidos para todos los roles.

4. **Controlar medida de línea**: en páginas de detalle (solicitud/[id], compras/[id]), limitar el ancho de texto descriptivo a `max-w-[72ch]`.

5. **Integrar toasts (sonner) para feedback**: confirmación de acciones (guardar, aprobar, rechazar) — ya está instalado.

6. **Unificar voz tipográfica**: decidir si `font-display` se usa para headings de página o solo para branding, y aplicarlo consistentemente.

7. **Añadir estado de carga de navegación**: un indicador sutil (top-bar progress bar o similar) durante navegaciones SPA entre páginas.

---

## Modo Command Code recomendado para cada hallazgo

| Hallazgo | Modo |
|---|---|
| Taxonomía de headings | `typeset` |
| Valores oklch crudos | `recolor` |
| Medida de línea | `typeset` |
| Error states | `surface` |
| Toasts feedback | `interaction` |
| Voz tipográfica | `typeset` |
| Navegación loading | `interaction` |
| Variedad compositiva | `relayout` |
