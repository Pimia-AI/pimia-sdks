import Link from 'next/link'

import { REQUESTED_SCOPES } from '@/lib/config'
import { readSession } from '@/lib/session'

const ERRORES: Record<string, string> = {
  access_denied: 'No autorizaste el acceso. Sin permiso no podemos leer nada de tu Pimia.',
  state_invalido: 'La vuelta del consentimiento no cuadró (state inválido). Vuelve a intentarlo.',
  flujo_incompleto: 'Se perdió el flujo de autorización (¿tardaste más de 10 minutos?).',
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const session = await readSession()

  return (
    <>
      <h1>Reformas Vertical</h1>
      <p className="muted">
        Ejemplo de app vertical: tu marca y tu flujo, la facturación por la API
        de Pimia.
      </p>

      {error ? (
        <div className="notice error">{ERRORES[error] ?? `No se pudo conectar: ${error}`}</div>
      ) : null}

      {session ? (
        <div className="row">
          <Link className="button" href="/panel">
            Ir al panel
          </Link>
          <span className="muted">Conectado a {session.baseUrl}</span>
        </div>
      ) : (
        <>
          <p>
            Para empezar, conecta la cuenta de Pimia de tu empresa. Te llevaremos
            a la pantalla de Pimia para que autorices estos permisos:
          </p>
          <ul>
            {REQUESTED_SCOPES.map((scope) => (
              <li key={scope}>
                <code>{scope}</code>
              </li>
            ))}
          </ul>
          <a className="button" href="/login">
            Conectar con Pimia
          </a>
        </>
      )}
    </>
  )
}
