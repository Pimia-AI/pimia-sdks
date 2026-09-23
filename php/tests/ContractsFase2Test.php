<?php

declare(strict_types=1);

namespace Pimia\Tests;

use PHPUnit\Framework\TestCase;
use Pimia\Exception\ValidationException;
use Pimia\Http\Response;
use Pimia\PimiaClient;
use Pimia\Resource\Contracts;

final class ContractsFase2Test extends TestCase
{
    /** @param \Closure(string, string, int): Response $handler */
    private function cliente(\Closure $handler): array
    {
        $transport = new FakeTransport($handler);

        return [
            PimiaClient::withBorrowedToken(
                'https://acme.pimia.es', 'token-ficticio', $transport, ['company' => '3'],
            ),
            $transport,
        ];
    }

    public function test_las_siete_operaciones_del_catalogo_conservan_ruta_metodo_y_cuerpo(): void
    {
        $modelo = ['data' => ['id' => 4, 'name' => 'Mantenimiento', 'status' => 'ACTIVE', 'draft_revision' => 2]];
        [$client, $transport] = $this->cliente(static fn () => FakeTransport::json($modelo));

        $contenido = [
            ['type' => 'heading', 'level' => 2, 'text' => [['type' => 'text', 'value' => 'Objeto', 'bold' => true]]],
            ['type' => 'paragraph', 'text' => [['type' => 'variable', 'key' => 'customer.name']]],
            ['type' => 'list', 'ordered' => true, 'items' => [[['type' => 'text', 'value' => 'Uno']]]],
            ['type' => 'table', 'variable' => 'contract.milestones'],
            ['type' => 'signature'],
        ];
        $cuerpo = ['name' => 'Mantenimiento', 'content' => $contenido, 'draft_revision' => 2];

        $client->contracts->models->list(['status' => 'ALL', 'limit' => 'all']);
        $client->contracts->models->get(4);
        $client->contracts->models->create($cuerpo, 'modelo-alta');
        $client->contracts->models->update(4, $cuerpo);
        $client->contracts->models->publish('4');
        $client->contracts->models->archive(4);
        $client->contracts->models->variables('MILESTONES');

        $this->assertSame([
            'GET https://acme.pimia.es/api/v1/contract-models?status=ALL&limit=all',
            'GET https://acme.pimia.es/api/v1/contract-models/4',
            'POST https://acme.pimia.es/api/v1/contract-models',
            'PUT https://acme.pimia.es/api/v1/contract-models/4',
            'POST https://acme.pimia.es/api/v1/contract-models/4/publish',
            'POST https://acme.pimia.es/api/v1/contract-models/4/archive',
            'GET https://acme.pimia.es/api/v1/contract-models/variables?billing_mode=MILESTONES',
        ], array_map(static fn ($c) => $c['method'].' '.$c['url'], $transport->calls));

        // El árbol viaja tal cual: el SDK no normaliza ni recorta el clausulado.
        $this->assertSame($cuerpo, json_decode($transport->calls[2]['body'], true));
        $this->assertSame($cuerpo, json_decode($transport->calls[3]['body'], true));
        $this->assertSame('modelo-alta', $transport->calls[2]['headers']['idempotency-key']);
        // Publicar y archivar no llevan cuerpo propio: la decisión es la acción.
        $this->assertSame([], json_decode($transport->calls[4]['body'], true));
        $this->assertSame([], json_decode($transport->calls[5]['body'], true));

        foreach ($transport->calls as $call) {
            $this->assertSame('3', $call['headers']['company']);
        }
    }

    public function test_el_diccionario_sin_modo_no_manda_la_query(): void
    {
        $diccionario = [
            'data' => [[
                'key' => 'contract.total_amount', 'label' => 'Importe total', 'type' => 'money',
                'format' => 'currency', 'modes' => ['MILESTONES', 'ONE_OFF'], 'required' => true,
                'empty_as' => null, 'guarded' => false, 'example' => '4.500,00 €',
            ]],
            'meta' => [
                'dictionary_version' => '1', 'schema_version' => '1', 'render_revision' => '2026-09-23.2',
                'block_types' => ['heading', 'paragraph', 'list', 'table', 'signature'],
                'inline_types' => ['text', 'variable'],
                'limits' => ['max_blocks' => 300, 'max_inlines' => 300, 'max_list_items' => 200,
                    'max_text_length' => 5000, 'max_bytes' => 200000, 'max_heading_level' => 3],
            ],
        ];
        [$client, $transport] = $this->cliente(static fn () => FakeTransport::json($diccionario));

        $this->assertSame($diccionario, $client->contracts->models->variables());
        $this->assertSame('https://acme.pimia.es/api/v1/contract-models/variables', $transport->calls[0]['url']);
        // Los límites vivos salen del servidor: el SDK no lleva una segunda copia.
        $this->assertSame(300, $diccionario['meta']['limits']['max_blocks']);
    }

    public function test_el_409_de_una_revision_vieja_no_se_reintenta(): void
    {
        $conflicto = ['success' => false, 'message' => 'Otra edición guardó este borrador mientras escribías.'];
        [$client, $transport] = $this->cliente(static fn () => FakeTransport::json($conflicto, 409));

        try {
            $client->contracts->models->update(4, ['name' => 'x', 'content' => [], 'draft_revision' => 2]);
            $this->fail('un 409 tiene que subir');
        } catch (\Pimia\Exception\ApiException $e) {
            $this->assertSame(409, $e->status);
            $this->assertSame($conflicto, $e->body);
            // Un conflicto de edición no trae bloqueos de datos: son cosas distintas.
            $this->assertNull(Contracts::documentBlockers($e->body));
        }

        $this->assertCount(1, $transport->calls);
    }

    public function test_los_cuatro_modos_viajan_con_los_campos_de_su_modo_y_nada_mas(): void
    {
        [$client, $transport] = $this->cliente(static fn () => FakeTransport::json(['data' => ['id' => 7]], 201));
        $base = ['title' => 'Obra', 'customer_id' => 5, 'starts_at' => '2026-10-01'];
        $cuerpos = [
            $base + ['billing_mode' => 'INSTALLMENTS', 'amount' => 12000, 'billing_every' => 'MONTHLY'],
            $base + [
                'billing_mode' => 'MILESTONES', 'total_amount' => 450000, 'project_id' => 11,
                'contract_model_version_id' => 9,
                'milestones' => [
                    ['description' => 'Fase 1', 'amount' => 150000, 'planned_date' => '2026-11-01', 'position' => 1],
                    ['description' => 'Fase 2', 'amount' => 300000, 'planned_date' => null, 'position' => 2],
                ],
            ],
            $base + ['billing_mode' => 'ONE_OFF', 'total_amount' => 90000],
            $base + ['billing_mode' => 'NONE'],
        ];

        foreach ($cuerpos as $cuerpo) {
            $client->contracts->create($cuerpo);
        }

        $this->assertCount(4, $transport->calls);
        foreach ($cuerpos as $i => $cuerpo) {
            // Ni un céntimo inventado ni una periodicidad por defecto.
            $this->assertSame($cuerpo, json_decode($transport->calls[$i]['body'], true));
        }
        $hitos = json_decode($transport->calls[1]['body'], true)['milestones'];
        $this->assertSame([1, 2], array_column($hitos, 'position'));
        $this->assertNull($hitos[1]['planned_date']);
        // Céntimos ENTEROS, no un float ni una cadena con coma.
        $this->assertSame(150000, $hitos[0]['amount']);
    }

    public function test_la_preview_prepara_descarga_los_mismos_bytes_y_envia_con_la_referencia(): void
    {
        $referencia = '01KX0ZPQ7Q2M3N4P5R6S7T8V9W';
        $preparada = [
            'data' => [
                'reference' => $referencia, 'contract_id' => 7, 'status' => 'PREPARED',
                'contract_model_version_id' => 9, 'signature_version' => null,
                'render_revision' => '2026-09-23.2', 'anchored' => true,
                'source_document_sha256' => str_repeat('a', 64), 'byte_size' => 24576,
                'signature_fields' => null,
                'expected_signature_field' => ['page' => 2, 'page_count' => 3, 'left' => 12.5, 'top' => 70.25, 'width' => 40.0, 'height' => 5.0],
                'implicit_preview' => false, 'data_snapshot' => ['context' => ['locale' => 'es']],
            ],
            'download_url' => "https://acme.pimia.es/api/v1/contracts/7/document-preview/{$referencia}",
        ];
        $pdf = "%PDF-1.4\n";
        [$client, $transport] = $this->cliente(static function (string $method, string $url, int $n) use ($preparada, $pdf) {
            if ($n === 2) {
                return new Response(200, $pdf, ['content-type' => 'application/pdf']);
            }

            return FakeTransport::json($n === 3 ? ['data' => ['id' => 7], 'signingUrl' => 'https://firma.example.test/x'] : $preparada);
        });

        $vista = $client->contracts->documentPreview(7, ['name' => 'Ana', 'email' => 'ana@example.test']);
        $this->assertSame($preparada, $vista);

        // El PDF llega como bytes, no decodificado: leerlo como JSON lo corrompe.
        $this->assertSame($pdf, $client->contracts->downloadDocumentPreview(7, $vista['data']['reference']));

        $client->contracts->sendForSignature(7, [
            'name' => 'Ana', 'email' => 'ana@example.test',
            'document_version_id' => $vista['data']['reference'],
        ]);

        $this->assertSame([
            'POST https://acme.pimia.es/api/v1/contracts/7/document-preview',
            "GET https://acme.pimia.es/api/v1/contracts/7/document-preview/{$referencia}",
            'POST https://acme.pimia.es/api/v1/contracts/7/signature',
        ], array_map(static fn ($c) => $c['method'].' '.$c['url'], $transport->calls));

        // La referencia es la que devolvió el servidor, no un hash del navegador.
        $this->assertSame($referencia, json_decode($transport->calls[2]['body'], true)['document_version_id']);
        // Y la caja esperada es un objeto con página: no una lista.
        $this->assertSame(2, $preparada['data']['expected_signature_field']['page']);
    }

    public function test_la_preview_sin_destinatario_manda_un_objeto_vacio(): void
    {
        [$client, $transport] = $this->cliente(static fn () => FakeTransport::json(['data' => ['reference' => 'r']]));

        $client->contracts->documentPreview('7');

        $this->assertSame([], json_decode($transport->calls[0]['body'], true));
    }

    public function test_un_bloqueo_llega_con_todos_los_motivos_y_sin_reintento(): void
    {
        $bloqueo = [
            'success' => false,
            'message' => 'El documento no se puede preparar porque faltan datos: …',
            'blockers' => [
                'El marcador «customer.tax_id» (NIF del cliente) no tiene valor en este contrato.',
                'El marcador «contract.total_amount» (Importe total) no tiene valor en este contrato.',
            ],
        ];
        [$client, $transport] = $this->cliente(static fn () => FakeTransport::json($bloqueo, 422));

        try {
            $client->contracts->documentPreview(7);
            $this->fail('un bloqueo tiene que subir');
        } catch (ValidationException $e) {
            $this->assertSame($bloqueo['blockers'], Contracts::documentBlockers($e->body));
        }

        // Un bloqueo no se reintenta: hornearía otro PDF y retiraría la revisión.
        $this->assertCount(1, $transport->calls);

        // Y lo que no trae bloqueos no se los inventa.
        $this->assertNull(Contracts::documentBlockers(['message' => 'x']));
        $this->assertNull(Contracts::documentBlockers(['blockers' => [1, 2]]));
        $this->assertNull(Contracts::documentBlockers('nada'));
    }

    public function test_una_revision_obsoleta_al_enviar_se_propaga_sin_preparar_otra(): void
    {
        $obsoleta = [
            'success' => false,
            'message' => 'La revisión que mandas ya no es la vigente de este contrato.',
            'blockers' => ['Los datos del contrato cambiaron desde que se preparó el papel. Vuelve a revisarlo.'],
        ];
        [$client, $transport] = $this->cliente(static fn () => FakeTransport::json($obsoleta, 422));

        try {
            $client->contracts->sendForSignature(7, [
                'name' => 'Ana', 'email' => 'ana@example.test', 'document_version_id' => 'referencia-vieja',
            ]);
            $this->fail('una revisión obsoleta tiene que subir');
        } catch (ValidationException $e) {
            $this->assertSame($obsoleta['blockers'], Contracts::documentBlockers($e->body));
        }

        $this->assertCount(1, $transport->calls);
    }

    public function test_una_factura_manual_se_vincula_a_su_contrato(): void
    {
        [$client, $transport] = $this->cliente(static fn () => FakeTransport::json(['data' => ['id' => 31, 'contract_id' => 7]]));

        $creada = $client->invoices->create([
            'customer_id' => 5, 'invoice_date' => '2026-11-02', 'due_date' => '2026-11-30',
            'contract_id' => 7, 'items' => [],
        ]);

        $this->assertSame(7, $creada['data']['contract_id']);
        $this->assertSame(7, json_decode($transport->calls[0]['body'], true)['contract_id']);
    }
}
