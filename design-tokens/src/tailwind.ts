/**
 * Preset de Tailwind con los tokens de Pimia. Uso:
 *
 *   // tailwind.config.js
 *   import pimiaPreset from '@pimia/design-tokens/tailwind'
 *   export default { presets: [pimiaPreset], content: [...] }
 *
 * Va por `theme.extend`: no borra la paleta por defecto de Tailwind — las
 * reglas del sistema (nada de purple-* ni violet-*) son disciplina de uso, y
 * el partner que no quiera el sistema sencillamente no monta el preset.
 */
import { colors, fontFamilies, radius, spacing } from './tokens.js'

const preset = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: colors.primary,
          hover: colors.primaryHover,
          container: colors.primaryContainer,
          'container-subtle': colors.primaryContainerSubtle,
        },
        ink: {
          DEFAULT: colors.ink,
          muted: colors.mutedInk,
          subtle: colors.subtleInk,
        },
        surface: {
          DEFAULT: colors.surface,
          muted: colors.surfaceMuted,
        },
        line: {
          DEFAULT: colors.border,
          subtle: colors.borderSubtle,
        },
        success: {
          DEFAULT: colors.success,
          container: colors.successContainer,
        },
        warning: {
          DEFAULT: colors.warning,
          container: colors.warningContainer,
        },
        danger: {
          DEFAULT: colors.danger,
          container: colors.dangerContainer,
        },
      },
      fontFamily: {
        display: [...fontFamilies.display],
        body: [...fontFamilies.body],
        mono: [...fontFamilies.mono],
      },
      borderRadius: {
        control: radius.control,
        card: radius.card,
        badge: radius.badge,
      },
      spacing: { ...spacing },
    },
  },
}

export default preset
