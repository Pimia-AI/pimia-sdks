# Contratos fase 2: el recorrido entero

`recorrido.mjs` hace, contra un tenant real y en este orden: diccionario de
marcadores → modelo de clausulado → publicar la versión → contrato **por
hitos** con proyecto que elige esa versión → vista previa → descarga de los
bytes exactos → (opcional) envío a firmar con la referencia → **factura manual
vinculada** al contrato. Y al final imprime la forma del cuerpo de los cuatro
modos.

```bash
PIMIA_BASE_URL=https://TENANT.taskai.work \
PIMIA_TOKEN=... \
PIMIA_COMPANY=1 \
PIMIA_CUSTOMER_ID=5 \
PIMIA_PROJECT_ID=11 \
node examples/contratos-fase2/recorrido.mjs
```

- **Escribe de verdad**: crea un modelo, un contrato y una factura. Úsalo en
  desarrollo (`taskai.work`), no en producción.
- **No firma nada sin `--firmar`**, porque firmar manda un correo a una
  persona. La vista previa, en cambio, no envía nunca: no crea envelope, no
  manda correos y no consume intento de firma.
- El token necesita `contracts:read`, `contracts:write` e `invoices:write`, y
  el usuario, las **abilities del catálogo**: poder enviar un contrato no
  concede redactar modelos.
- Si falta un dato, el script imprime **todos** los motivos del bloqueo y para.
  No reintenta: preparar otra vez hornea otro PDF y retira la revisión
  anterior.
