# Cuestionario para el equipo de Identidad (v2)

Documento de trabajo de [SPEC-0044](SPEC-0044-identidad-digital-del-agente.md), F3. **No es una especificación: son las preguntas cuyas respuestas faltan** para escribir el adaptador del sistema de identidad real. Las respuestas se anotan debajo de cada pregunta y, al final, se comparan con lo que hoy se *asume* (§ «Lo que asumimos hoy»).

Esta versión (2026-11-24) **sustituye a la primera**. Cambia el planteamiento: ya no preguntamos «¿se parece a nuestro formato?», sino **«¿cuál es el vuestro?»**, porque hay (al menos) dos familias de sistemas y nuestro modelo asumido solo describe una. Se conserva la numeración A1–E2 de la primera versión para no perder lo ya enviado; las preguntas nuevas llevan **(nueva)**.

Cómo usarlo: se envía tal cual. Cada pregunta dice **por qué se hace** y **qué cambia en el framework según la respuesta**, para que quien responda sepa qué se decide con ella.

## Contexto, en cuatro líneas

Un agente de software actúa en nombre de una persona o de una entidad. El framework exige dos cosas antes de ejecutar nada: (1) **una identidad digital del agente** y (2) **un apoderamiento** que diga a nombre de quién actúa y qué puede hacer, con sus límites. Queremos que las respalde el sistema de identidad, no una cadena de texto que ponga la aplicación. Hoy las dos están **simuladas** con un formato propio; con vuestras respuestas escribiremos **un adaptador específico para vuestro sistema**, sin cambiar el núcleo.

## Las dos familias que conocemos, y por qué preguntamos

| | Familia **EUDI** (eIDAS 2) | Familia **W3C / registro distribuido** (p. ej. modelo Alastria ID, UNE 71307) |
|---|---|---|
| Credencial | SD-JWT VC o mdoc | Credencial verificable W3C (JWT o JSON-LD) |
| Identificadores | clave o certificado del emisor | DID, con su documento en un registro |
| Confianza en el emisor | listas de confianza del ecosistema | registro de emisores en el propio registro distribuido |
| Revocación | listas de estado | registro de estado o consulta en cadena |
| Titular típico | persona, con cartera en el móvil | persona, con cartera en el móvil |

**No sabemos en cuál de las dos está vuestro sistema, ni si es otra.** Nuestro formato asumido es de la primera. Si el vuestro es de la segunda, el adaptador es distinto (resolver un DID, otro algoritmo de firma, otra revocación). Las preguntas A1, B1 y F2 deciden eso.

## A. El apoderamiento (la credencial)

**A1. ¿En qué formato se emite?** SD-JWT VC, mdoc (ISO 18013-5), credencial verificable W3C en JWT, W3C en JSON-LD con prueba de datos, otro. ¿Con qué perfil o norma (ARF, UNE 71307, otra)?
*Por qué:* decide el adaptador entero. *Asumido:* SD-JWT VC, `typ` `dc+sd-jwt`.

**A2. Lista exacta de claims** y su significado, con un ejemplo real (sin datos reales) de una credencial completa. En concreto:
- identificador de la credencial;
- **quién es el agente al que se emite** (¿qué claim? ¿en qué espacio de nombres: DID, URN, otro?);
- **quién otorga el poder** (persona o entidad), cómo se identifica y si distingue persona física de entidad jurídica;
- **qué poderes concede**: estructura, vocabulario de acciones y de objetos, y cómo se expresan los límites (importe, moneda, recurso, periodo, número de usos);
- fechas de validez y si la caducidad es obligatoria;
- nivel de garantía de la identidad de la persona (¿eIDAS `low`/`substantial`/`high` u otro?).
*Asumido:* `sub` = agente; `represents: { id, kind, assurance }`; `powers: [{ action, object?, max?: { value, currency } }]`.

**A3. ¿Hay restricciones más allá de verbo, objeto e importe?** Horario, contraparte, país, número de operaciones, suma acumulada, condiciones…
*Por qué:* el framework **rechaza** una credencial con una restricción que no sabe aplicar (ignorarla concedería más de lo que se quiso). Hoy sabe aplicar: acciones, recursos, un importe máximo por operación y **medidas con nombre y máximo por operación** (p. ej. «filas borradas», «acciones por orden»), ver [SPEC-0045](SPEC-0045-limites-generales-del-apoderamiento.md). **No** sabe aplicar contadores por periodo ni ventanas horarias: necesitan estado o calendario, y se dejan a la lógica del agente.

**A4. ¿Quién firma y cómo se confía en el emisor?** ¿Una clave por emisor, certificado `x5c`, lista de confianza, DID resoluble, registro de emisores en cadena? ¿Cómo se publica y rota la clave?
*Asumido:* el operador lista emisores y claves.

**A5. ¿Puede delegarse?** ¿Un agente puede apoderar a otro? ¿Hasta qué profundidad, y solo reduciendo poderes? ¿Cómo viaja la cadena en la credencial?

**A6. ¿La persona consiente con su propia firma?** ¿Hay una prueba de consentimiento de quien otorga el poder sobre los poderes concedidos? ¿Con qué clave y formato?
*Asumido:* firma Ed25519 de la persona sobre un mensaje canónico.

**A7. ¿Qué alcance tiene el apoderamiento?** ¿Solo compras y transacciones con dinero, o cualquier acción en nombre de la persona (firmar, reservar, presentar un trámite, acceder a datos)? Y para el dinero: ¿el pago lo ejecuta el sistema o solo lo autoriza un tercero con la autenticación reforzada del pagador (PSD2/PSD3)?
*Por qué:* el framework es neutro (verbo, objeto, límites); el importe es una restricción más. *Asumido:* compras con importe máximo por operación; el pago real queda fuera del framework.

**A8 (nueva). ¿Existe una credencial de representación?** Es decir, un poder de una persona o entidad a **un tercero** (no solo «esta persona es quien dice ser»), con los límites dentro. Si no existe hoy, ¿está previsto, y con qué esquema?
*Por qué:* es lo que el framework llama mandato. Si el sistema solo certifica la identidad de personas, el poder lo tendríamos que emitir nosotros (y lo haríamos con un nivel de confianza distinto, que la auditoría marca).

## B. La identidad del agente y su clave

**B1. ¿Cómo se identifica un agente?** Formato del identificador (DID, URN, otro), quién lo asigna y si es estable ante rotaciones de clave.

**B1b (nueva). ¿Puede un agente de software ser titular?** ¿Puede tener su propio identificador y sus propias credenciales, o el sistema solo tiene titulares **persona** (con cartera en el móvil) y entidades?
*Por qué:* si solo hay personas, el agente no es titular: se identificaría con una clave que **la persona o la entidad le delega**, y el adaptador cambia por completo.

**B2. ¿Quién genera y custodia la clave del agente?** El agente (clave local), un KMS/HSM de la organización, o la plataforma del sistema (el agente pide firmar y nunca ve la clave).
*Por qué:* decide cómo registramos la clave pública del agente en la credencial y la latencia de cada firma (microsegundos en local, milisegundos en remoto, que se suman a cada llamada).

**B3. ¿Qué algoritmos de firma admite la clave del agente?** *Hoy el verificador de credenciales de referencia acepta EdDSA y ES256, y el núcleo verifica de serie las firmas de auditoría Ed25519.* Cualquier otro (**secp256k1**, que usan las claves de cadena compatibles con Ethereum, P-384, RS256…) hay que añadirlo antes de escribir el adaptador.

**B4. ¿Cómo se ata la credencial a esa clave?** ¿`cnf` (RFC 7800), el DID del titular, otro mecanismo? ¿Cómo se prueba la posesión (Key Binding JWT, firma de un reto propio, presentación con prueba)?
*Por qué:* sin esto un apoderamiento es una cadena que cualquiera que la lea puede usar. *Asumido:* `cnf.jwk` y un KB-JWT con `aud`, `nonce`, `sd_hash`.

**B5. ¿Cómo obtiene el framework la identidad y la firma de un agente?** ¿API del sistema (REST, SDK, token), con qué autenticación, qué latencia y qué disponibilidad? ¿Qué pasa si no responde?
*Por qué:* se llama en cada ejecución (con caché corta y plazo máximo); un proveedor lento o caído **deniega** la llamada.

**B6. ¿Cómo se rota o revoca la clave de un agente?** ¿Cómo se entera el framework de que la clave quedó comprometida?

## C. Estado, revocación y consulta

**C1. ¿Cómo se revoca un apoderamiento?** Lista de estado, consulta en línea, registro en cadena, caducidad corta. ¿Con qué retraso de propagación?
*Por qué:* una credencial revocada debe dejar de valer; si no se puede comprobar, se trata como revocada.

**C2. ¿Se puede consultar el estado de una credencial por id?** ¿Hay un endpoint, y con qué autenticación?

**C3 (nueva). ¿Se puede verificar sin conexión?** ¿Qué hace falta tener localmente (claves públicas, documentos DID, estado de revocación)? Si la verificación requiere leer un registro distribuido, ¿qué red, con qué latencia típica y qué finalidad (cuánto tarda en ser definitivo un cambio)?
*Por qué:* cada llamada del agente se verifica; si cuesta una consulta a una red, hay que decidir qué se cachea y cuánto, y qué pasa si la red no responde (**se deniega**).

## D. Alcance legal y de seguridad

**D1. ¿Qué valor tiene la firma del agente?** ¿Firma electrónica con efecto legal o firma técnica que prueba solo quién actuó? ¿Hay sello de tiempo cualificado?
*Por qué:* el framework **no** afirma valor legal (lo decide cada despliegue).

**D2. ¿Es compatible con eIDAS 2 / EUDI Wallet?** ¿En qué formato y con qué perfil? ¿Hay un camino previsto desde el modelo actual hasta el del ARF, y para qué fecha?
*Por qué:* el ARF exige SD-JWT VC y mdoc y deja el modelo W3C como opcional. Si el sistema no está en esa familia hoy, necesitamos saber si lo estará.

**D3. ¿Qué datos personales viajan en la credencial?** ¿Hay divulgación selectiva o pruebas que no revelen todo? ¿Qué se escribe en un registro distribuido (y cómo se compagina con el derecho de supresión)?
*Por qué:* el framework nunca guarda la credencial en la auditoría (solo su hash); queremos saber qué contiene para no filtrarla.

## E. Entorno de pruebas

**E1. ¿Hay un entorno de pruebas** (emisor, claves y credenciales de ejemplo) contra el que probar el adaptador, o solo documentación?

**E2. ¿Pueden darnos** 3 credenciales de ejemplo: una válida, una caducada y una revocada, con sus claves públicas?

## F. Acceso y relación (nueva sección)

**F1. ¿Cómo se accede?** ¿Hay API y SDK públicos, o hay que ser entidad adherida o cliente? ¿Qué requisitos tiene la adhesión (cuota, contrato, auditoría, certificación)?

**F2. ¿Qué documentación técnica es accesible y bajo qué licencia?** Especificaciones, esquemas de credencial, repositorios. ¿Podemos publicar un adaptador de código abierto que use el sistema, o solo uno privado?

**F3. ¿Qué garantías de servicio hay?** Disponibilidad, límite de peticiones, ventanas de mantenimiento, soporte. (Una caída **deniega** las llamadas de los agentes que dependen del sistema.)

**F4. ¿Quién es el interlocutor técnico** para dudas de integración, y cuál es el plazo razonable de respuesta?

---

## Lo que el framework ya hace, y no se pregunta

- La identidad la da **el proveedor**, nunca la credencial: lo que la credencial dice del agente solo se **compara** con lo que el proveedor resuelve (si no coinciden, no hay apoderamiento).
- **Falla cerrado**: sin identidad, sin persona, sin credencial, con proveedor caído, lento o con una prueba que no verifica, no se ejecuta nada.
- Cada evento de auditoría lo **firma la identidad del agente** y lleva si la posesión de la clave se probó (`holderBinding: proven | none`).
- Una credencial **al portador** (sin clave) se acepta solo si el operador no exige posesión, y la auditoría la marca `none`.
- El framework se conecta al sistema por **dos contratos**, y solo esos cambian con cada sistema: un `AgentIdentityProvider` (dice quién es el agente y, si puede, firma) y un `MandateVerifier` (convierte la credencial en un `Mandate` neutral, o la rechaza). El núcleo, la política y la auditoría no cambian.
- Los niveles de confianza se marcan en la auditoría: identidad **autoafirmada**, **con claves propias** o **avalada por un tercero**. Una credencial emitida por nosotros mismos es de las dos primeras.

## Lo que asumimos hoy (y lo que se sustituye)

Nuestro adaptador de referencia (`examples/mandate-agent/src/providers/eidas2-assumed.ts`) **supone** un formato de la familia EUDI: contenedor SD-JWT VC, con un contenido (los claims) que no es público y que estas preguntas cierran. **No se cambia**: se queda como está, y cuando haya respuestas se escribe **otro adaptador** para el sistema real. No se nombra ningún producto concreto.

| Pieza | Supuesto | Preguntas que lo cierran |
|---|---|---|
| Contenedor | SD-JWT VC | A1, D2 |
| Agente | `sub` = identidad del agente | A2, B1, B1b |
| Persona | `represents: { id, kind, assurance }` | A2 |
| Poderes | `powers: [{ action, object?, max? }]` | A2, A3, A7, A8 |
| Ligadura a clave | `cnf.jwk` + Key Binding JWT | B2, B3, B4 |
| Consentimiento | firma Ed25519 de la persona | A6 |
| Revocación | Token Status List | C1, C3 |
| Confianza en el emisor | claves que lista el operador | A4 |
| Algoritmos | EdDSA y ES256 | B3 |

## Respuestas

*(Se rellenan aquí, pregunta por pregunta. Al terminar se compara cada una con la tabla de arriba y se decide: ajustar el adaptador asumido o escribir uno nuevo.)*

| Pregunta | Respuesta | ¿Coincide con lo asumido? | Qué cambia |
|---|---|---|---|
| A1 | | | |
| A2 | | | |
| A3 | | | |
| A4 | | | |
| A5 | | | |
| A6 | | | |
| A7 | | | |
| A8 | | | |
| B1 | | | |
| B1b | | | |
| B2 | | | |
| B3 | | | |
| B4 | | | |
| B5 | | | |
| B6 | | | |
| C1 | | | |
| C2 | | | |
| C3 | | | |
| D1 | | | |
| D2 | | | |
| D3 | | | |
| E1 | | | |
| E2 | | | |
| F1 | | | |
| F2 | | | |
| F3 | | | |
| F4 | | | |
