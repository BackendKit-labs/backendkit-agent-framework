# SPEC-0040: diseñador de agentes en la web (de una tarea al diseño y a los pasos para construirlo)

**Fecha:** 2026-11-19
**Estado:** Borrador. Sin fases hechas.
**Origen:** idea del autor (2026-11-19): que un visitante de la web escriba una tarea cualquiera ("diseña un agente que haga esto") y reciba el **diseño** del agente y **cómo construirlo con el framework**, con opción de descargarlo. No entrega el agente creado.
**Depende de:** la web (`site/`, Astro + Starlight en Vercel, estática), los esquemas con zod del framework y las guías ya escritas (`site/src/content/docs`).
**Tipo de cambio:** una herramienta de la web. Sin cambios en `agent-core`. Si el esquema de la especificación se quiere reutilizar fuera de la web, se estudia en la F3 (§6).
**Fuera de alcance:** generar el agente ya construido, tocar Hermes o Steward (se aplazan; ver §7), y un servidor propio con la clave del proyecto en las primeras fases.

## 1. Qué es y qué no es

El visitante describe una tarea. La herramienta responde con dos cosas:

1. **El diseño:** qué agentes hacen falta, qué tools tiene cada uno y con qué banderas (`readOnly`, `destructive`, `idempotent`), la política y las aprobaciones, si hace falta un flujo, el presupuesto y cómo se prueba.
2. **Cómo construirlo:** pasos ordenados con el framework, con un esqueleto de código y enlaces a las guías que ya existen.

Se puede **descargar** (un documento Markdown y la especificación en JSON). No se ejecuta nada y no se crea ningún proyecto.

## 2. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Qué produce el modelo? | Una **especificación estructurada** (JSON validado con un esquema), no texto libre ni código libre. |
| D2 | ¿Quién escribe el documento y el código de ejemplo? | Una **plantilla determinista** a partir de la especificación. El modelo no escribe llamadas a la API del framework: así no puede inventar funciones. |
| D3 | ¿Quién paga el modelo? | **Clave del propio visitante**, usada desde su navegador. Coste cero para el proyecto, nada que abusar, y el prompt no pasa por nosotros. Una versión alojada con clave del proyecto y límites queda como decisión posterior (F3). |
| D4 | ¿Cómo conoce el modelo el framework? | Se le da como contexto un resumen de las guías (generado en la compilación de la web, desde las mismas páginas), no su memoria. |
| D5 | ¿Qué hacer con lo peligroso? | Toda tool `destructive` y toda regla de política se marcan **"lo decide una persona"** en el documento. El diseño es una propuesta para revisar, y la herramienta lo dice. |

## 3. La especificación

Campos mínimos (se fijan en la F0): objetivo; agentes (id, función, tools permitidas, delegaciones); tools (nombre, qué hacen, banderas declaradas, entradas); política y aprobaciones; flujo (si hay pasos largos, esperas o puerta humana); presupuesto; riesgos y qué debe revisar una persona; cómo se prueba (casos para el proveedor simulado y evals).

La validación rechaza lo incoherente: una tool `readOnly` que además es `destructive`, una tool citada por un agente que no está definida, un agente que delega en uno inexistente. Si el modelo devuelve algo inválido, se le devuelve el error una vez; si falla otra vez, la herramienta lo dice sin inventar nada.

## 4. Riesgos y cómo se tratan

- **Diseño que no compila:** el esqueleto de código sale de plantillas. En CI se compila cada plantilla contra los paquetes publicados, de modo que un cambio de API rompe la compilación y no al visitante.
- **Diseño plausible pero malo:** el modelo puede proponer algo inseguro o innecesario. Por eso D5, y por eso la F2 mide la calidad con casos (§5).
- **Clave del visitante:** vive solo en memoria del navegador (opcionalmente en la sesión), se envía solo al proveedor elegido, y no se registra ni se envía a la web. Se dice en pantalla.
- **Cuotas y fallos del proveedor:** el error se muestra tal cual, sin reintentos ocultos que gasten la clave.
- **Afirmar de más:** el documento no dice "listo para producción". Cada punto cuya verificación dependa del caso concreto se marca como tal.

## 5. Fases

| Fase | Qué | Criterio de hecho |
|---|---|---|
| **F0** | Esquema de la especificación, validaciones y plantillas (documento y esqueleto), probados con especificaciones escritas a mano, **sin modelo**. Averiguar qué proveedores aceptan llamadas directas desde el navegador (CORS). | Las plantillas compilan en CI contra los paquetes publicados. Hay una lista verificada de proveedores utilizables desde el navegador. |
| **F1** | Página en la web: descripción de la tarea, clave del usuario, un proveedor, validación con un reintento, vista del diseño y descarga (Markdown y JSON). | Con un proveedor real, 5 tareas distintas dan un diseño válido. Sin clave, la página lo explica. |
| **F2** | Calidad: casos con propiedades esperadas (una tarea con pagos produce una tool `destructive` y una aprobación; una consulta pura no pide aprobación) y medición con el proveedor real. Más proveedores. | Los casos pasan de forma repetible, y el informe dice con qué modelos se midió. |
| **F3** | Decisión: versión alojada con clave del proyecto y límites, y si la especificación se publica como parte de `agent-core` o de un paquete. | Lo decide el autor con datos de uso de la F1 y F2. No se crea ningún paquete sin consulta. |

## 6. Decisiones abiertas

1. ¿Qué proveedor primero en la F1? Depende de la verificación de CORS de la F0.
2. ¿El idioma del documento es el de la tarea o el de la web (inglés)? Propuesta: el de la tarea, con los términos del framework en inglés.
3. ¿Se guarda algo del lado del visitante (historial de diseños)? Propuesta: nada en la F1; solo la descarga.

## 7. Aplazado

Un paso de diseño en workflows de Hermes y su uso desde Steward: el mismo agente y esquema podrían servir ahí, pero no se toca hasta que la web demuestre el valor. Se retoma con una spec propia, tras revisar cómo define Hermes sus workflows.
