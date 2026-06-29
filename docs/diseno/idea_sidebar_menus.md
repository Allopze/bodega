# Safeti (SFTI) - Guía Completa de Secciones

> [!NOTE]
> Exploración completa de todas las secciones de `web.safeti.cl` realizada el 16 de junio de 2026.
> Se visitaron ~30 páginas para documentar el contenido de cada módulo.

---

## 1. 🏢 Estructura Organizacional

Gestiona la jerarquía organizacional de la empresa.

### Empresa (`/empresa/ver/`)
- **Vista**: Formulario/Ficha de datos
- **Contenido**: Datos de la empresa — RUT, razón social, dirección, teléfono, email, representante legal, actividad económica, mutualidad asociada
- **Acciones**: Editar datos de la empresa

### Sucursal (`/sucursal/lista/`)
- **Vista**: Tabla
- **Columnas**: Nombre, Dirección, Teléfono, Tipo, Estado
- **Acciones**: Agregar sucursal, Ver, Editar, Filtros

### Faena (`/faena/lista/`)
- **Vista**: Tabla
- **Columnas**: Nombre, Sucursal, Dirección, Estado
- **Acciones**: Agregar faena, Filtros

### Contratista (`/contratista/lista/`)
- **Vista**: Tabla
- **Columnas**: RUT, Razón social, Dirección, Teléfono, Email, Sucursal, Faena, Estado
- **Acciones**: Agregar contratista, Ver, Editar, Filtros

### Trabajador (`/trabajador/lista/`)
- **Vista**: Tabla
- **Columnas**: RUT, Nombre, Apellido, Cargo, Sucursal, Faena, Contratista, Estado
- **Registros**: Base de datos de todos los trabajadores
- **Acciones**: Agregar trabajador, Ver, Editar, Importar, Filtros

---

## 2. 📄 Documentación

El módulo más grande. Gestiona toda la documentación legal y normativa.

### 2.1 Empresa

#### Reglamento Interno (`/reglamento/interno/lista/`)
- **Qué es**: Registro de los reglamentos internos de la empresa (obligatorio por ley en Chile)
- **Vista**: Tabla
- **Columnas**: Título, Versión, Fecha, Estado, Realizador
- **Acciones**: Agregar, Ver, Descargar PDF

#### Info. Riesgos Laborales - General (`/derechoasaber/general/lista/`)
- **Qué es**: Derecho a Saber (ODI) — Información general de riesgos que aplica a todos los trabajadores
- **Vista**: Tabla
- **Columnas**: Título, Versión, Fecha, Sucursal, Faena, Estado
- **Acciones**: Agregar, Ver, Descargar

#### Info. Riesgos Laborales - Específico (`/derechoasaber/especifico/lista/`)
- **Qué es**: ODI específico por cargo — Riesgos particulares de cada puesto de trabajo
- **Vista**: Tabla
- **Columnas**: Título, Cargo, Versión, Fecha, Sucursal, Faena, Estado
- **Acciones**: Agregar, Ver, Descargar

#### Capacitación - Evaluaciones (`/registro/capacitacion/evaluacion/lista/`)
- **Qué es**: Banco de evaluaciones/pruebas para medir el conocimiento de los trabajadores post-capacitación
- **Vista**: Tabla
- **Columnas**: Título, Tipo, Estado, Realizador
- **Acciones**: Agregar evaluación, Ver, Editar

#### Capacitación - Listado (`/registro/capacitacion/lista/`)
- **Qué es**: Registro de todas las capacitaciones realizadas (charlas, cursos, inducciones)
- **Vista**: Tabla
- **Columnas**: Fecha, Tipo, Título, Relator, Sucursal, Faena, Duración, N° asistentes, Estado
- **Acciones**: Agregar capacitación, Ver, Filtros

#### Registro de Documentos (`/registro/documento/lista/`)
- **Qué es**: Repositorio general de documentos de la empresa (políticas, procedimientos, etc.)
- **Vista**: Tabla
- **Columnas**: Tipo, Título, Fecha, Versión, Sucursal, Faena, Estado, Realizador
- **Acciones**: Agregar documento, Ver, Descargar, Filtros

#### Registro de Formularios (`/planilla/personalizada/lista/`)
- **Qué es**: Formularios personalizados creados por la empresa para diversos registros
- **Vista**: Tabla
- **Columnas**: Título, Tipo, Fecha creación, Estado
- **Acciones**: Agregar formulario, Ver, Editar

### 2.2 Trabajador

#### Entrega de Reglamento Interno (`/reglamento/interno/entrega/lista/`)
- **Qué es**: Registro de entrega del reglamento interno a cada trabajador (evidencia de cumplimiento)
- **Vista**: Tabla
- **Columnas**: Fecha entrega, Trabajador, RUT, Cargo, Sucursal, Faena, Estado
- **Acciones**: Registrar entrega, Ver, Filtros

#### Entrega ODI General (`/derechoasaber/general/entrega/lista/`)
- **Qué es**: Registro de entrega de la información de riesgos generales a trabajadores
- **Vista**: Tabla
- **Columnas**: Fecha, Trabajador, RUT, Cargo, Sucursal, Faena, Estado
- **Acciones**: Registrar entrega, Filtros

#### Entrega ODI Específico (`/derechoasaber/especifico/entrega/lista/`)
- **Qué es**: Registro de entrega de la información de riesgos específicos por cargo
- **Vista**: Tabla
- **Columnas**: Fecha, Trabajador, RUT, Cargo, Sucursal, Faena, Estado
- **Acciones**: Registrar entrega, Filtros

#### EPP - Elementos de Protección Personal (`/epp/entrega/lista/`)
- **Qué es**: Registro de entrega de EPP (cascos, guantes, lentes, etc.) a trabajadores
- **Vista**: Tabla
- **Columnas**: Fecha de entrega, Realizador, Trabajador, Cargo, Sucursal, Faena, Subárea, Tipo, Estado, Cantidad, Elementos
- **Registros encontrados**: 2
- **Acciones**: Entrega por cargo, Entrega especial, Filtros

### 2.3 Contratista

#### Registro de Documentos (`/registro/documento/contratista/lista/`)
- **Qué es**: Documentación requerida a empresas contratistas (seguros, certificaciones, etc.)
- **Vista**: Tabla
- **Columnas**: Contratista, Tipo documento, Título, Fecha, Vencimiento, Estado
- **Acciones**: Agregar, Ver, Filtros

### 2.4 Externa

#### Registro de Fiscalización (`/registro/fiscalizacion/lista/`)
- **Qué es**: Registro de visitas e inspecciones de organismos fiscalizadores (Inspección del Trabajo, SEREMI, etc.)
- **Vista**: Tabla
- **Columnas**: Fecha, Organismo, Tipo, Sucursal, Faena, Resultado, Estado
- **Acciones**: Agregar registro, Ver, Filtros

#### Registro de Mutualidad (`/registro/mutualidad/lista/`)
- **Qué es**: Registro de visitas y recomendaciones de la mutualidad de seguridad (ACHS, IST, Mutual, ISL)
- **Vista**: Tabla
- **Columnas**: Fecha, Tipo, Sucursal, Faena, Estado
- **Acciones**: Agregar, Ver, Filtros

---

## 3. 📋 Programa de Trabajo

### Listado (`/programa/trabajo/lista/`)
- **Qué es**: Programas de trabajo anuales de prevención de riesgos — planificación de actividades SST para el año
- **Vista**: Tabla
- **Columnas**: Año, Título, Sucursal, Faena, Tipo de proceso, Estado de cumplimiento, % cumplimiento tareas
- **Acciones**: Agregar programa, Ver, Filtros

---

## 4. ⚠️ Técnicas Preventivas

Herramientas y metodologías de gestión preventiva.

### IPER (`/iper/lista/`)
- **Qué es**: Identificación de Peligros y Evaluación de Riesgos — Matriz de riesgos por área/proceso
- **Vista**: Tabla
- **Columnas**: ID, Proceso, Área, Sucursal, Faena, Tipo de proceso, Cumplimiento tareas, Estado
- **Acciones**: Agregar IPER, Ver, Filtros
- **Nota**: Es la herramienta base de todo el sistema de gestión SST

### Inspección de Seguridad (`/inspeccion/seguridad/lista/`)
- **Qué es**: Inspecciones planificadas a las áreas de trabajo (condiciones inseguras)
- **Vista**: Tabla
- **Columnas**: Fecha, Tipo, Sucursal, Faena, Subárea, Realizador, Estado, Cumplimiento
- **Acciones**: Agregar inspección, Ver, Filtros

### Observación de Seguridad (`/observacion/seguridad/lista/`)
- **Qué es**: Observaciones de comportamiento (actos seguros/inseguros de trabajadores)
- **Vista**: Tabla
- **Columnas**: Fecha, Tipo, Trabajador observado, Sucursal, Faena, Realizador, Resultado
- **Acciones**: Agregar observación, Ver, Filtros

### Análisis de Riesgos del Trabajo (`/analisis/riesgo/lista/`)
- **Qué es**: ART — Análisis de riesgos previo a tareas con peligros significativos
- **Vista**: Tabla
- **Columnas**: Fecha, Tarea, Sucursal, Faena, Realizador, Estado
- **Acciones**: Agregar ART, Ver, Filtros

### AST - Análisis Seguro de Trabajo (`/ast/registro/lista/`)
- **Qué es**: Formulario AST — Análisis paso a paso de una tarea con identificación de riesgos y controles
- **Vista**: Tabla
- **Columnas**: Fecha, Tarea, Sucursal, Faena, Subárea, Realizador, Estado
- **Acciones**: Agregar AST, Ver, Filtros

### Investigación de Cuasi-accidentes (`/investigacion/cuasiaccidente/lista/`)
- **Qué es**: Registro e investigación de incidentes sin lesión (near-miss)
- **Vista**: Tabla
- **Columnas**: Fecha, Tipo, Descripción, Sucursal, Faena, Realizador, Estado
- **Acciones**: Agregar investigación, Ver, Filtros

### Investigación de Accidentes (`/investigacion/accidente/registro/lista/`)
- **Qué es**: Investigación completa de accidentes del trabajo (metodología árbol de causas, etc.)
- **Vista**: Tabla
- **Columnas**: Fecha, Tipo, Trabajador afectado, Sucursal, Faena, Días perdidos, Estado
- **Acciones**: Agregar investigación, Ver, Filtros

### Investigación de Enfermedades Profesionales (`/investigacion/enfermedad/registro/lista/`)
- **Qué es**: Investigación de enfermedades profesionales diagnosticadas
- **Vista**: Tabla
- **Columnas**: Fecha, Trabajador, Enfermedad, Sucursal, Faena, Estado
- **Acciones**: Agregar investigación, Ver, Filtros

---

## 5. 🔒 Permiso de Trabajo

### Listado (`/permiso/trabajo/lista/`)
- **Qué es**: Permisos de trabajo especiales para tareas de alto riesgo (trabajos en altura, caliente, espacios confinados, etc.)
- **Vista**: Tabla
- **Columnas**: Fecha, Tipo de permiso, Tarea, Sucursal, Faena, Responsable, Estado
- **Acciones**: Agregar permiso, Ver, Filtros

---

## 6. ✅ Auditoría

### Listado (`/auditoria/lista/`)
- **Qué es**: Vista general de auditorías del sistema de gestión SST
- **Vista**: Tabla
- **Acciones**: Agregar, Filtros

### Disponibles (`/auditoria/disponible/lista/`)
- **Qué es**: Plantillas de auditoría listas para ser aplicadas
- **Vista**: Tabla/Cards
- **Acciones**: Seleccionar y aplicar auditoría

### Realizadas (`/auditoria/realizada/lista/`)
- **Qué es**: Historial de auditorías completadas con sus resultados
- **Vista**: Tabla
- **Columnas**: Fecha, Tipo, Sucursal, Faena, Puntaje, Estado
- **Acciones**: Ver resultados, Descargar informe

---

## 7. 🔧 HEMTIE (Herramientas, Equipos, Maquinarias, Transportes, Instalaciones, Emergencia)

Gestión de activos físicos con sistema de códigos QR.

### Herramientas (`/herramienta/lista/`)
- **Qué es**: Inventario de herramientas (manuales, eléctricas, neumáticas)
- **Vista**: Tabla
- **Columnas**: ID, QR, Tipo, Centro de costo, Sucursal, Faena, Subárea, Lugar, Contratista, Estado, Realizador
- **Registros**: 79
- **Acciones**: Agregar herramienta, Ver, Imprimir QR, Filtros

### Equipos (`/equipo/lista/`)
- **Qué es**: Inventario de equipos (compresores, soldadoras, etc.)
- **Vista**: Tabla (filas expandibles)
- **Columnas**: ID, QR, Tipo, Centro de costo, Sucursal, Faena, Área/Subárea, Lugar, Contratista, Estado, N° componentes, Realizador
- **Registros**: 190
- **Acciones**: Agregar equipo, Ver, Imprimir QR, Filtros

### Maquinarias (`/maquinaria/lista/`)
- **Qué es**: Inventario de maquinaria pesada (grúas, retroexcavadoras, etc.)
- **Vista**: Tabla
- **Columnas**: ID, QR, Tipo, Código/Placa/Patente, Centro de costo, Sucursal, Faena, Subárea, Lugar, Contratista, Estado, Recepcionado por
- **Registros**: 74
- **Acciones**: Agregar maquinaria, Filtros

### Transportes (`/transporte/lista/`)
- **Qué es**: Inventario de vehículos de transporte
- **Vista**: Tabla
- **Columnas**: ID, QR, Tipo, Código/Placa/Patente, Marca, Modelo, Año de fabricación, Centro de costo, Sucursal, Faena, Subárea, Lugar
- **Registros**: 36
- **Acciones**: Agregar transporte, Filtros

### Instalaciones (`/instalacion/lista/`)
- **Qué es**: Inventario de instalaciones (bodegas, oficinas, plantas)
- **Vista**: Tabla (vacía actualmente)
- **Columnas**: ID, QR, Nombre, Tipo, Descripción, Contratista, Centro de costo, Sucursal, Faena, Subárea
- **Registros**: 0
- **Acciones**: Agregar instalación, Filtros

### Equipos de Emergencia (`/equipo/emergencia/lista/`)
- **Qué es**: Inventario de equipos de emergencia (extintores, camillas, botiquines, desfibriladores)
- **Vista**: Tabla
- **Acciones**: Agregar, Ver, Filtros

### EPP - Catálogo (`/elementos/proteccion/personal/lista/`)
- **Qué es**: Catálogo maestro de Elementos de Protección Personal disponibles
- **Vista**: Tabla
- **Columnas**: Nombre, Tipo, Descripción
- **Acciones**: Agregar EPP, Editar, Filtros

---

## 8. 🌊 Gestión del Riesgo de Desastres

### Listado (`/grd/registro/lista/`)
- **Qué es**: Planes de gestión del riesgo de desastres naturales y antrópicos (terremotos, tsunamis, incendios)
- **Vista**: Cards/Tarjetas (no tabla)
- **Registros**: 3 planes
- **Contenido por tarjeta**: Antecedentes, Faena/Empresa, Coordinador, Amenazas (Humanas/Naturales), Nivel de cumplimiento
- **Acciones por tarjeta**:
  - Comité GRD
  - Diagnóstico y análisis histórico
  - Identificación de amenazas
  - Planes de respuesta
  - Simulacros y entrenamientos

---

## 9. 👥 Comités

### Comité Paritario de Higiene y Seguridad (`/comiteparitario/inscripcion/lista/`)
- **Qué es**: Gestión del CPHS (obligatorio en empresas con +25 trabajadores en Chile)
- **Vista**: Tabla
- **Columnas**: Descripción, Periodo inicio, Periodo término, Realizador, Fecha cierre inscripción, Fecha votación, Sucursal, Faena, Subárea, Estado
- **Registros**: 1
- **Acciones**: Agregar, Acta de elección, Acta de representantes de empresa, Descargar folleto inscripción, Dar de baja

### Comité de Faena (`/comiteparitario/faena/inscripcion/lista/`)
- **Qué es**: Comité paritario de faena (para obras o proyectos con múltiples contratistas)
- **Vista**: Tabla
- **Acciones**: Agregar, Filtros

### Comité Bipartito (`/comitebipartito/lista/`)
- **Qué es**: Comité bipartito de capacitación (Ley SENCE)
- **Vista**: Tabla
- **Acciones**: Agregar, Filtros

---

## 10. 📊 Estadística

### Estadística Mensual (`/estadistica/mensual/lista/`)
- **Qué es**: Indicadores mensuales de seguridad y salud ocupacional (KPIs de SST)
- **Vista**: Tabla
- **Columnas**: Año, Mes, Realizador, Total trabajadores, Total HH del mes, Total HH trabajadas, N° accidentes con tiempo perdido, N° accidentes sin tiempo perdido, N° enfermedades, N° días perdidos, **Tasa de frecuencia**, **Tasa de gravedad**, **Tasa de siniestralidad**
- **Registros**: 9 meses registrados
- **Acciones**: Nueva estadística, Filtros
- **Nota**: Calcula automáticamente las tasas regulatorias chilenas

---

## 11. 📅 Planificación de Actividades

### Calendario (`/reunion/coordinacion/calendario/`)
- **Qué es**: Calendario visual de actividades de SST planificadas (reuniones, inspecciones, capacitaciones)
- **Vista**: Calendario interactivo (vista mensual/semanal)
- **Acciones**: Agregar actividad, Ver detalle

### Actas (`/reunion/coordinacion/acta/lista/`)
- **Qué es**: Registro de actas de reuniones de coordinación de actividades
- **Vista**: Tabla
- **Columnas**: Fecha, Título, Participantes, Sucursal, Faena, Estado
- **Acciones**: Agregar acta, Ver, Filtros

---

## 12. 🏥 Salud Ocupacional

### Protocolos de Vigilancia (`/protocolo/lista/`)
- **Qué es**: Gestión de protocolos de vigilancia de salud ocupacional del MINSAL
- **Vista**: Pestañas (tabs) con tablas independientes
- **Pestañas disponibles**:
  | Protocolo | Descripción |
  |-----------|-------------|
  | **PREXOR** | Protocolo de Exposición Ocupacional a Ruido |
  | **Psicosocial** | Riesgo psicosocial laboral (ISTAS 21) |
  | **Químicos cancerígenos** | Exposición a agentes químicos cancerígenos |
  | **Hiperbaria** | Trabajo en ambientes hiperbáricos |
  | **Exposición a frío o calor** | Estrés térmico |
  | **Polvo no especificado** | Exposición a polvo (silicosis, etc.) |
- **Columnas** (tab PREXOR): ID, Periodo inicio, Dónde aplica, Sucursal, Faena, Realizador, Tipo de proceso, Estado cumplimiento, Cumplimiento tareas
- **Registros**: 0 (PREXOR vacío actualmente)
- **Acciones**: Agregar protocolo, Filtros

---

## 13. 🧪 Gestión de Calidad

### Registro Microbiológico (`/registro/microbiologico/lista/`)
- **Qué es**: Registros de análisis microbiológicos (empresas de alimentos, agua potable, etc.)
- **Vista**: Tabla
- **Acciones**: Agregar, Ver, Filtros

### Control de Plagas (`/control/plaga/lista/`)
- **Qué es**: Registro de actividades de control de plagas (desratización, desinsectación, sanitización)
- **Vista**: Tabla
- **Acciones**: Agregar, Ver, Filtros

---

## 14. 📈 Análisis de Datos

### Paneles por Unidad (`/paneles/lista/unidad/`)
- **Qué es**: Dashboards interactivos con métricas a nivel de unidad de negocio
- **Vista**: Cards de paneles disponibles
- **Acciones**: Obtener/Generar panel

### Paneles por Empresa (`/paneles/lista/empresa/`)
- **Qué es**: Dashboards consolidados a nivel empresa
- **Vista**: Cards de paneles disponibles
- **Paneles disponibles**: 6
  - Estadísticas
  - Examen de salud ocupacional
  - Programa de trabajo
  - Elemento de protección personal
  - Capacitación
  - Comité paritario de higiene y seguridad
- **Acciones**: Obtener/Generar cada panel

### Paneles por Sucursal (`/paneles/lista/sucursal/`)
- **Qué es**: Dashboards filtrados por sucursal
- **Vista**: Cards de paneles
- **Acciones**: Obtener panel por sucursal

### Informes (`/informe/lista/`)
- **Qué es**: Generación de informes consolidados de gestión SST
- **Vista**: Tabla
- **Acciones**: Generar informe, Descargar, Filtros

### Reportes (`/reporte/lista/`)
- **Qué es**: Reportes prediseñados (reportes mensuales, trimestrales, anuales)
- **Vista**: Tabla
- **Acciones**: Generar reporte, Descargar, Filtros

---

## 🔑 Menú de Usuario

| Item | URL | Descripción |
|------|-----|-------------|
| Widgets | `/dashboard/configuracion/` | Personalizar los widgets del dashboard principal |
| Configuración empresa | `/empresa/configuracion/` | Configuración general de la empresa en el sistema |
| Perfil de usuario | `/usuario/edita/` | Editar datos del perfil del usuario logueado |
| Cerrar sesión | `/logout/` | Finalizar la sesión actual |

---

## Resumen General

| # | Módulo | Propósito | Items | Registros |
|---|--------|-----------|-------|-----------|
| 1 | Estructura organizacional | Jerarquía empresa → sucursal → faena → contratistas → trabajadores | 5 | — |
| 2 | Documentación | Gestión documental legal y normativa completa | 14 | — |
| 3 | Programa de trabajo | Planificación anual de actividades SST | 1 | — |
| 4 | Técnicas preventivas | IPER, inspecciones, observaciones, ART, AST, investigaciones | 8 | — |
| 5 | Permiso de trabajo | Permisos para tareas de alto riesgo | 1 | — |
| 6 | Auditoría | Auditorías internas del sistema de gestión | 3 | — |
| 7 | HEMTIE | Gestión de activos físicos con QR | 13 | 379+ |
| 8 | Gestión riesgo desastres | Planes de emergencia y simulacros | 1 | 3 |
| 9 | Comités | CPHS, faena y bipartito | 3 | 1 |
| 10 | Estadística | KPIs mensuales de SST | 1 | 9 |
| 11 | Planificación actividades | Calendario y actas de reuniones | 2 | — |
| 12 | Salud ocupacional | 6 protocolos MINSAL | 1 | — |
| 13 | Gestión de calidad | Microbiología y control de plagas | 2 | — |
| 14 | Análisis de datos | Dashboards, informes y reportes | 5 | 6 paneles |
