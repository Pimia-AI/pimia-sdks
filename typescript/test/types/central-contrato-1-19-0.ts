// Guardia de tipos del contrato central 1.19.0 (y lo que traía la 1.18.0): los
// campos nuevos existen con la forma que el contrato promete, y el enum de
// moneda del catálogo es CERRADO. Sin esto, un `sync-spec.sh` que se dejara el
// spec viejo compilaría igual.
import type {
  ActivacionDeInstancia,
  ActivacionEnCartera,
  AnadidosDeCartera,
  AsientoDeCanal,
  CatalogoCurrency,
  PimiaCentralClient,
  TramoMayorista,
} from '../../dist/index.js'

// 1.18.0 — el asiento dice su precio y en qué moneda. Anulables: `null` es
// «sin precio propio», no cero.
declare const asiento: AsientoDeCanal
asiento.precio_cents satisfies number | null
asiento.moneda satisfies string | null

// 1.18.0/1.19.0 — el agregado desglosa asientos y declara su moneda.
declare const anadidos: AnadidosDeCartera
anadidos.asientos satisfies number
anadidos.asientos_cents satisfies number
anadidos.asientos_total satisfies string
anadidos.asientos_sin_precio satisfies number
anadidos.moneda satisfies string | null
anadidos.monedas_mezcladas satisfies boolean
// @ts-expect-error La moneda del agregado es anulable: con monedas mezcladas va a null.
const monedaSiempre: string = anadidos.moneda
declare const porTenant: AnadidosDeCartera['por_tenant'][number]
porTenant.base_cents satisfies number | null

// 1.18.0 — la cartera dice QUÉ tiene activado cada cliente, no solo cuántos.
declare const activacionEnCartera: ActivacionEnCartera
activacionEnCartera.kind satisfies string
activacionEnCartera.slug satisfies string
activacionEnCartera.name satisfies string

// 1.19.0 — el repreciado deja de ser invisible.
declare const activacion: ActivacionDeInstancia
activacion.precio_inicial_cents satisfies number
activacion.precio_desde satisfies string
activacion.cambio_de_precio satisfies boolean

// 1.19.0 — el tramo mayorista, con el siguiente peldaño o `null` en el último.
declare const tramo: TramoMayorista
tramo.key satisfies string
tramo.discount_pct satisfies string
tramo.seats satisfies number
if (tramo.next !== null) {
  tramo.next.min_seats satisfies number
  tramo.next.seats_missing satisfies number
}
// @ts-expect-error `next` es anulable: en el último peldaño no hay siguiente.
tramo.next.key

// 1.19.0 — la moneda del catálogo es un enum cerrado, no tres letras cualesquiera.
const eur: CatalogoCurrency = 'EUR'
// @ts-expect-error `ZZZ` tiene tres letras y no es una moneda del catálogo de Pimia.
const zzz: CatalogoCurrency = 'ZZZ'

async function consumidor(central: PimiaCentralClient) {
  const { data } = await central.catalogo.get()
  data.disponibles.wholesale_tier satisfies TramoMayorista
  data.disponibles.base[0]?.wholesale_price_cents satisfies number | null | undefined
  const items = (await central.activaciones.list('acme')).data.items
  items[0]?.cambio_de_precio satisfies boolean | undefined
  const cartera = (await central.overview()).data.cartera
  cartera[0]?.activaciones satisfies ActivacionEnCartera[] | undefined
  const facturacion = (await central.facturacion()).data
  facturacion.anadidos.monedas_mezcladas satisfies boolean
  facturacion.asientos[0]?.moneda satisfies string | null | undefined
}

export { eur, zzz, monedaSiempre, consumidor }
