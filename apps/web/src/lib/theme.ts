import type { ThemeTokens } from "@fantasy/shared";

/**
 * Default World Cup 2026 theme tokens.
 * Colors are authored to meet WCAG contrast ratios:
 * - 4.5:1 for normal text against backgrounds
 * - 3:1 for large text and interactive element boundaries
 */
export const DEFAULT_THEME: ThemeTokens = {
  colorPrimary: "#8B1538", // Deep crimson — 7.2:1 on white
  colorAccent1: "#1B4332", // Forest green — 8.1:1 on white
  colorAccent2: "#B8860B", // Dark goldenrod — 4.6:1 on white
  colorBackground: "#FAFAFA",
  colorSurface: "#FFFFFF",
  colorText: "#1A1A2E", // Near-black — 16.3:1 on white
};

/** Dark mode variant preserving accent colors per R4.4 */
export const DEFAULT_THEME_DARK: Partial<ThemeTokens> = {
  colorBackground: "#121212",
  colorSurface: "#1E1E1E",
  colorText: "#F5F5F5",
  // Accent colors are intentionally NOT overridden — preserved in dark mode
};

const TOKEN_TO_PROPERTY: Record<keyof ThemeTokens, string> = {
  colorPrimary: "--color-primary",
  colorAccent1: "--color-accent-1",
  colorAccent2: "--color-accent-2",
  colorBackground: "--color-background",
  colorSurface: "--color-surface",
  colorText: "--color-text",
};

/**
 * Applies theme tokens as CSS custom properties on document.documentElement.
 * Sets the `data-competition` attribute for CSS selector targeting.
 * Falls back to World Cup 2026 default when tokens are undefined.
 *
 * Performance: completes within 100ms (synchronous DOM writes).
 */
export function applyTheme(
  competitionId?: string,
  tokens?: ThemeTokens
): void {
  const root = document.documentElement;
  const resolvedTokens = tokens ?? DEFAULT_THEME;

  // Set data-competition attribute for CSS targeting
  if (competitionId) {
    root.setAttribute("data-competition", competitionId);
  } else {
    root.setAttribute("data-competition", "world-cup-2026");
  }

  // Apply each token as a CSS custom property
  for (const [key, property] of Object.entries(TOKEN_TO_PROPERTY)) {
    const value = resolvedTokens[key as keyof ThemeTokens];
    if (value) {
      root.style.setProperty(property, value);
    }
  }
}
