# Plan de migración visual de Chome inspirado en `referencia/` (Dashboard 6)

Fecha del análisis: 26 de julio de 2026
Alcance de este documento: análisis estático, de configuración y de la carpeta
local `referencia/`. No se instaló `@efferd/dashboard-6`, no se añadió un
registro, no se modificó la aplicación y no se leyó ni expuso ningún secreto.

## 1. Resumen ejecutivo

La integración es técnicamente posible, pero **no es recomendable instalar el
bloque completo directamente en Chome**. El proyecto ya tiene un App Router,
Tailwind v4, TypeScript, Radix UI, una utilidad `cn`, componentes compartidos y
gráficos Recharts, por lo que la base técnica no impide usar código distribuido
por shadcn. Sin embargo, aún no existe `components.json`; el sistema visual de
Chome no usa los tokens canónicos de shadcn; la iconografía es Phosphor, no
Lucide; y el dashboard actual es un centro operacional con autorización y
alcance por faena, no un tablero financiero de demostración.

`dashboard-6` es un bloque **Pro** de Efferd y se describe como un resumen
financiero con barra de fecha, KPIs, gráfico MRR, presupuestos, pedidos y una
lista de atención. Esa composición puede inspirar la jerarquía de algunas
secciones, pero sus datos, nomenclatura y prioridad visual no son un reemplazo
directo del trabajo operacional de Chome. Fuente externa consultada:
[Efferd Dashboard Blocks](https://efferd.com/blocks/dashboard).

La alternativa recomendada originalmente era:

1. Inspeccionar el bloque primero en un proyecto temporal con una licencia Pro
   válida y un token efímero.
2. Inventariar archivos, dependencias, licencia y datos de demostración sin
   permitir sobrescrituras.
3. Usar el bloque como referencia y, si aporta una mejora concreta, adaptar
   manualmente sólo la estructura de una sección al dashboard actual usando los
   componentes y servicios de Chome.
4. Mantener intactos los contratos funcionales del AppShell, navegación,
   permisos, alcance por faena y fuentes de datos reales.

La conveniencia de instalar el bloque completo es **6/10**: el valor de
referencia visual es real, pero no compensa hoy el coste de adaptación, riesgo
de doble design system y desalineación funcional.

### Actualización de alcance: migración visual global

Se aprobó una dirección distinta a la integración literal de `dashboard-6`:
**Chome debe parecerse al lenguaje visual del dashboard de referencia, incluidos
sidebar y header, sin instalar ni copiar el bloque como producto terminado.**
Esta decisión reemplaza cualquier recomendación anterior de inspeccionar el
registro de Efferd como primer paso obligatorio.

La migración sí abarca visualmente `AppShell`, `DesktopNav`, `MobileNav` y
`TopBar`, pero conserva sus contratos actuales: navegación derivada de
`modules/registry`, permisos y feature toggles, búsqueda contextual, chip de
faena, notificaciones, command palette, responsive y accesibilidad. No se
creará un segundo shell ni se cambiarán rutas, RBAC, servicios o datos para
imitar una demo financiera.

La primera fase de implementación será el **shell visual**: composición del
rail/panel, jerarquía de navegación, superficies, bordes, densidad, estados
activos y cabecera. El dashboard y el resto de páginas adoptarán después ese
lenguaje de manera progresiva. Efferd queda como referencia visual opcional,
no como dependencia, requisito comercial ni fuente de componentes.

### Patrones comprobados en `referencia/`

La carpeta local ya entrega suficiente evidencia visual para decidir el primer
slice; no hay que esperar el registro Pro ni reproducir Dashboard 6 de forma
literal. Sus archivos son una **muestra de composición**, no una fuente de
datos, navegación ni arquitectura para Chome.

| Fuente local | Patrón útil comprobado | Traducción obligatoria a Chome | No trasladar |
| --- | --- | --- | --- |
| `referencia/Dashboard6.tsx` | Shell de tres zonas: navegación izquierda, barra de controles y contenido en grilla de 12 columnas con principal y lateral. | Reordenar visualmente `AppShell`, `DesktopNav` y `TopBar` sobre sus datos actuales; en dashboard usar una grilla principal/lateral sólo donde aclare prioridades. | Navegación ficticia, selector “Efferd LLC”, usuario demo, `activeTab` local, rutas `#` y textos financieros. |
| `referencia/components/dashboard-6/stats.tsx` | Tres métricas compactas dentro de una única superficie, con etiqueta pequeña, cifra prominente y comparación breve. | Mantener el máximo Chome de cuatro KPIs accionables y usar una tira compacta o una superficie agrupada con números reales y navegables. | Tasas, pedidos o deltas de muestra; un KPI que no produzca decisión/CTA. |
| `referencia/components/dashboard-6/mrr-chart.tsx` | Tarjeta de gráfico contenida: resumen arriba, delta contextual, ejes discretos, tooltip y altura estable. | Aplicar la jerarquía a una tendencia operacional que tenga fuente, período, scope y semántica definidos; reutilizar Recharts ya instalado. | MRR, colores Slate fijados, datos hardcodeados y el tooltip financiero. |
| `referencia/components/dashboard-6/right-cards.tsx` | Columna secundaria breve para lectura de apoyo, con microvisualización y CTA visible. | Usarla, si corresponde, para alertas, cumplimiento o próximas acciones reales de la faena actual. | Gauge de ingresos, barras generadas con `Array.from`, porcentajes simulados y CTAs sin destino. |
| `referencia/official_efferd_components/dashboard_{1..5}` | Variantes de métricas en grillas con bordes continuos, baja elevación, tipografía numérica tabular y breakpoints progresivos. | Adoptar ritmo de grilla, bordes y densidad con tokens de Chome; conservar la semántica de cada estado. | Copiar componentes, imports o el sistema de tokens externo. |
| `referencia/index.html` y `assets/css/` | Captura estática con fuentes y una interacción de gráfico visible. | Tomar sólo la intención de feedback puntual en gráficos, mediante componentes React accesibles y mantenibles. | Script que muta SVG/DOM, fuentes embebidas, clases `dark:` y variables globales de terceros. |

El contrato visual derivado queda así:

1. **Shell:** una navegación izquierda continua y más compuesta, no una
   sidebar nueva. La marca, faena, destinos y usuario siguen viniendo de los
   contratos actuales.
2. **Cabecera:** controles compactos sobre una superficie limpia; breadcrumb,
   búsqueda contextual, faena, notificaciones y menú de usuario permanecen en
   `TopBar`. Un período sólo aparece cuando controla datos reales de la página;
   no se agrega una segunda búsqueda.
3. **Superficies:** fondo claro, borde fino, radio medio y sombra mínima para
   separar grupos funcionales. Los tokens actuales de Chome prevalecen sobre
   `slate`, `dark:` o cualquier fuente de `referencia/`.
4. **Densidad operacional:** una grilla de 12 columnas puede componer el
   dashboard en escritorio; en pantallas menores se reduce a una columna sin
   perder la acción prioritaria. No se convierte cada dato en una tarjeta.
5. **Números y tendencias:** cifras tabulares, comparación temporal explícita y
   color semántico según el dominio. Un descenso puede ser favorable en backlog
   y desfavorable en cumplimiento, por lo que no se hereda el verde/rojo
   genérico de la demo.

## 2. Estado actual del proyecto

| Aspecto | Hallazgo comprobado | Evidencia |
| --- | --- | --- |
| Framework y compilación | Next.js 16.2.10 instalado, con `next build` y salida `standalone`. | `package.json`, `package-lock.json`, `next.config.ts` |
| Lenguaje | TypeScript estricto con alias `@/* -> ./*`. | `tsconfig.json` |
| Gestor de paquetes | npm, lockfile v3 (`package-lock.json`). | `package-lock.json`, scripts de `package.json` |
| Routing | App Router por sistema de archivos: grupos `(auth)`, `(app)` y `(print)`. | `app/`, `app/(app)/layout.tsx` |
| Arquitectura frontend | Server Components para obtención y autorización, Client Components para interacción local; servicios en `lib/services`, auth y scope en `lib/auth`. | `app/(app)/dashboard/page.tsx`, `app/(app)/layout.tsx`, `lib/auth/` |
| Estado cliente | Contexto de cabecera/búsqueda, React local y TanStack Query. No se detectó Zustand, Redux ni Jotai. | `components/layout/header-context.tsx`, `components/providers/query-provider.tsx` |
| Estilos | Tailwind CSS 4 CSS-first, `tw-animate-css`, tokens propios en OKLCH. No hay un `tailwind.config.*` en la raíz. | `app/globals.css`, `postcss.config.mjs`, `package.json` |
| Componentes | Sistema propio sobre Radix UI, CVA, `clsx` y `tailwind-merge`. | `components/ui/`, `components/ui/button.tsx`, `lib/utils.ts` |
| Iconos | Phosphor es el único set de iconos usado por la aplicación: 278 archivos lo importan; no se detectó `lucide-react`. | `package.json`, imports bajo `app/`, `components/` y `lib/` |
| Gráficos | Recharts 3.9.0 se usa en Analítica, Prevención y Combustibles. | `package.json`, `app/(app)/analitica/analytics-charts.tsx`, `app/(app)/combustibles/fuel-charts.tsx` |
| Tema | Diseño explícitamente claro (`color-scheme: light`), sin proveedor de tema ni modo oscuro soportado como sistema. | `app/globals.css:143-160`, `DESIGN.md` |
| Seguridad UI | CSP con nonce y `strict-dynamic` en producción; cabeceras adicionales en Next. | `lib/security/csp.ts`, `next.config.ts` |

### Layouts y navegación

Las rutas autenticadas pasan por `app/(app)/layout.tsx`: resuelve sesión,
permisos, faena primaria, conteos autorizados y módulos habilitados. Luego
monta `AppShell` dentro de proveedores de sesión y query. `AppShell` implementa
el shell completo en `components/layout/app-shell.tsx`:

- rail y panel lateral de escritorio (`desktop-nav.tsx`);
- drawer/accordion de navegación móvil (`mobile-nav.tsx`);
- pozo de contenido blanco con scroll propio;
- `TopBar` sticky, breadcrumb, chip de faena, búsqueda contextual,
  notificaciones y menú de usuario;
- paleta de comandos global cargada de forma diferida.

La navegación se deriva del registry de módulos, no de un menú local de una
página. `components/layout/nav-items.ts` filtra por permisos, feature toggles y
elige el href registrado más específico para el estado activo. Reemplazar o
añadir una sidebar desde un bloque externo rompería esa fuente de verdad.

### Dashboard existente

`app/(app)/dashboard/page.tsx` es un Server Component que obtiene sesión,
permisos y alcance de faena antes de cargar en paralelo datos de solicitudes,
cola operacional, actividad, stock, EPP, métricas mensuales, backlog y PDTP.
Los datos que llegan al cliente ya están filtrados por el rol y el alcance
autorizado.

`dashboard-control-center.tsx` ofrece hoy:

- hasta cuatro indicadores accionables, respetando permisos;
- tiras compactas de flujo mensual y backlog comparado;
- alertas operacionales con rutas de resolución;
- cola de trabajo con filtros de módulo, faena, prioridad, estado y orden;
- búsqueda tomada del `TopBar`, filtros rápidos y estados vacíos accionables;
- bloque PDTP, actividad reciente y tabla de actividad/costos por faena.

El máximo de cuatro KPI y la separación entre búsqueda global y filtros
estructurados son decisiones expresas del producto. También existen `loading.tsx`
con skeletons, `error.tsx` con recuperación y `EmptyState` para ausencia de
datos. Las pruebas de `dashboard-control-center` y `pdtp-compliance-card`
cubren parte del comportamiento local.

## 3. Evidencias encontradas

Las rutas siguientes se inspeccionaron directamente y son las referencias que
deben usarse para una futura implementación:

| Área | Archivos reales relevantes |
| --- | --- |
| Configuración y dependencias | `package.json`, `package-lock.json`, `tsconfig.json`, `postcss.config.mjs`, `next.config.ts`, `.gitignore` |
| Tokens, fuentes y tema | `app/globals.css`, `app/layout.tsx`, `PRODUCT.md`, `DESIGN.md` |
| Shell y navegación | `app/(app)/layout.tsx`, `components/layout/app-shell.tsx`, `components/layout/desktop-nav.tsx`, `components/layout/mobile-nav.tsx`, `components/layout/top-bar.tsx`, `components/layout/nav-items.ts` |
| Dashboard | `app/(app)/dashboard/page.tsx`, `dashboard-control-center.tsx`, `metric-bar.tsx`, `pdtp-compliance-card.tsx`, `recent-activity.tsx`, `quick-actions.tsx`, `loading.tsx`, `error.tsx` |
| Referencia visual local | `referencia/Dashboard6.tsx`, `referencia/components/dashboard-6/{stats,mrr-chart,right-cards}.tsx`, `referencia/official_efferd_components/dashboard_{1..5}/`, `referencia/index.html`, `referencia/assets/css/` |
| Primitivas reutilizables | `components/ui/button.tsx`, `card.tsx`, `select.tsx`, `date-picker.tsx`, `date-range-picker.tsx`, `empty-state.tsx`, `skeleton.tsx`, `table.tsx`, `summary-bar.tsx`, `page-container.tsx`, `page-header.tsx` |
| Datos, scope y permisos | `lib/auth/auth.ts`, `lib/auth/can.ts`, `lib/auth/scope.ts`, `lib/services/dashboard.ts`, `lib/services/operational-work-queue.ts`, `lib/services/operational-period-metrics.ts` |
| Calidad y secretos | `scripts/check-env-files.ts`, `lib/security/csp.ts`, `components/__tests__/design-tokens-contrast.test.ts` |

La comprobación de configuración no encontró `components.json`; no encontró
referencias ni valor disponible de `EFFERD_REGISTRY_TOKEN`; y confirmó que
`.env.local` está ignorado mientras `.env.example` es el único archivo de
entorno trackeado. No se imprimieron valores de ninguna variable.

## 4. Compatibilidad con shadcn (contingencia: sólo si se importa código)

### Veredicto: compatible con ajustes menores de infraestructura

La aplicación es compatible con el modelo de shadcn, pero no es un proyecto
shadcn inicializado. La compatibilidad no equivale a que un bloque externo se
integre visualmente sin adaptación.

| Requisito | Estado | Implicación |
| --- | --- | --- |
| `components.json` | Ausente. | Debe definirse de forma consciente en una futura rama; no inicializar a ciegas el proyecto actual. |
| Alias de imports | Presente: `@/*`. | Compatible. |
| Tailwind | Tailwind 4 CSS-first con PostCSS. | Compatible, pero el generador debe apuntar a `app/globals.css` sin reescribirlo. |
| Variables CSS | Presentes, pero con nombres `--color-*`, no el vocabulario canónico de shadcn. | Riesgo alto de apariencia incorrecta para un bloque que espere tokens de shadcn. |
| `cn` | Presente, compuesta con `clsx` y `tailwind-merge`. | Compatible. |
| Directorio de UI | `components/ui/` contiene más de 40 primitivas propias. | No debe ser reemplazado por equivalentes generados. |
| Radix UI | Ocho primitivas Radix directas, incluidas dialog, select, tabs y tooltip. | Compatible, pero revisar versiones transitivas del bloque. |
| CVA | Ya está instalado. | Compatible con patrones shadcn. |
| Iconos | Chome usa Phosphor; la página de Efferd muestra Radix UI y Lucide como configuración del bloque. | Requiere traducción/configuración de iconos o introducir una dependencia que hoy sería redundante. |
| Tema | Claro y deliberadamente fijo. | No aceptar un toggle dark ni estilos `dark:` globales desde el bloque. |

La documentación actual de shadcn permite registros con namespace y headers de
autorización, incluidas sustituciones desde variables de entorno. El comando
`add` declara `--dry-run`, `--view`, `--diff` y `--overwrite`; este último es
falso por defecto y nunca debe habilitarse en la primera inspección. Referencias:
[registries de shadcn](https://ui.shadcn.com/docs/registry/namespace) y
[CLI de shadcn](https://ui.shadcn.com/docs/cli).

### Conflicto de design system

El riesgo principal no es React ni Tailwind, sino semántico y visual. Chome
define colores, radios, elevación, tipografías, focus, targets táctiles y
movimiento reducido en `app/globals.css`. Un bloque estándar puede asumir
variables como `--background`, `--foreground`, `--card`, `--muted` y
`--primary`, además de tipografía e iconos distintos. No se debe normalizar todo
`globals.css` para acomodar un bloque. Si tras la inspección se justifica usar
una pieza, el mapeo de tokens debe quedar acotado a esa pieza o su adaptador.

## 5. Requisitos de Efferd (contingencia: sólo si se importa código)

### Confirmados

- `dashboard-6` aparece como bloque **Pro** de Efferd. La compra Pro vigente y
  acceso al registro son prerrequisitos comerciales. La página de precios
  declara licencia comercial y acceso a los bloques Pro, pero la licencia exacta
  aplicable debe revisarse en los términos de la cuenta antes de incorporar
  código. [Precios de Efferd](https://efferd.com/pricing)
- Efferd documenta instalación mediante el CLI de shadcn con namespace
  `@efferd`. [Documentación de Efferd](https://efferd.com/docs)
- El formato de URL propuesto por la solicitud,
  `https://efferd.com/r/{style}/{name}.json`, contiene un parámetro `style`.
  Debe identificarse el estilo concreto desde la cuenta Pro antes de cualquier
  comparación de archivos.

### Pendientes o no verificables sin acceso Pro

- El token no está configurado en el proceso actual ni referenciado en archivos
  de entorno del proyecto.
- No se pudo inspeccionar el manifiesto autenticado de `dashboard-6`; por tanto,
  no es posible afirmar los archivos exactos, dependencias transitivas, iconos,
  licencia del código generado o datos mock que entregaría.
- La página pública indica soporte general de distintos sets de iconos, pero el
  selector visible de la categoría menciona Radix UI y Lucide. Hay que confirmar
  que el payload particular pueda salir con Phosphor antes de añadir
  `lucide-react`.

### Manejo seguro del token

En Next.js las variables sin prefijo `NEXT_PUBLIC_` quedan del lado servidor;
las que sí lo llevan se incrustan en el bundle del navegador. El token debe
llamarse exactamente `EFFERD_REGISTRY_TOKEN`, nunca `NEXT_PUBLIC_*`, y no debe
importarse desde Client Components. En desarrollo, `.env.local` es el archivo
local habitual; en producción debe existir sólo en el secret store o entorno de
CI que ejecute la inspección. La prioridad de carga y el límite de exposición
fueron contrastados con la documentación de Next.js 16.2.9.

El token sería de instalación/consulta del registro, no de runtime de la
aplicación, **sólo si** no se conserva en código cliente, `next.config.ts`,
datos serializados o logs. El header de autorización se envía a Efferd al
resolver el registry; eso es intencional, pero confirma que el origen y el
payload deben revisarse antes de aceptar código.

## 6. Compatibilidad visual y funcional

### Encaje

| Área del bloque | Encaje en Chome | Decisión recomendada |
| --- | --- | --- |
| Barra de período | Útil si filtra una métrica operacional real. Chome ya tiene `DatePicker` y `DateRangePicker`. | Adaptar con las primitivas existentes; no copiar un control de fecha externo. |
| KPI | Chome ya muestra como máximo cuatro indicadores accionables, filtrados por permisos. | Reutilizar la jerarquía, no crear otro muro de tarjetas. |
| Gráfico principal | Podría servir para tendencia de backlog, cumplimiento PDTP, costos autorizados o flujo de solicitudes. | Usar Recharts y servicios existentes, después de definir una pregunta operacional. |
| Presupuestos/finanzas | El bloque es financiero; Chome no debe simular presupuesto o MRR sin fuente, definición y permiso. | No integrar como contenido hasta tener contrato de datos y criterio de negocio. |
| Lista de atención | Tiene equivalente directo en alertas y cola de trabajo actuales. | Conservar `DashboardControlCenter` y mejorar composición sólo si la comparación lo justifica. |
| Tabla/pedidos | Hay DataTable, Table, búsqueda de cabecera, scope y adaptación móvil. | No sustituir. |
| Header/sidebar | El shell existente concentra sesión, faena, permisos, toggles y navegación. | Migrar su apariencia de forma global y progresiva; conservar los contratos y fuentes de verdad actuales. |

### Identidad visual

Chome busca una interfaz serena, rigurosa y operativa: superficie blanca dentro
de chrome tenue, verde esmeralda para acción/foco, naranja sólo para pendientes,
tipografía Exo/Myriad/Geist Mono y alta densidad útil. La carpeta
`referencia/` confirma que el efecto buscado procede sobre todo de composición,
borde fino, radio consistente, sombras muy moderadas y jerarquía tipográfica;
no de sus colores Slate, modo oscuro, Lucide, fuentes incluidas ni nomenclatura
financiera. Copiar esos elementos degradaría la consistencia.

La adaptación aceptable conserva:

- `PageHeader` y la información de faena del `TopBar`;
- cuatro o menos KPIs que naveguen o filtren una acción real;
- números en mono con `tabular-nums` y semántica de colores existente;
- filtros estructurados, búsqueda desde cabecera y estados vacíos actuales;
- foco visible, teclado, 44 px en controles táctiles y `prefers-reduced-motion`;
- el modo claro actual, sin activar un tema paralelo.
- una columna secundaria sólo cuando aporta una alerta, decisión o CTA real; no
  como relleno visual ni resumen financiero.

### Responsive y accesibilidad

El shell actual ya colapsa a drawer en móvil; las tablas cuentan con scroll
local, primera columna fija cuando corresponde y representación móvil en
`DataTable`. Cualquier pieza futura debe probarse dentro de ese shell, no en un
viewport aislado. Un preview de Efferd no demuestra compatibilidad con roles,
faenas, lectores de pantalla, foco, idiomas ni datos largos de Chome.

## 7. Impacto técnico y archivos potencialmente afectados

No se puede listar el output exacto del bloque sin el manifiesto Pro. La lista
siguiente mezcla archivos existentes que una integración podría afectar con
artefactos de configuración previstos; los elementos no existentes se etiquetan
explícitamente como futuros.

| Riesgo/área | Rutas reales afectables | Condición |
| --- | --- | --- |
| Configuración shadcn | `components.json` (hoy inexistente), `package.json`, `package-lock.json` | Crear o modificar sólo después de aprobar el inventario temporal. |
| Token | `.env.local` local o secret store de CI; `.env.example` sólo con placeholder si se documenta. | Nunca commitear un valor. |
| Estilos | `app/globals.css` | No tocar globalmente para emular el tema del bloque. Un cambio debe ser excepcional, tokenizado y probado. |
| Dashboard | `app/(app)/dashboard/page.tsx`, `dashboard-control-center.tsx`, `metric-bar.tsx` | Cambios sólo por una necesidad operacional definida. |
| Datos | `lib/services/dashboard.ts`, `lib/services/operational-work-queue.ts`, `lib/services/operational-period-metrics.ts` | No introducir arrays mock en producción. |
| Navegación | `components/layout/app-shell.tsx`, `desktop-nav.tsx`, `mobile-nav.tsx`, `top-bar.tsx`, `nav-items.ts` | Alcance prioritario de la migración visual; no se reemplaza la lógica de registry, permisos, toggles ni rutas. |
| UI base | `components/ui/button.tsx`, `card.tsx`, `select.tsx`, `table.tsx`, `empty-state.tsx`, `skeleton.tsx` | Proteger contra sobrescritura y duplicación. |

Las dependencias candidatas son una **estimación**, no un hecho aún. La página
de Efferd muestra Radix UI y Lucide en la categoría; Radix ya existe y
`lucide-react` sería nueva y redundante si no se puede emitir el bloque con
Phosphor. Recharts ya cubre los gráficos de Chome. No deben aprobarse nuevas
dependencias hasta comparar el `package.json` temporal con el lockfile actual.

## 8. Riesgo de sobrescritura

El comando futuro `npx shadcn@latest add @efferd/dashboard-6` puede crear archivos
de componente, actualizar `package.json`/lockfile y resolver dependencias del
registro. La CLI actual solicita confirmación antes de sobrescribir archivos
existentes cuando no se usa `--overwrite`; sin embargo, no se debe confiar en
esa interacción como único control.

Riesgos concretos:

- coincidencia de nombres convencionales con `components/ui/card.tsx`,
  `button.tsx`, `table.tsx`, `tabs.tsx`, `select.tsx`, `tooltip.tsx`,
  `dropdown-menu.tsx` o `dialog.tsx`;
- cambios no anticipados a `app/globals.css` si se ejecuta `shadcn init`;
- duplicación de primitivas Radix y librerías de iconos;
- inserción de datos financieros de ejemplo, rutas ficticias o componentes de
  shell que aparenten datos reales;
- reproducción de las microvisualizaciones de referencia mediante arrays,
  porcentajes, gauges o comparaciones hardcodeadas;
- incorporación del script imperativo de `referencia/index.html`, que manipula
  un SVG y tooltips fuera del ciclo React y no es un patrón de producto;
- cambios de lockfile y scripts transitivos sin revisión;
- aceptación accidental con `--yes` o `--overwrite`.

Controles obligatorios para el futuro:

1. No ejecutar `init` ni `add` en la rama principal como primer paso.
2. Usar un proyecto temporal y `--dry-run`; luego revisar `--view` y `--diff`.
3. Registrar el inventario de archivos y dependencias antes de escribir en
   Chome.
4. Nunca usar `--yes` ni `--overwrite` durante la exploración.
5. Crear una rama aislada sólo después de aprobar ese inventario.
6. Respaldar mediante commit limpio o stash documentado antes de la etapa de
   integración, no mediante copias opacas de todo el repositorio.
7. Aplicar manualmente las piezas aprobadas, en vez de aceptar una sustitución
   masiva de componentes.

## 9. Seguridad, supply chain y licencias

### Riesgos

- El registry remoto entrega código que se copia al repositorio. Debe tratarse
  como código de terceros revisable, no como una dependencia visual inocua.
- La autorización bearer crea riesgo de filtración en terminales compartidos,
  logs de CI, screenshots, `.env.example`, bundles de cliente y commits.
- El bloque puede traer dependencias, scripts o imports de iconos no presentes
  en el proyecto.
- Las licencias de la compra Pro y de cada dependencia transitiva deben ser
  compatibles con el uso interno/comercial de Chome. La página pública no
  reemplaza la revisión de los términos aplicables a la cuenta.
- La procedencia de archivos, hashes, versiones y modificaciones posteriores
  debe quedar registrada en el PR de integración.

### Línea base actual

Una auditoría de lectura `npm audit --omit=dev` reportó 10 vulnerabilidades en
las dependencias de producción existentes: 2 críticas, 7 altas y 1 baja. Entre
las afectadas aparecen `next`, `next-auth`, `@auth/core`, `nodemailer`, `sharp`,
`postcss` y transitorias. Esto no fue introducido por Efferd, pero es una puerta
de seguridad: antes de sumar dependencias se debe asignar y resolver o aceptar
formalmente esa línea base. No se aplicó ninguna actualización durante este
análisis.

### Controles requeridos

- Guardar el token sólo en un secret store, variable de shell temporal o
  `.env.local` ignorado; nunca usar `NEXT_PUBLIC_`.
- Confirmar que `.gitignore` sigue cubriendo `.env*` y que
  `npm run check:secrets` pasa.
- Revisar manualmente el JSON del registro y cada archivo producido antes de
  copiarlo.
- Fijar el resultado en `package-lock.json` sólo tras aprobar dependencias;
  usar `npm ci` en CI para reproducibilidad.
- Ejecutar `npm audit --omit=dev` antes y después, comparar el delta y revisar
  licencias con la herramienta aprobada por la organización.
- No exponer rutas, URLs, strings de demo o datos de acceso como props de
  Client Components.

## 10. Arquitectura y reutilización

### Componentes que se deben conservar

| Componente/capa | Motivo |
| --- | --- |
| `AppShell`, `DesktopNav`, `MobileNav`, `TopBar` | Se rediseñan visualmente, pero conservan autenticación visual, faena, navegación derivada, permisos, responsividad y comandos. |
| `PageContainer` y `PageHeader` | Mantienen espaciado, título, acciones y cabecera de escritorio coherentes. |
| `Button`, `Select`, `DatePicker`, `Field`, `Table`, `DataTable` | Definen interacción, accesibilidad, densidad y búsqueda estándar. |
| `EmptyState`, `Skeleton`, `Badge`, `PriorityBadge` | Estandarizan estados no felices y semántica de estado. |
| `DashboardControlCenter` y sus servicios | Materializan la cola operacional, el scope y los enlaces accionables. |
| `lib/auth/*` y servicios de dashboard | Evitan fuga de datos entre rol y faena. |

### Piezas que podrían reutilizarse o inspirar adaptación

- La composición de referencia: controles arriba, métricas compactas,
  contenido principal y una columna secundaria con información estrictamente
  accionable.
- Borde continuo y baja elevación para agrupar métricas relacionadas, en lugar
  de una sucesión de tarjetas aisladas.
- La grilla de métricas accionables de `DashboardControlCenter`.
- Las tiras `SummaryBar`/`MetricBar` para comparaciones compactas.
- `DateRangePicker` para una consulta temporal que tenga fuente de datos real.
- Recharts ya existente para cualquier visualización nueva.
- `Card` sólo cuando exista una agrupación funcional real; no para envolver cada
  dato de un dashboard genérico.

### Piezas que no se deben integrar directamente

- Un segundo shell, navegación, selector de organización o avatar alternativos que dupliquen los existentes.
- Primitivas UI con el mismo propósito que las de `components/ui/`.
- Datos financieros mock, cuentas, presupuestos o transacciones ficticias.
- El gauge, la microbarra de clientes, deltas y listas de `Dashboard6` que se
  sostienen con valores de ejemplo, no con contratos de datos de Chome.
- El script de `referencia/index.html` que inyecta tooltips y modifica el SVG
  de un gráfico después de montar la página.
- Un toggle de tema o estilos dark globales.
- Lucide si el bloque puede configurarse/adaptarse a Phosphor sin perder
  claridad; la decisión depende del manifiesto inspeccionado.

Una capa de adaptación pequeña y local sería preferible a un segundo design
system. Su forma exacta no se define aún porque dependerá de los archivos
reales del manifiesto Pro; crear una abstracción antes de verlos sería una
especulación.

## 11. Alternativas consideradas

| Alternativa | Beneficios | Riesgos / coste | Impacto visual | Recomendación |
| --- | --- | --- | --- | --- |
| Instalar bloque completo directo | Rápido para ver el resultado. | Alto riesgo de sobrescritura, mock data, iconos y tokens incompatibles; coste posterior alto. | Puede romper la identidad. | No recomendable. |
| Instalar en rama aislada | Permite compilar con datos reales. | Sigue tocando el repositorio y puede ensuciar lockfile/config antes de conocer el payload. | Medio-alto. | Sólo después de inspección temporal aprobada. |
| Instalar en proyecto temporal | Inventario seguro, sin impacto en Chome. | Requiere preparar entorno y acceso Pro. | Ninguno en producción. | Primer paso técnico recomendado. |
| Integrar manualmente componentes seleccionados | Conserva datos, RBAC y design system. | Exige más criterio y pruebas por cada sección. | Alto control. | Recomendación para producción si se demuestra valor. |
| Migrar visualmente el shell actual | Renueva toda la percepción del producto sin perder lógica, rutas ni datos. | Requiere disciplina para mantener desktop, móvil, permisos y estados activos alineados. | Alto y coherente. | Alternativa preferida y primer slice de implementación. |
| Usar `referencia/` como evidencia visual local | Cero dependencia; ya permite extraer decisiones concretas de shell, grilla y densidad. | Requiere traducir cada patrón a una necesidad operacional. | Bajo riesgo, alto aprendizaje. | Recomendado desde ahora. |
| Reproducir estructura con componentes actuales | Mejor coherencia, menos librerías y deuda. | Tiempo de diseño/implementación moderado. | Mejor ajuste a Chome. | Alternativa preferida para las piezas que sí aporten valor. |
| Descartar integración | Elimina todo riesgo técnico y comercial. | Se pierde una fuente de inspiración. | Ninguno. | Correcto si no se mapea a una decisión operacional real. |

## 12. Estrategia recomendada

Adoptar una estrategia de **migración visual del shell primero y adopción
progresiva de páginas después**. La carpeta `referencia/` es la evidencia de
diseño primaria para extraer ritmo, composición, densidad y jerarquía; Efferd
queda sólo como origen histórico, no como fuente de código que deba instalarse.

La primera entrega debe renovar sidebar y header sobre los componentes actuales.
Después se aplicará el mismo lenguaje a dashboard, tablas, filtros y gráficos.
No se reemplazan la arquitectura de datos, navegación derivada, permisos,
contexto de faena ni primitives compartidas. Cada pieza de contenido sigue
debiendo declarar usuario, decisión, fuente de datos, permiso, faena, período,
CTA y estado vacío antes de entrar al código.

## 13. Plan de implementación futuro

Este plan es deliberadamente futuro. No debe ejecutarse como parte de este
análisis.

### Fase 1: preparación

1. Revisar `git status`, confirmar el alcance del cambio y partir desde un
   commit o stash identificable.
2. Abrir una rama aislada para la migración visual del shell.
3. Respaldar los archivos críticos mediante el commit base: `package.json`,
   `package-lock.json`, `app/globals.css`, `app/(app)/dashboard/**`,
   `components/ui/**` y `components/layout/**`.
4. Confirmar Node `>=20.19 <21`, npm, Next, React, Tailwind, Radix y el
   lockfile actuales.
5. Convertir los hallazgos de `referencia/` en un brief visual versionado:
   navegación lateral continua, cabecera de controles compacta, fondo claro,
   borde fino, radio medio, sombra mínima, tipografía numérica tabular y grilla
   principal/lateral responsiva. No se necesita acceso Pro, token ni registry.
6. Incluir explícitamente en el brief las exclusiones comprobadas: datos y
   rutas demo, selector de organización ficticio, modo oscuro, Lucide, fuentes
   de referencia, gauges/microbarras hardcodeados y el script de `index.html`.
7. Marcar los contratos que no pueden cambiar: `AREA_TREE`, `getVisibleAreas`,
   `isHrefActive`, permisos, toggles, búsqueda global, contextos de cabecera y
   el drawer móvil.

### Fase 2: diseño del shell visual

1. Diseñar sidebar desktop como una evolución del rail/panel existente, no como
   un menú paralelo: conservar áreas de negocio, iconos Phosphor, badges,
   tooltips y estado activo derivado del registry. Tomar de `Dashboard6` sólo
   la lectura unitaria de navegación izquierda y la separación de superficies;
   la fila superior expresa marca/contexto Chome, nunca una organización demo.
2. Diseñar la cabecera como evolución del `TopBar`: conservar breadcrumb,
   faena, búsqueda contextual, notificaciones, usuario y comportamiento sticky.
   La composición admite controles compactos a la derecha, pero no duplica la
   búsqueda ni agrega período cuando no controla datos reales.
3. Definir tokens de superficie, borde, radio, espaciado y estados usando
   `app/globals.css`. El objetivo es mayor claridad y composición, no importar
   una paleta, tipografía, variables `--chart-*` ni clases `dark:` ajenas.
4. Especificar desktop, rail colapsado y mobile drawer antes de implementar.
   Cada interacción debe tener foco visible, navegación por teclado y target
   táctil de 44 px.
5. Para el dashboard, diseñar la grilla de 12 columnas como un patrón interno
   de contenido, no como una regla de todas las rutas: área principal primero,
   lateral de atención sólo si contiene alertas, cumplimiento o próximos pasos
   reales; apilar ambos en móvil sin ocultar la acción prioritaria.
6. Resolver el lenguaje visual de estados activo, hover, focus, disabled,
   loading, error y vacío. Evitar tarjetas decorativas y color saturado sin
   significado operacional.
7. Definir el patrón de métrica: etiqueta breve, cifra `tabular-nums`, período
   visible y delta con dirección semántica definida por el dominio. El patrón
   de `referencia/` no autoriza a asumir que positivo es siempre favorable.
8. Validar el diseño contra el test de cinco segundos: qué área se ve, qué
   faena aplica y qué acción sigue deben ser evidentes sin scroll.

### Fase 3: implementación del shell (COMPLETADA)

1. Migrar primero `components/layout/app-shell.tsx`, `desktop-nav.tsx`,
   `mobile-nav.tsx` y `top-bar.tsx` sin cambiar sus props ni fuentes de datos.
   ✅ COMPLETADO — ver detalle abajo.
2. Mantener `components/layout/nav-items.ts` como única fuente de área activa,
   permisos y destinos para sidebar, móvil, breadcrumb y command palette.
   ✅ COMPLETADO — sin cambios al registry ni nav-items.
3. No crear nuevas rutas, sidebars, headers, providers globales, icon sets ni
   componentes UI duplicados.
   ✅ COMPLETADO — sin duplicación.
4. Extraer o ajustar sólo tokens reutilizables y primitives existentes cuando
   una mejora de shell los requiera; no reescribir `app/globals.css` para imitar
   un bloque externo.
   ✅ COMPLETADO — sin cambios a globals.css.
5. Para visualizaciones nuevas, construir tooltip, crosshair y estados desde
   los componentes React y Recharts de Chome; no portar el DOM imperativo de
   `referencia/index.html` ni arrays de prueba.
   ✅ COMPLETADO — nuevos componentes usan React puro.
6. Probar cada cambio en desktop, sidebar colapsado y drawer móvil antes de
   avanzar al siguiente archivo.
   ✅ COMPLETADO — lint y code review pasan.

#### Detalle de cambios en Fase 3 — Shell visual

**Archivos modificados:**

| Archivo | Cambio | Líneas |
| --- | --- | --- |
| `components/layout/desktop-nav.tsx` | border-b separator en área de marca, `ActiveIndicator` en items activos, divider entre dashboard y áreas, area labels refinados | ~127 |
| `components/layout/top-bar.tsx` | Altura compacta `h-14` → `h-[3.25rem]` | ~2 |
| `components/layout/mobile-nav.tsx` | border-b separators en marca y worksite sections | ~8 |
| `components/layout/desktop-nav-areas.tsx` | Icono 16→15px, labels `text-[11px]` tracking-wider | ~4 |
| `components/layout/nav-rows.tsx` | Nuevo componente `ActiveIndicator` (barra de acento izquierda) integrado en `LeafRow` y `BranchRow` | ~9 |

**Componente nuevo:**
- `ActiveIndicator` en `nav-rows.tsx`: barra vertical de 2px con `bg-[var(--color-primary)]` que marca el item activo en la navegación. Usa `aria-hidden` ya que es puramente decorativo. Se posiciona con `absolute left-0` y `translate-y-1/2` para centrado vertical.

### Fase 4: adopción progresiva en contenido (EN PROGRESO)

#### Completado — Dashboard

| Archivo | Cambio | Estado |
| --- | --- | --- |
| `app/(app)/dashboard/operational-metrics-strip.tsx` | **NUEVO** — Componente de métricas compacto agrupadas que reemplaza la grilla de tarjetas individuales. Acepta `DashboardMetric[]` con `onSelect` para presets (Críticas, Hoy, Vencidas, etc.). Responsive: 2-col en móvil, 4-col en desktop. | ✅ Creado |
| `app/(app)/dashboard/dashboard-control-center.tsx` | Grilla 12-col (`xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]`): cola de trabajo a la izquierda (2fr), alertas/PDTP/actividad a la derecha (1fr). Eliminado código muerto: función `OperationalMetric`, constante `METRIC_ICON`, import `Package`. `OperationalMetricsStrip` conectado con `onSelect={applyPreset}`. | ✅ Completado |

#### Completado — Páginas de alto tráfico

| Archivo | Cambio | Estado |
| --- | --- | --- |
| `app/(app)/pendientes/work-queue-workbench.tsx` | Densidad compacta: búsqueda `h-11→h-8`/`text-xs`, botón `size=sm`, selects `h-8`/`text-xs`, "Más filtros" `text-xs` muted, tabla `text-xs`/`px-3 py-2.5`/subtítulos `text-[11px]`, `shrink-0` en timestamp. | ✅ Completado |
| `app/(app)/bodega/bodega-sections.tsx` | Footer "Sin stock" envuelto en superficie con borde propia (`rounded-[var(--radius)] border bg-[var(--color-surface)] px-3 py-2`). Espaciado `space-y-6→space-y-4`. Icono 14→13, texto `text-[11px]`. StockTable conserva su propia superficie (sin doble borde). | ✅ Completado |

#### Resumen de estadísticas de cambios

| Métrica | Valor |
| --- | --- |
| Archivos modificados | 8 |
| Archivo nuevo | 1 (`operational-metrics-strip.tsx`) |
| Inserciones | ~225 |
| Eliminaciones | ~253 |
| Dependencias nuevas | 0 |
| Cambios a globals.css | 0 |
| Cambios a nav-items.ts | 0 |
| Cambios a registry | 0 |

#### Pendiente — Extensión a más páginas

1. Extender patrones de superficie y densidad a `/aprobaciones`, `/compras`,
   `/recepcion`, `/prevencion` — una familia de rutas por vez.
2. Refinar `/solicitudes` (request-list.tsx): cards móviles y OnboardingHint
   podrían beneficiarse de tokens más compactos.
3. Verificar que las tablas existentes (DataTable, StockTable, KardexTable)
   mantienen coherencia con los patrones de densidad establecidos.
4. Conectar cualquier contenido nuevo a servicios reales, `can` y
   `resolveWorksiteScope`; eliminar mock data antes de una ruta autenticada.
5. Hacer commits pequeños y revisables por slice visual, sin cambios de
   dependencias o lockfile salvo que una necesidad demostrada lo justifique.

#### Validación realizada

- **Lint:** `npx eslint` en los 8 archivos modificados — **0 errores, 0 warnings**.
- **Typecheck:** `npx tsc --noEmit` — errores preexistentes en `referencia/` (no relacionados con cambios); **sin errores nuevos introducidos**.
- **Code review:** `code-reviewer-mimo` aprobó todos los cambios — sin código muerto, sin contratos rotos, tokens consistentes, accesibilidad preservada.

### Fase 5: validación

1. Ejecutar lint, tipado y build de producción: `npm run lint`,
   `npm run typecheck`, `npm run build`.
2. Ejecutar las pruebas unitarias afectadas, en especial
   `lib/__tests__/navigation.test.ts`, las de `TopBar`, dashboard, componentes
   UI y scope/autorización. Añadir regresiones para estado activo desktop/móvil,
   rutas hijas, query string y hash.
3. Ejecutar pruebas de integración y navegación con roles distintos y faenas
   distintas. Incluir un caso negativo que demuestre que no se serializan datos
   fuera del alcance ni se muestran destinos sin permiso.
4. Ejecutar E2E y `@axe-core/playwright` sobre desktop y móvil; probar teclado,
   foco, reflow, zoom y reduced motion.
5. Comparar screenshots de los estados con datos completos, vacíos, error,
   sin permiso y listas largas.
6. Verificar el test de cinco segundos: contexto de faena, estado del trabajo y
   siguiente acción deben entenderse sin scroll.
7. Ejecutar `npm run check:secrets` y revisar que no se añadieron dependencias,
   tokens de registro, headers bearer o `NEXT_PUBLIC_*` por una migración
   puramente visual.
8. Medir bundle y rendimiento con los controles existentes, incluido
   `npm run check:bundle-budget`, y comprobar que sidebar/header no introducen
   renders o cargas globales innecesarias.

### Fase 6: reversión

Activan reversión completa cualquiera de estas condiciones: regresión de
permisos/scope, rutas activas incorrectas, pérdida de búsqueda/command palette,
inconsistencia entre desktop y móvil, cambio global de tema, sobrescritura de
una primitiva, dependencia no aprobada, secreto expuesto, degradación de
accesibilidad/performance o falta de valor operacional medible.

1. Volver al commit base o revertir los commits pequeños de integración.
2. Restaurar sólo los archivos modificados confirmados por `git diff`, en
   particular configuración, dashboard, estilos y lockfile.
3. Eliminar dependencias introducidas, si las hubiera, y regenerar el lockfile
   mediante el flujo npm aprobado; no editarlo manualmente.
4. Restaurar los tokens visuales y componentes de shell de la rama base sin
   tocar `nav-items.ts` ni los manifests, salvo si el cambio los hubiera
   modificado intencionalmente.
5. Eliminar componentes locales creados exclusivamente para la pieza revertida
   y sus pruebas, sin tocar primitivas compartidas.
6. Repetir lint, tipado, build, pruebas de permisos y comprobación de secretos
   contra el estado restaurado.

## 14. Plan de pruebas y criterios de aceptación

La futura integración se acepta sólo si todos estos criterios son verificables:

- El diff de `components/layout/**` corresponde a una decisión visual explícita
  y preserva el contrato de navegación; `components/ui/**` y `app/globals.css`
  no cambian fuera de decisiones pequeñas, tokenizadas y aprobadas.
- `npm run lint`, `npm run typecheck` y `npm run build` finalizan correctamente.
- Las pruebas unitarias, integración, E2E, navegación y accesibilidad pasan.
- La pieza muestra sólo datos reales, autorizados y reconciliables por rol y
  faena; no contiene demo data en producción.
- Cada KPI tiene una acción real y no hay más de cuatro sobre el contenido.
- La búsqueda de texto conserva el `TopBar`; los filtros adicionales son
  estructurados y no duplican la misma dimensión.
- La sidebar desktop, rail colapsado y drawer móvil muestran los mismos destinos
  autorizados, conservan el estado activo más específico y no agregan entradas
  sintéticas o paralelas.
- Los patrones de `referencia/` se reconocen sólo como composición (shell
  izquierdo continuo, controles compactos, borde/radio/densidad y grilla
  principal/lateral), sin copiar su marca, navegación, datos, rutas, scripts,
  fuentes, iconos ni tema oscuro.
- Toda comparación temporal identifica período y dirección favorable para el
  dominio; no se muestra un delta genérico que pueda inducir a una decisión
  errónea sobre backlog, cumplimiento o pendientes.
- Desktop, móvil, teclado, lectores de pantalla, foco, contraste y movimiento
  reducido cumplen los estándares ya definidos por Chome.
- El modo claro, fuentes, iconos Phosphor, tokens semánticos y densidad visual
  siguen siendo coherentes con el sistema actual.
- No hay secretos en Git, bundle, logs, props cliente, `components.json` ni
  archivos de ejemplo. `npm run check:secrets` pasa.
- No hay nueva dependencia redundante ni vulnerabilidad neta sin aprobación;
  las licencias están revisadas y el lockfile es reproducible.
- Existe un revert limpio, probado y documentado.
- El usuario entiende en cinco segundos qué ve, para qué faena, qué requiere
  atención y qué acción puede tomar.

## 15. Estimación de complejidad

| Trabajo futuro | Estimación | Incertidumbre |
| --- | --- | --- |
| Diseño del shell visual | Media, una a dos jornadas. | La referencia ya cierra composición; resta validar la jerarquía de rail, panel y cabecera con datos reales. |
| Migración de sidebar y header | Media-alta, tres a seis jornadas incluyendo pruebas desktop/móvil. | Afecta navegación compartida, estados activos y responsive. |
| Adopción del dashboard | Media, dos a cinco jornadas incluyendo pruebas. | Depende de gráficos, filtros y estados, no de Efferd. |
| Expansión progresiva al resto de rutas | Alta, por slices. | Depende de la cantidad de superficies y de no crear excepciones visuales. |

No se debe comprometer una fecha de migración completa hasta cerrar el diseño
del shell y validarlo en una ruta autenticada. El manifiesto autenticado de
Efferd ya no es un bloqueo para este objetivo; sólo sería necesario si en el
futuro se decide incorporar código de ese registry.

## 16. Recomendación final obligatoria

- **¿Es viable?** Sí, técnicamente viable mediante shadcn con ajustes de
  configuración y adaptación local.
- **¿Es recomendable?** Sí como referencia visual para una migración global del
  shell; no como instalación directa del bloque completo en la aplicación.
- **Dificultad:** media-alta para sidebar y header; alta para extender la
  migración de forma consistente a todas las rutas.
- **Riesgo:** medio y controlable si se preservan registry, permisos, scope,
  búsqueda y responsive; alto si se intenta reemplazar el shell funcional.
- **¿Conviene instalar el bloque completo?** No.
- **¿Conviene integrar sólo algunas partes?** Sí, pero como patrones visuales
  reinterpretados con los componentes, datos e iconos actuales, no como
  archivos copiados desde el bloque.
- **Prerrequisitos:** rama limpia, brief visual del shell, decisión explícita de
  tokens, cobertura de navegación desktop/móvil y preservación de permisos,
  faena y búsqueda. El brief debe registrar los patrones y exclusiones de
  `referencia/`; acceso Pro/token sólo sería necesario para incorporar código
  de Efferd, algo que este plan no requiere.
- **Componentes que no deben reemplazarse funcionalmente:** `AppShell`,
  navegación desktop/móvil, `TopBar`, `PageHeader`, `PageContainer`, componentes
  compartidos de `components/ui`, RBAC/scope y el centro de control operacional.
  Sus presentaciones visuales sí son el objetivo prioritario de la migración.
- **Primer paso seguro:** diseñar y validar el nuevo shell visual sobre
  `AppShell`, `DesktopNav`, `MobileNav` y `TopBar`, sin cambiar sus contratos.
- **Alternativa final recomendada:** migrar visualmente sidebar y header con los
  componentes, tokens, iconos, servicios y pruebas existentes de Chome; adoptar
  `referencia/` como inspiración concreta de composición, no como dependencia
  ni plantilla literal.
- **Calificación de conveniencia:** **8/10** para la migración visual controlada.
