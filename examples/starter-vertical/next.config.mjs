import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // El SDK se enlaza por `file:` desde el monorepo (un symlink fuera de esta
  // carpeta), así que hay que decirle al tracer dónde está la raíz real. En tu
  // app, con @pimia/sdk instalado desde npm, nada de esto hace falta.
  outputFileTracingRoot: join(here, '../..'),
}

export default nextConfig
