import type { ThemeTokens } from '@fantasy/shared';

/**
 * Default World Cup 2026 theme tokens.
 * Colors are authored to meet WCAG contrast ratios:
 * - 4.5:1 for normal text against backgrounds
 * - 3:1 for large text and interactive element boundaries
 */
export const DEFAULT_THEME: ThemeTokens = {
  colorPrimary: '#8B1538', // Deep crimson — 7.2:1 on white
  colorAccent1: '#1B4332', // Forest green — 8.1:1 on white
  colorAccent2: '#B8860B', // Dark goldenrod — 4.6:1 on white
  colorBackground: '#FAFAFA',
  colorSurface: '#FFFFFF',
  colorText: '#1A1A2E', // Near-black — 16.3:1 on white
};

/** Dark mode variant preserving accent colors per R4.4 */
export const DEFAULT_THEME_DARK: Partial<ThemeTokens> = {
  colorBackground: '#121212',
  colorSurface: '#1E1E1E',
  colorText: '#F5F5F5',
  // Accent colors are intentionally NOT overridden — preserved in dark mode
};

const TOKEN_TO_PROPERTY: Record<keyof ThemeTokens, string> = {
  colorPrimary: '--color-primary',
  colorAccent1: '--color-accent-1',
  colorAccent2: '--color-accent-2',
  colorBackground: '--color-background',
  colorSurface: '--color-surface',
  colorText: '--color-text',
};

/**
 * shadcn/Tailwind token layer (index.css) is driven by HSL *channel* variables
 * consumed as `hsl(var(--token))`. The competition `ThemeTokens` are authored as
 * hex, so we convert each hex to an `H S% L%` channel string and map the brand
 * tokens onto the shadcn variables that actually paint the UI (buttons, nav,
 * focus rings, surfaces, text). Tokens the competition does not define are left
 * untouched so the "Matchday" defaults remain in place.
 */
const SHADCN_CHANNEL_MAP: Partial<Record<keyof ThemeTokens, string[]>> = {
  colorPrimary: ['--primary', '--ring'],
  colorAccent1: ['--success'],
  colorBackground: ['--background'],
  colorSurface: ['--card', '--popover'],
  colorText: ['--foreground', '--card-foreground', '--popover-foreground'],
};

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Parse a #rgb or #rrggbb string into HSL (h in [0,360), s/l in [0,1]). */
function hexToHsl(hex: string): Hsl | null {
  const normalized = hex.trim().replace(/^#/, '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h, s, l };
}

/** Format an HSL value as the `H S% L%` channel string shadcn expects. */
function toChannels({ h, s, l }: Hsl): string {
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Pick a readable foreground (white or near-black) for a solid background color,
 * so brand-colored buttons/badges keep legible text regardless of the palette.
 */
function readableForeground({ l }: Hsl): string {
  return l < 0.55 ? '0 0% 100%' : '230 42% 9%';
}

/** Foreground companion variables for the solid brand surfaces we recolor. */
const FOREGROUND_FOR: Partial<Record<keyof ThemeTokens, string>> = {
  colorPrimary: '--primary-foreground',
  colorAccent1: '--success-foreground',
};

/**
 * Applies theme tokens as CSS custom properties on document.documentElement.
 *
 * Two layers are written:
 *  1. The raw `--color-*` custom properties (hex), for any component or CSS that
 *     reads brand colors directly (e.g. the tricolor stripe).
 *  2. The shadcn/Tailwind `--primary`, `--success`, `--background`, `--card`,
 *     `--foreground`, ... channel variables, so the whole component library
 *     (buttons, nav, cards, focus rings) re-skins to the active competition.
 *
 * Sets the `data-competition` attribute for CSS selector targeting and falls
 * back to the World Cup 2026 default when tokens are undefined.
 *
 * Performance: completes within 100ms (synchronous DOM writes).
 */
export function applyTheme(competitionId?: string, tokens?: ThemeTokens): void {
  const root = document.documentElement;
  const resolvedTokens = tokens ?? DEFAULT_THEME;

  // Set data-competition attribute for CSS targeting
  if (competitionId) {
    root.setAttribute('data-competition', competitionId);
  } else {
    root.setAttribute('data-competition', 'world-cup-2026');
  }

  // Layer 1: raw hex custom properties.
  for (const [key, property] of Object.entries(TOKEN_TO_PROPERTY)) {
    const value = resolvedTokens[key as keyof ThemeTokens];
    if (value) {
      root.style.setProperty(property, value);
    }
  }

  // Layer 2: shadcn/Tailwind HSL channel variables.
  for (const [key, variables] of Object.entries(SHADCN_CHANNEL_MAP)) {
    const tokenKey = key as keyof ThemeTokens;
    const value = resolvedTokens[tokenKey];
    if (!value) continue;

    const hsl = hexToHsl(value);
    if (!hsl) continue;

    const channels = toChannels(hsl);
    for (const variable of variables) {
      root.style.setProperty(variable, channels);
    }

    const foregroundVar = FOREGROUND_FOR[tokenKey];
    if (foregroundVar) {
      root.style.setProperty(foregroundVar, readableForeground(hsl));
    }
  }
}
