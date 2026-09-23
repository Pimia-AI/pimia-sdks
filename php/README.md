# pimia/pimia-php

`baseUrl` es el **origen**, sin `/api` ni barra final: `https://pimia.es`
para el cliente central o `https://acme.pimia.es` para el de instancia.
El cliente añade `/api/…` (central, TypeScript) o `/api/v1/…` (instancia).
Desde 0.30.1, un valor terminado en `/api` o `/api/v1` se rechaza al construir
el cliente (en PHP, al crear `Config`), antes de hacer peticiones. Quita ese
sufijo; no se elimina automáticamente. Una barra final sigue admitiéndose.


Cliente PHP oficial de la API de Pimia para **apps de partner**: OAuth con
PKCE, **rotación del refresh token** persistida, reintentos de rate limit y
excepciones tipadas. Licencia MIT.

> El código vive en el monorepo [`Pimia-AI/pimia-sdks`](https://github.com/Pimia-AI/pimia-sdks),
> directorio `php/`. [`Pimia-AI/pimia-php`](https://github.com/Pimia-AI/pimia-php)
> es un **espejo de solo lectura** que se regenera en cada release: existe
> porque Composer exige el `composer.json` en la raíz del repositorio. Las
> incidencias y los PRs, al monorepo.

Requisitos: PHP ≥ 8.2 + un cliente HTTP PSR-18 (cualquiera vale; Guzzle es el
sugerido).

## Instalación

```bash
composer require pimia/pimia-php
```

Publicado en Packagist desde v0.1.0. Requiere PHP ≥ 8.2 y un cliente HTTP
PSR-18 (Guzzle es el sugerido):

```bash
composer require guzzlehttp/guzzle
```

## Uso en 20 líneas

```php
use GuzzleHttp\Client;
use GuzzleHttp\Psr7\HttpFactory;
use Pimia\{Config, PimiaClient, Scopes};
use Pimia\Http\PsrTransport;
use Pimia\OAuth\{InMemoryTokenStore, OAuthClient, PkceChallenge};

$config = new Config(
    baseUrl: 'https://acme.pimia.es',
    clientId: getenv('PIMIA_CLIENT_ID'),
    clientSecret: getenv('PIMIA_CLIENT_SECRET') ?: null,
    redirectUri: 'https://miapp.example/callback',
);

$factory = new HttpFactory();
$transport = new PsrTransport(new Client(), $factory, $factory);

// 1. Autorización
$pkce = PkceChallenge::create();          // guarda $pkce->verifier en sesión
$oauth = new OAuthClient($config, $transport);
$url = $oauth->authorizeUrl([Scopes::INVOICES_READ], PkceChallenge::state(), $pkce);

// 2. Callback: canje + persistencia
$tokens = new InMemoryTokenStore();       // en producción: tu BD
$tokens->save($oauth->exchangeCode($code, PkceChallenge::fromVerifier($verifierDeSesion)));

// 3. Uso
$pimia = new PimiaClient($config, $transport, $tokens);
$invoices = $pimia->invoices->list(['page' => 1]);
```

## Lo único que tienes que leer antes de escribir código

**El refresh token de Pimia rota.** Cada refresco devuelve uno nuevo y mata el
anterior; reusar uno ya rotado revoca el grant entero en cascada. Por eso el
cliente exige un `TokenStore`: persiste el conjunto de tokens tras cada
refresco y no refresques dos veces en paralelo con el mismo token. Las dos
cosas las cubre el SDK si lo usas como está pensado.

## Un servicio que reenvía el token de su usuario

Todo lo de arriba supone que **tu app posee un grant**. Hay integraciones que no
y que no deben: un servicio al que el front le manda, en cada petición, el
`Authorization` del usuario que ya entró en Pimia. Para ésas está el modo de
token prestado — sin `clientId`, sin `TokenStore` y sin ceremonia OAuth:

```php
$pimia = PimiaClient::withBorrowedToken(
    baseUrl: "https://{$tenant}.pimia.es",
    accessToken: $bearerDeQuienLlama,
    transport: $transport,
    // La empresa activa viaja en cabecera, como en todo el API. OMÍTELA cuando
    // no la sepas: `company:` vacía es una cabecera presente que no casa con
    // ninguna empresa.
    headers: $empresa === null ? [] : ['company' => (string) $empresa],
    // Atiendes una petición web: los reintentos del SDK DUERMEN, y dormir
    // dentro de la petición de un usuario es una petición colgada.
    maxRateLimitRetries: 0,
);

$empresa = $pimia->bootstrap->currentCompanyId();
$censo = $pimia->crm->assignableUsers();
```

Lo que ganas con esto es que **Pimia sigue decidiendo los permisos**: tu servicio
no puede darle a nadie más de lo que su token ya le daba, y no hay una
credencial de servicio que auditar aparte.

Tres cosas que conviene tener claras:

- **Un cliente por petición.** El token vive lo que viva la petición que lo
  trajo; una instancia compartida es una credencial compartida.
- **No se refresca.** El refresh es del dueño del grant. Cuando el token caduca,
  el 401 sube como `UnauthorizedException` y quien tiene que conseguir otro es
  quien te lo prestó. El cliente no lo intenta —y eso es deliberado: con la
  rotación de Pimia, tocar el refresh de otro revoca su grant entero.
- **`$pimia->oauth` es `null`** en este modo. No hay ceremonia que hacer, y un
  `OAuthClient` sin `clientId` compondría una URL de autorización rota que sólo
  fallaría en el navegador del usuario.

`GET /bootstrap` merece un aviso propio: **es la única respuesta del API que no
viene envuelta en `data`**. Sus claves cuelgan de la raíz, así que un
desenvolvedor de `data` escrito «para todas las llamadas» devuelve vacío sin
error — y el fallo se ve como una empresa sin resolver o como una moneda que cae
al respaldo, nunca como un fallo. `$pimia->bootstrap->currentCompanyId()` y
`->currency()` lo leen bien; `->get()` te da el cuerpo tal cual.

## La suscripción del cliente en el Stripe de su integrador

Si tu vertical cobra con tu Stripe, el perfil del cliente puede enseñar su plan
y mandarle al portal de Stripe (scopes `Scopes::INTEGRADOR_BILLING_READ` y
`Scopes::INTEGRADOR_BILLING_WRITE`; dueño o administrador de la empresa):

```php
$suscripcion = $pimia->billing->integrador->subscription();
$portal = $pimia->billing->integrador->portal('https://app.erpstudio.es/perfil');
header('Location: '.$portal['data']['url']);
```

Los cortes llegan en `code` del cuerpo (`ApiException::$body`):
`suscripcion_no_disponible` (404), `suscripcion_de_baja` (409),
`return_url_no_permitida` (422)… No hay `cancel` ni `changePlan`: todo pasa por
el portal.

## Reintentar un `POST` sin duplicar

Manda una `Idempotency-Key` única por operación y Pimia ejecuta la escritura
una sola vez, por muchos reintentos que haya:

```php
$clave = bin2hex(random_bytes(16));
$client->estimates->create($presupuesto, $clave);
```

Reúsala **solo** en los reintentos de esa misma operación: la misma clave con
otro cuerpo responde `422`.

Tras un reintento el cuerpo que recibes es idéntico al de la primera llamada
—ese es justo el contrato—, así que el cuerpo solo no dice si Pimia escribió o
se limitó a repetirse. Para saberlo, `requestWithMeta()`:

```php
$r = $client->requestWithMeta('POST', '/estimates', body: $presupuesto, idempotencyKey: $clave);

if ($r->meta->idempotentReplay) {
    // ya existía: no se ha creado nada nuevo
}
```

## Recibir webhooks

`WebhookVerifier` comprueba la firma `PIMIA-WEBHOOK-v1` y te devuelve la
entrega ya parseada. No reimplementes el HMAC:

```php
use Pimia\Exception\WebhookVerificationException;
use Pimia\Webhooks\WebhookEvent;
use Pimia\Webhooks\WebhookVerifier;

$verifier = new WebhookVerifier(getenv('PIMIA_WEBHOOK_SECRET'));

try {
    // ⚠️ El cuerpo CRUDO. En Laravel, $request->getContent() — nunca
    // json_encode($request->all()): Pimia firma los bytes que envía y
    // reserializar rompe la firma sin que se vea por qué.
    $hook = $verifier->verify($request->headers->all(), $request->getContent());
} catch (WebhookVerificationException $e) {
    return response($e->reason, 400);
}

// Pimia reintenta: la misma entrega llega con el mismo id.
if ($yaProcesado($hook->delivery)) {
    return response('', 200);
}

match ($hook->event) {
    WebhookEvent::EstimateAccepted => $facturar($hook->payload['id']),
    WebhookEvent::InvoicePaid      => $cobrar($hook->payload['id']),
    default                        => null, // incluye el catálogo futuro
};

return response('', 200); // responde rápido; el trabajo pesado, a una cola
```

Los ocho eventos del catálogo están en el enum `WebhookEvent` y sus payloads
documentados como *array shapes* (PHPStan y Psalm los entienden). Un evento que
este SDK todavía no conozca **no es un error**: se verifica igual y llega con
`$hook->event === null` y el nombre crudo en `$hook->eventName`.

Detalles que ahorran un rato:

- El constructor acepta una **lista** de secretos, para rotarlo sin ventana de
  caída.
- La ventana anti-replay son 300 s; ajústala con `toleranceSeconds:`.
- `$e->reason` es legible por máquina (`signature_mismatch`,
  `timestamp_out_of_window`, `missing_headers`, `invalid_timestamp`,
  `invalid_json`) para tus métricas.
- `WebhookVerifier::sign()` firma un cuerpo como lo haría Pimia: úsalo en **tus
  tests**, no en producción.

## Más

Documentación completa, modelo mental (un tenant = una base URL = un token),
tabla de excepciones tipadas y el contrato OpenAPI, en el monorepo:
[Pimia-AI/pimia-sdks](https://github.com/Pimia-AI/pimia-sdks).

### Confirmación del dueño (0.30.0 preparada)

Usuarios administradores, roles admin y vínculos pueden quedar pendientes:

```php
use Pimia\OwnerConfirmationRequired;

$result = $pimia->put('/users/42', ['role' => 'admin']);
$pending = OwnerConfirmationRequired::fromResponse($result);
if ($pending !== null) {
    mostrarPendiente($pending->message); // $pending->id identifica la solicitud.
} else {
    mostrarUsuarioActualizado($result);
}
```

`post`, `put`, `delete` y `request` conservan el cuerpo 202; no lo convierten
al recurso creado. `requestWithMeta` permite leer además `$result->meta->status`.
El 503 no se reintenta: llega como `ApiException`, cuyo `$e->body['code']`
es `OwnerConfirmationRequired::MAIL_FAILED_CODE`. El SDK no ejecuta ni abre
el enlace de confirmación. El plano central y los métodos de primer periodo
siguen siendo exclusivos de TypeScript.

### Contratos: modos, modelos y vista previa (0.34.0)

```php
// Cuotas: es el ÚNICO modo que crea o adopta recurrente al activar.
$client->contracts->create([
    'title' => 'Mantenimiento', 'customer_id' => 5, 'starts_at' => '2026-10-01',
    'billing_mode' => 'INSTALLMENTS', 'amount' => 12000, 'billing_every' => 'MONTHLY',
]);

// Hitos: total opcional, guía ordenada en céntimos, proyecto y clausulado.
$client->contracts->create([
    'title' => 'Reforma', 'customer_id' => 5, 'starts_at' => '2026-10-01',
    'billing_mode' => 'MILESTONES', 'total_amount' => 450000,
    'project_id' => 11, 'contract_model_version_id' => 9,
    'milestones' => [
        ['description' => 'Fase 1', 'amount' => 150000, 'planned_date' => '2026-11-01', 'position' => 1],
        ['description' => 'Fase 2', 'amount' => 300000, 'planned_date' => null, 'position' => 2],
    ],
]);
```

`ONE_OFF` lleva `total_amount` opcional y `NONE` no lleva nada económico.
`customer_id` sigue siendo obligatorio en los cuatro modos y un campo ajeno al
modo es un **422**. Un alta sin `billing_mode` se resuelve al persistido o a
`INSTALLMENTS`: los contratos anteriores no cambian.

⛔ Los hitos son **guía**: no emiten factura ni marcan cobro. La de un hito se
crea a mano y aparece bajo el contrato:
`$client->invoices->create([..., 'contract_id' => 7])`.

**El catálogo de clausulados** vive en `$client->contracts->models` y tiene
**abilities propias**: poder enviar un contrato no concede redactar modelos.

```php
$diccionario = $client->contracts->models->variables('MILESTONES');
// $diccionario['meta']['limits'] y ['block_types'] vienen del servidor.

$modelo = $client->contracts->models->create([
    'name' => 'Mantenimiento',
    'draft_revision' => 0,
    'content' => [
        ['type' => 'heading', 'level' => 2, 'text' => [['type' => 'text', 'value' => 'Objeto', 'bold' => true]]],
        ['type' => 'paragraph', 'text' => [['type' => 'variable', 'key' => 'customer.name']]],
        ['type' => 'table', 'variable' => 'contract.milestones'],
        ['type' => 'signature'], // dónde firma el cliente: uno, ni cero ni dos
    ],
]);
$client->contracts->models->publish($modelo['data']['id']); // versión INMUTABLE
```

Guardar contenido exige la `draft_revision` que leíste: un **409** dice que
otra edición guardó mientras tanto. Publicar la v2 no toca la v1 ni los
contratos que la eligieron; `archive` retira de las selecciones nuevas sin
borrar historial.

**Revisar antes de firmar:**

```php
$vista = $client->contracts->documentPreview(7, ['name' => 'Ana', 'email' => 'ana@example.test']);
$pdf = $client->contracts->downloadDocumentPreview(7, $vista['data']['reference']); // bytes
$client->contracts->sendForSignature(7, [
    'name' => 'Ana', 'email' => 'ana@example.test',
    'document_version_id' => $vista['data']['reference'],
]);
```

La preview **no envía** y los bytes se sirven del archivo sin regenerarse.
`source_document_sha256` es evidencia, **no autorización**. Un 422 de falta de
dato o de revisión obsoleta trae todos los motivos y **no se reintenta solo**:

```php
try { $client->contracts->documentPreview(7); }
catch (ValidationException $e) { $motivos = Contracts::documentBlockers($e->body); }
```

`implicit_preview => true` marca la revisión que preparó el propio envío de un
contrato sin modelo: no acredita que nadie haya visto el papel.

### Firma del cliente en contratos (0.32.0)

```php
$sent = $client->contracts->sendForSignature(7, [
    'name' => 'Ana', 'email' => 'ana@example.test', 'send_email' => true,
], 'contrato-7-firma-1');
// $sent['data'] contiene el contrato; $sent['signingUrl'] permite firmarlo.
$status = $client->contracts->signatureStatus(7);
$accepted = $client->contracts->remindSignature(7); // 202: ['success' => bool]
$client->contracts->cancelSignature(7); // cancela la firma, no el contrato
```

`sendForSignature` acepta también `subject` y `body`. Los dos POST admiten
una clave de idempotencia opcional. `signatureStatus` exige `contracts:read`;
las otras acciones, `contracts:write`.

`signingUrl` es una capacidad y solo vuelve al enviar: no lo registres en logs
ni lo expongas en listados. `data.signature` trae `status`, `version`, `sent_at`,
`signed_at`, `source_document_sha256`, `signed_document_sha256`; fechas y hashes
pueden ser null. Completar la firma no activa el contrato y el retorno del
navegador no acredita su estado: consúltalo al núcleo. El recordatorio es
manual y su 202 acepta el correo, no acredita su entrega ni crea otra firma.
Para personalizar `subject`/`body` del recordatorio, usa el POST genérico.
