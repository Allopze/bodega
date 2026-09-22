# Manual de Usuario del Módulo de Prevención de Riesgos (SG-SST)
### Plataforma de Gestión Operativa CHOME

> **Dirigido a:** Prevencionistas de Faena (PRF), Jefes de Terreno (JT), Supervisores de Operaciones y Administradores de Contrato.  
> **Alcance Operativo:** Faenas Biodiversa, Cholguan - Arauco, Horcones, Masisa, Santa Fe - Grúas y Teno - Arauco.  
> **Marco Legal:** Ley 16.744, DS 44 (Gestión de la SST), DS 594 (Condiciones ambientales y sanitarias), DS 76 (Contratistas), DS 54 (CPHS) y Ley 21.719 (Protección de datos personales).

---

## 1. Bienvenida y Propósito del Manual

Estimado/a Prevencionista y Línea de Mando:

Este manual está diseñado para ser tu herramienta de consulta permanente en la faena. Su objetivo es explicarte, con un lenguaje directo, práctico y sin tecnicismos informáticos innecesarios, **cómo realizar tus labores preventivas diarias en la plataforma**, garantizando el cumplimiento legal ante fiscalizaciones (Dirección del Trabajo, SEREMI de Salud, Organismos Administradores Mutual/ACHS) y auditorías de empresas mandantes.

En esta plataforma, **el trabajo preventivo real en terreno se conecta automáticamente con los compromisos anuales**. Cuando ejecutas una inspección, completas una ocurrencia del catálogo anual de capacitación o gestionas una tarjeta PPA, el sistema acredita esa actividad en el Programa de Trabajo Preventivo (PDTP) de tu faena cuando existe un mapeo explícito.

---

## 2. Los Roles en la Faena: ¿Quién hace qué?

Para asegurar la transparencia y validez legal de los registros, la plataforma aplica el principio de **segregación de funciones**: *quien elabora un registro no debe ser quien lo apruebe o cierre sobre sí mismo*.

| Rol en Plataforma | Cargo Habitual en Terreno | Foco Principal en el Módulo |
|---|---|---|
| `prevencionista_faena` | Prevencionista de Riesgos de Faena (PRF) | Ejecución técnica diaria: inspecciones, capacitaciones, investigación RE-20, cierre de evaluaciones de trabajador nuevo, revisión de PPA, EPP y cierre de estadísticas mensuales. |
| `jefe_terreno` | Jefe de Terreno (JT) / Jefe de Faena | Reporte de incidentes, investigación preliminar, ingesta de planillas físicas, toma de conocimiento y ejecución de medidas correctivas. |
| `supervisor_terreno` | Supervisor de Turno / Operaciones | Registro de charla diaria de 5 minutos, acompañamiento de inspecciones, control de terreno y detención preventiva de tareas. |
| `admin_contrato` | Administrador de Contrato | Emisión y carga formal de DIAT ante la Mutual, gestión de recursos, coordinación con el mandante y revisión de cumplimiento global. |
| `prevencionista` | Jefa de Departamento de Prevención (JDPR) | Aprobación de plantillas, publicación de cursos, aprobación de matrices MIPER/CGRD, auditorías y gobernanza SG-SST. |

---

## 3. Mapa de Navegación del Módulo de Prevención

Al ingresar a la plataforma y seleccionar **Prevención** en el menú lateral, encontrarás 4 grandes bloques de trabajo:

```
PREVENCIÓN
├── Inicio de Prevención (/prevencion) -> Tu panel principal con "Atención requerida"
│
├── 1. PROGRAMA
│   ├── Programa de trabajo (/prevencion/pdtp) -> Planilla anual de 81 actividades por faena
│   ├── Matriz IPER (/prevencion/miper) -> Inventario de peligros y controles críticos
│   └── Requisitos legales (/prevencion/requisitos-legales) -> Normativa aplicable
│
├── 2. CUMPLIMIENTO DEL PROGRAMA
│   ├── Inspecciones (/prevencion/inspecciones) -> Pautas móviles y digitalización por foto OCR
│   ├── Capacitación (/prevencion/capacitacion) -> Control anual predefinido, evidencias y expediente histórico
│   ├── Acciones correctivas (/prevencion/capa) -> Planes de acción y verificación de eficacia
│   ├── Incidentes y accidentes (/prevencion/incidentes) -> Flujo legal RE-20 y DIAT
│   ├── Requisitos de EPP (/prevencion/epp-preventivo) -> Cruce de dotación vs. entregas de bodega
│   ├── Campañas preventivas (/prevencion/campanas) -> Se hizo / no se hizo, con evidencia de difusión (N°85-89)
│   ├── Emergencias (/prevencion/emergencias) -> Planes, brigadas, extintores y simulacros
│   ├── Comités paritarios (/prevencion/cphs) -> Actas, reuniones y certificación Mutual
│   └── Gestión de riesgos de desastres (/prevencion/cgrd) -> Comité y matriz de amenazas DS 44
│       └── Mapa de riesgos (/prevencion/cgrd/mapa) -> Plano de la faena con los peligros de la MIPER ubicados
│
├── 3. EN TERRENO
│   ├── Para, Piensa y Actúa (/prevencion/ppa) -> Tarjetas de detención y control en terreno
│   ├── Evaluaciones SST (/prevencion/evaluaciones) -> Inducción y acompañamiento de 4 semanas
│   ├── Permisos de trabajo (/prevencion/permisos) -> Trabajos críticos, AST y bloqueo LOTO
│   ├── Higiene y vigilancia (/prevencion/higiene) -> Protocolos MINSAL (PREXOR, PLANESI, TMERT)
│   └── Gestión del cambio (/prevencion/gestion-cambio) -> Evaluación de modificaciones operacionales
│
└── 4. SEGUIMIENTO Y GOBERNANZA
    ├── Visitas y coordinación (/prevencion/coordinacion) -> Fiscalizaciones DT/SEREMI y Mutual
    ├── Indicadores SST (/prevencion/indicadores) -> Cierre estadístico mensual de faena (HHT y tasas)
    ├── Daño material y ambiental (/prevencion/indicadores-material-ambiental) -> Pérdidas y derrames
    ├── Registro documental (/prevencion/documentacion) -> Procedimientos de Trabajo Seguro (PTS)
    ├── Estructura preventiva (/prevencion/faenas) -> Dotación y obligaciones legales por faena
    └── Datos personales (/prevencion/privacidad) -> Derechos de privacidad y confidencialidad clínica
```

---

## 4. Estructura de este Manual

Para facilitar la lectura durante la operación, el manual se organiza en los siguientes volúmenes y guías:

*   [**00. Guía Rápida: El Día a Día del Prevencionista**](./00-guia-rapida-dia-a-dia.md): Rutina recomendada para el turno de faena (inicio de jornada, inspecciones de terreno, contingencias y cierre mensual).
*   **Parte 1: Programa y Planificación**
    *   [01. Programa de Trabajo Preventivo (PDTP)](./parte-1-programa-y-planificacion/01-pdtp-programa-trabajo.md)
    *   [02. Registro de Constancias PDTP](./parte-1-programa-y-planificacion/02-constancias-pdtp.md)
    *   [03. Controles de Alcotest (DO-48)](./parte-1-programa-y-planificacion/03-alcotest.md)
    *   [04. Matriz IPER y Mapa de Riesgos](./parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md)
    *   [05. Matriz de Requisitos Legales](./parte-1-programa-y-planificacion/05-requisitos-legales.md)
*   **Parte 2: Gestión Operativa en Terreno**
    *   [06. Inspecciones y Digitalización por Foto OCR](./parte-2-gestion-operativa-en-terreno/06-inspecciones-terreno.md)
    *   [07. Capacitaciones, Charlas y Brechas](./parte-2-gestion-operativa-en-terreno/07-capacitacion-charlas-brechas.md)
    *   [08. Evaluaciones SST y Habilitación de Trabajadores](./parte-2-gestion-operativa-en-terreno/08-evaluaciones-sst-trabajador.md)
    *   [09. Para, Piensa y Actúa (PPA Digital)](./parte-2-gestion-operativa-en-terreno/09-ppa-digital.md)
    *   [10. Permisos de Trabajo Especiales (AST y LOTO)](./parte-2-gestion-operativa-en-terreno/10-permisos-trabajo-ast-loto.md)
    *   [11. Cobertura de EPP Preventivo](./parte-2-gestion-operativa-en-terreno/11-requisitos-epp.md)
*   **Parte 3: Eventos Críticos y Contingencias**
    *   [12. Incidentes y Accidentes (Expediente RE-20 y DIAT)](./parte-3-eventos-criticos-y-contingencias/12-incidentes-accidentes-re20.md)
    *   [13. Acciones Correctivas y Preventivas (CAPA)](./parte-3-eventos-criticos-y-contingencias/13-capa-acciones-correctivas.md)
    *   [14. Planes de Emergencia y Simulacros](./parte-3-eventos-criticos-y-contingencias/14-emergencias-simulacros.md)
    *   [15. Higiene Ocupacional y Protocolos MINSAL](./parte-3-eventos-criticos-y-contingencias/15-higiene-protocolos-minsal.md)
*   **Parte 4: Gobernanza y Seguimiento**
    *   [16. Comités Paritarios (CPHS)](./parte-4-gobernanza-y-seguimiento/16-comites-paritarios-cphs.md)
    *   [17. Comité de Gestión de Riesgo de Desastres (CGRD) y Mapa de Riesgos](./parte-4-gobernanza-y-seguimiento/17-gestion-riesgo-desastres-cgrd.md)
    *   [18. Gestión del Cambio (MOC)](./parte-4-gobernanza-y-seguimiento/18-gestion-del-cambio-moc.md)
    *   [19. Visitas Externas y Fiscalizaciones](./parte-4-gobernanza-y-seguimiento/19-visitas-coordinacion-externa.md)
    *   [20. Indicadores Estadísticos SST y Cierre Mensual](./parte-4-gobernanza-y-seguimiento/20-indicadores-sst-cierre-mensual.md)
    *   [21. Registro Documental y Difusión de PTS](./parte-4-gobernanza-y-seguimiento/21-registro-documental-pts.md)
    *   [22. Protección de Datos y Privacidad Clínica](./parte-4-gobernanza-y-seguimiento/22-privacidad-datos-sensibles.md)
*   **Anexos Operativos de Consulta Rápida**
    *   [Anexo A: Matriz Maestra de las 81 Actividades del PDTP](./anexos/anexo-a-matriz-81-actividades-pdtp.md)
    *   [Anexo B: Tabla de Roles y Permisos en Terreno](./anexos/anexo-b-roles-y-permisos-faena.md)
    *   [Anexo C: Preguntas Frecuentes (FAQ) y Casos Borde](./anexos/anexo-c-preguntas-frecuentes-faq.md)

---

## 5. Simbología Utilizada en el Manual

A lo largo de todos los capítulos encontrarás los siguientes bloques de ayuda visual:

> [!IMPORTANT]
> **REQUISITO OBLIGATORIO:** Pasos normativos o condiciones indispensables antes de poder guardar o avanzar un registro.

> [!WARNING]
> **PLAZO LEGAL O ALERTA CRÍTICA:** Fechas perentorias cuya omisión expone a sanciones de la Dirección del Trabajo, SEREMI de Salud o incumplimiento con el mandante.

> [!TIP]
> **CONSEJO DE TERRENO:** Recomendaciones prácticas para agilizar el trabajo diario, evitar retrabajo o resolver situaciones sin conexión óptima.

> [!NOTE]
> **REGLA DE SEGREGACIÓN:** Explica por qué ciertas acciones requieren la validación o firma de otro usuario para mantener la validez legal del registro.
