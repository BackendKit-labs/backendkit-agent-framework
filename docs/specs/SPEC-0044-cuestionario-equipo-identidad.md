# Cuestionario para el equipo de Identidad

Documento de trabajo de [SPEC-0044](SPEC-0044-identidad-digital-del-agente.md), F3. **No es una especificación: son las preguntas cuyas respuestas faltan** para sustituir el formato que hoy se *asume* por el real. Las respuestas se anotan debajo de cada pregunta y, al final, se comparan con el modelo asumido (§ «Modelo asumido» abajo).

Cómo usarlo: se envía tal cual; cada pregunta dice **por qué se hace** y **qué cambia en el framework según la respuesta**, para que quien responda sepa qué se decide con ella. Lo que el framework ya hace (y no depende de un sistema concreto) está en la sección final, para no preguntarlo.

## Contexto, en cuatro líneas

Un agente de software actúa en nombre de una persona o de una entidad. El framework exige dos cosas antes de ejecutar nada: (1) **una identidad digital del agente** y (2) **un apoderamiento** que diga a nombre de quién actúa y qué puede hacer. Queremos que ambas las respaldel sistema de identidad, no una cadena de texto que ponga la aplicación. Hoy las dos están **simuladas** con un formato supuesto; necesitamos el real.

## A. El apoderamiento (la credencial)

**A1. ¿En qué formato se emite?** JWT, SD-JWT VC (RFC 9901), mdoc (ISO 18013-5), JSON-LD con prueba de datos, otro.
*Por qué:* decide el adaptador entero. *Asumido:* SD-JWT VC, `typ` `dc+sd-jwt`.

**A2. Lista exacta de claims** y su significado, con un ejemplo real (sin datos reales) de una credencial completa. En concreto:
- identificador de la credencial (`jti` u otro);
- **quién es el agente al que se emite** (¿`sub`? ¿otro claim? ¿en qué espacio de nombres: DID, URN, otro?);
- **quién otorga el poder** (la persona o entidad), cómo se identifica y si distingue persona física de entidad jurídica;
- **qué poderes concede**: estructura de la lista, vocabulario de acciones y de objetos, y cómo se expresan los límites (importe, moneda, recurso, periodo, número de usos);
- fechas de validez (`nbf`, `exp`) y si `exp` es obligatorio;
- nivel de garantía de la identidad de la persona (¿eIDAS `low`/`substantial`/`high` u otro?).
*Asumido:* `sub` = agente; `represents: { id, kind, assurance }`; `powers: [{ action, object?, max?: { value, currency } }]`.

**A3. ¿Hay restricciones más allá de verbo, objeto e importe?** Horario, contraparte, país, número de operaciones, suma acumulada, condiciones…
*Por qué:* el framework **rechaza** una credencial con una restricción que no sabe aplicar (ignorarla concedería más de lo que se quiso). Cada restricción nueva necesita un extractor en la aplicación.

**A4. ¿Quién firma y cómo se confía en el emisor?** ¿Una clave por emisor, certificado `x5c`, lista de confianza, DID resoluble? ¿Cómo se publica y rota la clave?
*Asumido:* el operador lista emisores y claves.

**A5. ¿Puede delegarse?** ¿Un agente puede apoderar a otro (un orquestador a un especialista)? ¿Hasta qué profundidad y con qué reglas (solo reducir poderes, nunca ampliar)? ¿Cómo viaja la cadena en la credencial?
*Por qué:* el framework tiene delegación entre agentes y hoy cada agente lleva su propio apoderamiento.

**A6. ¿La persona consiente con su propia firma?** ¿Hay una firma o prueba de consentimiento de quien otorga el poder sobre los poderes concedidos? ¿Con qué clave y formato?
*Por qué:* sin ella, el emisor podría conceder poderes que nadie aceptó. *Asumido:* firma Ed25519 de la persona sobre un mensaje canónico (id, agente, caducidad, quién, poderes).

## B. La identidad del agente y su clave

**B1. ¿Cómo se identifica un agente?** Formato del identificador (DID, URN, otro), quién lo asigna y si es estable ante rotaciones de clave.

**B2. ¿Quién genera y custodia la clave del agente?** El agente (clave local), un KMS/HSM de la organización, o la plataforma del sistema de identidad (el agente pide firmar y nunca ve la clave).
*Por qué:* decide cómo registramos la clave pública del agente en la credencial y la latencia de cada firma (microsegundos en local, milisegundos en remoto, que se suman a cada llamada).

**B3. ¿Qué algoritmos de firma admite la clave del agente?** El framework verifica Ed25519 de serie; otros (ES256, secp256k1, P-256…) necesitan un verificador que registre el operador.

**B4. ¿Cómo se ata la credencial a esa clave?** ¿Con `cnf` (RFC 7800: clave incrustada o `kid` referenciado) u otro mecanismo? ¿Cómo se prueba la posesión (Key Binding JWT, firma de un reto propio)?
*Por qué:* sin esto un apoderamiento es una cadena que cualquiera que la lea puede usar (credencial «al portador»). *Asumido:* `cnf.jwk` y un KB-JWT con `aud`, `nonce`, `sd_hash`.

**B5. ¿Cómo obtiene el framework la identidad y la firma de un agente?** ¿API del sistema de identidad (REST, SDK, token), con qué autenticación, qué latencia y qué disponibilidad? ¿Qué pasa si no responde?
*Por qué:* se llama en cada ejecución (con caché corta y plazo máximo); un proveedor lento o caído **deniega** la llamada.

**B6. ¿Cómo se rota o revoca la clave de un agente?** ¿Cómo se entera el framework de que la clave quedó comprometida?

## C. Estado, revocación y consulta

**C1. ¿Cómo se revoca un apoderamiento?** Lista de estado (Token Status List, `status.status_list.{idx,uri}`), consulta en línea, caducidad corta. ¿Con qué retraso de propagación?
*Por qué:* una credencial revocada debe dejar de valer; si no se puede comprobar, se trata como revocada.

**C2. ¿Se puede consultar el estado de una credencial por id?** ¿Hay un endpoint y con qué autenticación?

## D. Alcance legal y de seguridad

**D1. ¿Qué valor tiene la firma del agente?** ¿Es una firma electrónica con efecto legal, o una firma técnica que prueba solo quién actuó? ¿Hay sello de tiempo cualificado?
*Por qué:* el framework **no** afirma valor legal (lo decide cada despliegue); necesitamos saber qué podemos decir con honestidad.

**D2. ¿El sistema es compatible con eIDAS 2 / EUDI Wallet?** ¿En qué formato y con qué perfil (ARF)? ¿Un apoderamiento de persona física a agente tiene un esquema público?

**D3. ¿Qué datos personales viajan en la credencial?** El framework nunca guarda la credencial en la auditoría (solo su hash); queremos saber qué contiene para no filtrarlo en registros.

## E. Entorno de pruebas

**E1. ¿Hay un entorno de pruebas** (emisor, claves y credenciales de ejemplo) contra el que probar el adaptador, o solo documentación?

**E2. ¿Pueden darnos** 3 credenciales de ejemplo: una válida, una caducada y una revocada, con sus claves públicas?

---

## Lo que el framework ya hace, y no se pregunta

- La identidad la da **el proveedor**, nunca la credencial: lo que la credencial dice del agente solo se **compara** con lo que el proveedor resuelve (si no coinciden, no hay apoderamiento).
- **Falla cerrado**: sin identidad, sin persona, sin credencial, con proveedor caído o con una prueba que no verifica, no se ejecuta nada.
- Cada evento de auditoría lo **firma la identidad del agente** y lleva si la posesión de la clave se probó (`holderBinding: proven | none`).
- Una credencial **al portador** (sin clave) se acepta solo si el operador no exige posesión, y la auditoría la marca `none`.
- Nada de esto depende de un proveedor: el adaptador del sistema traduce su formato a un `Mandate` neutral; el resto del framework no cambia.

## Modelo asumido hoy (lo que se sustituye)

Por ahora **tratamos nuestro formato supuesto como el de un sistema compatible con eIDAS 2**: contenedor SD-JWT VC y atestaciones públicas del ecosistema EUDI, con un contenido (los claims) que no es público y que estas preguntas cierran. No se nombra ningún producto concreto.

| Pieza | Supuesto | Dónde vive | Preguntas que lo cierran |
|---|---|---|---|
| Contenedor | SD-JWT VC | `examples/mandate-agent/src/providers/eidas2-assumed.ts` | A1 |
| Agente | `sub` = identidad del agente | ídem | A2, B1 |
| Persona | `represents: { id, kind, assurance }` | ídem | A2 |
| Poderes | `powers: [{ action, object?, max? }]`, sin nombres de tools | ídem | A2, A3 |
| Ligadura a clave | `cnf.jwk` + Key Binding JWT (`aud`, `nonce`, `sd_hash`) | ídem + `agent-mandates` | B2, B3, B4 |
| Consentimiento | firma Ed25519 de la persona | ídem + `adapter-kit` | A6 |
| Revocación | Token Status List | ídem | C1 |
| Confianza en el emisor | claves que lista el operador | ídem | A4 |

## Respuestas

*(Se rellenan aquí, pregunta por pregunta, según se vayan obteniendo. Al terminar se compara cada una con la tabla de arriba y se refactoriza el adaptador.)*

| Pregunta | Respuesta | ¿Coincide con lo asumido? | Qué cambia |
|---|---|---|---|
| A1 | | | |
| A2 | | | |
| A3 | | | |
| A4 | | | |
| A5 | | | |
| A6 | | | |
| B1 | | | |
| B2 | | | |
| B3 | | | |
| B4 | | | |
| B5 | | | |
| B6 | | | |
| C1 | | | |
| C2 | | | |
| D1 | | | |
| D2 | | | |
| D3 | | | |
| E1 | | | |
| E2 | | | |
