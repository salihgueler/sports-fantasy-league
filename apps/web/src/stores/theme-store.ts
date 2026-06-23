import { create } from "zustand";
import type { ThemeTokens } from "@fantasy/shared";
import { applyTheme, DEFAULT_THEME } from "../lib/theme";

interface ThemeState {
  competitionId: string | null;
  tokens: ThemeTokens;
  setCompetitionTheme: (competitionId: string, tokens?: ThemeTokens) => void;
  resetToDefault: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  competitionId: null,
  tokens: DEFAULT_THEME,

  setCompetitionTheme: (competitionId: string, tokens?: ThemeTokens) => {
    const resolvedTokens = tokens ?? DEFAULT_THEME;

    // Apply synchronously — CSS custom property writes are sub-millisecond,
    // well within the 100ms budget (R4.1, R4.5)
    applyTheme(competitionId, resolvedTokens);

    set({ competitionId, tokens: resolvedTokens });
  },

  resetToDefault: () => {
    applyTheme(undefined, DEFAULT_THEME);
    set({ competitionId: null, tokens: DEFAULT_THEME });
  },
}));
