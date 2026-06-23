import type { ReactNode } from 'react';

/**
 * Full-page centered layout for public auth routes (sign-in, sign-up, verify).
 * Renders the brand mark, the tricolor signature stripe, and centers its
 * children (typically a Card) on the app background.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="tricolor-stripe" aria-hidden="true" />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground shadow-sm">
              FL
            </span>
            <h1 className="font-display text-xl font-bold tracking-tight">Fantasy League</h1>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
