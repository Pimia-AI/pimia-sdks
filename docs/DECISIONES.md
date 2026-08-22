# Decisiones de arquitectura — 2026-08-22 (rev. 2, misma tarde)

Documento **idéntico en los repos del ecosistema Pimia** (núcleo, pimia-sdks,
pimia-web-shadcn, pimia-workspace), para que cualquier agente o persona que
trabaje en uno tenga las mismas decisiones delante. Si cambia una decisión, se
cambia en todos el mismo día.

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

5. **Toda funcionalidad nueva del núcleo nace con ruta en `/api/v1` y tipo en
   el spec**, o no existe para nadie. Regenerar el OpenAPI y los tipos es un
   paso del release del SDK, no un acto manual.

6. **Orden de trabajo (rev. 2: la cadena tiene cinco eslabones, no dos):**
   1. sanear las lecturas de `settings` (núcleo);
   2. abrir el catálogo OAuth con el client de primera parte (núcleo);
   3. publicar las rutas de `admin` (usuarios, roles, módulos, SMTP) en
      `/api/v1` y en el spec, con un export reproducible (núcleo);
   4. release del SDK con el spec nuevo — la 0.6.0 puede salir YA con lo que
      `main` ya tiene (`/me`, plantillas, series, RRHH, tienda, empresa);
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
   **Despliegue: una sola instancia del panel** (el refresh token rota; dos
   procesos refrescando = reuse = revocación en cascada), con su almacén de
   grants y candado locales. Todas las pruebas contra un tenant de pruebas.

## Cómo se aplica en este repo (SDK)

- Este repo es la cara pública del núcleo. Cuando pimia-web-shadcn se abra,
  el README apunta a ella como «el ERP entero para personalizar».
- `examples/starter-vertical` se queda pequeño a propósito (OAuth + pocas
  pantallas) para no competir con la web.
- `spec/pimia-api-v1.json` y `api.d.ts` son EL contrato: se regeneran en cada
  release. Un hueco que encuentre un anfitrión se registra aquí como deuda del
  contrato; no se rodea en el anfitrión.
