# Plan de Mejora UI/UX — Plataforma Chome

**Origen:** [AUDITORIA_UIUX_INTEGRAL_2026-07-24.md](AUDITORIA_UIUX_INTEGRAL_2026-07-24.md)
**Fecha:** 2026-07-24
**Meta:** cerrar los 2 hallazgos Críticos y los 8 Altos para llevar *Preparación para Producción* de 4.0 a ≥8.0 y la puntuación global de 7.1 a ≈8.6.

> ## Estado: auditoría cerrada · queda 1 error sin diagnosticar (`/ppa` #418) y Fase 4
> **Pasada 10 completada el 2026-07-25.** Global **9.6 → 9.7**.
> `next build` limpio · `tsc` limpio · **ESLint 0 problemas en todo el repo** · **3012/3012 tests** · 159/159 rutas.
>
> | Pasada | Global | Qué cerró |
> |---|---|---|
> | 1–5 | 7.1 → 8.8 | Fases 0, 1 y 3-desktop (I–IV) · desktop agotado |
> | 6 | 8.8 → 9.1 | Fase 2 móvil |
> | 7 | 9.1 → 9.3 | Validación visual real · causa raíz de A-7 · **build roto desde P1** |
> | 8 | 9.3 → 9.5 | Fase 5: E-1, E-3, E-4, E-5, M-13 |
> | 9 | 9.5 → 9.6 | **Errores preexistentes:** 3 páginas rotas + 3 derivas del entorno de auditoría |
> | 10 | 9.6 → 9.7 | **E-2** (`localStorage`, decisión del usuario) · `/entregas/[id]/print` #418 resuelto · `/ppa` #418 investigado a fondo, sigue sin causa raíz |
>
> ### El patrón que domina este trabajo: el entorno de auditoría mintió tres veces
> 1. **C-1** — el seed insertaba un movimiento de inventario contradictorio → un falso Crítico.
> 2. **Pasada 6** — las capturas servían un build de antes de todos los cambios → validación falsa.
> 3. **Pasada 9** — el seed de capturas tenía un catálogo RBAC escrito a mano, desincronizado de `SYSTEM_PERMISSIONS`: le faltaban permisos y concedía uno inexistente.
>
> Y en los tres casos la herramienta **no avisaba**: el manifest marcaba `ok: true` con la página renderizando su error boundary, y un `catch` vacío se tragaba los fallos de modal. Ahora hay detección de errores de cliente, de scroll horizontal, guardia de paridad RBAC, invariante de seed y dos reglas ESLint. **La herramienta que valida el producto necesitaba validarse a sí misma.**
>
> ### Reglas añadidas para que lo corregido no vuelva
> `local/no-bare-to-locale` (hidratación) · `no-restricted-imports` para `sonner` · guardia de paridad RBAC en el seed · invariante `stockAfter = stockBefore + quantity` · detección de scroll horizontal · detección de errores de cliente · aviso en fallos de modal.

---

## 1. Matriz Impacto vs Esfuerzo

```
                        IMPACTO EN EL USUARIO
                 Alto                        Bajo
            ┌────────────────────────┬────────────────────────┐
            │  VICTORIAS RÁPIDAS     │  TAREAS MENORES        │
     Bajo   │  C-1  C-2  A-6  A-8    │  M-9  M-10  M-14       │
            │  A-3  M-3  M-5  M-8    │  B-1  B-2  B-3  B-4    │
  ESFUERZO  │  M-1  M-2  M-4  M-7    │  B-6                   │
            ├────────────────────────┼────────────────────────┤
            │  PROYECTOS CLAVE       │  SUMIDEROS DE TIEMPO   │
     Alto   │  A-1  A-2  A-4  A-5    │  M-6 (col. toggle sin  │
            │  A-7  M-12  M-15       │  demanda: retirar en    │
            │  E-1  E-2  E-3         │  vez de adoptar)        │
            └────────────────────────┴────────────────────────┘
```

**Observación clave:** los dos hallazgos Críticos son victorias rápidas — se corrigen en **~4 horas combinadas** y desbloquean el veredicto de producción. No hay justificación para diferirlos.

---

## 2. Fases

### ✅ Fase 0 — Desbloqueo de producción · COMPLETADA

Cierra los dos Críticos. Sin esto, la plataforma no puede declararse lista según la regla de ponderación no-promediada.

#### ❌ 0.1 · Signo en los movimientos de inventario `[C-1]` — CANCELADO, el hallazgo era falso

> **No se tocó `kardex-table.tsx`: no había nada que arreglar.** `inventoryMovements.quantity` es un delta con signo y los productores reales ya pasan `-input.quantity`; un egreso siempre rendea `−2`. El `+2` de la captura venía del **seed**, que insertaba filas directas saltándose `applyMovement`.
>
> **Lo que sí se hizo:** corregir el seed a `-2` y añadir la invariante `stockAfter === stockBefore + quantity`, que lanza antes de insertar. Un seed inconsistente ya no puede fabricar evidencia falsa.

<details><summary>Plan original (no aplicado)</summary>

`app/(app)/bodega/kardex-table.tsx`

```tsx
// ponytail: la magnitud se almacena positiva; la dirección la define el tipo
const OUTBOUND = new Set(["egreso_entrega", "egreso_desecho"])
const signedQty = (m: Movement) =>
  OUTBOUND.has(m.type) ? -Math.abs(m.quantity) : Math.abs(m.quantity)
```

Aplicar en la celda de escritorio (línea ~78) y en la tarjeta móvil (línea ~104). Renderizar `{q > 0 ? "+" : "−"}{Math.abs(q)}` manteniendo `MOVEMENT_QTY_CLASS` como refuerzo cromático redundante.

**Verificación obligatoria:** revisar `kardex-export-button.tsx` y el servicio de exportación — el archivo Excel descargado debe llevar el mismo signo, o el error simplemente se traslada al reporte contable.

**Test:** `expect(signedQty({type:"egreso_entrega", quantity:2})).toBe(-2)` y una aserción de render de que el egreso muestra `−2`.

</details>

#### ✅ 0.2 · Token de borde para controles `[C-2]` — APLICADO

`app/globals.css`, dentro de `@theme`:

```css
/* Límite de controles interactivos — WCAG 2.2 §1.4.11 exige ≥3:1.
   --color-border (1.27:1) queda reservado a hairlines decorativas y divisores. */
--color-border-control: oklch(0.660 0.005 90);  /* #93928f · 3.11:1 sobre blanco */
```

Sustituir `--color-border` → `--color-border-control` **sólo** en el borde por defecto de:
`components/ui/input.tsx` · `textarea.tsx` · `select-parts.tsx` · `checkbox.tsx` · `switch.tsx` · variante `secondary` de `button.tsx`.

**No tocar** los bordes de `TableRow`, `Card`, divisores ni separadores: son decorativos, están exentos y oscurecerlos rompería la dirección visual documentada en `DESIGN.md`.

> **✅ Aplicado con un valor más oscuro que el propuesto:** `oklch(0.640 0.005 90)` en vez de `0.660`. El test reveló que el fondo vinculante es `--color-surface-2` (= `--color-chrome`), no el blanco: sobre él, `0.660` rendía 2.89:1. El valor final da **3.36:1 sobre blanco y 3.12:1 sobre surface-2**.
>
> Migrados `input`, `textarea`, `select` (trigger), `date-picker` (trigger), `button` (`secondary`) y el track apagado de `switch` (rendía 1.59:1). Los estados hover/active/read-only se recalibraron para no quedar nunca más claros que el default.
>
> **`checkbox.tsx` NO se migró a propósito:** es un `<input type="checkbox">` nativo con `accent-color`, y el renderizado por defecto del agente de usuario está exento de 1.4.11.

**Verificación pendiente:** recapturar `desktop-solicitudes-nueva.png` y `mobile-solicitudes-nueva.png` para confirmar visualmente que los campos siguen leyéndose como un sistema coherente. **El cambio no se ha visto renderizado todavía** — sólo está verificado analíticamente.

#### ✅ 0.3 · Guardas de regresión — APLICADO, y encontró un defecto nuevo

[components/__tests__/design-tokens-contrast.test.ts](components/__tests__/design-tokens-contrast.test.ts) — **21 aserciones** que parsean `app/globals.css`, convierten OKLCH → sRGB → luminancia relativa y validan:

- texto sobre `surface` **y sobre `chrome`** (4.5:1)
- `-ink` sobre su `-tint` en las 7 familias semánticas (4.5:1)
- `border-control` sobre `surface` **y sobre `surface-2`** (3:1)
- que el hover del control nunca sea más claro que su estado por defecto
- blanco sobre los rellenos sólidos que sí se usan así (4.5:1)

**En su primera ejecución falló dos veces, ambas correctamente:** destapó que `border-control` no cumplía sobre `surface-2` y que `--color-text-faint` fallaba 4.32:1 sobre el chrome — este último un hallazgo que la auditoría original no tenía (C-3). Ambos corregidos.

---

### ✅ Fase 1 — Victorias rápidas de alto impacto · COMPLETADA (10 de 12; 2 reasignadas a Fase 2)

Todo lo de esta fase es un cambio localizado con efecto amplio.

| # | Acción | Estado | Resultado |
|---|---|---|---|
| 1.1 | `scope="col"` por defecto en `TableHead` `[M-5]` | ✅ | Prop con default `"col"`, sobrescribible con `"row"`. 579 cabeceras conformes con WCAG 1.3.1 |
| 1.2 | Cabecera de tabla sticky `[A-5]` | ⚠️ **Parcial** | **El plan era un no-op.** `overflow-x-auto` en `TableRoot` ya crea contenedor de scroll: el `<thead>` se ancla a él y, con altura automática, nunca hay rango donde fijarse. Implementado como `stickyHeader?: boolean` que añade `max-h-[70vh] overflow-y-auto`. **Falta activarlo tabla por tabla** |
| 1.3 | `<PriorityBadge>` unificado `[A-6]` | ✅ | [priority-badge.tsx](components/ui/priority-badge.tsx) nuevo. Escala monótona danger > warning > neutro, punto sólo en niveles severos. Eliminados `PRIORITY_LABEL` y `URGENCY_CLASS` locales |
| 1.4 | Jerarquía en Aprobaciones `[A-3]` | ✅ | "Aprobar" a `primary`, `gap-1.5` → `gap-2.5`. **Dos partes del hallazgo eran inexactas**: "Rechazar" ya era `ghost`, y el rechazo ya exigía motivo vía `ReasonForm` |
| 1.5 | Cuadrar el contador de aprobaciones `[A-8]` | ⏳ **Pendiente** | Requiere decidir si el badge y la página deben compartir scope o explicitar la diferencia. Es una decisión de producto, no un cambio mecánico |
| 1.6 | Un solo CTA primario en Dashboard `[M-8]` | ✅ | "Ver tareas" de relleno verde a enlace con hover en `primary-tint` |
| 1.7 | Barra de acciones única en el formulario de solicitud `[M-7]` | ⏳ **Pendiente** | `request-form.tsx` tiene cambios sin commitear de otra línea de trabajo; se difiere para no entrelazar diffs |
| 1.8 | `title` en todo `truncate`/`line-clamp` `[M-9]` | ⏳ **Pendiente** | Barrido transversal; se agenda junto a M-10 |
| 1.9 | Espaciado entre secciones a `space-6` `[M-4]` | ✅ | `mt-12` en `user-invitations-panel.tsx` |
| 1.10 | Migrar imports de `sonner` + regla ESLint `[M-11]` | ✅ | 2 imports migrados + `no-restricted-imports` con excepciones, **verificada con control positivo** |
| 1.11 | Regenerar la tabla de tokens de `DESIGN.md` `[M-14]` | ✅ | 50 tokens generados desde `globals.css` con hex derivado |
| 1.12 | Piso de 11px en `Badge` `[B-1]` | ✅ | Severidad 11/11/12px · prose 11/12/13px |

**Reasignados a la Fase 2:** 1.5 (A-8, decisión de producto) · 1.7 (M-7, conflicto con WIP) · 1.8 (M-9, barrido transversal).

---

### ✅ Fase 3-desktop — Consistencia y densidad · COMPLETADA (Pasada 2)

Ejecutada **antes** que la Fase 2 por prioridad de desktop.

| # | Acción | Estado | Resultado |
|---|---|---|---|
| 3.1 | Un solo estilo de cabecera de tabla `[M-1]` | ✅ | Utilidad `th-type` en `globals.css` como fuente única, aplicada en 14 archivos. No hubo que reescribir markup: el padding/alineación sigue siendo local. `(print)` exento |
| 3.2 | `TableCellNum` en columnas numéricas `[M-3]` | ⚠️ **Parcial + retractación** | **Kardex ya estaba correcto** (el hallazgo era falso). **Indicadores SST sí lo estaba**: 5 columnas de la tabla mensual + denominadores + comparación pasan a `text-right font-mono tabular-nums` |
| 3.3 | Badges `ACTIVO`/`Inactivo` con un solo tratamiento `[M-2]` | ✅ | Variante `neutral` nueva: tipografía de severidad, color neutro |
| 3.4 | Estado vacío de Indicadores SST `[A-4]` | ✅ | De **39 "No calculable" a 1**. Aviso único con qué falta, cuánto y CTA que abre el diálogo de denominadores en el primer mes sin datos |
| 3.5 | Auditar los 45 `EmptyState` sin `action` `[A-4]` | ⏳ **Pendiente** | No barrido |
| 3.6 | Migrar los 21 `<input type="date">` `[M-12]` | ⏳ **Pendiente** | 11 archivos de Prevención y Compras |
| 3.7 | Completar `loading.tsx` `[M-15]` | ⏳ **Pendiente** | 58 rutas |
| 3.8 | Decidir sobre `enableColumnToggle` `[M-6]` | ✅ | **Adoptado, no retirado.** Activo en las 7 tablas de ≥8 columnas |
| 3.9 | Animaciones bajo `prefers-reduced-motion` `[B-6]` | ✅ | `motion-safe:` en `Button` + bloque `@media` para drawer, toasts y `animate-in/out` |
| 3.10 | Adoptar `FilterToolbar` `[B-5]` | ⏳ **Pendiente** | Sigue en 2 de ~15 módulos |
| + | Cabecera sticky adoptada `[A-5]` | ✅ | 7 listados largos sin paginación |
| + | `scope="col"` en `<th>` crudos `[M-5]` | ✅ | 75 adicionales a los 579 de `TableHead` |
| + | Jerga "legado" `[M-10]` | ⚠️ **Parcial** | Indicadores limpio; queda `SUGERIDO: APRO SUMINISTROS` |
| + | `title` en truncados `[M-9]` | ⚠️ **Parcial** | Instancias citadas cerradas; quedan 113 sin barrer |

---

### ✅ Fase 3-desktop-II — COMPLETADA (Pasada 3)

| # | Acción | Estado | Resultado |
|---|---|---|---|
| a | Cuadrar contadores de aprobación `[A-8]` | ✅ | **Bug de una línea, no decisión de producto.** Badge filtraba `!= 'repuestos'`, página `NOT IN ('repuestos','servicios')`. Predicado único en [lib/approvals-queue.ts](lib/approvals-queue.ts) |
| b | Migrar `<input type="date">` `[M-12]` | ✅ | **0 nativos.** 21 a `DatePicker`; en facturas el `ref` imperativo del OCR pasó a estado controlado. `required` movido a `<Field>` (ver desviación 8) |
| c | Cerrar la fuga de `--color-border` `[C-2]` | ✅ | 24 controles crudos, incluido el buscador del TopBar |
| d | Badge `SUGERIDO` a peso neutro `[M-10]` | ✅ | De `warning` a `default` |
| e | Atajos de teclado `[M-13]` | ⚠️ **Parcial** | `/` enfoca el filtro, `Esc` lo limpia. Faltan `n` y `Enter` entre campos |
| f | Empty state de invitaciones `[A-4]` | ✅ | CTA condicionado al tipo de vacío — el patrón a replicar en los 77 restantes |

---

### ✅ Fase 3-desktop-III — COMPLETADA (Pasada 4)

| # | Acción | Estado | Resultado |
|---|---|---|---|
| a | Completar `loading.tsx` `[M-15]` | ✅ | **87/145 → 144/145 (99%).** 57 skeletons generados desde el `metadata` de cada página, densidad según tipo (4 filas detalle / 6 listado). Sin breadcrumb a propósito: el TopBar lo deriva de `NAV_ITEMS` |
| b | Barra de acciones del formulario de solicitud `[M-7]` | ✅ | Causa: `space-y-8` (32px) entre los dos `<form>`. `-mt-6` une las filas. Barra única literal descartada a propósito (ver desviación 9) |
| c | Barrer `EmptyState` sin CTA `[A-4]` | ⚠️ **Reencuadrado** | Clasificados los 77: **5 correctos como están** (vacío = buena noticia), **2 de filtro corregidos**, **64 requieren criterio caso a caso** y su severidad efectiva es Baja (ver desviación 10) |

---

### ✅ Fase 3-desktop-IV — COMPLETADA (Pasada 5) · desktop agotado

| # | Acción | Estado | Resultado |
|---|---|---|---|
| a | `title` en truncados `[M-9]` | ✅ | Aislados los **40 que son identificador de fila**; 39 corregidos, 1 descartado con motivo (`label` es `ReactNode`). Los otros 73 truncan texto secundario ya visible en la fila |
| b | CTA en vacíos de nivel página `[A-4]` | ✅ | `trazabilidad` (un solo `EmptyState` servía a dos vacíos → separado) y `pdtp/cobertura` (la descripción ya decía "crea el programa"; ahora es botón) |
| c | Adoptar `FilterToolbar` `[B-5]` | ❌ **Retractado** | La cifra "2 de ~15" era heredada, no medida. Real: 9 archivos; adquisiciones usa `ListFilters` por arquitectura y con ≤5 controles no necesita hoja de desbordamiento. **Sin acción** |

**Con esto el desktop no tiene defectos abiertos en ninguna severidad.**

---

### ✅ Fase 2 — Paridad móvil · COMPLETADA (Pasada 6)

> **✅ Cerrada.** Resultado por ítem:
>
> | Ítem | Estado | Nota |
> |---|---|---|
> | 2.1 Escala táctil `[A-2]` | ✅ | **El único ítem del plan que no necesitó corrección.** Además había 8 controles con altura fija en `className` que habrían anulado la escala |
> | 2.2 Tarjetas móviles `[A-1]` | ✅ | 3 tablas de terreno con tarjeta; 9 de configuración marcadas desktop-only. **No** se extrajo el `renderMobileCard` genérico: las 3 tarjetas comparten patrón visual, no estructura |
> | 2.3 Desbordamiento horizontal `[A-7]` | ✅ | Por endurecimiento: `overflow-x-clip` en `<main>` + detección automática que nombra al culpable y falla con `exitCode 1` |
> | 2.4 Filtros y export `[B-4, B-2]` | ✅ | `w-full sm:w-auto`; el export era un `<a>` crudo, no `ExportButton` |
> | + `[B-3]` | ✅ | Eyebrow "Tablero" a `hidden lg:block` |

El bloque original: el móvil está declarado como canal para aprobaciones y reportes en terreno y no lo sostenía.

#### 2.1 · Escala táctil responsiva `[A-2]` — *hacer esto primero, es una línea por variante*

`components/ui/button.tsx`:

```tsx
sm:      "h-11 px-3 text-xs sm:h-7",
default: "h-11 px-4 sm:h-8",
lg:      "h-11 px-5 text-[13px] sm:h-9",
icon:    "h-11 w-11 p-0 sm:h-8 sm:w-8",
```

`input.tsx` / `textarea.tsx` / `select-parts.tsx`: `h-9` → `h-11 sm:h-9`.

Resuelve los 541 `size="sm"` de golpe y vuelve redundantes los 12 `icon-mobile` (mantenerlos como alias hasta migrarlos). **Revisar visualmente** las barras de acción densas tras el cambio: algunas filas de iconos crecerán y necesitarán reflujo.

#### 2.2 · Tarjetas móviles en las tablas core `[A-1]`

Orden por criticidad de flujo:

1. `app/(app)/recepcion/recepcion-table.tsx` — hoy el botón "Recibir" queda fuera de pantalla
2. `app/(app)/compras/oc-list.tsx`
3. `app/(app)/prevencion/pdtp/acciones/acciones-table.tsx`
4. `app/(app)/combustibles/importar/*-history.tsx` (2 archivos)

Extraer primero un `renderMobileCard` genérico a partir del patrón ya probado en [bodega/kardex-table.tsx:90-120](app/(app)/bodega/kardex-table.tsx#L90-L120), para no escribir seis variantes distintas.

Las 6 tablas de `/admin` (roles, folios, EPP, taxonomía, catálogos, rate-limit) son configuración de escritorio: **marcar explícitamente como desktop-only** con un aviso en móvil es una respuesta legítima y más barata que portarlas.

#### 2.3 · Eliminar el desbordamiento horizontal `[A-7]`

1. Diagnosticar `/prevencion/evaluaciones` a 390px:
   `[...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > 390)`
2. Corregir el elemento identificado.
3. Salvaguarda de sistema: `overflow-x-clip` en el `<main>` de `app-shell.tsx`.
4. Regresión permanente: extender el script de capturas para que **falle** si `document.scrollWidth > viewport.width` en cualquier ruta. Esta auditoría detectó el problema comparando anchos de PNG — automatizarlo cuesta 10 líneas.

#### 2.4 · Ancho completo de filtros y buscadores bajo `sm:` `[B-4]` y tratamiento de `ExportButton` `[B-2]`

---

### Fase 3 — Consistencia y densidad · ✅ CERRADA

Ejecutada en cuatro tandas (Fase 3-desktop I–IV). Residuos que quedan **por criterio, no por falta de tiempo**:

| Residuo | Por qué no se cierra mecánicamente | Severidad efectiva |
|---|---|---|
| 61 `EmptyState` sin CTA | Son paneles de workbench cuya acción vive en el `PageHeader`; añadirla ahí infringe la regla 5 de layout | Baja |
| 73 truncados sin `title` | Truncan texto secundario que ya aparece completo en la fila; `title` sería ruido de lector de pantalla | Baja |
| `n` y `Enter` de M-13 | `n` necesita saber "qué crear" por ruta; `Enter` entre campos es E-5 | Mejora |

---

### ✅ Fase 5 — Roadmap de productividad · COMPLETADA (Pasada 8 + E-2 en Pasada 10)

| Propuesta | Estado | Nota |
|---|---|---|
| **E-1** Densidad Compacto/Cómodo | ✅ | Preferencia compartida entre tablas; `data-density` en CSS porque las filas las renderiza el consumidor. Visible desde 8 filas |
| **E-3** Acciones en lote | ✅ | Selección cruzando solicitudes; `bulkApproveRequestAction` **ya validaba por ítem**, sólo faltaba UI. Barra `sticky`, no `fixed` (ver nota) |
| **E-4** Columna congelada | ✅ | Opt-in en las 7 tablas de ≥8 columnas; divisor con `::after` porque el sticky rompe `border-collapse` |
| **E-5** `Enter` entre campos | ✅ | Hook con 4 tests. El test destapó que `offsetParent` habría inutilizado el hook dentro de diálogos |
| **M-13** atajo `n` | ✅ | Opt-in por página. Un `n` global que adivinara el botón primario habría disparado "Aprobar todos" en Aprobaciones |
| **E-2** Vistas guardadas | ✅ | **Pasada 10 — decisión: `localStorage`**, por dispositivo. Hook + `Popover` UI + 7 tests, integrado en `ListFilters` (Solicitudes/Compras/Aprobaciones/Recepción) |

---

### ✅ Pasada 9 — Errores preexistentes

| Error | Estado | Nota |
|---|---|---|
| `<SelectItem value="">` (Radix lanza) | ✅ | 5 sitios; el de `FilterSelect` rompía **7 páginas de combustibles** |
| `toLocaleString()` sin locale → React #418 | ✅ | 5 sitios + **regla ESLint** que lo impide |
| Permiso cruzado sin guardar en `/trazabilidad/trabajador` | ✅ | El dashboard ya lo guardaba; la página no |
| Seed de capturas con RBAC a mano y desincronizado | ✅ | Derivado de `SYSTEM_PERMISSIONS` + guardia de paridad |
| `catch` que se tragaba fallos de modal | ✅ | Ahora avisa |
| Variable muerta `allReturned` | ✅ | — |
| Archivo de 0 bytes trackeado con nombre roto | ✅ | Eliminado, sin stagear |
| React #418 en `/entregas/[id]/print` | ✅ **Resuelto en Pasada 10** | Causa: `<html>` propio duplicando el del root layout. Fragment + `generateMetadata`, igual que las rutas print hermanas |
| React #418 en `/ppa` | ⏳ **Investigado a fondo en Pasada 10, sigue sin causa raíz** | HTML anidado, `navigator.onLine` y `notifPermission` descartados con evidencia; producción no calcula diagnóstico de hidratación (confirmado por `grep` en el bundle); stack resuelto con sourcemaps cae íntegro en React interno. Siguiente paso: bisección del JSX de `PpaForm`, no ejecutada |

---

### ✅ Pasada 10 — E-2 y uno de los dos #418

| Ítem | Estado | Nota |
|---|---|---|
| E-2 vistas guardadas | ✅ | `localStorage`, decisión del usuario. Ver Fase 5 arriba |
| `/entregas/[id]/print` #418 | ✅ | Causa raíz confirmada y arreglada. Ver fila arriba |
| `/ppa` #418 | ⏳ | Sigue abierto; techo técnico documentado, no falta de esfuerzo |
| Verificación | ✅ | `tsc` limpio · ESLint 0 · 3012/3012 tests (+7) · 159/159 rutas recapturadas contra build fresco · confirmado por recaptura que `/entregas/[id]/print` ya no aparece en la lista de errores |

---

### Fase 4 — Verificación que esta auditoría no pudo hacer · ~3 días

Cuatro pruebas requieren sesión interactiva y quedaron declaradas como no verificadas:

1. **Recorrido completo por teclado** — `Tab` puro sobre los 5 flujos críticos (solicitud → aprobación → OC → recepción → entrega). Buscar trampas de foco, orden ilógico y anillos invisibles.
2. **Lector de pantalla** (NVDA o VoiceOver) sobre los mismos flujos: verificar que cada control anuncie nombre, rol y estado.
3. **Zoom al 200%** en las 10 pantallas más densas — WCAG 1.4.4.
4. **Latencia percibida** — confirmar respuesta visual <100ms tras cada clic; identificar acciones sin feedback inmediato.

Estas pruebas suelen aportar hallazgos que ni el código ni las capturas revelan.

---

### Fase 5 — Roadmap · tabla original (estado real arriba)

Ninguna es un defecto; todas elevan la velocidad operativa del usuario diario.

| Propuesta | Beneficio |
|---|---|
| **E-1** Selector de densidad Compacto/Cómodo | ~60% más filas por pantalla para el operador de bodega |
| **E-3** Acciones en lote en Aprobaciones ("Aprobar 12 ítems") | Colapsa N decisiones en 1 |
| **E-2** Vistas guardadas (filtros + columnas) | Elimina la reconfiguración diaria |
| **E-4** Columna congelada en tablas de ≥8 columnas | Contexto de fila al hacer scroll horizontal |
| **E-5** Navegación por `Enter` entre campos en captura repetitiva | Cero viajes al ratón en entregas y recepción |
| **M-13** Atajos de teclado más allá de ⌘K (`/`, `n`, `Esc`) | Heurística #7 |

---

## 3. Impacto proyectado

| Dimensión | Inicial | P1 | P2 | P3 | **P4 (real)** | Proy. tras Fase 2 (móvil) |
|---|---|---|---|---|---|---|
| Accesibilidad (WCAG) | 5.5 | 8.0 | 8.5 | 9.0 | **9.0** ✅ | 9.0 |
| Responsividad | 5.5 | 5.5 | 5.5 | 5.5 | 5.5 — | **8.5** |
| Jerarquía Visual | 6.5 | 8.0 | 8.0 | 8.5 | **9.0** ✅ | 9.0 |
| Usabilidad | 7.0 | 7.5 | 8.0 | 8.5 | **8.5** ✅ | 8.5 |
| Consistencia Visual | 7.5 | 8.0 | 8.5 | 9.0 | **9.0** ✅ | 9.0 |
| Feedback de Estado | 7.5 | 7.5 | 7.5 | 7.5 | **9.0** ✅ | 9.0 |
| Calidad de Componentes | 8.0 | 8.5 | 9.0 | 9.0 | **9.0** ✅ | 9.0 |
| **Preparación para Producción** | **4.0** | 7.0 | 7.5 | 8.0 | **8.0** | 9.0 |
| **Global** | **7.1** | **7.8** | **8.2** | **8.5** | **8.7** | **9.0** |

**Las siete dimensiones de desktop alcanzaron su proyección de fin de plan**, porque se cerraron en el design system y no caso por caso. **Responsividad sigue clavada en 5.5**: es el único techo real de la nota global, y por decisión explícita se aborda al final.

---

## 4. Criterios de aceptación

**Fase 0 — ✅ CERRADA:**
- [x] Un egreso de bodega muestra `−N` — *ya era el comportamiento real; se corrigió el seed que lo contradecía*
- [x] Todo borde de control rinde ≥3:1 contra su fondo, verificado por test automatizado (21 aserciones)
- [x] Ningún hallazgo Crítico permanece abierto

**Fase 1 — ✅ CERRADA (10/12; 3 ítems reasignados a Fase 2):**
- [x] `tsc --noEmit` limpio · 45/45 tests · ESLint sin errores nuevos
- [x] Un solo tratamiento de prioridad en toda la aplicación
- [x] La bandeja de aprobación tiene acción primaria
- [x] `DESIGN.md` deja de contradecir a `globals.css`
- [ ] **Pendiente de verificación visual:** ninguno de los cambios se ha visto renderizado. Recapturar antes de dar la fase por buena

**Fase 3-desktop — ✅ CERRADA (Pasada 2):**
- [x] Un solo estilo de cabecera de tabla en toda la aplicación (`th-type`)
- [x] Cero columnas numéricas mal alineadas en Indicadores SST
- [x] Indicadores SST pasa de 39 "No calculable" a 1 aviso con CTA
- [x] `prefers-reduced-motion` cubierto
- [x] 3001/3001 tests
- [ ] **Pendiente de verificación visual:** dos pasadas de cambios sin recapturar

**Fase 3-desktop-II — ✅ CERRADA (Pasada 3):**
- [x] Cero `<input type="date">` nativos
- [x] Cero controles de formulario con borde bajo 3:1 (verificado por `grep`, no sólo en `components/ui/`)
- [x] Badge de aprobaciones y página derivan del mismo predicado
- [x] 3001/3001 tests
- [ ] **Pendiente de verificación visual:** tres pasadas sin recapturar

**Fase 3-desktop-III — ✅ CERRADA (Pasada 4):**
- [x] `loading.tsx` en 144/145 rutas
- [x] El CTA del formulario de solicitud deja de flotar fuera de la tarjeta
- [x] Los `EmptyState` clasificados; los que estaban mal, corregidos
- [x] 3001/3001 tests
- [ ] **Pendiente de verificación visual:** cuatro pasadas sin recapturar

**Fase 3-desktop-IV — ✅ CERRADA (Pasada 5):**
- [x] Todo truncado que sea identificador de registro es recuperable con `title`
- [x] Todo `EmptyState` de nivel página tiene salida clicable
- [x] B-5 medido y retractado
- [x] 3001/3001 tests
- [ ] **Pendiente de verificación visual:** cinco pasadas sin recapturar

**Fase 2 (móvil) — ✅ CERRADA (Pasada 6):**
- [x] El script de capturas **detecta y reporta** el scroll horizontal, nombrando al culpable, y falla con `exitCode 1`
- [x] Todo control interactivo mide ≥44px de alto bajo el breakpoint `sm`
- [x] Recepción y Compras son operables íntegramente en 390px, incluida la acción principal
- [ ] **Pendiente de verificación visual:** seis pasadas sin recapturar — ver §"riesgo abierto" en la auditoría

**Fase 3 cerrada cuando:**
- [ ] Un solo estilo de cabecera de tabla en toda la aplicación
- [ ] Cero columnas numéricas alineadas a la izquierda
- [ ] Todo `EmptyState` tiene CTA o una justificación registrada
- [ ] Cero `<input type="date">` nativos

---

## 5. Nota de método

Este plan **no propone rediseñar** la plataforma. La dirección visual, la arquitectura de información y el sistema de tokens son sólidos y están por encima del promedio del sector; el propio equipo ya cerró los dos hallazgos estructurales de las auditorías previas (`<select>` nativo y `form-kit` duplicado, ambos ahora en 0).

Lo que falta es **aplicar de forma pareja las reglas que el proyecto ya escribió**. Las reglas A1–A6 de `AGENTS.md` son correctas; se cumplen en los módulos nuevos y se degradan en Prevención y Combustibles. Buena parte de este plan consiste en mover esas reglas del documento al componente compartido, donde se cumplen solas: `scope="col"` dentro de `TableHead`, la escala táctil dentro de `buttonVariants`, el signo dentro del selector de cantidad. Un cambio en el design system corrige cientos de instancias; cientos de correcciones caso por caso se vuelven a romper.
