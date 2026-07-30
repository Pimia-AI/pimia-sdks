import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: 'Reformas Vertical — powered by Pimia',
  description: 'Starter kit de app vertical sobre la API de Pimia',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header>
          <strong>Reformas Vertical</strong>
          <span className="muted"> · powered by Pimia</span>
        </header>
        <main>{children}</main>
        <footer className="muted">
          Starter kit: la marca, el diseño y el flujo son tuyos; la facturación
          y el cumplimiento los pone Pimia por API.
        </footer>
      </body>
    </html>
  )
}
