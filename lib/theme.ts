import { configureFonts, MD3LightTheme } from 'react-native-paper';
import type { MD3Type } from 'react-native-paper/lib/typescript/types';

// ---------------------------------------------------------------------------
// circulaID design system — single source of truth for the whole app's LOOK.
// Nothing here touches logic, data, routing or business rules; it only defines
// colors, spacing, radii, shadows and fonts so every screen can stay short and
// consistent instead of repeating hardcoded hex values everywhere.
//
// The brand purple is taken from the onboarding screen ("in motion." text) and
// the login link, so the app matches its own splash/identity.
// ---------------------------------------------------------------------------

export const fonts = {
  // Quicksand = rounded, geometric, "bubbly" display face (matches onboarding).
  display: 'Quicksand_700Bold',
  displaySemi: 'Quicksand_600SemiBold',
  displayMedium: 'Quicksand_500Medium',
  // Nunito = soft, highly readable body face with lots of weights.
  body: 'Nunito_400Regular',
  bodyMedium: 'Nunito_600SemiBold',
  bodyBold: 'Nunito_700Bold',
  bodyExtra: 'Nunito_800ExtraBold',
} as const;

export const colors = {
  // Brand purples (from onboarding + login).
  primary: '#aa0cbe',
  primaryAccent: '#bd0bae',
  primaryDark: '#7d0a8c',
  // Soft purple tints used for chips, selected states, surfaces.
  primarySoft: '#F5E7FA',
  primarySofter: '#FBF4FE',
  primaryBorder: '#ECD6F4',

  // Neutral, airy backgrounds with a faint lavender tint.
  background: '#FFFFFF',
  backgroundAlt: '#FBF7FE',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F1FB',

  // Text scale (very dark plum -> muted purple-grey).
  text: '#1C1326',
  textMuted: '#6E6579',
  textFaint: '#9B93A6',
  onPrimary: '#FFFFFF',

  border: '#EFE7F5',
  white: '#FFFFFF',

  // Semantic status colors (kept meaningful, lightly tuned to fit the palette).
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  info: '#7C3AED',
  infoSoft: '#EDE9FE',
  star: '#F59E0B',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// Generous, bubbly corner radii.
export const radius = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

// Soft, low-contrast shadows so cards feel light and floating.
export const shadow = {
  card: {
    shadowColor: '#3A0B45',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  floating: {
    shadowColor: '#3A0B45',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
} as const;

// Quick type-scale helper for custom (non-Paper) StyleSheets, giving the strong
// size variety the design calls for.
export const type = {
  hero: { fontFamily: fonts.display, fontSize: 40, color: colors.text },
  display: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  title: { fontFamily: fonts.displaySemi, fontSize: 22, color: colors.text },
  subtitle: { fontFamily: fonts.displaySemi, fontSize: 18, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.text },
  bodyStrong: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textMuted },
  caption: { fontFamily: fonts.body, fontSize: 12, color: colors.textFaint },
} as const;

// ---------------------------------------------------------------------------
// Paper MD3 theme — this is what makes EVERY Paper component (Button, Card,
// TextInput, Chip, Dialog, FAB, Snackbar, etc.) adopt the purple + rounded look
// without per-screen overrides.
// ---------------------------------------------------------------------------

// Map every MD3 text variant onto our two font families. Display/headline/title
// use the bubbly Quicksand; body/label use the readable Nunito. We force
// fontWeight:'normal' because the weight is baked into the font file name (this
// avoids Android "faux bold" rendering with custom fonts).
function buildFontConfig() {
  const base = MD3LightTheme.fonts;
  const result: Record<string, MD3Type> = {};
  (Object.keys(base) as (keyof typeof base)[]).forEach((variant) => {
    const v = String(variant);
    let fontFamily: string = fonts.body;
    if (v.startsWith('display') || v.startsWith('headline')) fontFamily = fonts.display;
    else if (v.startsWith('title')) fontFamily = fonts.displaySemi;
    else if (v.startsWith('label')) fontFamily = fonts.bodyMedium;
    result[v] = {
      ...(base[variant] as MD3Type),
      fontFamily,
      fontWeight: 'normal',
    };
  });
  return result as unknown as typeof MD3LightTheme.fonts;
}

export const paperTheme = {
  ...MD3LightTheme,
  roundness: 4, // MD3 multiplies this; gives soft, rounded components.
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    onPrimary: colors.onPrimary,
    primaryContainer: colors.primarySoft,
    onPrimaryContainer: colors.primaryDark,
    secondary: colors.primaryAccent,
    onSecondary: colors.onPrimary,
    secondaryContainer: colors.primarySoft,
    onSecondaryContainer: colors.primaryDark,
    tertiary: colors.primaryAccent,
    background: colors.background,
    onBackground: colors.text,
    surface: colors.surface,
    onSurface: colors.text,
    surfaceVariant: colors.surfaceMuted,
    onSurfaceVariant: colors.textMuted,
    outline: colors.border,
    outlineVariant: colors.primaryBorder,
    error: colors.danger,
    errorContainer: colors.dangerSoft,
    elevation: {
      ...MD3LightTheme.colors.elevation,
      level0: 'transparent',
      level1: colors.surface,
      level2: colors.primarySofter,
      level3: colors.primarySofter,
    },
  },
  fonts: configureFonts({ config: buildFontConfig() }),
};

export type AppTheme = typeof paperTheme;
