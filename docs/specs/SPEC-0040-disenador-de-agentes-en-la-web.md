# SPEC-0040: diseñador de agentes en la web (de una tarea al diseño y a los pasos para construirlo)

**Fecha:** 2026-11-19
**Estado:** Borrador. **F0 hecha (2026-11-21)**, ver §3-bis. F1 a F3 sin hacer.
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

Esquema en `site/designer/schema.ts` (zod, objetos estrictos: una clave desconocida se rechaza). Es un vocabulario cerrado del framework, incluidas las capacidades de las SPEC-0041 y SPEC-0042:

- **Agentes** (id, nombre, rol, tools permitidas, delegaciones) y **tools** (nombre, descripción, `effect`: `read`, `write` o `destructive`, argumentos tipados, credenciales que necesita). Un solo `effect` en lugar de dos banderas: una tool no puede ser `readOnly` y `destructive` a la vez.
- **Reglas de gobernanza:** tool, condición opcional (`argumento operador valor`), efecto (`allow`, `ask`, `deny`), motivo, tipos de aprobador que acepta, **roles de quien aprueba**, **caducidad de la solicitud**.
- **Gobernanza:** **cuatro ojos**, que el agente actúe por un usuario, que la aplicación dé un **directorio de aprobadores**, un **credential broker**, aprobaciones guardadas, y la **auditoría** (cadena de hashes; puntos de control firmados; ancla `none` o `file`).
- **Flujo** (pasos de agente, de tool o de una persona; durable o no), **presupuesto**, **casos de prueba** (qué pide un modelo guionizado, en qué agente, qué hace el aprobador y qué se espera) y **riesgos**, cada uno marcado si lo decide una persona.

La validación (`site/designer/validate.ts`) rechaza lo incoherente y avisa de lo permitido pero revisable:

- **Errores:** nombres duplicados; una tool, un agente, un argumento o un paso que no existen; una delegación a uno mismo; una condición sobre un argumento que no existe o con un tipo que no corresponde; roles sin directorio; caducidad sin aprobaciones guardadas; opciones de `ask` en una regla que no es `ask`; una tool `destructive` que ninguna persona puede aprobar; cuatro ojos sin usuario; credenciales sin broker; un paso de persona en un flujo no durable; y un caso de prueba que pide una tool que su agente no puede usar.
- **Avisos:** una tool que ningún agente usa; una `destructive` sin regla o con un `allow` incondicional o que ningún test muestra rechazada; auditoría firmada sin ancla ("*tamper-evident*, no prueba"); ancla en archivo (solo vale si el operador no puede escribirlo); roles sin cuatro ojos; sin presupuesto.

Si el modelo devuelve algo inválido, se le devuelve el error una vez; si falla otra vez, la herramienta lo dice sin inventar nada.

## 3-bis. Resultado de la F0 (2026-11-21)

**Dónde vive:** `site/designer/` (no es un paquete nuevo): `schema.ts`, `validate.ts`, `render.ts`, 5 diseños escritos a mano en `fixtures/` y dos archivos de pruebas con el ejecutor de Node (Node 24 quita los tipos, sin `tsx`). CI lo ejecuta en un paso nuevo, `node --test "site/designer/*.test.ts"`, después de construir los paquetes. Cuando la F1 meta el esquema en una página de Astro, `zod` pasa a ser dependencia de `site/`.

**Qué se probó (69 pruebas):**

- Los 5 diseños son válidos con **exactamente** los avisos esperados; cada código de error y de aviso tiene una prueba que lo provoca; el esquema rechaza nombres que podrían llevar código, vocabulario fuera de lo cerrado y entradas que no son un diseño.
- El documento es determinista (byte a byte), dice que es una propuesta y nunca "listo para producción", pone cada tool irreversible, cada regla y cada riesgo de una persona en "Decisiones para una persona", y **todos sus enlaces apuntan a páginas y anclas que existen** en estas docs.
- El esqueleto (`tools.ts`, `agents.ts`, `policy.ts`, `engine.ts`, `evidence.ts` si la auditoría es firmada, y `agent.test.ts`) **se compila con TypeScript contra los paquetes de este repositorio** y **sus propias pruebas se ejecutan con el motor real**: las reglas del diseño producen los resultados que el diseño dice (un reembolso pequeño corre, uno grande queda pendiente, finanzas lo aprueba y corre; el que pidió no puede aprobar; un pago grande aprobado corre y uno rechazado no). Si cambia la API del framework, se rompe esa prueba y no el visitante.
- **Texto hostil:** un diseño cuyo texto intenta cerrar un comentario, una cadena, una tabla o un encabezado compila y sus pruebas pasan. En el código, lo que escribe el modelo solo aparece como literal de cadena JSON (con los separadores de línea U+2028 y U+2029 escapados) o en un comentario de una línea con el cierre `*/` neutralizado; en el documento, en una línea y con `|` escapado. Una mutación (comillas sin escapar) hace fallar dos pruebas.

**Lo que la F0 descubrió y quedó resuelto:**

1. **Una política propia sustituye a la de por defecto.** Un diseño con reglas dejaba una tool `destructive` sin regla *abierta*. El esqueleto termina siempre con lo que hacía la de por defecto: una tool de solo lectura corre, una `destructive` pregunta a una persona y cualquier otra que pueda cambiar cosas pregunta.
2. **Una prueba de rechazo puede pasar por la razón equivocada.** Un caso que pedía `refund_order` al primer agente, que no puede usarla, "pasaba" porque la llamada se rechazaba, no por la regla. Ahora cada caso dice en qué agente corre (`agent`) y es un error que pida una tool que ese agente no puede usar (`TEST_TOOL_NOT_ALLOWED`). Lo encontró ejecutar el esqueleto, no leerlo.
3. **Un presupuesto con precio cero no salta nunca.** El precio del modelo es un parámetro obligatorio del esqueleto, no un valor por defecto.
4. **Las claves no están en el código:** son parámetros (`auditSigningKeyPem`, `credentialBroker`, `approverDirectory`).

**Lo que la F0 no hace:** no genera el código de un flujo (el documento lo describe y enlaza a las guías de flujos); no ha probado nada con un modelo real; y el HTML que muestre la F1 tiene que escapar el texto que escribió el modelo.

**CORS desde el navegador (comprobado el 2026-11-21 con una petición de verificación previa `OPTIONS` y el origen de esta web):**

| Proveedor | Respuesta | `Access-Control-Allow-Origin` |
|---|---|---|
| Anthropic | 200 | `*` (admite la cabecera `anthropic-dangerous-direct-browser-access`, necesaria) |
| OpenAI | 200 | el origen de esta web |
| DeepSeek | 200 | el origen de esta web |
| Gemini | 200 | el origen de esta web |
| OpenRouter | 204 | `*` |
| Groq | 204 | `*` |
| Mistral | 200 | `*` |

**Qué no prueba:** solo la verificación previa. No se hizo la petición real porque requiere una clave, así que falta confirmar que la **respuesta** (y la de streaming) también lleva la cabecera, y qué dice cada proveedor de usar la clave desde un navegador. Hasta la F1, un proveedor es "probable", no "verificado". Anthropic exige además una cabecera con "dangerous" en el nombre: la página tiene que decirle al visitante por qué.
## 4. Riesgos y cómo se tratan

- **Diseño que no compila:** el esqueleto de código sale de plantillas. En CI se compila cada plantilla contra los paquetes publicados, de modo que un cambio de API rompe la compilación y no al visitante.
- **Diseño plausible pero malo:** el modelo puede proponer algo inseguro o innecesario. Por eso D5, y por eso la F2 mide la calidad con casos (§5).
- **Clave del visitante:** vive solo en memoria del navegador (opcionalmente en la sesión), se envía solo al proveedor elegido, y no se registra ni se envía a la web. Se dice en pantalla.
- **Cuotas y fallos del proveedor:** el error se muestra tal cual, sin reintentos ocultos que gasten la clave.
- **Afirmar de más:** el documento no dice "listo para producción". Cada punto cuya verificación dependa del caso concreto se marca como tal.

## 5. Fases

| Fase | Qué | Criterio de hecho |
|---|---|---|
| **F0** | **Hecha.** Esquema de la especificación, validaciones y plantillas (documento y esqueleto), probados con especificaciones escritas a mano, **sin modelo**. Averiguar qué proveedores aceptan llamadas directas desde el navegador (CORS). | Las plantillas compilan en CI contra los paquetes publicados. Hay una lista verificada de proveedores utilizables desde el navegador. Ver §3-bis: las plantillas compilan en CI y sus pruebas pasan con el motor real; la lista de CORS es de la verificación previa, no de la petición real. |
| **F1** | Página en la web: descripción de la tarea, clave del usuario, un proveedor, validación con un reintento, vista del diseño y descarga (Markdown y JSON). | Con un proveedor real, 5 tareas distintas dan un diseño válido. Sin clave, la página lo explica. |
| **F2** | Calidad: casos con propiedades esperadas (una tarea con pagos produce una tool `destructive` y una aprobación; una consulta pura no pide aprobación) y medición con el proveedor real. Más proveedores. | Los casos pasan de forma repetible, y el informe dice con qué modelos se midió. |
| **F3** | Decisión: versión alojada con clave del proyecto y límites, y si la especificación se publica como parte de `agent-core` o de un paquete. | Lo decide el autor con datos de uso de la F1 y F2. No se crea ningún paquete sin consulta. |

## 6. Decisiones abiertas

1. ¿Qué proveedor primero en la F1? La verificación previa de la F0 deja a los siete como probables (§3-bis); falta la petición real. Propuesta: empezar por uno que el autor ya use (DeepSeek está probado en vivo con el framework).
2. ¿El idioma del documento es el de la tarea o el de la web (inglés)? Propuesta: el de la tarea, con los términos del framework en inglés.
3. ¿Se guarda algo del lado del visitante (historial de diseños)? Propuesta: nada en la F1; solo la descarga.

## 7. Aplazado

Un paso de diseño en workflows de Hermes y su uso desde Steward: el mismo agente y esquema podrían servir ahí, pero no se toca hasta que la web demuestre el valor. Se retoma con una spec propia, tras revisar cómo define Hermes sus workflows.
