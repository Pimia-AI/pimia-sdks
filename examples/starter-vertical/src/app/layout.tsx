import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Bricolage_Grotesque, Inter, Plus_Jakarta_Sans } from 'next/font/google'
import Link from 'next/link'

// El orden importa: primero las variables del paquete de Pimia, luego la
// estructura, luego las pieles que rellenan las variables semánticas.
import '@pimia/design-tokens/pimia.css'
import './globals.css'
import './themes/partner.css'
import './themes/pimia.css'

import { readSession } from '@/lib/session'
import { activeTheme } from '@/lib/theme'

// Las fuentes de LAS DOS pieles, auto-hospedadas en el build con next/font:
// sin petición runtime a Google (más fiable, y lo correcto en la UE — servir
// Google Fonts en runtime ya ha costado sanciones RGPD). Cada piel elige la
// suya vía las variables CSS de abajo (themes/*.css).
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-bricolage',
  display: 'swap',
})
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
})
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

const theme = activeTheme()

export const metadata: Metadata = {
  title: `${theme.brand} — powered by Pimia`,
  description: theme.claim,
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await readSession()

  return (
    <html
      lang="es"
      data-theme={theme.id}
      className={`${bricolage.variable} ${jakarta.variable} ${inter.variable}`}
    >
      <body>
        <header>
          <div className="marca">
            <Link href="/">{theme.brand}</Link>
            <span className="powered">powered by Pimia</span>
          </div>
          {session ? (
            <>
              <nav>
                <Link href="/panel">Panel</Link>
                <Link href="/panel/facturas">Facturas</Link>
                <Link href="/panel/clientes">Clientes</Link>
                <Link href="/panel/presupuestos">Presupuestos</Link>
                <Link href="/panel/gastos">Gastos</Link>
              </nav>
              <form action="/logout" method="post">
                <button className="secondary" type="submit">
                  Desconectar
                </button>
              </form>
            </>
          ) : null}
        </header>

        <main>{children}</main>

        <footer>
          <span>
            {theme.brand} — tu marca, tu dominio y tu flujo; la facturación y el
            cumplimiento, por la API de Pimia.
          </span>
          {/* La submarca del programa de partners: visible en TODAS las
              pieles, también en la del partner. */}
          <span>Powered by Pimia</span>
        </footer>
      </body>
    </html>
  )
}
