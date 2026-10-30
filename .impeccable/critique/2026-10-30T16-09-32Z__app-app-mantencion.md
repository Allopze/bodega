---
target: módulo de mantención de equipos (jefatura + app del mecánico)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/allopze/dev/chome/bodega/app/(app)/mantencion"
timestamp: 2026-10-30T16-09-32Z
slug: app-app-mantencion
closed: true
---
Method: dual-agent (A: revisión de diseño · B: detector + navegador, subagentes aislados)

# Crítica — módulo de mantención de equipos

Alcance: jefatura (`/mantencion/*`, 12 vistas, 1440 y 390 px) y app del mecánico (`/m/mantencion`: login, PIN, inicio, flujos preventiva y correctiva hasta «Revisar», sin firmar). Datos: `bodega_dev` + 8 registros `QA_`.

## Design Health Score

| # | Heurística | Nota | Hallazgo clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 3 | App ejemplar (señal, cola, «Faltan 17 ítems», borrador). Panel: «Todas las pautas al día» con 112/119 equipos sin lecturas. |
| 2 | Lenguaje del usuario | 2 | «Pauta» (app) vs «intervalo» (jefatura); «sello», «situación»; texto de hoja de ruta interna visible. |
| 3 | Control y libertad | 2 | Salir de un registro en la app = «Salir y descartar» aunque ya autoguarda; quitar un intervalo es un clic con deshacer de 8 s. |
| 4 | Consistencia | 2 | Naranja = correctiva + pendiente + no realizado; «Sin actualizar» rojo en Panel y naranja en Registros; preventiva deshabilita «Revisar», correctiva valida al tocar. |
| 5 | Prevención de errores | 3 | Bien: salto de lectura, duplicado, anulación. Mal: cada clic en la matriz de pauta publica una versión. |
| 6 | Reconocer vs. recordar | 3 | Explicación de alertas sólo en `title`; filtro «Revisión» escondido en modal; Dispositivos fuera del menú. |
| 7 | Flexibilidad y eficiencia | 2 | «Todo realizado en Motor» es un gran atajo; jefatura sin bandeja «por revisar», anterior/siguiente ni lote. |
| 8 | Estética y minimalismo | 2 | App sobria. Jefatura: 5 botones de igual peso en el detalle, alertas-oración en mayúscula mono, tablas con borde dentro de tarjetas. |
| 9 | Recuperación de errores | 3 | Errores de la app específicos y con salto al campo; alertas del registro no dicen qué foto ni qué hacer. |
| 10 | Ayuda | 3 | Diálogo «Instalar app» con QR y pasos; falta explicar el «sello» y la regla del intervalo base. |
| **Total** | | **25/40** | **Aceptable** (app sola ≈31–32; jefatura baja el promedio) |

## Veredicto de especificidad

App del mecánico: diseñada para faena (táctiles 52–76 px, texto 16–19 px, borradores que sobreviven a recargar, un sistema de la pauta a la vez, motivos rápidos para «No realizado», avisos de salto y duplicado dentro de la pantalla). Jefatura: competente pero genérica; usa bien los primitivos pero se lee como ficha de base de datos y el trabajo central (revisar lo firmado, destrabar equipos detenidos) no tiene superficie propia. Coherencia entre superficies media: dos verdes (#1e6e3e app / #005c3f plataforma), dos naranjos (#f39200 / #e78400), vocabulario distinto.

Escaneo determinista: CLI 0 hallazgos en 126 archivos (validado con archivo de control). detect.js en 5 páginas: 1 low-contrast real (leyenda «Correctivas» 3,8:1), 30 nested-cards (24 FP por el pozo del shell, 6 reales: tablas con borde dentro de SectionCard), 2 tiny-text (SummaryBar compartido), 1 all-caps-body (faenas en la app). axe: 0 serious/critical. Consola y red: 0 errores. Headless: sin overlay visible.

## Impresión general

La app del mecánico es lo mejor del módulo. Lo «poco pulido» está casi todo en la jefatura: una docena de detalles de copy y maquetación y dos o tres flujos donde el diseño no acompaña lo que está en juego. Mayor oportunidad: que Panel y Registros digan la verdad del estado y ordenen el trabajo de revisión.

## Lo que funciona

1. Diseño de confianza del dominio: instantánea de la ficha al firmar, «firmado en el teléfono» vs «recibido», flujo de Anular ejemplar.
2. La pauta en la app: barra de progreso, «Todo realizado en X», luego excepciones; cierre «Pauta completa.» → «Revisar» con «Cambiar».
3. La jefatura respeta la plataforma (sin componentes locales duplicados, búsqueda propia registrada).

## Problemas prioritarios

- **[P1] El Panel da falsa tranquilidad.** «Mantenciones vencidas 0 · Todas las pautas al día» (panel-kpis.tsx:45) con 112/119 «Sin lecturas»; KA-110 «AL DÍA» con 15 días en taller. Arreglo: «0 vencidas de 7 con lectura», aviso accionable para «112 sin lectura», «En taller» pesa más que «Al día». Comando: clarify.
- **[P1] Editar una pauta es en vivo y demasiado liviano.** «×» de 28 px quita un intervalo de 70 equipos sin confirmar (schedule-intervals-card.tsx:35-43), deshacer de 8 s; re-agregar tras el plazo copia otra columna (schedule-editor.ts:187-202); cada casilla publica versión. Arreglo: confirmar con impacto, restituir columna al re-agregar, borrador + «Publicar versión N». Comando: harden.
- **[P1] En la app, salir de un registro descarta todo.** Sólo se sale retrocediendo al paso 1 → «Salir y descartar» rojo en zona del pulgar (flow-screen.tsx:165-174), aunque el borrador autoguarda. Arreglo: «Salir» en cada paso con «Guardar y salir» primario. Comando: harden.
- **[P1] La jefatura no tiene bandeja de revisión.** «Pendiente» oculto en la lista (record-badges.tsx:7-9), filtro «Revisión» en «Más filtros», sin contador ni anterior/siguiente; «Marcar revisado» al nivel de «Exportar». Arreglo: pestañas «Por revisar (N) / Observados / Revisados», «Marcar revisado y siguiente». Comando: layout.
- **[P2] El lenguaje de estado grita y no explica.** Alertas-oración en mayúscula mono con explicación sólo en `title` (record-sections.tsx:18-21); a 390 px el chip «…72 H» (396 px en 358) se corta (badge.tsx:16 whitespace-nowrap); correctivas en naranja de señal y leyenda a 3,8:1 (weekly-chart-inner.tsx:42). Arreglo: avisos en tipo oración con qué/por qué/qué hacer y enlace a la foto; tono no-señal para correctiva. Comando: typeset + colorize.

## Señales rojas por persona

- Jefatura que revisa 50 registros: sin contador ni pestaña de pendientes ni anterior/siguiente; columna Estado mezcla 4 dimensiones; 2 de 4 KPI de Registros no son enlaces (A1).
- Teclado / lector: explicaciones sólo en `title`; matriz de pauta ~265 paradas de Tab sin navegación de cuadrícula; ícono ojo en «Observar».
- Mecánico en terreno: chip de faena de 3 líneas en mayúscula mono; salir descarta; sin «Sin novedad» de un toque; vista previa de foto corta el sello; paso «Trabajo» de la correctiva ≈2,5 pantallas.
- Jefatura que configura flota: encabezado de Equipos con 5 acciones que truncan la miga; Dispositivos fuera del menú y filas indistinguibles; «Seguro» vacío como primer bloque del equipo.

## Observaciones menores

- Copy: texto de hoja de ruta «Jefatura · segunda etapa…» (record-aside.tsx:30-31); «Salió de taller» → «Sigue en taller» (record-sections.tsx:216-218); «un comentario. Respóndelos» (home-lists.tsx:106); «Observ.» (step-revisar.tsx:52); «Observar» vs «Observaciones del mecánico»; «Ford Cargo Ford Cargo»; descripción de pauta = nombre de la planilla.
- Maquetación: fechas «29-10-↵2026» (equipment-read-sections.tsx:29) y folio «MP-↵SAN-9101» en la app; «En taller ahora» trunca sin `title` (panel-cards.tsx:146-147); doble marco tabla-en-tarjeta (panel-cards.tsx:81, record-sections.tsx:121, equipment-life-section.tsx:47, schedule-brand-rules.tsx:67, record-aside.tsx:22); SummaryBar 11 px (summary-bar-stat-cell.tsx:37, compartido); dos estilos de badge en la misma celda; «Sí» badge vs «No» texto; doble anillo de foco en la lectura de la app.
- Estados: Dispositivos vacío sin CTA (A4); «Filtrar en esta página…» en Importar; hoja de vida «Vigente» + «PENDIENTE»; foto de correctiva a media columna vs ancho completo en preventiva; «Enviar respuesta» secundario.
- Teléfono (jefatura): Registros sin tarjetas (sólo Folio, Fecha, Faena; «Ver el registro» 88×17 px); 4 KPI apilados ≈540 px; matriz de pauta 159 botones de 36×36 (28 px desde 640), «Quitar intervalo» 28×28.

## Preguntas para pensar

1. ¿Qué abre la jefatura el lunes a las 8:00? ¿Por qué el Panel parte con un gráfico de 8 semanas?
2. Si el teléfono ya guarda los borradores, ¿por qué salir sigue siendo destructivo?
3. ¿La matriz 53×5 es la forma de trabajo de la jefatura o la planilla de origen reproducida (anti-referencia #1)?
4. ¿Qué significa «Al día» para un camión que lleva 15 días en taller?
