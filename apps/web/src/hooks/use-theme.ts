import { useEffect } from "react";
import type { ThemeTokens } from "@fantasy/shared";
import { useThemeStore } from "../stores/theme-store";

/**
 * Hook that applies a competition's theme when the competition changes.
 * Falls back to the World Cup 2026 default when theme is undefined.
 *
 * Call this in a top-level layout component, passing the active competition ID
 * and its optional theme tokens.
 */
export function useTheme(
  competitionId: string | undefined,
  tokens: ThemeTokens | undefined
): void {
  const setCompetitionTheme = useThemeStore((s) => s.setCompetitionTheme);
  const resetToDefault = useThemeStore((s) => s.resetToDefault);

  useEffect(() => {
    if (competitionId) {
      setCompetitionTheme(competitionId, tokens);
    } else {
      resetToDefault();
    }
  }, [competitionId, tokens, setCompetitionTheme, resetToDefault]);
}
