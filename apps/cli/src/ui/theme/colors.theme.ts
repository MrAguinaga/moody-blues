export const BRAND_COLORS = {
  primary: '#B388FF',
  primaryLight: '#D1C4E9',
  secondary: '#7C4DFF',
  deep: '#4A148C',
  accent: '#00E5FF',
  glow: '#E040FB',
  metallic: '#CFD8DC',
  metallicDark: '#78909C',
  text: '#EDE7F6',
  textMuted: '#9E9E9E',
  logoGradient: ['#E9D5FF', '#D8B4FE', '#C084FC', '#A855F7', '#9333EA', '#7C3AED'],
} as const;

export const SEMANTIC_COLORS = {
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: BRAND_COLORS.accent,
  muted: 'gray',
} as const;

export const THEME = {
  brand: BRAND_COLORS,
  semantic: SEMANTIC_COLORS,
} as const;

export type Theme = typeof THEME;
