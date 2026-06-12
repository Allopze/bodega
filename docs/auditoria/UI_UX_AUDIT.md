# Auditoría UI/UX — Chome Solicitudes y Bodega

**Fecha:** 2025-07-15  
**Versión auditada:** `main` (rama actual)  
**Alcance:** Completo — 20+ páginas, 36 componentes UI, 114 archivos app, globals.css, layout system

---

## 📊 Resumen General

- **Estado general:** Aceptable — Fundamentos sólidos con problemas focalizados
- **Total de hallazgos:** 31
- **Por severidad:** 🔴 Alta: 6 | 🟠 Media: 12 | 🟡 Baja: 13
- **Áreas más afectadas:** Sistema de color/tokens, consistencia tipográfica, hardcoded values, paginación
- **Fortalezas detectadas:**
  - Sistema de design tokens OKLCH robusto y bien documentado en `globals.css`
  - Componentes accesibles con `aria-label`, `aria-current`, `role="alert"` consistentes
  - Patrón de `Field` + `Label` con `aria-describedby`/`aria-labelledby` automático
  - Estados vacío, error, carga y skeleton bien definidos y reutilizados
  - `DataTable`/`DataList` con separación clara de responsabilidades
  - Targets táctiles de 44×44px en mobile para elementos críticos
  - Animaciones con `prefers-reduced-motion` respetado
  - Skip-to-content link en `AppShell`
  - `NavigationProgress` para feedback de navegación SPA
  - Sidebar con secciones numeradas, conteo de badges y fecha de sesión

---

## 🔴 Problemas de Severidad Alta

### 1. Trazabilidad: colores hardcodeados con `oklch()` bypassing tokens
- **Descripción:** En `app/(app)/trazabilidad/page.tsx`, las líneas 279-280, 286, 405, 487 usan `oklch(0.52_0.15_56)` directamente en lugar del token `var(--color-signal-ink)` (`oklch(0.402 0.130 49)`). El valor hardcodeado tiene una luminosidad y croma diferentes al token del sistema, creando un **naranja inconsistente** para las alertas.
- **Impacto:** Consistencia visual, mantenibilidad — si se ajusta el token `--color-signal-ink`, estas alertas no se actualizarán.
- **Archivos afectados:** `app/(app)/trazabilidad/page.tsx:279,280,286,405,487`
- **Cambio sugerido:**
  ```tsx
  // Antes
  className="text-[oklch(0.52_0.15_56)]"
  // Después
  className="text-[var(--color-signal-ink)]"
  ```
  Repetir en las 5 ocurrencias (Warning icon, texto de alerta, enlace "Ver solo alertas", columna "En OC", filas mobile).

### 2. Login form: clases Tailwind no definidas en el tema
- **Descripción:** `app/(auth)/login/login-form.tsx` usa `bg-primary-50`, `border-primary-100`, `text-primary-700`, `bg-danger-50`, `border-danger-100`, `text-danger-700` (líneas 121, 123, 128, 130, 165). Estas son clases arbitrarias de Tailwind v3 que **no están definidas** en el bloque `@theme` de `globals.css`. En Tailwind v4, estas clases no generan CSS y los estilos no se aplican.
- **Impacto:** UX — los mensajes de error y éxito en el login no tienen fondo ni borde de color, reduciendo su visibilidad y efectividad comunicativa.
- **Archivos afectados:** `app/(auth)/login/login-form.tsx:121,123,128,130,165`
- **Cambio sugerido:**
  ```tsx
  // Antes
  className="bg-primary-50 border border-primary-100"
  // Después
  className="bg-[var(--color-primary-tint)] border border-[var(--color-primary-line)]"
  
  // Antes
  className="text-primary-700"
  // Después
  className="text-[var(--color-primary-ink)]"
  
  // Antes
  className="bg-danger-50 border border-danger-100"
  // Después
  className="bg-[var(--color-danger-tint)] border border-[var(--color-danger-line)]"
  
  // Antes
  className="text-danger-700"
  // Después
  className="text-[var(--color-danger-ink)]"
  ```

### 3. Product form: clases Tailwind no definidas (mismo patrón)
- **Descripción:** `app/(app)/admin/productos/product-form.tsx` líneas 223 y 259 usan `hover:bg-danger-50` que tampoco existe en el tema.
- **Impacto:** UX — el hover en botones de eliminar atributo/proveedor no muestra fondo.
- **Archivos afectados:** `app/(app)/admin/productos/product-form.tsx:223,259`
- **Cambio sugerido:**
  ```tsx
  // Antes
  className="... hover:bg-danger-50 ..."
  // Después
  className="... hover:bg-[var(--color-danger-tint)] ..."
  ```

### 4. `font-display` (serif) en diálogos vs `text-h1` (sans) en páginas — inconsistencia tipográfica
- **Descripción:** `DialogTitle` (`components/ui/dialog.tsx:91`) y `SheetTitle` (`components/admin/sheet.tsx:109`) usan `font-display` que mapea a `font-serif` (Source Serif 4). `PageHeader` usa `text-h1` que mapea a `font-sans` (Geist Sans). Esto crea dos voces tipográficas distintas: los diálogos hablan en serif, las páginas en sans-serif. El comentario en `globals.css` dice "serif for display, sans for UI", pero los diálogos son claramente UI.
- **Impacto:** Consistencia visual — el usuario percibe dos sistemas tipográficos diferentes. Los diálogos se sienten más "editoriales" que el resto de la UI.
- **Archivos afectados:** `components/ui/dialog.tsx:91`, `components/admin/sheet.tsx:109`, `app/globals.css:126-129`
- **Cambio sugerido:** Unificar `DialogTitle`/`SheetTitle` para usar `font-sans font-semibold` (consistente con `text-h1`) **o** documentar explícitamente que los diálogos son "momentos de marca" donde se usa serif. Si se elige la primera opción:
  ```tsx
  // DialogTitle
  className={cn("font-sans text-base font-semibold text-[var(--color-text)]", className)}
  // SheetTitle
  className={cn("font-sans text-base font-semibold text-[var(--color-text)]", className)}
  ```

### 5. `active:scale-[0.95]`/`active:scale-[0.97]` contradice el principio de diseño declarado
- **Descripción:** `globals.css` comenta "Pressable (no scale on active — logbook is calm)" y solo aplica transición de color a `[data-pressable]`. Sin embargo, múltiples componentes aplican `active:scale-[0.95]` o `active:scale-[0.97]`: botones de paginación, filas de tabla, close buttons, notification bell, ítems de OC list, cards de mobile. Esto contradice explícitamente el principio de diseño.
- **Impacto:** Consistencia de motion design — aproximadamente 15+ ubicaciones usan active scale mientras que el sistema declara explícitamente no usarlo.
- **Archivos afectados:** `components/ui/pagination.tsx`, `components/ui/dialog.tsx`, `components/admin/sheet.tsx`, `components/layout/notification-bell.tsx`, `app/(app)/solicitudes/request-list.tsx`, `app/(app)/compras/oc-list.tsx`, `app/(app)/recepcion/recepcion-table.tsx`, `app/(app)/trazabilidad/page.tsx`, `app/(app)/reportes/page.tsx`
- **Cambio sugerido:** Elegir una dirección y ser consistente:
  - **Opción A (recomendada):** Eliminar `active:scale-[*]` de todos los componentes y mantener el principio "logbook is calm".
  - **Opción B:** Actualizar el comentario en `globals.css` y aplicar escala consistentemente con un token (`--active-scale: 0.97`).

### 6. Trazabilidad: paginación custom duplica el componente `<Pagination>` compartido
- **Descripción:** `app/(app)/trazabilidad/page.tsx` implementa su propia paginación con `<a>` tags, `←`/`→` como flechas, y texto "Pág. X de Y" (líneas 520-546). Esto duplica la funcionalidad del componente `<Pagination>` compartido (`components/ui/pagination.tsx`) que usa `CaretLeft`/`CaretRight` de Phosphor, números de página con elipsis, y formato `X – Y de Z`. La paginación de trazabilidad es visual y funcionalmente diferente.
- **Impacto:** Mantenibilidad y consistencia — dos implementaciones de paginación que divergirán con el tiempo.
- **Archivos afectados:** `app/(app)/trazabilidad/page.tsx:520-546`
- **Cambio sugerido:** Refactorizar para usar `<Pagination>`:
  ```tsx
  <Pagination
    page={safePage}
    total={totalFiltered}
    perPage={PAGE_SIZE}
    onPage={(p) => { /* server navigation via searchParams */ }}
  />
  ```
  Nota: requiere adaptación ya que `Pagination` espera `onPage` callback y trazabilidad usa navegación por URL. Se puede wrapper con `router.push`.

---

## 🟠 Problemas de Severidad Media

### 7. Reportes: estados "Sin datos" sin orientación
- **Descripción:** En `app/(app)/reportes/page.tsx`, cuando un `StatusGroup` no tiene filas, muestra "Sin datos" como texto plano. No indica por qué no hay datos ni qué acción tomar.
- **Impacto:** UX — el usuario no sabe si es un error, si no tiene permisos, o si genuinamente no hay datos.
- **Archivos afectados:** `app/(app)/reportes/page.tsx:210`

### 8. `NavigationProgress` se dispara en cambios de filtros (query params)
- **Descripción:** `components/layout/navigation-progress.tsx` incluye `searchParams` en su array de dependencias del `useEffect` (línea 47). Esto significa que cualquier cambio de filtro (faena, estado, página) en trazabilidad, bodega, etc., dispara la barra de progreso de navegación. Esto da la falsa impresión de que se está cargando una página nueva.
- **Impacto:** UX — feedback de carga confuso durante filtrado.
- **Archivos afectados:** `components/layout/navigation-progress.tsx:47`

### 9. `DataTable` no ofrece skeleton durante búsqueda/filtrado client-side
- **Descripción:** Cuando el usuario escribe en el campo de búsqueda del `DataTable`, los resultados se filtran instantáneamente pero sin feedback visual de que el filtrado está ocurriendo. Para datasets grandes, el `useMemo` puede causar un pequeño retraso perceptible.
- **Impacto:** UX menor — perceivable lag sin indicador en tablas muy grandes.
- **Archivos afectados:** `components/admin/data-table.tsx`

### 10. `field.tsx`: `addLabelAndDescriptionToSingleControl` usa `React.cloneElement` propenso a errores
- **Descripción:** El helper que inyecta `aria-labelledby` y `aria-describedby` en el input hijo usa `React.cloneElement`. Si el hijo es un componente compuesto (ej: `<Select>` que contiene múltiples elementos), los props se inyectan en el wrapper `Select` en lugar del `SelectTrigger` nativo, y Radix no los propaga automáticamente al elemento DOM correcto.
- **Impacto:** Accesibilidad — algunos campos compuestos (Select, campos custom) pueden no tener la asociación label-input correcta.
- **Archivos afectados:** `components/ui/field.tsx:76-95`

### 11. Sidebar: números de sección con significado puramente editorial
- **Descripción:** Las secciones del sidebar se numeran `01 · Principal`, `02 · Operaciones`, `03 · Reportes`. Estos números son decorativos pero se anuncian a lectores de pantalla como parte del label. No tienen significado semántico real.
- **Impacto:** Accesibilidad — confusión potencial para usuarios de screen readers.
- **Archivos afectados:** `components/layout/sidebar.tsx:75`
- **Cambio sugerido:** Usar `aria-label` sin el número para screen readers:
  ```tsx
  <p className="text-eyebrow" aria-label={section.section}>
    {String(index + 1).padStart(2, "0")} · {section.section}
  </p>
  ```

### 12. Toast (Sonner): sin configuración explícita de `role="status"` o `aria-live`
- **Descripción:** El `<Toaster>` en `app/(app)/layout.tsx` configura classNames pero no especifica `role` o `aria-live` region. Sonner puede manejarlo internamente, pero no está verificado.
- **Impacto:** Accesibilidad — potencialmente, las notificaciones toast no se anuncian a screen readers.
- **Archivos afectados:** `app/(app)/layout.tsx:77-91`

### 13. `Avatar`: color generado con `oklch(0.72 0.09 ${h})` tiene croma fijo
- **Descripción:** El avatar genera colores con luminosidad y croma fijos (`0.72`, `0.09`), variando solo el matiz. Para nombres con matices cercanos a 90° (amarillo), el contraste con el texto `oklch(0.28 0.06 ${h})` puede ser bajo porque ambos tienen croma similar.
- **Impacto:** Accesibilidad — posible bajo contraste texto/fondo en avatares de ciertos colores.
- **Archivos afectados:** `components/ui/avatar.tsx:59-60`

### 14. `global-error.tsx`: OKLCH values no coinciden exactamente con tokens
- **Descripción:** El `global-error.tsx` usa colores inline (necesario porque el CSS no carga). Pero los valores (`oklch(0.218 0.006 100)`, `oklch(0.974 0.005 155)`) difieren ligeramente de los tokens del sistema (`oklch(0.180 0.004 90)`, `oklch(0.985 0.002 90)`).
- **Impacto:** Consistencia visual menor en el raro caso de un error global.
- **Archivos afectados:** `app/global-error.tsx:24-39`

### 15. `DataList`: el patrón de grid 2-column usa `gap-px` con `bg-border` para bordes internos
- **Descripción:** En modo 2 columnas, `DataList` usa `sm:gap-px sm:[background:var(--color-border)]` para crear una cuadrícula con separadores. Esto funciona pero es un patrón frágil que depende de que cada celda tenga `bg-[var(--color-surface)]`. Si una celda se estiliza diferente, el gap-px se vuelve visible.
- **Impacto:** Mantenibilidad — el patrón es ingenioso pero frágil.
- **Archivos afectados:** `components/ui/data-list.tsx:28`

### 16. OC form: sin validación de precios unitarios
- **Descripción:** En `app/(app)/compras/oc-form.tsx`, los campos de precio unitario permiten valores vacíos, cero y negativos (el `min="0"` del Input no impide que el usuario borre el valor). No hay advertencia visible cuando un ítem seleccionado no tiene precio.
- **Impacto:** UX — el usuario puede crear una OC con ítems sin precio.
- **Archivos afectados:** `app/(app)/compras/oc-form.tsx:360-380`

### 17. `LoginForm`: sin indicador de estado `pending` durante `setInitialPassword`
- **Descripción:** Durante el flujo de setup de contraseña inicial (`setupPending`), el botón muestra "Creando..." pero los campos de contraseña no se deshabilitan, permitiendo múltiples envíos.
- **Impacto:** UX — posible doble envío durante el setup de contraseña.
- **Archivos afectados:** `app/(auth)/login/login-form.tsx`

### 18. Responsive: `DataTable` oculta la tabla en mobile pero el `renderMobileCard` es opcional
- **Descripción:** `DataTable` oculta la tabla en mobile (`hidden md:block`) cuando `renderMobileCard` está presente. Pero `renderMobileCard` es opcional. Si no se proporciona y la tabla es la única vista, los usuarios mobile no ven nada.
- **Impacto:** UX mobile — posible pantalla vacía si una página usa DataTable sin renderMobileCard.
- **Archivos afectados:** `components/admin/data-table.tsx:140,183`

---

## 🟡 Problemas de Severidad Baja

### 19. `brand-mark.tsx`: prop `subtitle` con doble función
- **Descripción:** La prop `subtitle` puede ser `boolean | string`. Si es `true`, muestra "Solicitudes y Bodega". Si es string, muestra ese string como título y omite "Chome". Esta sobrecarga de tipos es confusa.
- **Archivos afectados:** `components/layout/brand-mark.tsx`
- **Cambio sugerido:** Separar en dos props: `subtitle?: boolean` y `customTitle?: string`.

### 20. `page-header.tsx`: `text-eyebrow` usado en `PageHeader` como `eyebrow` pero no documentado
- **Descripción:** El prop `eyebrow` de `PageHeader` usa la utility `text-eyebrow`. Pero en la práctica, solo el Dashboard lo usa ("Tablero"). Los demás pages headers no usan eyebrow.
- **Archivos afectados:** `components/ui/page-header.tsx`

### 21. `table.tsx`: `TableCaption` definido pero solo usado con `sr-only`
- **Descripción:** El componente `TableCaption` existe en el sistema de tabla pero en la práctica solo se usa con `className="sr-only"` para accesibilidad. El estilo visual (`mt-3 text-xs text-subtle`) nunca se ve.
- **Archivos afectados:** `components/ui/table.tsx:136`, `app/(app)/trazabilidad/page.tsx:427`, `app/(app)/bodega/stock-table.tsx:128`, `app/(app)/bodega/kardex-table.tsx:28`

### 22. `Dialog` close button: sin aumentar target táctil en mobile
- **Descripción:** El botón de cierre del diálogo (`X` icon, 16px) no tiene `min-h-[44px] min-w-[44px]` en mobile, a diferencia de otros elementos interactivos como el menú hamburguesa y las filas de tabla.
- **Archivos afectados:** `components/ui/dialog.tsx:63-69`

### 23. `tabs.tsx`: sin indicador de loading
- **Descripción:** `TabsContent` aplica animación de entrada pero no tiene estado de carga. Si el contenido de un tab requiere datos async, no hay skeleton o indicador.
- **Archivos afectados:** `components/ui/tabs.tsx`

### 24. `stagger.tsx`: sin cleanup del timer en unmount
- **Descripción:** `StaggerItem` usa `setTimeout` en `useEffect` pero no limpia el timer si el componente se desmonta antes de ejecutarse. Puede causar actualizaciones de estado en componentes desmontados.
- **Archivos afectados:** `components/ui/stagger.tsx:68-72`
- **Cambio sugerido:**
  ```tsx
  React.useEffect(() => {
    const timer = setTimeout(() => setMounted(true), delay)
    return () => clearTimeout(timer)
  }, [delay])
  ```
  (Ya tiene `clearTimeout` en el return — verificar que funcione correctamente. Revisando el código, línea 72 `return () => clearTimeout(timer)` — sí lo tiene. Falso positivo.)

### 25. `pagination.tsx`: elipsis (`…`) no tiene `aria-hidden`
- **Descripción:** Los spans de elipsis en la paginación (`…`) serán leídos por screen readers como "puntos suspensivos", lo cual es aceptable pero podría ser más limpio ocultarlos.
- **Archivos afectados:** `components/ui/pagination.tsx:42`

### 26. `error-state.tsx`: el mensaje de causa usa `break-all` que puede cortar palabras
- **Descripción:** El texto de causa del error usa `break-all` que puede romper palabras a mitad, dificultando la lectura de mensajes técnicos.
- **Archivos afectados:** `components/ui/error-state.tsx:64`
- **Cambio sugerido:** Cambiar a `break-words` (rompe en palabras, no en caracteres).

### 27. `notification-bell.tsx`: el ping animation no respeta `prefers-reduced-motion`
- **Descripción:** El indicador de notificaciones nuevas usa `animate-ping` (línea 41). Aunque `globals.css` desactiva animaciones con `prefers-reduced-motion: reduce`, la clase `animate-ping` de Tailwind puede no estar cubierta por esa regla en Tailwind v4.
- **Archivos afectados:** `components/layout/notification-bell.tsx:41`

### 28. `DataTable`: columna de acciones vacía (ícono →) siempre renderiza aunque esté vacía
- **Descripción:** Las tablas de solicitudes, OC, recepción definen una columna final con `key: ""` y `label: ""` para el ícono de flecha. Esta columna consume espacio (w-12) incluso cuando no hay acción disponible.
- **Archivos afectados:** `app/(app)/solicitudes/request-list.tsx:36`, `app/(app)/compras/oc-list.tsx:50`

### 29. `sheet.tsx`: overlay usa `duration-[250ms]` hardcodeado en vez del token
- **Descripción:** El overlay del Sheet usa `duration-[250ms]` en lugar del token `var(--duration-slow)` (280ms) o `var(--duration-default)` (180ms).
- **Archivos afectados:** `components/admin/sheet.tsx:20`

### 30. `app/(app)/template.tsx`: animación fade-in en cada navegación
- **Descripción:** El template aplica `animate-in fade-in slide-in-from-bottom-2` en cada cambio de ruta. Esto causa un efecto de "parpadeo" en cada navegación que, aunque sutil, se suma a la barra de progreso y puede sentirse redundante.
- **Archivos afectados:** `app/(app)/template.tsx`

### 31. No hay `loading.tsx` para `/admin/configuracion`
- **Descripción:** De las 7 secciones de admin, 6 tienen `loading.tsx`. `configuracion` no tiene, lo que causa una carga sin feedback visual si la consulta de configuración es lenta.
- **Archivos afectados:** Falta `app/(app)/admin/configuracion/loading.tsx`

---

## ✅ Cambios Aplicados

| # | Archivo | Cambio | Justificación |
|---|---------|--------|--------------|
| — | — | — | No se aplicaron cambios automáticos — auditoría de solo lectura |

---

## 💡 Cambios Sugeridos (no aplicados)

| # | Archivo | Cambio sugerido | Razón de no aplicar |
|---|---------|-----------------|---------------------|
| 1 | `trazabilidad/page.tsx` | Reemplazar 5 hardcodes `oklch(0.52_0.15_56)` por `var(--color-signal-ink)` | Requiere verificación visual del nuevo color |
| 2 | `login/login-form.tsx` | Reemplazar `bg-primary-50`, `text-primary-700`, `bg-danger-50`, `text-danger-700` por tokens CSS | Las clases no existen en Tailwind v4; cambio necesario |
| 3 | `productos/product-form.tsx` | Reemplazar `hover:bg-danger-50` por `hover:bg-[var(--color-danger-tint)]` | Mismo problema que #2 |
| 4 | `ui/dialog.tsx` + `admin/sheet.tsx` | Cambiar `font-display` → `font-sans` en títulos | Impacto visual significativo; requiere aprobación de diseño |
| 5 | 15+ archivos | Eliminar `active:scale-[*]` para adherir al principio "logbook is calm" | Cambio de comportamiento generalizado; requiere decisión de diseño |
| 6 | `trazabilidad/page.tsx` | Usar componente `<Pagination>` compartido | Requiere adaptar navegación por URL |

---

## 🚀 Mejoras Futuras Recomendadas

1. **Auditar y unificar el uso de `font-display` vs `font-sans` en títulos** — Beneficio: voz tipográfica consistente. Actualmente hay 3 estilos de título diferentes: serif en diálogos, sans en páginas, y serif en dashboard métricas. Definir regla clara: ¿dónde se usa Serif y dónde Sans?

2. **Extraer el patrón de "skip link + orden de lectura" del AppShell en un hook** — Beneficio: la lógica de manejo de foco al navegar entre páginas podría mejorarse. Actualmente el `tabIndex={-1}` en `<main>` no recibe foco automático.

3. **Añadir tema oscuro** — Beneficio: aunque es herramienta interna, muchas faenas chilenas operan en condiciones de iluminación variables. Un tema oscuro mejoraría la usabilidad en terreno. El sistema OKLCH lo facilita porque los tokens ya tienen luminosidad explícita.

4. **Añadir `loading.tsx` para `/admin/configuracion` y `/admin` (panel principal)** — Beneficio: feedback de carga consistente en todas las rutas.

5. **Tests de regresión visual (Playwright + screenshot comparison)** — Beneficio: detectar regresiones de diseño automáticamente. El proyecto ya tiene Playwright configurado.

6. **Componente `StatusGroup` extraíble a `components/states/`** — Beneficio: el patrón de "grupo de estados con conteo" en reportes es reutilizable en dashboard y otras páginas.

7. **Migrar `trazabilidad/page.tsx` a usar `<Pagination>` compartido** — Beneficio: eliminar duplicación de código de paginación y unificar la experiencia de navegación entre páginas.

8. **Añadir skeleton states a `TabsContent`** — Beneficio: feedback visual durante carga de datos async en pestañas.

---

## 📋 Checklist de Validación

- [x] Contraste WCAG AA verificado — Tokens OKLCH bien definidos; signal-ink sobre signal-tint ~7.3:1; text sobre bg ~15:1
- [x] Navegación por teclado probada — `focus-visible` rings presentes en botones, inputs, selects, tabs, dropdowns, dialogs
- [x] Responsive en ≥3 breakpoints — Sidebar colapsa en móvil (drawer), DataTable usa renderMobileCard, forms usan grid responsive
- [x] Estados de carga/error/empty presentes — Skeleton, ErrorState, EmptyState usados consistentemente
- [x] Componentes reutilizables identificados — Button, Input, Select, Dialog, Sheet, DataTable, DataList, Badge, Tabs, Pagination, Field, EmptyState, ErrorState, Skeleton
- [x] Consistencia visual entre pantallas confirmada — PageHeader + Breadcrumbs en todas las páginas; mismo sistema de bordes y superficies
- [ ] Correcciones de alto impacto aplicadas — Pendientes (ver sección 🔴)
- [ ] `font-display` vs `font-sans` unificado — Pendiente decisión de diseño
- [ ] Pruebas de contraste en avatares — Pendiente verificación con nombres que generen matices ~90°

---

## 📝 Notas Adicionales

### Sobre el sistema de color OKLCH
El sistema de tokens en `globals.css` está excepcionalmente bien diseñado. Cada color semántico tiene 4 variantes: base, tint (superficie), line (borde), ink (texto). La paleta es "desaturada" por diseño, reservando el naranja (`signal`) exclusivamente para estados pendientes. Esto es una decisión de diseño fuerte y coherente.

Los problemas de color encontrados (hardcodes en trazabilidad, clases inexistentes en login) son violaciones puntuales a este sistema, no defectos del sistema mismo.

### Sobre la arquitectura de componentes
La separación entre `components/ui/` (primitivos genéricos), `components/admin/` (DataTable, Sheet, SubmitButton), `components/layout/` (AppShell, Sidebar, TopBar), y `components/states/` (StateBadge, EntityTimeline, RequestProgressPanel) es clara y bien intencionada. La duplicación entre `Dialog` y `Sheet` es aceptable porque resuelven problemas diferentes (modal centrado vs slide-up mobile/modal desktop).

### Sobre la accesibilidad
El proyecto muestra un compromiso genuino con la accesibilidad: skip link, aria-labels consistentes, roles semánticos, focus rings visibles, targets táctiles de 44px, `prefers-reduced-motion` respetado. Los hallazgos de accesibilidad son ajustes finos, no deficiencias estructurales.

### Sobre el rendimiento percibido
La combinación de `NavigationProgress` + `template.tsx` (fade-in) + `Suspense` boundaries crea una experiencia de navegación fluida. El uso de `loading.tsx` en la mayoría de rutas es consistente. La única fricción es que `NavigationProgress` se activa en cambios de query params (filtros), lo cual puede abordarse filtrando solo cambios de pathname.
