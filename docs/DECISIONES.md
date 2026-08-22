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
   (verifactu crea el taxpayer; estado OAuth del LLM), `default_scope`
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
