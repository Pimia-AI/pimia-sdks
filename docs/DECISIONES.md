# Decisiones de arquitectura — 2026-08-22 (rev. 3, mismo día)

Documento **idéntico en los cuatro repos** (factSaas, pimia-sdks,
pimia-web-shadcn, pimia-workspace), para que cualquier agente o persona que
trabaje en uno tenga las mismas decisiones delante. Si cambia una decisión, se
cambia aquí en los cuatro el mismo día. El mapa gráfico que lo acompaña:
https://claude.ai/code/artifact/4f04896d-2bd4-4c9b-b3d8-f2018119c72c

## El reparto: qué repo es qué

| Repo | Papel | Licencia / apertura |
|---|---|---|
| **Núcleo (factSaas)** | El producto. **Nunca se abre.** Abastece a todo como SaaS multitenant en `{tenant}.pimia.es`: API REST `/api/v1`, Authorization Server OAuth, MCP. Conserva TODO el núcleo de funcionalidad y el **panel central** (superadmin, gestoría, integradores). | cerrado |
| **pimia-sdks** | **Punto de entrada** del integrador y **único contrato público**: `spec/` (OpenAPI), `api.d.ts`, `@pimia/sdk`, `pimia/pimia-php`, `@pimia/design-tokens`. | MIT, publicado |
| **pimia-web-shadcn** | La capa web del ERP. **Punto de crecimiento nº 1.** Un integrador la forkea para su vertical web. | se abre cuando esté al 100 % |
| **pimia-workspace** | ERP de escritorio dentro de Buzz. **Punto de crecimiento nº 2.** Un integrador la forkea para su vertical de escritorio. Recibe `features/pimia/` de la web en bloque cuando la web esté al 100 %. | abierto y libre |

Con el núcleo cerrado, el núcleo es un **servicio, no una dependencia**: un
integrador no necesita su código, necesita un tenant y un client OAuth (que se
obtiene en el registro de Pimia o en el panel de integrador).

## Las decisiones

1. **El panel Vue de la pyme tiende a desaparecer: no se le hacen mejoras.**
   Queda congelado como referencia funcional de lo que la web tiene que
   igualar. Todo lo nuevo se hace en la web (y sube al escritorio).

2. **El panel central** (superadmin, gestoría, integradores) es Vue hoy y se
   migrará a React + shadcn **al final y sin prisa**: no se libera, la
   migración es estética. No se prioriza por delante de nada.

3. **Los privilegios son de la pyme, no del client.** Una pyme tiene los
   mismos derechos sobre su tenant contrate directo o a través de un
   integrador. La diferencia entre primera parte y partner no es de derechos,
   es de **quién responde del código que guarda el token**. El techo de cada
   app lo pone su lista blanca; el techo común, el Authorization Server.
   **Rev. 2:** el Authorization Server distingue **un client de primera
   parte** (el del panel web de Pimia, único, creado por seeder/comando y
   nunca por el registro dinámico) con un flag `first_party`: puede pedir
   todos los dominios y **no enseña la pantalla de consentimiento**. Los
   clients de integrador piden lo que el catálogo emita para partners,
   siempre con consentimiento. Dar `admin` a partners es una decisión
   aparte, posterior.
   **Hecho (2026-08-22).** El flag existe, se llama `first_party` y vive en
   la tabla de clients; nace en `false` y solo lo escribe un comando
   idempotente, nunca el registro dinámico. El catálogo gana un **segundo eje,
   `first_party_only`**, que es lo que permite emitir un scope sin dárselo a
   los integradores — así entraron `admin` y `delegation`. No es lo mismo que
   `privileged`: aquel mira **a dónde aterriza el código** (host de
   redirección de confianza), este **quién es el client**, y un scope puede
   necesitar uno, el otro, los dos o ninguno.
   Abrirle uno de esos dominios a los partners —la decisión posterior, que
   sigue pendiente— pide **dos cambios y no uno**: quitar el flag del scope Y
   añadir el dominio a la superficie pública. Que sean dos es deliberado: es
   lo que impide abrirlo a medias, con scope pero sin contrato o al revés.
   ⛔ **Saltarse el consentimiento exige TRES condiciones, no dos**: el flag,
   la sesión abierta y **redirect_uris registradas**. Un client sin ellas
   acepta cualquier redirect por compatibilidad; eso, más el salto, entregaría
   el código de autorización a donde diga quien construya la URL. La
   combinación es el agujero, no cada mitad.

4. **El catálogo OAuth es el cuello de botella, no las pantallas.** Hoy no
   emite `admin`, `settings:write`, `verifactu` ni `delegation`, y por eso la
   web no puede sustituir al panel Vue (usuarios, roles y módulos son justo lo
   que una pyme necesita para administrarse sin el panel viejo). **«El
   catálogo no lo emite» deja de ser respuesta final** y pasa a ser deuda del
   contrato. La dirección: emitir todos los dominios que el guard mapea
   **menos acuñar tokens**; que la pyme decida en la pantalla de
   consentimiento, con palabras de pyme. **Rev. 2:** la ruta de acuñado es
   `/mcp/tokens` (segmento `mcp → admin`), no `admin/tokens`; la exclusión se
   escribe como `domain_override` (`mcp/tokens* → null`). Y el editor de
   plantillas NO necesita `settings:write`: plantillas y series cuelgan de
   `invoices`, que ya se escribe; `settings:write` hace falta para impuestos,
   preferencias, empresa y campos personalizados.
   ⚠️ Condición: sanear antes las lecturas de `settings`. **Rev. 2, medido:**
   lo de las claves de proveedor y el ajuste por clave arbitraria ya está
   cerrado; siguen abiertos la clave SES sin cifrar y fuera de los patrones,
   el patrón `*_password` que no casa con `_pass`, dos GET con efectos
   (verifactu crea el taxpayer — ⚠️ cerrado el 2026-08-22 y verificado el 25 en
   el estudio de verifactu: el GET ya no crea nada; la frase sobrevivió a la
   corrección general de abajo y se fecha aquí—; estado OAuth del LLM), `default_scope`
   desconocido → acceso total con registro dinámico abierto, y el modo del
   guard por defecto en «observar». Eslabón 1 antes del 2.
   **Hecho (2026-08-22): la condición se cumplió y el catálogo ya está
   abierto.** Emite **para partners, con consentimiento**, `settings:write`,
   `reports:write` y `store:write`; **reservados a la primera parte**, `admin`
   y `delegation`. Fuera del mapa para todos, ni siquiera con `admin`, queda
   **acuñar credenciales — y son dos rutas, no una**: el minting de tokens que
   la rev. 2 ya nombraba y el puente del canal de wab-ai, porque el criterio
   es *fabricar una credencial*, no la ruta concreta. Un token acotado que
   puede fabricar otro token se ha acotado a sí mismo y a nadie más.
   ⛔ Tres cosas que parecían configuración resultaron ser tomas de cuenta y
   hubo que cerrarlas en el mismo cambio: **cambiar la contraseña o el correo
   del propio usuario** (no pedía la contraseña actual), **las escrituras de
   autenticación** (una de ellas acuña un token a cambio de credenciales,
   saltándose el Authorization Server entero) y **escribir credenciales por el
   escritor genérico de ajustes**, que acepta clave arbitraria y con el que se
   podía redirigir el correo del tenant a otro servidor. Las tres exigen ahora
   `admin` o se rechazan; la lección es que **partir un dominio se hace
   mirando sus rutas una a una**, no por su nombre.
   **Rev. 2026-08-27: la capa B de VeriFactu (configuración) se abre.**
   Decisión de 👤 (2026-08-26): la web sustituye al panel Vue y la pantalla de
   ajustes de VeriFactu no puede perderse. Es la opción C del estudio que
   midió la capa ruta a ruta (`ESTUDIO-MCP-VERIFACTU.md` § I.5-I.7, repo web),
   tomada por su camino condicionado y en su orden: primero las dos
   condiciones (permiso `manage company` en las cuatro rutas — «solo el
   dueño» era una propiedad del menú de Vue, no del sistema — y un
   `PUT /settings/verifactu` que ya no contesta 200 cuando la API falla), y
   entonces la apertura con los DOS cambios que la rev. 2 exige juntos: par
   `verifactu:read`/`verifactu:write` en el catálogo con **`first_party_only`**
   (el criterio de `admin`; dominio PROPIO y restringido, no colgado de
   `admin` ni de `settings`) y entrada en la lista blanca de
   `partner_surface`. Lo que NO cambia: `settings:read`, `admin:*` y el
   `api:read` genérico siguen sin alcanzarla, y un integrador no puede pedir
   el scope. El certificado es multiparte: entra en el contrato, y su
   pantalla web entra después por la puerta multiparte con su propia issue.

5. **Toda funcionalidad nueva del núcleo nace con ruta en `/api/v1` y tipo en
   el spec**, o no existe para nadie. Regenerar el OpenAPI y los tipos es un
   paso del release del SDK, no un acto manual.

6. **Orden de trabajo (rev. 2: la cadena tiene cinco eslabones, no dos):**
   1. ✅ **hecho (2026-08-22)** — sanear las lecturas de `settings` (núcleo);
   2. ✅ **hecho (2026-08-22)** — abrir el catálogo OAuth con el client de
      primera parte (núcleo);
   3. ✅ **hecho (2026-08-22)** — publicar las rutas de `admin` en `/api/v1` y
      en el spec, con un export reproducible (núcleo). Lo que era el bloqueo
      —que el spec no se regeneraba en limpio— está cerrado: `spec:export` crea
      un esquema temporal, lo migra con las migraciones de INSTANCIA y exporta
      contra él, y un test compara el artefacto commiteado con el regenerado
      byte a byte (#433, cierra #372). La causa era doble y la segunda mitad no
      estaba diagnosticada: el artefacto se generaba introspeccionando el plano
      CENTRAL, donde `public` conserva copias legacy de 49 tablas de negocio,
      así que el contrato describía un plano que la API no sirve.
      Sobre eso entraron las cuatro familias de `admin` —usuarios (#434), roles
      y permisos (#436), módulos de la instancia (#437) y correo (#438)—, más
      `GET /crm/assignable-users` (#439, cierra pimia-sdks#32), las descargas
      (#440) y los importes (#441).
      **La costura que lo hace posible: la superficie de PRIMERA PARTE.** El
      documento gana una tercera marca —`first-party-only`, junto a `any-token`
      y `owner-only`— para lo que existe en el contrato y solo puede llamar el
      client del panel de Pimia, con su requisito de seguridad de verdad
      (`admin:*`) y el scope publicado en el flow con «(solo el panel de Pimia)»
      delante. ⛔ Se abre por **lista blanca de segmentos**, no por dominio:
      `admin` son 57 rutas de `/api/v1` y entre ellas están las credenciales del
      proveedor de IA, la revocación de grants OAuth ajenos, los discos,
      transferir o borrar la empresa y la instalación de módulos subiendo un
      paquete. Un dominio no se abre por su nombre, se abre mirando sus rutas
      una a una — la lección del #426, aplicada.
   4. **← aquí estamos.** Release del SDK con el spec nuevo. ⚠️ Ya no es la
      0.6.0 aditiva: el contrato trae un **cambio de tipo**. Los importes dejan
      de viajar como texto (`"55370.00"` → `55370`, céntimos) en 78
      propiedades, y las descargas dejan de anunciarse como `application/json`.
      La nota de migración está escrita en `docs/changelog-desarrollador.md`;
      pimia-sdks#24 y #25 avisadas.
   5. portar en la web;
   6. **«100 %»** = la web puede sustituir al panel Vue de la pyme, medido
      contra las **22 maquetas + los 8 módulos de Vue sin maqueta que son
      portables con el catálogo actual** (banca y conciliación, SEPA,
      inversiones, y RRHH: equipo, calendario de ausencias, correcciones de
      fichaje, calendarios, horarios). POS y planes no entran (dominios fuera
      del catálogo; planes es del panel central). Las rutas de PDF y
      exportaciones que viven fuera de `/api/v1` se mueven dentro;
   7. barrido de lo privado en web y escritorio;
   8. abrir los dos repos;
   9. subir `features/pimia/` al escritorio en bloque;
   10. panel central a React + shadcn, cuando sobre tiempo.

   **El barrido no se adelanta.** **Deploy a prod: solo al terminar por
   completo en dev.** El escritorio ya es React + shadcn: el tema se aborda
   al final y el ERP trae el suyo.

7. **Cada vertical de terceros vive en su fork.** No hay una puerta por la que
   suban a Buzz a través de Pimia. El dialecto portable de `features/pimia/`
   (sin `"use client"`, sin carril de servidor, transporte por la costura) es
   una propiedad que Pimia mantiene para mover **su** ERP entre los dos
   anfitriones; al integrador se le cuenta como ventaja, no como obligación.

8. **El SDK es la única superficie** de los anfitriones abiertos: ni el MCP ni
   la API a pelo. Lo que falta se reporta al contrato; nunca se rodea.

9. **La web es el panel por defecto (rev. 2).** Un cliente que se registre
   en Pimia aterriza en pimia-web-shadcn, no en el panel Vue. Consecuencias:
   la web usa **un client OAuth global de primera parte** (no uno por
   tenant); **tenant por selección**, el subdominio después como azúcar de
   URL; el registro encadena el SSO que ya existe (entrar → auto-login) a
   `/oauth/authorize` y la web aterriza al tenant en su panel sin volver a
   teclear la contraseña; la lista blanca de la web pasa a ser código de
   seguridad, porque es lo único que la distingue de un integrador.
   ⚠️ **Hay DOS Authorization Servers y no hacen lo mismo** (medido al
   construir el flag): el del ápice autentica con correo, contraseña y
   selector de instancia, y **no tiene sesión web que consultar**; el de la
   instancia sí. El salto de consentimiento vive en el de la **instancia**,
   que es donde este flujo deja al usuario. Quien monte el encadenado del SSO
   tiene que hablar con ese, no con el del ápice.
   **Despliegue: una sola instancia del panel** (el refresh token rota; dos
   procesos refrescando = reuse = revocación en cascada), con su almacén de
   grants y candado locales. Todas las pruebas contra `reformas-vera` (dev).
   **HECHO Y MEDIDO el 2026-08-25** (núcleo galeote/factSaas#481 y #482, web
   pimia-web-shadcn#133), desplegado en dev y ejercido contra
   `prueba-registro-web`, un tenant creado por el registro público:
   - ✅ **El eslabón web, medido de punta a punta.** Con la sesión del tenant
     viva, `/conectar?tenant=reformas-vera` completa la ceremonia **en un solo
     salto** —sin pantalla de consentimiento— y aterriza en el panel con el
     seed entero (100 clientes, 362 facturas, 306.558,60 € pendiente), sin
     teclear la contraseña. Y se confirma lo que este punto ya decía: **basta
     con la sesión de la INSTANCIA**; no hizo falta ninguna sesión central.
   - ✅ **Multi-tenant por selección, hecho.** Cae la guarda mono-tenant y el
     `configuredTenant`; `PIMIA_BASE_URL` pasa a ser el patrón
     `https://{tenant}.taskai.work`. El `?tenant=` es un **nombre**, nunca una
     dirección: la dirección la construye la web con su patrón, que es la
     diferencia entre una lista blanca y una negra.
   - ⛔ **El `next` del auto-login va con allowlist** (rutas propias + el origen
     de `panel_web.url`). Es la misma prohibición del punto 3 rev. 2 aplicada
     al otro extremo: la petición que lleva el `next` es la que acaba de abrir
     la sesión, así que un redirect libre entrega a un usuario recién
     autenticado — y encadenado al salto de consentimiento, es el agujero
     entero.
   - ✅ **El automatismo, medido con el interruptor encendido en dev.** `enter`
     devuelve el destino **sin que nadie lo pida**
     (`next=http://localhost:3000/conectar?tenant=…`), y las dos entradas del
     autónomo al panel central —la vuelta del correo
     (`/login?verificado=1&instancia=…`) y cualquier ruta con `requiresAuth`—
     terminan en el panel web. Dos grants vivos a la vez en la misma sesión,
     27 permisos cada uno.
   - 🔴 **Y una trampa que costó una vuelta, por si vuelve a aparecer**: el
     encadenado no puede vivir en la pantalla de login. El guard del router
     central manda al autónomo fuera **antes de montarla** (`meta.guest` →
     `dashboard` → `tenants[0].url`), así que ahí no se ejecuta nunca en el
     caso normal — y ese salto llevaba al panel Vue, incumpliendo esta misma
     decisión. Va en el guard (#482).
   - ⚠️ **Desplegar esto NO es solo `config:cache` + `route:cache`.** El tramo
     de registro vive en `resources/scripts/central/`, o sea en el bundle de
     Vite: sin `npm run build` el navegador sigue con el SPA anterior y la
     medición mide el código viejo creyendo que mide el nuevo.
   - ⛔ **El grant del panel es FONTANERÍA, no una «app conectada»**
     (👤, 2026-08-26). Corolario de que la web sea el panel: su OAuth de
     primera parte es cómo viaja, no algo que el usuario haya «autorizado».
     Vue nunca pudo salir en su propia lista de apps conectadas porque entra
     por sesión; la web, mientras viaje por grant, salía — y salió, con su
     botón de revocarse a sí mismo, en la primera pasada real de esa pantalla.
     Así que los grants de clients `first_party` quedan **fuera de esa
     superficie entera**: ni se listan, ni se revocan, ni se cierran sus
     credenciales por ahí (404, la misma respuesta que «no existe» — para esa
     pantalla, un grant de la casa no existe). Hecho y desplegado a dev en
     galeote/factSaas#533; la pantalla que lo consume es
     `pimia-web-shadcn#200`.

     **Lo que esto deja abierto, dicho con fecha**: al salir de esa lista,
     «cerrar las sesiones del panel en otros dispositivos» se queda sin
     puerta. El día que haga falta será una pantalla de **cuenta**, con
     lenguaje de sesiones y no de apps — y lo decide 👤.

     ⚠️ Y el reverso, que se confunde fácil: **`pimia-workspace` (con Buzz) SÍ
     es una app conectada** y sí pasa por autorización. Mismo código portable
     de `features/pimia/`, dos anfitriones, **dos naturalezas distintas** — el
     panel es la casa y el escritorio es una invitada. Quien porte esa vista al
     escritorio no puede heredar de aquí la exclusión.

10. **Nada de lo que hace el panel Vue se pierde en la web (2026-08-27).**
    La regla, dicha por 👤 la noche del 26 al 27 con estas palabras: la web
    sustituye al panel Vue, Vue será deprecado, y **toda función que hoy hace
    Vue tiene que poder hacerse en la web**. Es el cierre de las decisiones 1
    y 4: «referencia funcional de lo que la web tiene que igualar» deja de
    admitir excepciones por superficie. Lo que la regla resolvió, pieza a
    pieza:
    - **Los segmentos de primera parte pendientes se publican ENTEROS**:
      `gestoria-link` (asesoría, galeote/factSaas#513) y
      `delegable-tasks`/`delegated-tasks` (tareas delegables,
      galeote/factSaas#535), con `request`/`revoke` y `delegate`/`execute`
      incluidos. El argumento es **paridad, no ampliación**: sus dominios
      (`admin`, `delegation`) se emiten `first_party_only`, así que el único
      actor por esa vía es el panel con su usuario dentro — exactamente el que
      ya hace todo eso en el Vue por sesión. Un integrador verá las rutas en
      el spec pero no puede obtener el scope. Y la alternativa (partir los
      segmentos) rompería al propio Vue sin proteger nada que el modelo de
      scopes no proteja ya.
    - **La configuración de VeriFactu (capa B) se abre**, por el camino
      condicionado de `ESTUDIO-MCP-VERIFACTU.md` § I.7 (repo web): ANTES, las
      dos condiciones en el núcleo — permiso de usuario en sus cuatro rutas
      (hoy no tienen ninguno: «solo el dueño» era una propiedad del menú de
      Vue, no del sistema) y que el `PUT` deje de contestar 200 cuando la API
      de VeriFactu falla —; DESPUÉS, el par `verifactu:*` `first_party_only`,
      el `domain_override` a `verifactu` y su entrada en la superficie. El
      certificado es multiparte y entra aparte, por la puerta multiparte de
      la web, con su propia issue.
    - **Lo que la regla NO toca**: acuñar credenciales sigue fuera para todos
      (decisión 4), y en `mcp` ni siquiera hay mitad abrible — **listar y
      acuñar son la misma ruta** (`GET` y `POST /mcp/tokens`), medido en
      § II.2 del estudio, que es el motivo que vale para no volver a
      estudiarlo desde cero. WhatsApp es de la fase de mensajería, no de esta
      regla.

    El límite de la regla, dicho para que nadie lo estire: paridad de
    **funciones de la pyme**, no de credenciales de la casa.

## Cómo se aplica en este repo (núcleo)

- Una mejora pedida «en el panel» de la pyme se hace en la API y en la web,
  no en `resources/scripts/admin`. Si alguien pide tocar Vue-pyme, recordar
  la decisión 1 antes de hacerlo.
- Toda ruta o campo nuevo entra el mismo día en el OpenAPI y, si hace falta,
  en el catálogo de scopes. Lo que no está en el spec no existe para los
  anfitriones. **Desde el eslabón 3 esto tiene guardarraíl**: el artefacto se
  regenera con `scripts/spec-export.sh` y la suite se pone roja si el fichero
  commiteado no es el que produce el comando.
- Publicar una ruta de `admin` es añadir su segmento a
  `partner_surface.first_party_segments`, y eso se hace **mirando sus rutas una
  a una**. La lista blanca es fail-closed a propósito: una ruta nueva de `admin`
  no entra sola en el contrato.
- La ampliación del catálogo **ya está hecha** (2026-08-22), y con ella el
  saneado que era su condición. Lo que queda vigente de aquella regla es su
  motivo: un dominio no se abre por su nombre, se abre mirando sus rutas una a
  una — así aparecieron las tres tomas de cuenta que vivían dentro de
  «ajustes». La exclusión del acuñado de credenciales se escribe como
  `domain_override` a `null` (fail-closed), no como una entrada del mapa, y
  cubre **dos** rutas: `mcp/tokens*` —que no es `admin/tokens`, como decían
  las revisiones anteriores— y `settings/wabai/bridge-token`.
- `admin` y `delegation` se emiten con `first_party_only`. Antes de quitarle
  ese flag a ninguno de los dos, releer lo que abren: entre las escrituras de
  `admin` están transferir la empresa a otro usuario, borrar empresas y
  usuarios, e instalar módulos subiendo un paquete. Está anotado junto al
  scope, en el catálogo.
- El panel central (`resources/scripts/central`) se queda en Vue; el
  `dashboard/` React es un arranque huérfano sin ruta y no se retoma por
  iniciativa propia.

11. **Hermes Desktop es el tercer anfitrión del ERP: el escritorio del
    autónomo (fase 1a verificada en vivo el 2026-08-30).** Buzz
    (pimia-workspace) sigue siendo el escritorio del equipo —empleados y
    agentes—; para el autónomo sin plantilla, el ERP se sirve dentro de
    Hermes Desktop (NousResearch/hermes-agent, MIT) como **plugin por su
    puerta de disco**, sin fork: las vistas de `features/pimia/` entran
    VERBATIM desde pimia-web-shadcn —tercer consumidor del dialecto portable
    del punto 7— y las costuras del anfitrión viven en el plugin (repo
    `pimia-hermes-plugin`): transporte por el REST namespaced del plugin,
    auth y shell sobre su backend Python, y la navegación como router
    interno, porque las rutas contribuidas de Hermes no llevan parámetros.
    Lo que no se negocia: **el token jamás entra en el renderer** —la
    custodia vive en el backend Python del plugin (client público RFC 7591 +
    PKCE + loopback de puerto fijo, refresh serializado y persistido antes
    de reintentar), el mismo modelo que Rust en el escritorio—; las vistas
    se editan SOLO en pimia-web-shadcn (el plugin consume, no bifurca); y el
    catálogo OAuth sigue mandando (punto 4): Hermes pide scopes del catálogo
    de partner, con consentimiento, sin privilegio nuevo alguno.
    Coste medido de la 1a: cero ediciones en vistas, ~400 líneas de
    costuras, y dos peculiaridades del loader de Hermes resueltas para
    siempre en el build del plugin (su escáner de imports lee el TEXTO
    entero del bundle; react-dom exige un `require` léxico). El tema salió
    gratis: Hermes publica la paleta shadcn mapeada a su tema y las vistas
    la heredan, claro/oscuro y portales incluidos.
    Pendiente, por fases: **1b** —Panel/Clientes/Presupuestos/Facturas en
    lectura, el `PimiaConnectDialog` real, cambio de empresa—; **2**
    —escritura, llavero del SO (hoy vault JSON 0600), revocación al
    desconectar—. La 2 no empieza sin decidir qué scopes de escritura pide
    Hermes, que vuelve a ser el punto 4.

12. **El programa de integradores es MAYORISTA: el tenant es del cliente, la
    relación comercial es del integrador y Pimia cobra al integrador
    (2026-09-05).** Decisión de 👤 tras vivir la superficie de partner con
    el primer integrador real —Zoomo Estudio, fork privado
    `Pimia-AI/zoomo-pimia` servido en `app.erpstudio.es` contra dev— y los
    tres estudios que salieron de ahí (`ESTUDIO-ALTA-CLIENTE-ZOOMO.md`,
    `ESTUDIO-PANEL-INTEGRADOR.md`, `ESTUDIO-DOMINIO-Y-ALTA-DEL-INTEGRADOR.md`,
    en el fork). Seis reglas, y el orden en que se paga la deuda:

    1. **«Powered by Pimia» siempre, también en marca blanca.** La marca
       blanca de Pimia es de FACTURACIÓN (el cliente no ve precios de Pimia),
       no de existencia. Se aplica en los tres sitios donde el cliente toca a
       Pimia: la app del integrador, la pantalla de contraseña y
       consentimiento (que lleva la marca del integrador y «powered by Pimia»
       al pie) y los correos que el núcleo manda al cliente.
    2. **Modelo mayorista, no marketplace.** Pimia le cobra al integrador un
       plan de canal —una suscripción con N asientos y sus añadidos, una
       factura al mes— y el integrador le cobra a su cliente lo que quiera,
       con SU Stripe, fuera de Pimia. Pimia no toca el dinero del cliente
       final ni ve el Stripe del integrador: **sin Stripe Connect**. La
       maquinaria mayorista ya existe (patrocinio de canal, asientos, gracia
       de 15 días, rescate); le falta un plan de canal con precio y que el
       desarrollador pueda declarar «pago yo» desde una pantalla
       (galeote/factSaas#721).
    3. **El tenant es siempre del cliente.** La invitación (el cliente se
       registra y nace dueño) es el camino por defecto; si el integrador crea
       la instancia, el traspaso de propiedad ANTES de entregar es
       obligatorio, no opcional. Con eso, «romper con el integrador» es dos
       actos del dueño que ya existen: revocar el acceso de la app desde Apps
       conectadas y asumir la licencia (rescate). No se mueve ni se borra un
       dato; borrar la cuenta es otra decisión del mismo dueño, la de
       cualquier pyme. Aristas aparcadas, con fecha: el cambio de precios al
       pasar del integrador a Pimia, el integrador que quiere cortar el
       servicio a un cliente moroso (hoy solo corta Pimia, por impago del
       canal) y el contrato a tres partes.
    4. **El catálogo del integrador, pieza nueva.** Pimia guarda por
       integrador qué revende (Pimia base, cada módulo, cada app integrada), a
       qué precio, en qué moneda y con qué enlace de contratación. Hace dos
       cosas con él: **enseñarlo al cliente** en la pantalla de plan del
       tenant en marca blanca (hoy devuelve lista vacía) con «Contratar»
       llevando al cobro del integrador; y **activar lo vendido**: el
       integrador enciende el módulo en el tenant desde su dashboard o por
       API desde su propio webhook, y la activación dispara el cobro
       MAYORISTA (asiento más añadidos). El precio minorista solo existe en el
       catálogo, nunca en el dinero de Pimia.
    5. **El dominio del integrador, en dos niveles y no tres.** Hoy: la app
       en su dominio (`app.erpstudio.es`, medido) y la pantalla de Pimia con
       la marca del integrador. Objetivo: **un dominio de acceso por
       integrador** (`login.<integrador>`), CNAME al Authorization Server del
       ÁPICE —el que autentica con correo, contraseña y selector de instancia
       sin depender del subdominio del tenant— con TLS bajo demanda,
       verificación de propiedad del dominio y cookie acotada al host. El
       cliente no ve nunca `pimia.es`, y **las credenciales siguen llegando a
       servidores de Pimia**: el integrador presta el nombre, no custodia la
       contraseña — lo que contesta la pregunta aparcada de quién responde de
       ellas. El **dominio por cliente** (que las instancias cuelguen del
       dominio del integrador; ocho piezas de infraestructura, diseñadas en el
       fork) queda SIN motivo salvo que un contrato lo exija: las direcciones
       de la instancia no las ve nadie.
    6. **El dashboard del integrador nace en Next.js + shadcn, en un repo
       NUEVO de primera parte del plano central**, no en `pimia-web-shadcn`
       (ese es el panel de la pyme y es lo que el integrador forkea: meter ahí
       la consola con la que Pimia gestiona a sus partners haría que cada fork
       la arrastrara). No contradice la decisión 2: no es migrar el Vue
       central por estética, es producto nuevo para la única figura que nació
       después de congelarlo. Enseña: cartera de clientes y tenants (con la
       atribución del alta), invitaciones y traspasos, patrocinio y asientos,
       lo que el integrador paga a Pimia, sus clients OAuth con alta y edición,
       y el catálogo con sus precios de venta. No enseña sus cobros
       minoristas. Dos condiciones antes de la primera línea: **un contrato
       del plano central** (hoy `/api/desarrollador/*` es interno del SPA con
       sesión Sanctum; el spec público solo cubre `/api/v1`) y **la
       atribución** «este tenant entró por este integrador»
       (galeote/factSaas#722, diseñada junto con #720).

    **Lo que el fork midió sobre la línea del repo**, y que este punto da por
    cerrado: todo lo que un integrador toca cabe en `src/host/`, `src/app/` y
    `src/server/` (marca, menú, scopes, despliegue, y hasta su web comercial
    servida por `Host`); lo que le obliga a entrar en `features/pimia/` es
    deuda de la web, y son cinco cosas —las secciones de Ajustes de primera
    parte siempre visibles, el menú de cuenta, los destinos de `closedDoors`,
    la lista de permisos de `account.ts` y el widget de fichaje que dispara
    `hr:read` sin mirar el grant— más el nombre del producto, que debería
    venir de la costura de auth como ya vienen `firstParty` y sus scopes. Es
    la opción A+ de `ESTUDIO-PRIMERA-PARTE-VS-PARTNER.md`, y ya no hace falta
    decidirla contra B o C: la vertical existe sin dos árboles ni paquete.

    **La deuda, en orden:** plan de canal con precio → #720 y #722 diseñadas
    juntas (una sola prueba de atribución para el retorno, la cartera y el
    `billing_mode`) → #721 → el contrato del plano central → el catálogo del
    integrador y la activación mayorista → el dominio de acceso por
    integrador → el dashboard. Quedan sin decidir dos cosas que no son de
    arquitectura: la contraseña del cliente en el asistente de «Nuevo
    cliente» (hoy la elige el tercero, con suelo de 6 frente a los 8 del
    registro público) y la cifra del plan de canal.

## Referencias (repos privados)

- Catálogo OAuth: `config/oauth.php` del núcleo. La ampliación **está hecha**:
  galeote/factSaas#422, en cinco PRs (#427 `settings:write`, #428
  `reports:write` y `store:write`, #429 el client de primera parte, #430
  `admin`, #431 `delegation`). El saneado que era su condición, en #426. Los
  seis en `main` y en dev desde el 2026-08-22; ninguno en prod.
- El spec **ya se regenera en limpio**: `scripts/spec-export.sh` →
  `php artisan spec:export`, con `ElSpecEsReproducibleTest` vigilando que el
  artefacto commiteado sea el que produce el comando (galeote/factSaas#433,
  cerró #372). Se regenera **al final de cada PR que toque el contrato**, no
  cuando alguien se acuerda.
- Lo que queda del eslabón 3, con issue y medido: 17 operaciones publican su
  `200` como objeto opaco (#443, entre ellas `POST /invoices`); la facturación
  cuenta en céntimos y la banca en euros (#442); cuatro rutas de
  `Route::resource` que el controlador no implementa dan 500, más cuatro huecos
  de CRUD (#444, desde pimia-sdks#34).
- Dirección fiscal de empresa, bloquea «ajustes → empresa»: galeote/factSaas#414.
- Plan y bitácora del porte web: `pimia-web-shadcn/docs/PLAN-BITACORA.md`.
- El anfitrión Hermes: plugin en `pimia-hermes-plugin` (local, sin remoto
  todavía); la receta del build y los tropiezos del loader, en su README y
  sus commits.
- El programa de integradores (punto 12): el fork `Pimia-AI/zoomo-pimia`
  (privado; `docs/FORK.md` es su libro de cuentas y `docs/ESTUDIO-*.md` los
  tres estudios medidos con cuenta de desarrollador real); en el núcleo,
  galeote/factSaas#720 (retorno al integrador), #721 (invitación y
  `billing_mode` del desarrollador) y #722 (atribución del alta). El estudio
  de la línea del repo: `pimia-web-shadcn/docs/ESTUDIO-PRIMERA-PARTE-VS-PARTNER.md`.
