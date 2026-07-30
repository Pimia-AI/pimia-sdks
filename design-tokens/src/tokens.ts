/**
 * Tokens del sistema de diseño de Pimia («los números en limpio»).
 *
 * Fuente de verdad: DESIGN.md del repo de la plataforma (frontmatter + reglas
 * con nombre), snapshot del 2026-07-30. Este paquete NO inventa valores: los
 * transcribe para que una app de partner pueda adoptarlos — o ignorarlos por
 * completo, que es exactamente lo que significa white-label.
 *
 * Los canónicos de marca y semáforo van en OKLCH (matiz 278 para la marca);
 * los `hex` que aparecen en comentarios son equivalencias orientativas.
 */

export const colors = {
  /** La única voz de marca: acciones primarias, enlaces, navegación activa, foco. */
  primary: 'oklch(48% 0.20 278)', // ≈ #4b44ca
  primaryHover: 'oklch(44% 0.22 278)', // ≈ #422fc7
  /** Fondos de estado activo, badges de marca. */
  primaryContainer: 'oklch(96% 0.04 278)', // ≈ #ebf0ff
  /** Fondo de avatares de iniciales (texto en `primary`). */
  primaryContainerSubtle: 'oklch(95% 0.018 278)',

  /** Texto principal (slate-800). */
  ink: '#1e293b',
  /** Texto secundario y cuerpo de lectura (slate-600) — el LÍMITE legible. */
  mutedInk: '#475569',
  /** SOLO decorativo (slate-400): iconos de apoyo, placeholders, disabled. ~3:1 sobre blanco, no cumple AA para texto. */
  subtleInk: '#94a3b8',

  /** Cards y formularios. */
  surface: '#ffffff',
  /** Fondo de página y sidebar (slate-50). */
  surfaceMuted: '#f8fafc',
  /** Bordes de card y panel (slate-200). */
  border: '#e2e8f0',
  /** Separadores internos de card (slate-100). */
  borderSubtle: '#f1f5f9',

  // El semáforo contable: habla SOLO de estado de dinero y cumplimiento,
  // nunca de marca. Cada estado con su `-container` pastel para badges.
  success: 'oklch(52% 0.18 155)', // ≈ #008435
  successContainer: 'oklch(97% 0.03 155)', // ≈ #e6fcec
  warning: 'oklch(62% 0.18 75)', // ≈ #c37000
  warningContainer: 'oklch(98% 0.02 75)', // ≈ #fff7ea
  danger: 'oklch(54% 0.22 25)', // ≈ #d00021
  dangerContainer: 'oklch(98% 0.02 25)', // ≈ #fff4f2
} as const

export const fontFamilies = {
  /** Titulares y superficies comerciales (login, landing). */
  display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
  /** El trabajo: tablas, formularios, lectura funcional. */
  body: ['Inter', 'system-ui', 'sans-serif'],
  /** Montos, NIFs, IBANs, códigos — SIEMPRE con `tabular-nums` y, en tablas, a la derecha. */
  mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
} as const

export type TypeStyle = {
  fontFamily: readonly string[]
  fontSize: string
  fontWeight: number
  lineHeight: number
  letterSpacing: string
}

export const typography: Record<string, TypeStyle> = {
  /** Hero comercial (Jakarta). Techo duro: 48px. */
  display: {
    fontFamily: fontFamilies.display,
    fontSize: 'clamp(2.25rem, 5vw, 3rem)',
    fontWeight: 800,
    lineHeight: 1.05,
    letterSpacing: '-0.025em',
  },
  /** h1 de página. */
  headline: {
    fontFamily: fontFamilies.display,
    fontSize: '1.5rem',
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: 'normal',
  },
  /** h2 de sección y cabeceras de card grandes. */
  title: {
    fontFamily: fontFamilies.display,
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.3,
    letterSpacing: 'normal',
  },
  /** Celdas, formularios, lectura funcional. */
  body: {
    fontFamily: fontFamilies.body,
    fontSize: '0.875rem',
    fontWeight: 400,
    lineHeight: 1.5,
    letterSpacing: 'normal',
  },
  /** Metadatos y filas secundarias (DESIGN.md §3, escala de trabajo). */
  bodySm: {
    fontFamily: fontFamilies.body,
    fontSize: '0.75rem',
    fontWeight: 400,
    lineHeight: 1.5,
    letterSpacing: 'normal',
  },
  /** Leyendas de campo y cabeceras de tabla: MAYÚSCULAS + tracking. */
  label: {
    fontFamily: fontFamilies.body,
    fontSize: '0.6875rem',
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: '0.05em',
  },
}

/** Radios por rol — controles, cards, badges, pills. */
export const radius = {
  control: '0.5rem', // botones e inputs (rounded-lg)
  card: '0.75rem', // cards, panels, secciones (rounded-xl)
  badge: '0.375rem', // StatusBadge
  pill: '9999px',
} as const

export const spacing = {
  xs: '0.375rem',
  sm: '0.625rem',
  md: '1rem',
  lg: '1.25rem',
  xl: '2.5rem',
} as const

/**
 * Recetas de componente del frontmatter, con las referencias resueltas.
 * Son la forma canónica, no una imposición: una app de partner puede montar
 * sus propios componentes con los tokens de arriba.
 */
export const components = {
  buttonPrimary: {
    backgroundColor: colors.primary,
    textColor: colors.surface,
    rounded: radius.control,
    padding: '0.5rem 1rem',
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    textColor: colors.ink,
    rounded: radius.control,
    padding: '0.5rem 1rem',
  },
  input: {
    backgroundColor: colors.surface,
    textColor: colors.ink,
    rounded: radius.control,
    padding: '0.5rem 0.75rem',
  },
  card: {
    backgroundColor: colors.surface,
    textColor: colors.ink,
    rounded: radius.card,
    padding: '1.25rem',
  },
  badge: {
    backgroundColor: colors.primaryContainer,
    textColor: colors.primary,
    rounded: radius.badge,
    padding: '0.125rem 0.5rem',
  },
} as const

/**
 * Las reglas con nombre del sistema, en forma consultable (para linters de
 * partner, documentación generada o simple lectura). El detalle narrativo
 * vive en DESIGN.md; esto es el resumen operativo.
 */
export const namedRules = {
  unaSolaVoz:
    'El violeta OKLCH 278 es la única voz de marca; purple-*/violet-* de Tailwind quedan prohibidos.',
  semaforoContable:
    'success/warning/danger hablan SOLO de estado de dinero y cumplimiento; el violeta jamás comunica estado.',
  limiteDelSlate:
    'El texto legible nunca baja de mutedInk (#475569); subtleInk es solo decorativo (no cumple AA).',
  planoPorDefecto:
    'Profundidad por hairlines de 1px y contraste de superficie; sombra máxima shadow-sm y siempre con borde.',
  numerosTabulares:
    'Todo dato financiero o estructurado va en mono con tabular-nums y, en tablas, alineado a la derecha.',
  sinEmojis: 'Nada de emojis en la UI: StatusBadge, iconos o puntos de color.',
} as const

/** Fuentes vetadas y jubiladas por DESIGN.md §3 — no reintroducir. */
export const forbiddenFonts = [
  'Sora',
  'DM Sans',
  'Space Mono',
  'IBM Plex',
  'Outfit',
  'Nunito',
  'Raleway',
  'Lato',
  'Poppins',
  'Lexend',
  'Source Sans 3',
  'Bricolage Grotesque',
  'Hanken Grotesk',
] as const

export const tokens = {
  colors,
  fontFamilies,
  typography,
  radius,
  spacing,
  components,
} as const

export type PimiaTokens = typeof tokens
