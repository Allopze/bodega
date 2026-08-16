# Brechas de cobertura — módulo Prevención (2026-08-15)

> **ESTADO: CERRADO el 2026-08-15.** De las 13 brechas: **9 implementadas**, **2 descartadas
> por incorrectas** (B-03 mal planteada, B-13 ya existía), **1 resuelta como configuración**
> (B-12) y **1 diferida con argumento** (B-08). Ver `PLAN_BRECHAS_PREVENCION_2026-08-15.md`
> para el detalle de qué se construyó y por qué. Este documento se conserva como registro del
> diagnóstico original; las secciones de abajo describen el estado **previo** a la remediación.

Backlog derivado de comparar el sidebar de Prevención contra tres referencias:

1. **DS 44/2024** (vigente 01-02-2025, derogó DS 40 y DS 54) — la norma que fiscaliza la DT.
2. **ISO 45001:2018** — traducción oficial.
3. **Safeti** (`web.safeti.cl`) y **EHS Insight** / **ZYGHT** — implementaciones reales, chilena y comparadas.

No es una auditoría de bugs: es cobertura funcional. Cada ítem se verificó contra el
repo antes de listarlo. Los que resultaron falsos positivos están al final para que
nadie los vuelva a reportar.

---

## P0 — Elementos que el DS 44 declara obligatorios y no existen

### B-01 · Auditoría / evaluación del Sistema de Gestión
**Exigido por:** DS 44 Art. 22 n°4 — *"La evaluación o auditoría periódica del desempeño
del Sistema de Gestión de la Seguridad y Salud en el Trabajo"*. ISO 45001 **9.2**.
**Estado:** no existe. `/prevencion/pdtp/cobertura` mide cobertura del programa, que es
otra cosa: cubre el Art. 14 (evaluación del cumplimiento *del programa*), no la auditoría
*del sistema*.
**Referencia:** Safeti lo resuelve con tres vistas — plantillas disponibles, auditorías
realizadas con puntaje, e histórico.

### B-02 · Reglamento Interno de Higiene y Seguridad
**Exigido por:** DS 44 Título III Párrafo 5, Arts. 56–61 (exigibilidad, aprobación,
contenido mínimo, obligaciones, prohibiciones, sanciones).
**Estado:** no existe, ni el documento ni el registro de entrega nominativa.
**Nota:** Safeti separa el instrumento (`Reglamento Interno`) de su evidencia
(`Entrega de Reglamento Interno` por trabajador). Ese patrón es el correcto.

### B-03 · Coordinación de la actividad preventiva con contratistas
**Exigido por:** DS 44 Art. 20. Ley 20.123 / DS 76.
**Estado:** `contractor_or_third_party` existe como valor de `eventType` en incidentes y
hay campos sueltos en permisos, pero no hay entidad contratista, ni sus documentos con
vencimiento, ni el Reglamento Especial.

---

## P1 — Cobertura que la competencia tiene y nosotros no

### B-04 · Protocolos MINSAL nombrados
**Estado:** [`lib/prevention/hygiene.ts`](lib/prevention/hygiene.ts) clasifica agentes por
tipo (`chemical`, `physical`, `biological`, `ergonomic`, `psychosocial`). Es más general,
pero el fiscalizador pregunta por protocolo, no por tipo de agente.
**Faltan como entidad nombrada:** PREXOR (ruido), riesgo psicosocial, químicos
cancerígenos, hiperbaria, exposición a frío/calor, polvo/sílice.
**Impacto:** ser más genérico nos deja peor parados en una fiscalización.

### B-05 · Registro de fiscalizaciones
Visitas de Inspección del Trabajo, SEREMI de Salud: fecha, organismo, resultado,
compromisos. No existe.

### B-06 · Registro de visitas del organismo administrador
ACHS / IST / Mutual / ISL: prescripciones de medidas y recomendaciones. DS 44 Art. 70
obliga a cumplir las medidas prescritas; hoy no hay dónde registrarlas ni seguirlas.

### B-07 · Equipos de emergencia
Extintores, botiquines, camillas, desfibriladores con vencimiento y control. DS 594.
El módulo Emergencias tiene planes y simulacros, pero no el inventario del equipamiento.

### B-08 · Comité Bipartito de Capacitación
Ley SENCE. No existe. Menor prioridad: solo aplica sobre 15 trabajadores.

### B-09 · Calendario transversal de actividades preventivas
Hay actas por módulo (CPHS, emergencias) pero no una vista de calendario que cruce
inspecciones, capacitaciones y reuniones.

---

## P2 — Mejoras estructurales detectadas de paso

### B-10 · El Mapa de Riesgos está enterrado
DS 44 Art. 62 (Título III Párrafo 6) lo exige como instrumento **distinto** de la matriz
IPER, con su propia exigibilidad, contenido y visibilidad. Hoy vive como pestaña dentro
de MIPER ([`miper-workbench.tsx:165`](app/(app)/prevencion/miper/miper-workbench.tsx#L165)).
Un fiscalizador los pide por separado. Candidato a ítem propio del sidebar.

### B-11 · `/pdtp/aprobaciones` y `/pdtp/obligaciones` muestran la misma bandeja
Ambas llaman `listPendingPdtpExecutions()`. Dos filas del sidebar para la misma cola de
ejecuciones pendientes de aprobación. Decisión de producto: cuál se queda con ella.

### B-12 · Subagrupar Registro documental por sujeto
Idea tomada de Safeti: `Empresa / Trabajador / Contratista / Externa`. Responde
"¿de quién es este papel?", que es como se busca durante una fiscalización.

### B-13 · Separar instrumento de evidencia de entrega
Ya lo hacemos en capacitación (sesión + asistencia). No lo hacemos en documentos:
un documento publicado no deja rastro nominativo de a quién se le entregó.

---

## Verificados y descartados — no volver a reportar

| Reportado como hueco | Realidad |
|---|---|
| **ODI / Derecho a Saber** | Existe: `kind: 'odi'` en el catálogo de cursos ([`training.ts:36`](db/schema/prevention/training.ts#L36)), con asistencia como evidencia. Safeti lo modela como documento + entrega; ambos caminos cumplen el DS 44 Art. 15. |
| **Investigación separada de cuasi-accidentes / accidentes / EEPP** | Nuestro `eventType` de 8 valores ([`incidents.ts:56`](db/schema/prevention/incidents.ts#L56)) cubre los tres en un flujo, más daño material, derrame, evento vehicular y terceros. Nuestro modelo es superior a los tres módulos separados de Safeti. |
| **Objetivos SST (ISO 6.2)** | Existen, dentro de la pestaña de planificación del PDTP. |
| **Simulacros** | Existen dentro de Emergencias. |
| **Actas de reunión** | Existen en CPHS y Emergencias. Lo que falta es el calendario transversal (B-09). |
| **Gestión del cambio, CAPA transversal, matriz de competencias, requisitos legales, cobertura del programa** | Los tenemos y Safeti no. |

---

## Contexto: por qué nuestro modelo difiere

Safeti tiene el `% de cumplimiento de tareas` como columna en cinco módulos
independientes (Programa, IPER, Inspección, Protocolos, GRD), sin relación entre ellos.
No existe allá el concepto de "esta inspección cumple una actividad del programa".

Nuestro `prevention_pdtp_source_links` con sus 12 `sourceType`
([`risk-legal.ts:389`](db/schema/prevention/risk-legal.ts#L389)) es exactamente ese eje.
Por eso a Safeti le sirve un menú plano de 14 cajas y a nosotros no: un archivador no
necesita agrupación por ciclo; un motor de cumplimiento sí.

Esa diferencia también explica por qué su cobertura es más ancha y la nuestra más
profunda. Este documento existe para cerrar el ancho sin perder el fondo.
