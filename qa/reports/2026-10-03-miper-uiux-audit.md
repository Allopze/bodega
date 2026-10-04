# Auditoría UI/UX de MIPER — 3 de octubre de 2026

Method: dual-agent (A: /root/miper_design · B: /root/miper_evidence).

## Resultado

**La interfaz presenta problemas de comprensión inicial, jerarquía y lenguaje en desktop.** La aplicación tiene navegación por tareas, editor por pasos y mecanismos de continuidad, pero varios niveles de navegación y datos compiten con el trabajo. Se confirma además una discrepancia entre «Completos» y su destino de pendientes.

**Ajuste de prioridad, 4 de octubre de 2026:** el usuario indicó «móvil me da igual, el foco es desktop». El registro de la auditoría conserva toda la evidencia obtenida, pero sus hallazgos móviles quedan fuera del plan de mejora y no determinan prioridades. No se ejecutó un nuevo recorrido de navegador para este ajuste documental.

El [plan detallado de mejora](../../PLAN_MEJORA_UIUX_MIPER_2026-10-03.md) propone ocho fases, archivos afectados, dependencias, pruebas y criterios de aceptación. No se modificó código de aplicación ni se ejecutaron escrituras de negocio.

## Entorno y método

- Checkout inicial `8c699148` con cambios concurrentes previos, incluidos cambios del importador. Se evaluó el árbol actual.
- Al cerrar, el checkout estaba en `9de01f91`, después de los commits concurrentes `10363dd3` y `9de01f91` de importación. La auditoría no creó esos commits ni modificó su contenido. No se atribuye toda la evidencia a un único commit inmutable; al ejecutar el plan debe actualizarse la lectura del importador.
- `next dev` existente en `http://localhost:3001`, entorno local. No se inició ni detuvo el servidor del usuario. No se auditó producción.
- Chromium mediante Playwright con sesión QA existente y vigente; sin regenerarla ni alterar autenticación.
- Desktop 1440×1000; móvil emulado 390×844. MIPER recorrida: Oficina Central 2099, borrador, 222 riesgos. No equivale a probar todos los períodos o faenas.
- Evaluación A: análisis de implementación, contexto de producto, diseño y documentos existentes. Evaluación B: detector y navegador, sin recibir hallazgos de A. El padre sintetizó ambas y revisó capturas desktop/móvil.
- Skills: Impeccable `critique`/`audit` y web-ai-slop. La auditoría no reproduce las pruebas extensas declaradas en informes anteriores.
- Apertura y cierre de importador, navegación, búsqueda y lectura de estados. No se importaron archivos, guardaron campos, enviaron rondas, aprobaron documentos o verificaron controles. No se hizo un checksum antes/después de la BD: la ausencia de escrituras se basa en las acciones ejecutadas, no en una reconciliación integral de tablas.

## PRODUCT BUG / inconsistencia confirmada

**UX-03 · S2 · rótulo y destino opuestos.** «Completos 0 de 222» abre `?completitud=pendientes` y muestra «Con pendientes». La acción responde, pero el rótulo visible anuncia otro conjunto.

- Reproducción: entrar a la matriz → clic en «Completos 0 de 222» → observar filtro/resultados.
- Fuente: `summary-strip.tsx:47`; el mismo patrón existe en `resumen-panel.tsx:61`.
- Evidencia: [clic en Completos](evidence/2026-10-03-miper-uiux-audit/b-desktop-completos-click.png).
- Mejora: «Completar N pendientes» como acción explícita, o que «Completos» filtre efectivamente completos. Validar 0/1/N y filtros preexistentes.

## UX FINDING

1. **S2 — Contenido fuera de la primera vista móvil.** Acciones, recomendación, pestañas, franja documental, clasificaciones y filtros ocupan el viewport antes de mostrar una tarea. En la búsqueda «soldar», la primera tarea comienza en y=999 px, por debajo de los 844 px de la pantalla; el primer riesgo, aún más abajo. [Matriz móvil](evidence/2026-10-03-miper-uiux-audit/b-mobile-workspace.png), [búsqueda móvil](evidence/2026-10-03-miper-uiux-audit/b-mobile-busqueda-soldar.png). La falta de tarea visible no significa que no exista una CTA: «Siguiente pendiente» sí aparece arriba, pero no explica por sí sola la estructura del trabajo.
2. **S2 — Pasos sin nombre visible.** En editor móvil, sólo el paso activo conserva su rótulo; los demás aparecen con número y marca. Sus nombres accesibles permanecen, pero la persona que mira la pantalla debe recordar qué significa cada número. [Editor móvil](evidence/2026-10-03-miper-uiux-audit/b-mobile-editor.png).
3. **S2 — Jerarquía y contadores repetidos.** Matriz combina cinco áreas del documento con métricas y clasificación por matriz/actividad/tarea. Editor mantiene esa navegación y suma cuatro pasos más navegación entre riesgos. [Matriz desktop](evidence/2026-10-03-miper-uiux-audit/b-desktop-matriz.png), [editor](evidence/2026-10-03-miper-uiux-audit/b-desktop-editor-medidas.png).
4. **S2 — Importación con lenguaje técnico al inicio.** La explicación de RE-04, P×C y escala aparece antes de la primera selección. Se propone llevar detalle técnico a ayuda secundaria y explicar primero el resultado de importar. [Importador desktop estable](evidence/2026-10-03-miper-uiux-audit/b-desktop-import-selector.png), [móvil](evidence/2026-10-03-miper-uiux-audit/b-mobile-importador.png).
5. **S3 — Lote poco descubrible.** «Seleccionar» aparece al filtrar; en estructura el camino no es evidente. Hallazgo también documentado en el cierre previo; se mantiene como pendiente y no se presenta como nuevo.

## FUNCTIONAL FINDING / fuente con validación pendiente

- Programa poblado antepone nueve antecedentes y repite avance (`program-panel.tsx:310–337`). Fuente confirma estructura; no se verificó su primera vista con actividades existentes.
- Detalle de actividad despliega ejecuciones en orden cronológico y registros; comprobar densidad con años de historial (`program-activity-view.tsx`).
- Confirmación del importador necesita más contexto del destino; cerrar descarta decisiones. Se revisó fuente, no se produjo una vista previa nueva ni se ensayó el descarte con un archivo.
- Ficha de control muestra hash, cantidad de vínculos y referencia de evidencia como texto; verificación y ejecución usan modelos de evidencia distintos. Requiere un control existente y evidencia válida para verificar navegación y comprensión reales.
- Factores carece de tarjetas móviles propias en fuente y su aviso de uso depende de `title`; la sesión actual no pudo ver el contenido.

Estos puntos sustentan propuestas de mejora, no una afirmación de que su flujo completo falló en navegador.

## Accesibilidad y detector

**Hallazgo confirmado S3:** axe informa `aria-allowed-role`, impacto `minor`, para `nav[aria-label="Qué faenas ver"]` con `role="group"` en portada. Inspeccionar la primitiva compartida `SegmentedControl` antes de corregir la página; extender la comprobación a otros consumidores al modificarla.

Detector Impeccable ejecutado una vez sobre `app/(app)/prevencion/miper`: **0 hallazgos**, JSON `[]`, sin falsos positivos. Eso no mide claridad o facilidad de uso.

Axe se ejecutó en ocho estados desktop: portada, matriz, programa vacío, revisión, historial, filtro de pendientes, tarea y editor inicial (automáticamente Medidas). Un hallazgo minor en portada; ninguno en los otros siete estados instrumentados. No se repitió axe en todos los pasos/móvil/roles y no se usó lector de pantalla; no se certifica WCAG para el submódulo.

## Consola y red

En los ocho estados desktop instrumentados: 0 `console.error`, 0 `pageerror`, 0 respuestas HTTP ≥400 y 0 solicitudes fallidas registradas. Las navegaciones y capturas adicionales no amplían automáticamente esa cobertura instrumentada. La redirección esperada de Factores a `/forbidden` se clasifica como límite del rol, no como fallo HTTP de producto.

## PASS y cobertura exacta

| Área | Desktop | Móvil | Alcance verificado |
|---|---|---|---|
| Portada | Sí | Sí | Carga, presentación y acceso a matriz; axe desktop. |
| Matriz | Sí | Sí | Estructura, filtro de pendientes y presentación. |
| Resumen | Sí | No | Presentación de métricas y fuente de enlaces. |
| Búsqueda | Sí | Sí | «soldar» y resultado fuera del primer viewport móvil. |
| Tarea | Sí | No separado | Carga y acceso al editor; sin crear peligro. |
| Editor | Cuatro pasos | Paso activo Medidas | Identificación/Evaluación/Medidas/Seguimiento desktop; rótulos y densidad móvil. |
| Programa | Vacío | No separado | Mensaje sin programa; no ejecución. |
| Revisión | Sí, sin ronda poblada | No separado | Área y atajos; no observación/aprobación. |
| Historial | Sí | No separado | Vista inicial; no certificación del historial completo. |
| Importación | Inicio | Inicio | Sheet estable, requisitos y pasos; sin archivo ni escritura. |
| Menú de acciones | Sí | No separado | Apertura de opciones; sin ejecutar. |
| Factores | `/forbidden` | `/forbidden` | Acceso no permitido con esta sesión; contenido no auditado. |
| Control y evidencia | No | No | Revisión de fuente solamente. |

## AUTOMATION WARNING

- No existe una auditoría `npm run audit` ejecutada: el recorrido se hizo con sondas Playwright temporales.
- La primera captura del importador estaba a mitad de animación; se sustituyó por captura estable con movimiento reducido. No se trató como defecto del panel.
- `b-desktop-editor-paso1.png` muestra Medidas porque el editor abre el primer paso pendiente. Para cada paso, usar los PNG `editor-identificacion`, `editor-evaluacion`, `editor-medidas` y `editor-seguimiento`.
- `fullPage` no recorre todo el scroll interno del shell: las capturas muestran primera vista o estado particular, no el total del contenido.
- No se inició servidor live del detector ni se inyectó su overlay en navegador. Se utilizaron captura, medición DOM y axe como evidencia; no hay overlay visible para el usuario.

## COVERAGE GAP

- Una sesión y una matriz en borrador; roles reducidos de revisión/Legal/responsable no ejercitados.
- Programa poblado, ejecuciones antiguas y futuras, controles verificables, archivos de evidencia y rondas con observaciones no disponibles/recorridos.
- Importación posterior a selección de archivo, destino definitivo y efectos de escritura no recorridos.
- Catálogo Factores bloqueado por permisos; no se alteraron permisos para forzar acceso.
- Navegador móvil real, WebKit/Safari, teclado virtual, conectividad lenta, lector de pantalla y zoom 200 % no verificados.
- No se ejecutaron typecheck, lint, doctor, suites unitarias/PGlite ni E2E mutantes: no hubo cambios de aplicación. Los resultados de QA anteriores son antecedentes, no resultados de esta pasada.
- No hubo prueba de comprensión con personas nuevas. El plan define cómo realizarla antes de dar la experiencia por validada.

## Recomendaciones priorizadas

1. Alinear rótulos y destinos; corregir «Completos» primero.
2. Validar nueva entrada e inicio de trabajo con el usuario: contexto y siguiente acción antes de datos secundarios.
3. Reducir franja/métricas repetidas de matriz y hacer explícita estructura/resultados.
4. Jerarquizar el editor desktop y distinguir avanzar de paso de avanzar de riesgo.
5. Reordenar revisión y programa alrededor de decisiones/ejecuciones pendientes.
6. Explicar evidencia y destino de importación; asegurar navegación a fuentes autorizadas.
7. Corregir ARIA en la primitiva responsable y aclarar el catálogo desktop con el rol apropiado.

## Artefactos y notas de ejecución

Evidencia: [carpeta de capturas](evidence/2026-10-03-miper-uiux-audit/), 26 PNG y cinco JSON de navegador sanitizados; detector conservado aparte en la misma carpeta. Capturas locales incluyen datos de la sesión interna; no publicar fuera del ámbito de QA sin revisar su contenido. No hay credenciales, cookies ni tokens guardados en los informes.

Slug Impeccable: `app-app-prevencion-miper`; no había exclusiones activas que aplicar. Evaluaciones independientes; navegador headless sin pestaña visible ni overlay. No se inició servidor adicional. Scripts temporales eliminados. Contexto Impeccable detectó formato legado de `PRODUCT.md`; se mantuvo sin cambios y ese metadato no influyó en la auditoría. Su actualización pertenece a `init` cuando se solicite.

La evaluación heurística de fuente fue 28/40; no se interpreta como nota de comprensión con usuarios. El plan contiene su desglose, fortalezas y recorridos por persona.
