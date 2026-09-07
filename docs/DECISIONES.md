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

12. **El programa de integradores es MAYORISTA: ~~el tenant es del cliente~~
    —el tenant es del INTEGRADOR desde el 2026-09-07, ver 13.25—, la
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
       **REVISADA el 2026-09-07 y dada la vuelta por 👤 (13.25): el tenant es
       del INTEGRADOR, no del cliente** —«eso dificulta mucho toda la
       operativa»—, y el cliente que se va se lleva una copia de seguridad
       para que otro integrador la restaure. Con ello caen de esta regla el
       traspaso obligatorio antes de entregar y el rescate como salida del
       cliente; lo que sobrevive es que los DATOS son suyos y puede
       llevárselos. Léase la regla 3 entera desde 13.25.
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
       **Revisada el 2026-09-07** (ver «El login del integrador, decidido»,
       más abajo): el nombre lo sirve el integrador en su servidor y hace
       proxy a Pimia; no hay CNAME a Pimia ni certificados ajenos en Pimia.
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
    integrador → el dashboard. ~~Quedan sin decidir dos cosas que no son de
    arquitectura~~ **Decididas por 👤 el mismo 2026-09-05, por la tarde:**
    la **contraseña del cliente** en el asistente de «Nuevo cliente» (hoy la
    elige el tercero, con suelo de 6 frente a los 8 del registro público) →
    **invitar, no fijar**: el alta por gestoría o desarrollador manda una
    invitación y el cliente pone su contraseña en su dominio; si el campo se
    mantiene para el caso sin correo, mismo suelo que el registro y cambio
    obligatorio al primer acceso (galeote/factSaas#724). Y la **cifra del
    plan de canal** → **Price de PRUEBA en dev**, no precio real: creado ese
    día en la cuenta de test de Pimia (product `prod_VCojt6AVsKnRCu`, 49 €
    por asiento y mes, la doctrina del seeder) y asignado al plan de canal
    «Desarrollador» (id 6) en `plans.stripe_price_id`, anotado como
    `STRIPE_PRICE_CANAL_DESARROLLADOR` en el `.env` de dev. Con eso
    `Sponsorship::sponsor()` deja de responder `stripe_price_missing` y el
    patrocinio se puede ensayar de punta a punta con Zoomo. «Asesoría» (id 3)
    sigue sin precio; prod sigue sin precios.

    **La contraseña, resuelta el 2026-09-06 (galeote/factSaas#724).** Medido
    antes de tocar: el alta manual pedía `min:6` mientras el registro público y
    la aceptación de una invitación exigen `Password::min(8)`, y ninguno de los
    cuatro tests que mandan `admin_password` fijaba el suelo flojo. 👤 decidió
    que **el método «Crear manualmente» se mantiene tal cual, con el suelo
    igualado a ocho**, y que **el «cambio obligatorio al primer acceso» queda
    APARCADO con fecha**: no existe nada parecido en el núcleo y solo podría
    vivir en el SPA Vue de la pyme, que la decisión 1 congela y por el que el
    cliente de un integrador ya no pasa —con la redirección dura D3 entra por
    la app del integrador vía OAuth—, así que protegería la puerta que ese
    cliente no usa. Se retomará **cuando la web shadcn sustituya a ese SPA**,
    que es donde el guard sí llegaría a todos. Queda medido, para cuando se
    retome, que la vía «pon tú tu contraseña en tu dominio» ya existe:
    `SsoDestination` deja `forgot-password` y `reset-password/*` fuera de la
    redirección dura, y el broker del tenant está montado. El estudio, en
    `docs/ESTUDIO-CONTRASENA-ALTA-POR-TERCERO.md`.

    **El contrato del plano central, estudiado el 2026-09-06** en
    `docs/ESTUDIO-CONTRATO-PLANO-CENTRAL.md`, con dos preguntas abiertas
    (vocabulario y prefijo; dónde se publica el spec). Lo medido que cambia la
    forma del trabajo: el perímetro del integrador **no** son las nueve rutas
    de `/api/desarrollador/*`, porque patrocinar y traspasar —dos de las cuatro
    pantallas del dashboard— viven fuera del prefijo, y las cuatro rutas ya
    existen: falta la pantalla, no la API. Con `statefulApi()`, un token Bearer
    de una cuenta de desarrollador abre hoy **todo** el grupo `auth:sanctum`
    del plano central, no solo su prefijo. Y un segundo documento OpenAPI no
    pide paquete nuevo: la versión instalada de Scramble ya trae
    `registerApi()` y `scramble:export --api=<nombre>` con `export_path`
    propio.

    **El plano central, cerrado el mismo 2026-09-06 en tres PRs del núcleo y
    uno del SDK.** (1) El riesgo del estudio era real y estaba en la
    ACUÑACIÓN, no en la puerta: registro, login y aceptación de invitación no
    pasaban habilidades (Sanctum → `['*']`), ninguna puerta del grupo
    `auth:sanctum` las miraba, y el SPA central corre sobre ese mismo Bearer
    (`stores/auth.js`, `localStorage`); en dev había 124 `auth-token` con `*`.
    Desde galeote/factSaas#732 (issue #731) el plano central es **fail-closed
    por habilidades del token**: cuatro, una por plano —`central` (el grupo
    compartido), `gestoria` (la que ya llevaba el copiloto Hermes),
    `desarrollador`, `superadmin`—; el `auth-token` nace con las de la figura;
    la sesión por cookie no cambia; un token con `*` contesta 401 para que el
    SPA vuelva al login; y la figura sigue siendo la segunda puerta. Un token
    de máquina se acuña solo con `desarrollador` y no alcanza la cuenta, los
    tenants ni la facturación (lo fija `HabilidadesDelPlanoCentralTest`).
    (2) Las dos preguntas del estudio las decidió 👤: el documento declara
    **Bearer con habilidades** (OAuth `client_credentials` del ápice queda como
    destino, con la regla 5); las rutas se publican **tal cual** —`desarrollador`
    en la URL, «integrador» en los textos— con **1.0.0**; y **se publica en el
    SDK**, que es lo que el dashboard consumirá: lo que protege es el token
    acotado, no que las rutas no se vean, y el perímetro son solo las de la
    figura desarrollador. galeote/factSaas#735 lo publica:
    `docs/openapi/pimia-central-v1.json`, **15 operaciones por método y ruta**
    (`config/central_surface.php`: las nueve de `desarrollador`, invitar,
    patrocinar y soltar, traspasar), `x-pimia-required-ability` por operación,
    `spec:export --api=central`, `scripts/spec-export.sh --api central` y el
    test reproducible recorriendo los dos documentos. (3) El agujero de
    `/api/v1/desarrollador-link/*` se cierra en galeote/factSaas#736: entra
    como primera parte, como `gestoria-link` (428 → 431 operaciones). En el
    SDK, la **0.22.0** (Pimia-AI/pimia-sdks#87): `PimiaCentralClient` —token
    personal, sin refresh—, `spec/pimia-central-v1.json`, tipos
    `@pimia/sdk/central-api` y `MissingAbilityError`. De paso, #730 (el suelo
    de ocho también para el superadmin, galeote/factSaas#734). **Siguiente de
    la lista:** el catálogo del integrador y la activación mayorista (estudio
    primero) → el login del integrador → el dashboard.

    **El catálogo del integrador, estudiado y decidido el mismo 2026-09-06
    (noche)** en `docs/ESTUDIO-CATALOGO-DEL-INTEGRADOR.md`. Lo medido que
    cambia la forma del trabajo: el asiento del canal «Desarrollador» (plan 6,
    `modules NULL`) **lo incluye todo** —un cliente patrocinado enciende los
    siete opcionales gratis y Pimia solo cobra los 49 € del asiento—, así que
    la «activación que dispara el cobro mayorista» de la regla 4 no tenía
    objeto; el mecanismo de añadidos rechaza el asiento patrocinado en cinco
    sitios; el integrador no puede activar nada (ni ruta ni actor: instalar
    exige ser el DUEÑO del tenant); y la marca blanca exige el asiento, que el
    alta atribuida no crea — Talleres Ana, traída por Zoomo, veía los planes
    de Pimia. Decisiones de 👤: (1) **el asiento es Pimia base y los módulos y
    apps son añadidos mayoristas con Prices PROPIOS del canal** (plan 6 pasa a
    `modules: []`); (2) **el catálogo se enseña a TODO tenant con integrador**
    —lo paga un desarrollador, o entró por su app y el vínculo vive— y a ese
    tenant se le cierran checkout, cambio de plan y añadidos de Pimia desde el
    alta, no desde el primer pago; (3) **el añadido mayorista se cobra como el
    asiento**: partida de canal sin prorrateo en la factura del mes, alta y
    baja en el acto; (4) una **moneda por integrador**; (5) **perfil comercial
    mínimo ahora** (nombre, soporte); (6) filas **siempre con precio**. El
    catálogo entra en el núcleo con `integrador_perfiles`,
    `integrador_catalogo_items`, `Tenant::integrador()`, `GET|PUT
    /api/desarrollador/catalogo` (contrato central **1.1.0**, 17 operaciones) y
    la pantalla del cliente (`/billing/plans` con `catalogo`, `/tenant-modules`
    con `billing: channel`) — galeote/factSaas#738, SDK 0.23.0, web #416,
    todo desplegado en dev. **Y la activación mayorista, la misma noche**
    (galeote/factSaas#739, SDK 0.24.0): el asiento «Desarrollador» pasa a
    `modules: []` conservando lo encendido como heredado; `channel_activations`
    es el libro mayor; `ActivacionMayorista` activa la base (el asiento),
    módulos y apps y los cobra como partidas de la suscripción de canal sin
    prorrateo (`ajustarPartida`, la única costura con Stripe); el cliente no
    compra ni apaga lo del canal (`403 white_label` / `403 channel_module`) y
    una app del canal la instala sin caja; `billing:reconcile-canal` coteja
    por cartera. Contrato central 1.2.0, 20 operaciones. ⚠️ Los Prices
    mayoristas (`STRIPE_PRICE_MODULE_ADDON_CANAL`, `apps.channel_stripe_price_id`)
    los crea 👤 en la cuenta de test; hasta entonces activar contesta
    `503 stripe_price_missing`.

    **El login del integrador, decidido el 2026-09-07 (regla 5, REVISADA).**
    👤 paró el primer estudio porque partía de una premisa falsa —que
    `login.<integrador>` sería un CNAME del integrador a los servidores de
    Pimia— cuando **los integradores tienen servidores y registradores
    propios, ajenos a Pimia**. Se rehízo desde el mapa del conjunto
    (`docs/ESTUDIO-LOGIN-DEL-INTEGRADOR.md` del web, con el gráfico de Zoomo,
    Ana y Pimia): quién sirve cada nombre, quién emite cada certificado y por
    dónde viaja la contraseña. Lo medido corrige dos cosas del estudio
    anterior (las rutas centrales SÍ llevan `Route::domain`; `SESSION_DOMAIN`
    es `.taskai.work`, no host-only) y destapa que `*.erpstudio.es` ya apunta
    a la caja de Zoomo y que la contraseña del alta ya pasa por el servidor
    del integrador (su `/registro` reenvía a `/api/auth/register`). Las seis
    decisiones de 👤: (1) **el nombre de login lo sirve el INTEGRADOR en su
    servidor, con su certificado y su DNS, y hace proxy al AS del ápice de
    Pimia** (opción 2 del estudio), elegida sabiendo que la contraseña pasa
    por su proxy y descartando que Pimia emita u opere certificados de
    nombres ajenos, que es lo que el «CNAME a Pimia» obligaba. La regla 5 se
    reescribe: el integrador sirve el nombre y termina el TLS; las
    credenciales se comprueban y se guardan SOLO en Pimia; el integrador
    responde de su proxy como responde ya de su app y de los tokens que
    guarda; el pie de `/entrar` («la contraseña solo en tu dominio») no vale
    para sus clientes. Forma técnica que se deriva: Pimia da a cada
    integrador un nombre interno bajo su comodín (`login-<slug>.taskai.work`
    / `.pimia.es`, ya con DNS y certificado); el proxy reenvía por HTTPS a
    ese nombre con el público en `X-Forwarded-Host`, que Pimia acepta solo si
    coincide con el registrado por ese integrador, y con él construye issuer,
    formularios y redirecciones; las cookies de ese host salen sin dominio;
    el salto cifrado es obligatorio. (2) **El alta se queda en la app del
    integrador**: moverla al host de login perdió su motivo, porque con el
    proxy la contraseña del login también pasa por él. (3) **El selector del
    AS en ese nombre ofrece solo la cartera del integrador**
    (`Tenant::integrador()`); un correo sin empresas con él no entra por ahí.
    (4) **El correo de verificación lo envía el INTEGRADOR** (la opción C
    aparcada el 06-09): el alta firmada devuelve el enlace de verificación al
    servidor del integrador; la instancia sigue en espera hasta que se abre;
    Pimia solo sabe que el correo es real en la medida en que el integrador
    lo mandó a la dirección buena; el enlace aterriza en su nombre de login.
    (5) **A3 cerrada: token personal acotado a `desarrollador`, con alta,
    listado y revocación por API** (`/api/desarrollador/tokens`);
    `client_credentials` del ápice, no. (6) Los nombres se registran por API
    (`/api/desarrollador/dominios`) y entran con los tokens en
    `config/central_surface.php` (contrato central 1.3.0) y en el SDK. Orden
    de construcción: núcleo (nombres, grupo de rutas del host de login,
    selector por cartera, pista `tenant` y `tenant_id` en el canje, enlace de
    verificación en la respuesta del alta firmada, tokens por API) → web y
    fork (`PIMIA_AUTH_BASE_URL`, el correo desde el integrador, el bloque de
    Caddy de Zoomo para `login.erpstudio.es`) → medir con Talleres Ana.
    **HECHO y desplegado en dev el mismo 2026-09-07:** núcleo
    galeote/factSaas#741 (`integrador_dominios` con `proxy_secret`,
    `IntegradorLoginHost`, rutas `login-<slug>.<central>` antes de las de
    tenant, selector por cartera, pista `tenant` con pantalla de espera,
    `tenant_id` en el canje, alta y reenvío con `data.verification`,
    `/api/desarrollador/dominios` y `/tokens`; contrato central **1.3.0, 26
    operaciones**; suite entera 2340 OK; revisión adversarial con once
    hallazgos, seis arreglados en el PR —secreto del proxy, solo el client
    del integrador en su host, `login-*` reservado, plano central forzado
    para esquema y cookie, la espera solo para su cartera, acuñar tokens
    pide sesión— y tres anotados como consecuencia de las decisiones), SDK
    0.25.0 (Pimia-AI/pimia-sdks#91: `dominios.*`, `tokens.*`,
    `TokenSet.tenantId`; tag y npm de 👤), web #420 (`PIMIA_AUTH_BASE_URL`,
    `PIMIA_MAIL_URL`/`PIMIA_MAIL_FROM`) y el fork de Zoomo (7º rebase, Caddy
    de `login.erpstudio.es` con el secreto, Mailpit de midday como SMTP).
    Medido: `app.erpstudio.es/conectar?tenant=talleres-ana` → 307 a
    `login.erpstudio.es/oauth/authorize…&tenant=talleres-ana`, servido por
    el Caddy de Zoomo con su certificado y reenviado a Pimia; la pantalla
    dice «Entra en Zoomo Estudio», «powered by Pimia» y «Solo para empresas
    de Zoomo Estudio»; sin el secreto o sin `X-Forwarded-Host`, 404; `/entrar`
    en ese nombre, 404. Residuo en dev, puesto por SQL: `integrador_dominios`
    id 1 (`zoomo`, `login.erpstudio.es`, user 68847). Falta 👤: entrar como
    Talleres Ana tecleando la contraseña, un alta nueva por el fork con el
    correo en Mailpit, y medir el `X-Forwarded-For` en los limitadores.

    **El panel central en React, decidido el 2026-09-07 (regla 6 ENSANCHADA
    y decisión 2 ADELANTADA).** Al abrir el paso 5 con el estudio
    (`docs/ESTUDIO-DASHBOARD-DEL-INTEGRADOR.md` del web: el contrato 1.3.0
    medido pantalla a pantalla, nueve huecos, cómo entra hoy un integrador),
    👤 movió el marco en la primera pregunta: **«ya que nos metemos con el
    dashboard del integrador, nos metamos directamente con la arquitectura
    para todos: superadmin, asesoría e integrador. Aunque no hagamos ahora
    superadmin ni asesoría, las tres son las que van a sustituir a Vue»**.
    El repo nuevo no es la consola del integrador: es **el panel central de
    operativa de Pimia en Next.js + shadcn**, donde 👤 como superadmin lleva
    la operativa entera y las otras dos figuras la suya; el integrador es la
    primera figura que se construye. Es **privado y cerrado como el núcleo**:
    no es un repo compartido ni se abre con el barrido. Medido en el Vue
    central: 22 vistas de gestoría sobre 196 rutas, 5 de superadmin sobre 18,
    1 de desarrollador sobre 26 operaciones y un grupo compartido de 46; solo
    el integrador tiene contrato publicado, así que las otras dos figuras se
    pagan primero en el núcleo (contrato por figura), como se pagó esta. Las
    cuatro decisiones de 👤, una pregunta cada vez: (1) **cómo entra: login
    propio del panel** (opción A del estudio): pantalla de entrada del panel;
    su SERVIDOR llama a `POST /api/auth/login`, guarda el token personal en
    su store y da al navegador una cookie opaca —el patrón del web—; vale
    para las tres figuras porque el endpoint acuña `[central, <figura>]`;
    descartadas la sesión Sanctum por cookie desde el navegador (el SDK en el
    navegador y el panel atado a `*.pimia.es`), OAuth contra el AS del ápice
    (acuña tokens de instancia; sería un segundo AS) y el Bearer pegado a
    mano. (2) **Repo `Pimia-AI/pimia-central-web`** (creado ese día, privado).
    (3) **Dominio `central.taskai.work` / `central.pimia.es`** mientras
    conviva con el Vue (que vive en la raíz del ápice); el día que lo
    sustituya puede ocupar la raíz. (4) **Un PR del núcleo con los huecos
    pequeños ANTES de la primera pantalla**: contrato central **1.4.0** —los
    tres `201` sin cuerpo en el spec (⛔ `@response 201 array{…}` Scramble lo
    lee como el TIPO `201`: el token en claro, el `proxy_secret` y el
    `checkout_url` llegaban sin tipo al SDK), `anadidos` tipado como `string`,
    la atribución del alta en `overview` (`origen`), `GET /tenants/{slug}/users`
    y `POST /billing/portal` al contrato, `return_url` hacia el panel
    (aceptado solo si su origen es `CENTRAL_WEB_URL` o el ápice) y
    `device_name` en el login (rota solo los tokens de ese nombre: el Vue y
    el panel nuevo conviven; medido que el login mataba TODAS las sesiones
    anteriores)—. El alta, edición, rotación y revocación de clients (H6) va
    aparte cuando toque esa pantalla. Lo que el panel no lleva: grants OAuth,
    `/api/v1`, datos de ninguna instancia (a los libros se llega por OAuth
    consentido desde la app del integrador). Anotado con fecha: el plano
    central no tiene recuperación de contraseña para ninguna figura.

    **HECHO y desplegado en dev el mismo 2026-09-07:** núcleo
    galeote/factSaas#743 (`522cf264`; contrato central **1.4.0, 28
    operaciones**: los tres `201` con cuerpo, `cartera`, `anadidos` y `salud`
    tipados, `origen` con `atribuido` y solo clients propios, `GET
    /tenants/{slug}/users` e `POST /billing/portal` en el contrato,
    `return_url` sobre `SsoDestination::originOf` acotado a `CENTRAL_WEB_URL`
    o el ápice, `device_name` en lista cerrada `auth-token|central-web`;
    suite entera 2351 OK; revisión adversarial con quince hallazgos, siete
    arreglados —el alto: `\@` en `return_url`—; `conf.d.dev/central.conf`),
    SDK 0.26.0 (Pimia-AI/pimia-sdks#93: `tenants.users`, `billing.portal`;
    tag y npm de 👤), y **`Pimia-AI/pimia-central-web` nacido y servido en
    `https://central.taskai.work`** (#1: login propio con `device_name`,
    token en SQLite por `sha256(id)`, cookie `__Host-` opaca y deslizante
    con techo, puente con lista blanca de las 28 operaciones y comprobación
    de `Origin` en toda escritura, limitador propio del login, pantallas de
    Cartera, Salud y Facturación; revisión adversarial con dieciséis
    hallazgos, dieciséis cerrados y medidos en vivo —el alto: CSRF same-site
    desde `{slug}.taskai.work`—). Medido: `/` → 307 a `/entrar`; un POST con
    `Origin` de un tenant → 403; credenciales falsas → 401 del núcleo;
    `device_name` fuera de la lista → 422. Falta 👤: entrar con la cuenta de
    Zoomo (68847) para medir las tres pantallas con datos, y publicar el SDK
    0.26.0 en npm. Siguiente: las pantallas de escritura y H6 (clients).


13. **El panel central se DIBUJA antes de construirse, y el dashboard del
    integrador es un mini-superadmin de dos verbos (2026-09-06).** 👤 paró la
    cadena del panel del integrador —«nada de mergear ni desplegar nada de
    esto […] primero debatir y ver antes de continuar»— porque se estaban
    decidiendo detalles técnicos (rotación de secretos, cascadas de
    revocación, `redirect_uris`) sin haber acordado el MARCO: qué es el
    dashboard de un integrador. Su frase es la definición: «solo veo sentido a
    cartera y catálogo […] el dashboard de un integrador es lo más parecido a
    mi superadmin. Puede generar instancias, ver sus clientes, gestionar el
    precio de los productos y servicios. No estoy entendiendo absolutamente
    nada de oauths, tokens, es más ni tan siquiera sé por qué es necesario
    meter aquí el sdk».

    **Cómo se trabaja a partir de ahora:** las pantallas del panel central se
    maquetan primero en el BANCO (`galeote/shadcn-admin-clone`, rutas
    `/central/{superadmin,asesoria,integrador}`) con datos de mentira, y el
    debate con 👤 se hace SOBRE ESAS PANTALLAS, en lenguaje de producto
    (clientes, licencia, añadidos, precio, margen) y nunca de fontanería. El
    estudio previo —qué hace hoy cada figura en el SPA Vue, funciones y no
    estética— vive en `docs/research/ESTUDIO-PANEL-CENTRAL-TRES-FIGURAS.md`
    del banco, con las decisiones en su §7. Quedan maquetadas DOS figuras
    (integrador: visión general, cartera, catálogo y precios, facturación;
    superadmin: visión general, instancias, cuentas, planes e integraciones).
    La asesoría se maquetó y se retiró el mismo día: 13.4.

    **13.1. Un integrador NO da de alta a sus clientes.** 👤: «en integrador
    vamos a suprimir dar de alta a un cliente. Sus clientes ya tienen la vía
    de registro y login desde su dominio. Si quiere dar de alta un cliente que
    lo haga como si lo hiciera su cliente». Consecuencias: no hay pantalla de
    alta ni invitaciones desde el panel del integrador, y **la cuota de altas
    del desarrollador deja de gobernar nada visible** —contaba un gesto que ya
    no existe—. El vocabulario cambia: una instancia **nace en su web** (el
    alta se le atribuye por su client) o **se vincula después**; nunca «la
    creó él». Y con eso se cierra sola la tensión que el estudio había medido:
    por el camino «crearla yo» el integrador quedaba de `owner` del tenant de
    su cliente, y siéndolo podía entrar por SSO, gestionar su equipo y
    descargarse un backup, mientras el panel prometía por escrito que no veía
    nada suyo. Si nunca la crea, nunca es su dueño.

    **13.2. No hay traspaso de propiedad, y la iniciativa es del CLIENTE.**
    👤: «es el cliente de Zoomo el que realiza la reclamación, no Zoomo el que
    le traspasa la propiedad. […] El cliente de Zoomo puede hacer algo tan
    sencillo como un backup que otro integrador de Pimia puede restaurar.
    Olvidémonos de esta funcionalidad, que parece compleja de integrar y solo
    complica». La portabilidad entre integradores se resuelve con lo que ya
    existe y es simple —copia de seguridad del cliente, restaurada por el
    integrador nuevo—, no con una operación de traspaso. ⛔ No volver a
    proponerla. **Confirmada en su parte buena y corregida en su premisa por
    13.25 (2026-09-07):** sigue sin haber traspaso, pero la copia deja de ser
    la salida cómoda y pasa a ser la ÚNICA — y medida ese día, no funciona
    todavía entre instancias (no hay por dónde subirla, el volcado nombra el
    esquema de origen y no lleva los ficheros).

    **13.3. El integrador no entra en el Pimia de su cliente, y suspender se
    queda (2026-09-06).** 👤: «quita también entrar en su Pimia. Suspender es
    necesario para que pueda dar de baja a su cliente». Cae la entrada por SSO
    desde el panel del integrador: era la última puerta abierta a los libros de
    un cliente, y sin ella la promesa del panel —que no ve sus datos— pasa a ser
    cierta sin excepciones ni notas al pie. **Suspender se queda, y con un
    porqué que conviene no perder: no es un castigo ni una herramienta de cobro,
    es CÓMO un integrador da de baja a un cliente** que se va, cierra o deja de
    pagarle; sin ella seguiría pagando a Pimia el asiento de alguien que ya no
    es suyo, sin forma de pararlo desde su panel. El menú de un cliente en su
    cartera queda en dos acciones, y ninguna toca datos: cambiar sus añadidos y
    suspender el servicio.

    **13.4. El panel de la ASESORÍA sale del banco (2026-09-06).** 👤: «omite
    por completo el panel del asesor, no tiene nada que ver con lo que debe
    ser». Las cuatro pantallas maquetadas —panel operativo, cartera, bandeja de
    revisión y VeriFactu— se retiran. Se habían dibujado a partir de lo que el
    SPA Vue hace hoy, y eso no es lo que la figura tiene que ser: **la maqueta
    heredaba el planteamiento en vez de discutirlo**, que es justo el error que
    este trabajo existe para no cometer. ⚠️ Cuando la asesoría se retome, se
    retoma por la pregunta de qué TIENE QUE SER, no por esas pantallas ni por
    las del Vue. Lo que sobrevive y sirve: el inventario medido de sus 22 vistas
    en el §4 del estudio del banco (seis áreas de trabajo, `GestoriaMapeo` muerta
    y fuera del router, el triage sin entrada de menú, un enlace roto del panel a
    la ficha de contribuyente, y qué es un cliente «offline» — el que no tiene
    instancia y entrega papeles). El censo del ecosistema **conserva** las dos
    asesorías: traen nueve instancias que el superadmin ve y que pagan su parte
    del ingreso; quitarlas habría falseado la plataforma para no dibujar unas
    pantallas.

    **13.5. EL MARCO: la maqueta es el CONTRATO, y sustituye a
    `central.taskai.work` (2026-09-06).** 👤: «por eso estamos primero creando
    esto. Hasta llegar a un consenso real no cerraremos el mockup de superadmin
    e integradores. Una vez definido cada recoveco, central.taskai.work será
    sustituido por lo que estamos creando en el mockup». Consecuencias, y son
    las que ordenan todo lo demás: **(1)** lo desplegado hoy en
    `central.taskai.work` (`Pimia-AI/pimia-central-web`) es un BORRADOR que va a
    ser reemplazado, no un producto que haya que podar — con lo que **desaparece
    la pregunta** de qué hacer con sus pantallas (esconderlas, quitarlas,
    dejarlas); **(2)** lo que no esté dibujado y acordado en el banco no se
    construye allí, y lo acordado se porta tal cual; **(3)** el mockup **no se
    cierra** hasta que cada recoveco tenga consenso —«casi definido» no vale: la
    cadena se paró por dar por hecho un marco que nadie había acordado—; **(4)**
    cada decisión se aplica el MISMO DÍA a la maqueta y a este punto 13. Los
    recovecos que faltan por acordar están enumerados en el §7.6 del estudio del
    banco.

    **13.6. Hay ficha de cliente en el panel del integrador, y las activaciones
    llevan FECHA (2026-09-06).** Al pulsar un cliente de su cartera se abre su
    ficha: qué le tiene activado y **desde cuándo**, cuánto le deja al mes y
    cuánto lleva pagado por él, su historia (alta, activaciones, bajas, corte) y
    **qué NO ve de él** —sus facturas, su equipo, sus copias—, que no es un hueco
    sino el trato y por eso está escrito en la pantalla. Consecuencia para el
    núcleo y el SDK cuando toque construirlo: la ficha necesita las
    **activaciones con fecha de alta y de baja** por instancia, no solo la lista
    de lo activo hoy; `GET /api/desarrollador/tenants/{slug}/activaciones`
    devuelve el estado, y sin fechas la ficha no puede contar la historia de un
    cliente ni cuadrar un mes pasado. Lo mismo vale para la ventana de
    facturación de cada instancia (desde cuándo y hasta cuándo se le cobró el
    asiento al socio): **la factura de canal de un mes se calcula de lo que
    estaba vivo ESE mes**, y escribirla como una lista de totales la condena a
    contradecir la ficha en cuanto alguien mueva una fecha.

    **13.7. La ficha de una instancia es para COBRAR Y CONTRATAR, y el precio
    vive en el CONTRATO (2026-09-06).** De las cuatro cosas para las que un
    superadmin abre una instancia —vigilar y desatascar, entrar a resolverla
    dentro, cobrar y contratar, o responder con contexto—, 👤 eligió **cobrar y
    contratar**: la ficha la mandan su contrato (plan, qué paga de verdad, desde
    cuándo, quién paga), sus límites contra su consumo y su historial de cobros.
    Dos reglas del producto pasan de la prosa al número, y las dos tienen
    consecuencia técnica: **(a) el precio congelado** — una empresa paga lo que
    costaba su plan el día que lo contrató, así que **el precio se guarda en el
    contrato del tenant y NO se lee del plan**; leerlo del plan haría que subirlo
    le subiera la factura a todo el parque de golpe, que es justo lo que la regla
    existe para impedir (en la maqueta, arreglarlo bajó el MRR de 869 € a 854 €,
    y ese es el número correcto); **(b) los límites subidos a mano** por encima
    de los del plan, que es lo único que solo el superadmin puede hacer, y que la
    ficha enseña junto al consumo — con quien se pasa de su límite marcado,
    porque sin ese caso el botón de subirlo parece un capricho. Una instancia de
    canal no tiene contrato ni plan que cambiarle: la paga su socio, y la ficha
    lo dice en vez de pintar un cero.

    **13.8. El integrador VE el precio mayorista: es su coste real
    (2026-09-06).** 👤: «el precio mayorista sí lo ve, es su coste real». Se
    queda en su catálogo y en la ficha de cada cliente, junto a su precio de
    venta y al margen. La razón importa tanto como la decisión: **no es una
    referencia** ni un dato interno de Pimia que se le enseñe por cortesía, es
    **lo que se le factura** cuando le activa algo a un cliente. Consecuencias de
    redacción, que no son cosméticas: la pantalla lo llama **«te cuesta»** y no
    «precio de Pimia», y dice que **es el mismo para todos los integradores** —si
    pareciera negociable, cada conversación con un partner empezaría por ahí—.
    Por la misma razón se quedan, salvo que 👤 diga lo contrario, las columnas de
    dinero por cliente de su cartera y el bloque «lo que te deja» de la ficha:
    son ese mismo coste puesto por cliente.

    **13.9. Treinta días de cortesía, ficha de socio para el superadmin, y
    entrar dentro de una instancia queda APAGADO (2026-09-06).** Tres de un
    tirón. **(a)** 👤: «el integrador puede suspender a su cliente por impago,
    debe ofrecer **30 días de cortesía**». «En mora» deja de ser una etiqueta y
    pasa a ser una cuenta atrás: hace falta guardar **desde cuándo debe** cada
    cliente, y el botón de darle de baja está deshabilitado hasta que se agoten
    los treinta días —la regla vive en el botón, no en un aviso que se puede
    ignorar—. Invariante para quien lo construya: **nadie puede haber sido
    cortado antes de agotar su cortesía**. **(b)** El superadmin tiene **índice y
    ficha de socio**: quién es, qué le factura Pimia mes a mes, la cartera que ha
    traído y **a cuánto revende** — Pimia conoce los precios de venta de sus
    socios porque el catálogo vive dentro, así que la ficha los enseña Y dice de
    dónde salen; un dato así sin explicar es lo que hace que un partner deje de
    fiarse. Consecuencia técnica: la factura de canal debe poder calcularse
    **para cualquier socio**, no solo para el que tenga pantalla. **(c)** El
    botón de **entrar dentro de una instancia queda deshabilitado**, a la vista y
    apagado, no borrado: pendiente de decidir si deja rastro y si el cliente se
    entera.

    **13.10. A cuántos afecta un cambio de precio se ve ANTES de aplicarlo, y un
    socio de canal tiene precio propio (2026-09-07).** 👤: «necesito ver a
    cuántos afecta un cambio de precio antes de aplicarlo». El botón de precio de
    cada plan abre un diálogo que lo responde. La respuesta corta es siempre la
    misma —**a ninguno de los que ya lo tienen**— y por eso el diálogo no se
    queda ahí: enseña **quiénes lo tienen y a cuánto, con nombres**, porque de
    ahí sale la pregunta de verdad (cuánto se deja de ingresar por los contratos
    viejos), y separa **lo que cambia hoy** (nada) de **lo que cambiaría si todos
    pasaran**, dicho como hipótesis y no como previsión; juntarlas en un solo
    número sería la confusión que el diálogo existe para evitar. **El agujero que
    destapó, y que hay que arreglar al construirlo: un socio de canal no tenía
    precio propio.** El asiento se leía del plan, así que la respuesta habría
    sido «a ninguno» para los planes de pyme y **una mentira para los de canal**.
    Regla, ahora sí universal: **el precio se guarda en quien lo contrató** —el
    contrato de la pyme y el asiento del socio—, nunca se lee del plan. En la
    maqueta, arreglarlo bajó el MRR de 854 € a 834 €.

    **13.11. Una cuenta NO tiene pantalla propia: lleva a lo que ya existe
    (2026-09-07).** Pulsar una cuenta del panel del superadmin abre la ficha de
    **su instancia** si es una empresa, o **su ficha de socio** si es un
    integrador o una asesoría; la del superadmin no lleva a ninguna parte y su
    nombre ni siquiera es un enlace —un nombre que parece pulsable y no lleva a
    nada se lee como algo roto—. Lo que hizo obvia la decisión fue contar: de 33
    cuentas del censo, **28 tienen una sola instancia** y las otras **5 son
    socios que ya tienen ficha**; una pantalla intermedia habría sido un nombre,
    un correo y un enlace, o una copia de la ficha de socio, y **dos sitios
    contando lo mismo acaban contándolo distinto**. Anotado el caso que hoy no
    existe y habrá que resolver cuando aparezca: una empresa con dos instancias
    no tendría adónde ir. Invariante: ningún destino puede apuntar a una
    instancia o a un socio que ya no está — un enlace roto es peor que no tener
    enlace.

    **13.12. Una integración SÍ tiene ficha, y un recuento suelto siempre acaba
    mintiendo (2026-09-07).** Pulsar una integración del catálogo abre su ficha,
    porque hay una pregunta que la tabla no responde y es la única que importa
    antes de retirarla o de tocarle el precio: **quiénes la tienen instalada**.
    La ficha es esa lista —con enlace a cada instancia—, más **quién la revende**
    y por dónde entraron las que la tienen; y **no** lleva permisos, eventos,
    credenciales ni webhooks: una tarjeta dice que existen y dónde viven, sin
    desplegarlos. **Lo que enseñó construirla, y vale para el núcleo:** el
    recuento de instalaciones estaba escrito a mano y **mentía** —VeriFactu decía
    17 y el censo tenía 16 con VeriFactu configurado— sin que nadie pudiera
    notarlo mirando la tabla. Regla: **la lista es el dato y el número se cuenta
    de ella**, nunca al revés. Es la tercera vez que aparece lo mismo en esta
    maqueta (las facturas de canal, la historia de un cliente y ahora esto): un
    total que no se puede contrastar con nada acaba contradiciendo a la pantalla
    de al lado. Lo mismo con los revendedores de una app: son **los que la tienen
    encendida en algún cliente**, no los que figuren en una lista aparte.

    **13.13. El orden del trabajo, y los módulos entran en el catálogo del
    superadmin (2026-09-07).** 👤 fijó el orden: **la asesoría va la última**
    porque es la más compleja; primero se termina de definir superadmin e
    integrador y **se compila para probarlo en real antes** de ponerse con ella.
    Y señaló un hueco —«ni en superadmin ni en integradores se pueden modificar
    los precios de los módulos como CRM, Trabajo»— que medido era la mitad
    exacta: el integrador **sí** cambia su precio de venta en su catálogo, pero
    el **precio mayorista de CRM y Partes de trabajo no tenía pantalla en ningún
    sitio** (las dos apps sí salían en Integraciones). Ahora el catálogo del
    superadmin son **tres tablas: planes, módulos e integraciones**, y la lista
    de módulos **se deriva de lo que Pimia vende**, no se escribe — un módulo
    nuevo aparece solo y ninguno puede volver a quedarse sin pantalla. **Asimetría
    que queda POR DECIDIR:** a diferencia de un plan o de un asiento, el precio
    de un módulo **no está congelado**; subirlo le sube la factura, el mes
    siguiente, a todos los socios que lo tengan encendido. La pantalla lo dice
    arriba y con nombres en vez de esconderlo, pero si debe seguir siendo así es
    una decisión que no se toma dibujando.

    **13.14. El precio de un añadido NO se congela, y es a propósito
    (2026-09-07).** Un plan y el asiento de un socio congelan su precio en quien
    lo contrató (13.7, 13.10); **un módulo o una app, no**: hay un precio y se
    aplica a todos a la vez. 👤 lo eligió por lo que gana —es lo simple de
    explicar y de cobrar, y nadie arrastra precios viejos—. ⚠️ **Esto NO es un
    descuido pendiente de armonizar con la regla de los planes**: quien venga a
    «arreglarlo» estará deshaciendo una decisión, y por eso está escrito en el
    propio dato y en la pantalla, no solo aquí. Lo que la decisión exige a
    cambio: **la pantalla que cambia ese precio tiene que decir antes a quién le
    sube, cuánto a cada uno y cuánto en total** (la diferencia por cada instancia
    encendida), porque el mes siguiente esa subida llega a socios que ya habían
    puesto su precio de venta.

    **13.15. DOS PRECIOS por producto (directo y distribución) y TARIFAS de
    socio; los planes de canal desaparecen (2026-09-07).** 👤: «vendemos planes,
    módulos e integraciones, los cuales tienen un precio para los clientes
    directos de Pimia y otro diferente que debo poder parametrizar para los
    socios (precio distribución). Por otro lado tendremos tarifas, en función
    del tipo de socio: no es lo mismo un socio que vende 30.000 € que uno que
    vende 100.000 €». Tres cosas estaban mal representadas: un plan solo tenía
    precio directo, un módulo solo tenía precio de distribución, y **el canal se
    representaba como dos planes propios** («Asesoría» y «Desarrollador») a un
    precio fijo por cliente. Esa tercera escondía el fondo: **un asiento fijo
    hacía que todos los clientes de un socio le costaran lo mismo**, tuviera uno
    un Starter y otro un Business. **Modelo nuevo:** cada producto —plan, módulo
    o integración— lleva `precio_directo` y `precio_distribucion`; un cliente de
    socio está sobre un **plan normal** y su socio paga la distribución **de ese
    plan**; los planes de canal se retiran como producto. **Las tarifas** son un
    **descuento sobre el precio de distribución** (Bronce 0 %, Plata 10 %, Oro
    20 %) y NO una lista de precios por tarifa: así se parametriza un precio por
    producto y un número por tarifa, y añadir un producto no obliga a tocar
    ninguna tarifa ni deja a un socio sin precio por un olvido; el volumen
    orienta, la tarifa la asigna Pimia. Consecuencia para las pantallas: el
    catálogo de un integrador **no puede poner un coste fijo a su licencia**
    —depende del plan de cada cliente—, y lo que le define ante Pimia es su
    tarifa, no un plan de canal.

    **13.16. Un VERTICAL es un SECTOR, lo abre un integrador, y un integrador
    tiene de una a n (2026-09-07).** 👤: «una vertical de negocio es una
    agrupación de empresas del sector, por ejemplo peluquerías. Nosotros
    partimos de una aplicación genérica, no específica para ningún sector en
    concreto. Por eso es tan importante la entrada de los integradores, ellos
    descubrirán nuevas oportunidades». Antes de preguntar se midió
    (`docs/research/ESTUDIO-VERTICALES-DE-NEGOCIO.md` del banco): la palabra
    significaba tres cosas distintas —un fork (decisión 7), el producto del
    integrador (`User::isDesarrollador`) y un oficio para filtrar agentes en
    la tienda— y ninguna era un dato; y de las siete capas que distinguen al
    fork de Zoomo de la web estándar, dos están decididas (dominio, catálogo),
    dos son del integrador (permisos, web comercial) y tres son la vertical de
    verdad —marca, recorte del menú y **lo que nace encendido**—, y esa última
    no existe: **Talleres Ana, el cliente real de ERP Studio, nació sin
    Mantenimientos ni Agenda**, porque `contracts` y `agenda` son opt-in
    para todos por igual y encenderlos es de primera parte, así que ni Zoomo
    ni su app pueden hacerlo. **Decidido:** (a) un vertical es un sector, no
    un producto que defina Pimia ni un sinónimo de socio — Pimia es la
    aplicación genérica y los integradores descubren los sectores; (b) **un
    integrador tiene de una a n verticales, y su panel diferencia los
    clientes de cada una**; (c) las asesorías y las instancias directas no
    llevan vertical. Aplicado a la maqueta el mismo día: verticales con dueño
    en el censo (sector, cómo la llama el socio, de quién es, desde cuándo);
    cada cliente de integrador entró por una de las de su socio y nunca antes
    de que existiera; filtro y columna en la cartera, reparto en la visión
    general, y el superadmin las ve en socios, ficha de socio, instancias y
    ficha de instancia. Consecuencia para el núcleo cuando toque construirlo:
    **la vertical es una entidad del plano central con dueño —una cuenta de
    desarrollador— y cada tenant atribuido a un integrador guarda por cuál
    entró**; el alta desde la web del integrador tiene que decirlo (hoy solo
    dice por qué client). **Lo que 13.16 deja abierto, y es la pregunta
    siguiente: cuánto puede parametrizar un integrador dentro de su
    vertical.** Medido el mismo día (§9 del estudio): su software, todo y sin
    ayuda de Pimia; dentro de cada cliente, mucho —catálogo de servicios,
    impuestos, series, plantillas, campos, logo— pero cliente a cliente y
    después del consentimiento; y una franja que no puede tocar de ninguna
    manera: qué módulos tiene encendidos, sus usuarios, su plan, su correo.
    Lo que falta no es más permisos: es que la vertical exista en Pimia con
    contenido, para que un cliente nuevo nazca ya montado. ⛔ Dos cosas que no
    miden lo que un tercero puede: zoomo-pimia es una vertical DEMO montada
    por Pimia como si fuera un integrador, y el puente con compai se probó
    desde nuestro extremo, no desde las posibilidades de un integrador.

    **Lo que esto deja sin pantalla en el núcleo** (no se retira nada todavía,
    se anota): `POST /api/tenant-invitations` invocado por un desarrollador,
    `POST /api/tenants/{slug}/transfer-ownership`, y la cuota de altas de
    `config/tenant_provisioning.php` para la cuenta de desarrollador. El SDK no
    pierde operaciones: dejan de usarse.

    **Lo que sigue sin decidir:** lo abierto en 13.16 —qué puede definir un
    integrador en Pimia para su vertical— y lo aparcado por 13.9c — si entrar dentro
    de una instancia deja rastro y si el cliente se entera; el botón está a la
    vista y apagado. **Siguiente paso acordado (13.13): compilar y probar en real
    superadmin e integrador**, y solo después el panel de la asesoría, que sale
    de cero (13.4). ⛔ Ninguna pregunta técnica: eso fue lo que hizo parar la
    cadena.

    **13.17. El CORE de Pimia es lo fiscal y la identidad, más Clientes y
    Artículos (2026-09-07).** Al cerrar la primera capa de un integrador
    hecha de verdad —HubSpot en el sitio del CRM base, en el fork de Zoomo
    (`docs/ESTUDIO-CAPA-HUBSPOT.md` del fork)—, 👤 fijó el marco del debate
    que viene: «el integrador, lo primero de todo, debe tener claro cuál es
    el CORE de Pimia, lo que no puede tocar. Digamos que es el punto de
    partida por el cual nace su vertical. […] Debemos dejar que el integrador
    decida si activa nuestros módulos, los integra con software de terceros
    o creados por él, o directamente carga módulos al CORE de Pimia». Antes
    de preguntar se midió (`docs/ESTUDIO-BASE-DE-LAS-VERTICALES.md` del
    fork): el core estaba en TRES listas que no se hablan —nueve módulos
    `core: true` en el registro, diez permisos `first_party_only` en cinco
    dominios (`admin`, `delegation`, `verifactu`, `billing`, `apps`) y las
    reglas del servidor— y cuatro opcionales que nacen encendidos para todos
    (CRM, trabajo, personal, cumplimiento) se comportaban como core sin
    serlo; la prueba de HubSpot lo midió con el CRM, que ni el integrador ni
    su app pueden apagar. **Decidido**, con sus palabras: «solo lo fiscal y
    la identidad, pero añadiendo Clientes y Artículos; con ello tenemos lo
    necesario para el cumplimiento de la facturación». O sea: **(a) el core
    es lo mínimo para emitir una factura válida** —la facturación y su
    cumplimiento (facturas, cobros, VeriFactu y Factur-X), la identidad (la
    cuenta, la empresa, sus usuarios, el plan y el cobro a Pimia), los
    Clientes y los Artículos—; **(b) todo lo demás es COMPONIBLE por el
    integrador**: salen del core compras, finanzas, informes, notas y el
    panel, y siguen fuera CRM, trabajo, personal, contratos, agenda, almacén
    y TPV. Lo que esto NO decide todavía, y hay que preguntar antes de tocar
    el registro: presupuestos, recurrentes y albaranes viven en el mismo
    módulo que las facturas (`billing`) sin ser fiscales; «ajustes» mezcla
    la identidad con los ajustes del oficio; y el panel es la portada. Las
    tres preguntas siguientes del debate, en orden: si el integrador decide
    qué nace encendido en su vertical (el paquete de nacimiento, §3 del
    estudio de verticales del banco); si un tercero integrado en el sitio de
    un módulo de Pimia lo SUSTITUYE o CONVIVE con él (lo que dejó abierto
    HubSpot); y qué es «cargar un módulo al core», un manifiesto o código
    dentro — lo segundo reabre la decisión 7 y hay que decirlo con esas
    palabras. Lo ya medido para las tres vías: activar EXISTE desde el 06-09
    (la activación mayorista) pero no apaga lo heredado ni decide qué nace;
    integrar existe en piezas y el catálogo de apps ya prevé `third_party`;
    cargar no existe.

    **13.18. La VERTICAL declara su paquete de nacimiento (2026-09-07).**
    Segunda pregunta del debate de la base de las verticales
    (`docs/ESTUDIO-BASE-DE-LAS-VERTICALES.md` del fork de Zoomo): en una
    vertical, ¿quién decide qué módulos componibles nacen encendidos y cuáles
    apagados en un cliente nuevo? Lo medido: la regla de nacimiento
    (`ModuleManager::defaultStatus`) es una para todos —CRM, trabajo, personal
    y cumplimiento nacen encendidos; TPV, agenda, contratos y almacén,
    apagados— y no sabe de verticales; la activación mayorista (06-09) deja al
    integrador encender lo que vende, pero no apagar lo heredado ni decidir el
    nacimiento; así nació Talleres Ana sin Mantenimientos y así queda el CRM
    base encendido debajo de HubSpot. **Decidido:** el integrador declara POR
    VERTICAL qué nace encendido y qué nace apagado de lo componible (13.17);
    un cliente nuevo de esa vertical nace así, entre por la web del integrador
    o por el panel de Pimia; lo que no declare sigue la regla general. Cabe en
    el catálogo del integrador, que ya guarda qué revende (12.4); exige en el
    núcleo la vertical como dato (13.16) y que la regla de nacimiento la mire.
    Descartadas: la regla general con activación después (deja la ventana en
    la que el cliente ve Pimia genérico y no puede quitar lo que nace
    encendido) y que el cliente elija en el alta (compra un producto hecho,
    no una lista de módulos). Cambiar un cliente de vertical después es una
    migración: no se diseña hasta que se pida.

    **13.19. Un tercero SUSTITUYE al módulo de Pimia en su vertical, y el
    cliente no recompone: la vertical es un producto SEMICERRADO del
    integrador (2026-09-07).** Tercera pregunta: cuando una vertical pone
    software de un tercero o suyo en el sitio de un módulo componible —HubSpot
    donde estaba el CRM base—, ¿el módulo de Pimia desaparece o convive? 👤:
    «Lo sustituye […], pero el cliente del tenant de una vertical, en este
    caso de Zoomo, no hace modificaciones. De hecho en su tenant no verá esa
    opción. Se entiende como vertical un producto semicerrado que ha creado
    el integrador». Dos cosas, y la segunda corrige la premisa con la que se
    preguntó (que el dueño podría volver a encenderlo desde el panel de
    Pimia): **(a)** el módulo sustituido nace apagado en los clientes de esa
    vertical (13.18), sale del menú y su vocabulario sale de las demás
    pantallas (el embudo del panel, «oportunidad» como destinatario de un
    presupuesto, las tareas de un lead); **(b)** el cliente de un tenant de
    vertical NO compone: en su tenant no ve la opción de encender lo
    sustituido ni de tocar la composición de módulos; eso es del integrador.
    No toca 12.3 en lo que es propiedad —el tenant, sus datos, su copia de
    seguridad y revocar la app siguen siendo del cliente—: lo que pasa al
    integrador es la composición. **Corregido en parte por 13.25
    (2026-09-07): de esas cuatro cosas, el TENANT pasa al integrador**; sus
    datos, su copia de seguridad y revocar la app siguen siendo del cliente. Consecuencias que se ven desde aquí y no se
    construyen todavía: la pantalla de módulos y la tienda de un tenant con
    vertical no ofrecen lo sustituido; las vistas portables de la web
    necesitan una costura que diga qué módulos tiene sustituidos esta
    vertical, para apagar sus ramas; y la app del integrador deja de pedir
    los permisos del módulo sustituido, lo que obliga a registrar el client
    de nuevo (los permisos se fijan al registrar). Descartadas: convivir
    escondiendo el menú (lo que hace hoy el prototipo de HubSpot: dos CRMs a
    un clic) y que cada cliente elija (la vertical dejaría de ser un
    producto).

    **13.20. Módulos e integraciones se AÍSLAN antes de debatirlos: el CRM y
    wab-ai, cada uno en su repo (2026-09-07).** A la cuarta pregunta —qué es
    para Pimia un módulo creado por un integrador: un manifiesto sin código
    dentro, código en el núcleo, o por niveles— 👤 no contestó con una
    opción sino con el método: «ahora que ya tenemos definido el CORE y
    verticales, llegamos a un punto clave, módulos e integraciones. 1º Lanza
    una nueva sesión para aislar uno de nuestros módulos en un repo de
    GitHub, ejemplo CRM: de este modo tenemos un ejemplo de las necesidades y
    de cómo un integrador tiene que crear módulos para Pimia. 2º Lanza una
    nueva sesión para aislar nuestra integración con wab-ai, que es una
    aplicación externa. A partir de estos datos debatimos después cómo
    manejamos los desarrollos de los integradores». O sea: la pregunta 4
    queda ABIERTA a propósito, y se contesta con dos mediciones hechas de
    verdad —qué es un módulo de Pimia sacado de Pimia (el CRM: rutas,
    modelos, migraciones, abilities, su entrada del registro, sus vistas en
    la web y su trozo del contrato) y qué es una app externa sacada de Pimia
    (wab-ai: su manifiesto, su client, su token de puente, sus scopes, sus
    webhooks)— cada una en su repo (`Pimia-AI/pimia-modulo-crm`,
    `Pimia-AI/pimia-app-wabai`), con la lista de lo que hubo que cortar y de
    lo que se quedó pegado. Lo medido de antemano (§2 del estudio de la
    base): «cargar un módulo» puede ser un manifiesto (C1) o código dentro
    (C2), y la decisión 7 cerró la segunda; las dos sesiones dicen cuánto
    cuesta cada una con un módulo y una app reales.

    **13.21. La vertical declara sus ANFITRIONES, y cada módulo o integración
    declara sus CARAS (2026-09-07).** Al cerrar el aislamiento de la app de
    wab-ai (`docs/ESTUDIO-APP-WABAI-AISLADA.md` del núcleo;
    `Pimia-AI/pimia-app-wabai`), 👤 planteó el marco: «Pimia tiene versión
    web, versión Buzz y versión Hermes; el integrador, cuando hace la
    vertical, primero decide sobre qué plataformas corre, de tal forma que un
    módulo o una integración tendrá tres formatos». Antes de decidir se
    midió, y la medida corrige la unidad: los tres anfitriones de la UI —la
    web (`features/pimia/`, 524 ficheros), Buzz (`desktop/src/features/pimia`,
    54 ficheros, copia verbatim del 2026-08-10, **congelado hasta su fase**) y
    Hermes Desktop (plugin `pimia-hermes-plugin`, vistas verbatim, spike de
    solo lectura; decisión 11)— comparten UNA sola UI, el dialecto portable
    de la decisión 7; lo que cambia por anfitrión es la costura (su client
    OAuth, el transporte, la navegación), y cada anfitrión es un fork. Y
    «Hermes» nombra dos cosas distintas: Hermes Desktop, que es un anfitrión
    de UI, y el AGENTE de la instancia (Pim), que no lo es: sus integraciones
    son servidores MCP montados en su `config.yaml` (Pimia, OCR, el radar
    público, wab-ai) y skills del marketplace. Una integración como wab-ai no
    tiene UI propia en ningún anfitrión —se ve por la pantalla genérica de
    Integraciones, que es portable— y trae dos caras: la del CONTRATO (SDK y
    webhooks, lo que salió a `pimia-app-wabai`) y la del AGENTE, que wab-ai ya
    entrega (su MCP de siete herramientas y la skill `comunicacion-citas`,
    ocho pasos con cinco herramientas del MCP de Pimia y dos suyas). Un
    módulo tiene las tres: código en el núcleo, UI portable, y herramientas
    MCP más skills. **Decidido:** (a) la unidad no es «un formato por
    plataforma» sino tres CARAS —contrato, UI portable, agente— y tres
    ANFITRIONES —web, Buzz, Hermes Desktop—, con la UI escrita una vez; (b)
    **la vertical declara en Pimia en qué anfitriones corre, y cada módulo o
    integración declara qué caras trae**, igual que la vertical declara su
    paquete de nacimiento (13.18): así el catálogo del integrador y el panel
    pueden decir dónde corre cada vertical y qué incluye cada pieza, y Buzz y
    Hermes Desktop se pueden vender como parte de una vertical; (c) declarar
    un anfitrión no lo construye: hoy solo la web está en condiciones de
    recibir una vertical. Consecuencias para el núcleo cuando toque
    construirlo: la vertical (13.16) guarda sus anfitriones; el manifiesto de
    una app y la entrada de un módulo en el registro declaran sus caras; y la
    sesión del CRM (13.20) mide el módulo cara a cara —qué hay en el núcleo,
    qué en `features/pimia/`, qué en el MCP y las skills—, que es la
    comparación que el debate necesita. Descartadas: que el anfitrión sea solo
    el fork que despliega el integrador sin que Pimia lo sepa (Pimia no podría
    decir dónde corre una vertical ni enseñar en el catálogo qué caras trae
    una pieza), y declarar solo la cara de agente (dejaría fuera del dato a
    Buzz y Hermes Desktop justo cuando 13.16 pide que la vertical exista con
    contenido). Aparcado, con fecha: si el paquete de nacimiento (13.18)
    incluye también la cara de agente —qué skills y MCPs nacen encendidos en
    el Pim de un cliente de la vertical—; se decide cuando el CRM esté
    aislado y las dos mediciones estén sobre la mesa.

    **13.22. La conexión de la app de un integrador es de la EMPRESA, no de la
    persona que la conectó (2026-09-07).** Primera pregunta de marco de la
    etapa 1 del plan «cómo un integrador crea integraciones y módulos»
    (`docs/plan-integraciones-y-modulos-del-integrador.md`, §7). Lo medido: el
    grant OAuth es de una persona (`oauth_authorizations`: client, tenant,
    user); la capa HubSpot escribe en Pimia con el grant de quien conectó y,
    si esa sesión se desconecta, el webhook «se queda sin manos» (estudio de
    HubSpot, 3.5); wab-ai guarda el `access_token` del administrador que
    conectó, sin refresh (estudio de wab-ai, choque 7). **Decidido:** la
    conexión nace con la instalación por empresa y sobrevive a que quien la
    hizo cierre sesión o deje la empresa; el dueño la revoca desde «Apps
    conectadas» o desinstalando la integración. Consecuencia para el núcleo:
    una identidad de la app por empresa —un grant de servicio ligado a
    `company_apps.authorization_id`, con refresh y rotación—, que es la pieza
    5 de §3.3 del plan (M–L) y la que permite que la app registre sus propios
    webhooks (pieza 6). Descartado: el patrón Slack de hoy, en el que la app
    se instala con el token de quien la instaló y la empresa reinstala si esa
    persona se va.

    **13.23. La integración es TRANSPARENTE para el core: facturas,
    presupuestos y clientes no distinguen si un lead viene de HubSpot o del
    CRM nativo (2026-09-07).** Segunda pregunta: cuando un documento de Pimia
    nace desde el software del integrador (un deal de HubSpot, una orden de su
    app), ¿Pimia guarda solo la etiqueta que este le pone, o sabe y enseña de
    dónde viene? 👤 no eligió ninguna de las dos: «la integración tiene que
    ser transparente, es decir las facturas, presupuestos, clientes del CORE
    de Pimia no hacen distinción de si un lead viene de HubSpot o de su CRM
    nativo». Lo medido: el CRM de Pimia está cosido a los documentos del core
    a mano —`estimates.lead_id` con `required_without:customer_id`, la
    relación `Estimate::lead()`, `lead_id` en el resource, en el resumen, en
    el PDF y en el webhook `estimate.accepted` (estudio del CRM, choque 3)—,
    mientras que HubSpot solo pudo dejar una etiqueta opaca
    (`hubspot:deal:9004`) que Pimia guarda y devuelve sin entender (estudio
    de HubSpot, 2.b). **Decidido:** el core no sabe ni enseña qué proveedor
    hay detrás de una capacidad componible. El enlace de un presupuesto a una
    oportunidad es del core, con una sola forma, y lo rellena igual el CRM de
    Pimia que el del integrador; lo que el cliente ve en la ficha, en el PDF
    y en el webhook es «la oportunidad», nunca «de HubSpot» ni «del CRM
    nativo». `external_ref` sigue siendo el mapeo del integrador hacia SU
    sistema, no lo que el core enseña. Consecuencias: la pieza «referencia a
    documento externo» del estudio del CRM (§5.1, `links`, tamaño L) deja de
    ser opcional y entra en la etapa 1 como pieza 9 de §3.3 del plan, con la
    forma que hoy tiene `lead_id` generalizada a cualquier proveedor; y es la
    regla de 13.19 vista desde los documentos: sustituir es que el core no
    note la diferencia. Descartadas: la etiqueta opaca como único enlace (un
    presupuesto de HubSpot parece hecho a mano) y pintar el origen (el core
    distinguiría proveedores, que es justo lo que no se quiere).
    **Generalizada por 13.26 (2026-09-08)**: lo que aquí se dice de los
    documentos vale para CUALQUIER módulo sustituible, y allí está el criterio
    de hasta dónde guarda el core.
    **13.24. La etapa 1 se verifica con un MÓDULO NUEVO del sector de ERP
    Studio, no con la capa HubSpot (2026-09-07).** Tercera pregunta de marco
    de la etapa 1: ¿con qué se verifica que un módulo de un integrador corre
    en su servidor para su vertical? Opciones: la capa HubSpot de Zoomo, ya
    construida y medida en dev (crea cliente y presupuesto por el SDK, sin
    cuenta real todavía); un módulo nuevo del sector; o las dos. 👤 eligió el
    módulo nuevo: el fork de Zoomo —la vertical de demostración que Pimia
    opera como si fuera un integrador (13.16)— escribe desde una hoja en
    blanco un módulo propio de su sector (talleres) siguiendo la receta de
    §3.2 del plan (`docs/plan-integraciones-y-modulos-del-integrador.md`), y
    con él se miden las siete filas de §3.4. Por qué importa: la capa HubSpot
    mide integrar software AJENO en el sitio de un módulo de Pimia; un módulo
    propio mide el camino que el plan describe —crear, no solo conectar— con
    software del integrador, que es lo que 13.20 preguntaba. Consecuencias:
    HubSpot queda como la medición previa que ya destapó los choques (no se
    tira ni se amplía); qué hace el módulo nuevo —lo que un taller necesita y
    el core no hace— lo define el fork antes de escribirlo; se construye
    contra las piezas de §3.3 conforme entren, primero en dev
    (`reformas-vera`, con el grant del integrador de Zoomo que ya existe) y
    después en `app.erpstudio.es` con Talleres Ana; y la receta de §3.2 se
    corrige con lo que ese módulo tropiece, cada tropiezo un choque con
    fichero y línea. Descartadas: verificar con HubSpot (ya medido, y no es
    software del integrador) y con las dos (dobla la verificación antes de
    tener las piezas).

    **13.25. El tenant es del INTEGRADOR, y el cliente que se va se lleva una
    COPIA (2026-09-07).** 👤, revisando la regla 3 del punto 12: «el tenant no
    es del cliente (eso dificulta mucho toda la operativa), el tenant es del
    integrador. Si el cliente quiere cambiar de integrador, deberá realizar una
    copia de seguridad de sus datos y llevar esa copia para que el integrador
    la restaure en su vertical o tenant». **Decidido:** (a) la instancia de un
    cliente de integrador es del integrador —él la abre, la compone, la
    mantiene y la da de baja—; (b) romper con el integrador NO es quedarse la
    instancia: el cliente descarga su copia de seguridad y otro integrador la
    restaura en su vertical, y la instancia vieja se queda donde estaba; (c) al
    cliente de un integrador dejan de ofrecérsele **«asumir la licencia»**
    (el rescate) y **«volver a Pimia estándar»**, que existen y presuponen lo
    contrario. Preguntado y contestado el mismo día: lo que le queda al cliente
    al romper es **solo su copia**.

    **Qué revisa y qué no.** Revisa la regla 3 del punto 12 («el tenant es
    siempre del cliente», con el traspaso de propiedad obligatorio antes de
    entregar) y la frase de 13.19 que decía que «el tenant, sus datos, su copia
    de seguridad y revocar la app siguen siendo del cliente»: de esas cuatro
    cosas, la primera pasa al integrador. **No toca 13.1 ni 13.3, y conviene
    decirlo porque es lo que más se va a malinterpretar:** el integrador sigue
    SIN ser el dueño técnico de la instancia y SIN entrar en ella —ni por SSO,
    ni al equipo, ni a los libros—, que es justo lo que aquellas dos
    decisiones compraron para que el panel pudiera prometer que no ve los datos
    de nadie. La titularidad que cambia es la COMERCIAL: de quién es el
    contrato y a quién responde la instancia, no quién figura como `owner_id`
    en la fila. Y no toca la propiedad de los DATOS: los libros fiscales, los
    clientes y los ficheros siguen siendo del cliente, que por eso puede
    llevárselos. 13.2 se confirma en su parte buena (no hay traspaso de
    propiedad) y se corrige en su premisa: la copia deja de ser la salida
    cómoda y pasa a ser la ÚNICA.

    **⛔ Lo medido el mismo día, y es lo que esta decisión pone en el camino
    crítico: la copia de seguridad de hoy NO es portable entre instancias.**
    13.2 la daba por resuelta («algo tan sencillo como un backup que otro
    integrador de Pimia puede restaurar»); medido en dev sobre
    `app/Http/Controllers/Api/BackupController.php` y el contenedor
    `platform-app`, tres cosas lo impiden:

    1. **No hay por dónde subirla.** Las cinco rutas
       (`routes/api.php:354-358`) son listar, crear, descargar, borrar y
       restaurar, y `restore` (`BackupController.php:147`) solo admite un
       fichero que YA vive en `backups/{tenant_id}/` de esa misma instancia.
       El integrador nuevo puede recibir el `.sql.gz` por correo y no tiene
       ninguna forma de metérselo a Pimia.
    2. **El volcado lleva dentro el nombre de la instancia de origen.**
       Medido con un `pg_dump --schema-only` de `tenant_reformas-vera` en dev:
       el fichero trae `CREATE SCHEMA "tenant_reformas-vera"` y cada tabla
       cualificada con ese mismo nombre. Restaurarlo en otra instancia
       recrearía el esquema del origen, no el del destino: hay que reescribir
       el volcado, no solo cargarlo.
    3. **Los ficheros no van dentro.** El `.sql.gz` es un `pg_dump` del
       esquema; los adjuntos, logos y PDF viven aparte, en
       `storage/app/<slug>/`. Una copia sin ellos deja al cliente sin sus
       documentos.

    Añádase que la maquinaria está sin estrenar: en dev hay **un** directorio
    de copias y **cero** ficheros dentro, así que el camino no se ha recorrido
    nunca de punta a punta. Consecuencia: **la portabilidad hay que
    construirla** —exportación completa (esquema + ficheros), importación a
    una instancia nueva con reescritura del esquema, y una comprobación de que
    lo restaurado es lo que había—, y hasta que exista, esta decisión deja al
    cliente sin salida real. Es la pieza que 13.2 creyó gratis y no lo es.

    **Consecuencias para el núcleo**, sin construir nada todavía: se retiran
    de la superficie del cliente de integrador `POST /api/billing/rescue` y
    `POST /api/tenants/{slug}/return-to-standard`
    (`routes/api.php:343,374`); `POST /api/tenants/{slug}/transfer-ownership`
    queda sin uso en el programa de integradores —sigue publicado en el
    contrato del plano central (`docs/openapi/pimia-central-v1.json` 1.4.0) y
    hay que decidir si sale—; y el catálogo, el cobro y la baja siguen donde
    están, porque el mayorista (12.2) ya cobraba al integrador. Lo que esta
    decisión NO alcanza, y se anota en vez de suponerlo: las **asesorías** y
    las **instancias directas** siguen siendo del cliente (no llevan vertical,
    13.16c).

    **Lo que deja abierto, y hay que mirarlo antes de escribirlo en un
    contrato:** de quién responde ante la AEAT una instancia cuyos libros son
    del cliente y cuya titularidad es del integrador, y qué figura del RGPD le
    toca a cada uno cuando el que manda sobre la instancia no es el titular de
    los datos. No es una objeción a la decisión de producto: es el sitio donde
    esta decisión toca lo legal, y conviene resolverlo con quien corresponda.

    **Descartadas:** conservar el rescate como red de seguridad para cuando el
    integrador cierra o deja de pagar (deja la titularidad con una excepción
    que hay que explicar en el contrato y en el panel, y 👤 la descartó
    expresamente al elegir «solo su copia»); y hacer al integrador dueño
    técnico de la instancia (le devolvería la entrada por SSO, el equipo y el
    backup del cliente, que es lo que 13.1 y 13.3 quitaron).

    **13.26. El CORE define la forma, el MÓDULO la rellena — y el criterio para
    saber dónde para el core (2026-09-08).** Preguntado por dónde vive «la
    oportunidad» a la que se dirige un presupuesto cuando el CRM lo pone el
    integrador, 👤 no eligió entre las opciones y planteó la regla de arriba,
    con sus palabras: «imagino que esta casuística nos sucederá en casi todos
    nuestros módulos de Pimia, los cuales un integrador puede sustituir por unos
    suyos. El caso es que la mayoría de los módulos están enlazados con los
    módulos CORE. […] la base o el fundamento de la definición de lead es lo
    mismo en el módulo de Pimia, que en HubSpot, que en un CRM personalizado de
    un cliente. Por lo tanto creo que debemos diferenciar que un integrador
    utilice un módulo u otro, a cómo Pimia CORE recoge y almacena la
    información». Y preguntó si eso era una aberración o lo habitual: **es lo
    habitual**, y tiene nombre — el núcleo define un modelo propio y estable y
    los proveedores lo rellenan.

    **Decidido:** (a) **quién pone el módulo es una cosa y qué guarda Pimia es
    otra.** Un concepto que el core necesita existe en el core con UNA sola
    forma, y da igual si lo escribe el módulo de Pimia, el de un tercero o el
    propio del cliente; (b) por tanto el core **guarda los elementos que
    necesita**, no una etiqueta opaca del proveedor ni una copia del módulo; (c)
    y para saber dónde para, el criterio que 👤 aprobó el mismo día:

    > **El core guarda lo que el core necesita para hacer SU trabajo: emitir el
    > documento, poder enviarlo, imprimirlo y contarlo. Todo lo demás es del
    > módulo.**

    Ese criterio existe porque «tantos elementos como sean necesarios» sin freno
    acaba con el core copiando el módulo entero, y entonces el integrador ya no
    aporta nada — que es justo lo contrario de por qué existe el programa.

    **Aplicado al primer caso, la oportunidad de un presupuesto:** el core
    guarda a quién va dirigido y lo justo para poder mandárselo (nombre,
    contacto, correo, teléfono). La etapa del embudo, la probabilidad de cierre,
    el importe esperado y la actividad comercial se quedan en el módulo, sea el
    de Pimia o el del integrador. El cliente ve «la oportunidad» y nunca de
    dónde viene, que es 13.23.

    **Qué es de este punto y qué era ya de 13.23:** 13.23 dijo que el core no
    distingue proveedores en los documentos; 13.26 lo generaliza a CUALQUIER
    módulo sustituible y le pone el freno. Es la regla que gobierna la pieza 9
    de la fase 1 y todas las que vengan cuando un integrador sustituya compras,
    agenda, almacén o lo que sea.

    **Descartadas, y por qué:** reutilizar la ficha de Clientes para el
    interesado que aún no ha comprado (llena el fichero de clientes de gente que
    nunca compró, y esos aparecen en listados, informes y recuentos mezclados
    con los reales); y guardar solo el nombre escrito (no resuelve el caso: sin
    correo ni dirección ese presupuesto no se puede enviar ni imprimir, así que
    en la práctica habría que dar de alta al cliente igualmente).

    **Lo que deja abierto, a propósito:** qué se hace cuando un integrador pida
    que el core sepa algo MÁS de lo que necesita para su trabajo. Se decide
    entonces, con el caso real delante, y se añade; no se adivina ahora. ⚠️ Y un
    guardarraíl para quien aplique esto: que el core guarde un dato no lo
    convierte en dueño de la funcionalidad — la ficha mínima de la oportunidad
    no puede crecer hasta ser un CRM sin pasar otra vez por este punto.

    **13.27. La pantalla de consentimiento enseña lo que la VERTICAL permite, y
    para eso se acota lo que se CONCEDE (2026-09-08).** Medido en vivo el mismo
    día, con la primera vertical real de dev ya creada (`erp-studio`, del
    integrador Zoomo, con `crm` sustituido y `talleres-ana` dentro): al abrir la
    instancia, esta redirige al dominio del integrador y **la pantalla de
    consentimiento sigue pidiendo los permisos del módulo sustituido** — «Ver
    leads, su embudo y su actividad comercial» y «Crear y modificar leads». El
    client pide 25 scopes y dos son del CRM. O sea: **el CRM sale, y en el primer
    sitio que el cliente ve.** Es 13.19 cumpliéndose por escrito, y nadie lo
    había mirado en vivo.

    Preguntado si esa pantalla debe enseñar **lo que el token puede** o **lo que
    la vertical permite**, 👤 eligió lo segundo.

    **⚠️ Y eso obliga a leerlo de una sola manera, porque la otra convierte la
    pantalla en una mentira.** Si la pantalla se limitara a ESCONDER los permisos
    del módulo sustituido, el token seguiría llevándolos: la app podría leer y
    escribir leads mientras al cliente se le dijo que no. El propio fichero ya se
    peleó una vez con eso y dejó escrito lo contrario —«el usuario tiene que ver
    lo que el token va a poder hacer DE VERDAD, compat incluida»
    (`app/Services/OAuth/ScopeRegistry.php:317-318`)—. **Decidido, por tanto:**
    no se esconde, **se acota lo que se concede**. Lo que la vertical sustituye
    no entra en el grant, y entonces la pantalla dice la verdad sin tener que
    hacer nada especial, porque se alimenta de lo concedido.

    **Dónde se aplica, medido:** `ScopeRegistry::resolveRequested()` es el punto
    ÚNICO por el que pasan los cuatro caminos del consentimiento y del canje
    (`app/Http/Controllers/OAuth/OAuthController.php:148`, `:225`, `:253` y
    `:343`), y de ahí salen tanto `permissionsFor()` como el grant. Acotar ahí
    arregla la pantalla, el token y —de paso— «Apps conectadas», que enseña la
    misma lista.

    **Lo que esto ahorra, y no es poco:** 13.19 anticipaba que sustituir un
    módulo obligaría al integrador a **registrar su client de nuevo** y a rehacer
    el consentimiento con cada cliente. Con la poda por vertical no hace falta:
    el grant es por (client, tenant, usuario), así que el mismo client conserva
    sus permisos en los tenants que no sustituyen nada y los pierde solo donde la
    vertical lo dice. Un client, varias verticales, sin re-registrar.

    **Lo que queda abierto y hay que decidir al construirlo:** qué pasa con los
    grants **ya concedidos** que hoy llevan los permisos del módulo sustituido.
    Podarlos al vuelo cambia lo que un token podía hacer sin avisar a nadie;
    dejarlos vivos hasta el siguiente consentimiento deja una ventana en la que
    la pantalla y el token no dicen lo mismo. Se decide con el caso delante, y
    se anota la ventana.

    **Descartada:** que el client no pida los scopes del módulo sustituido
    (13.19). Es más honesto de leer, pero lo paga el integrador con un
    re-registro y un consentimiento nuevo por cada cliente, y no distingue entre
    sus verticales — el mismo client sirve a las que sustituyen y a las que no.

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
