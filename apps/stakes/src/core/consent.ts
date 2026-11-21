// Forge throws this when a call made as the user needs a consent the user has not yet
// given. It has to escape every catch, because only an uncaught error makes Forge
// show the user the "Allow access" prompt.
export function needsConsent(e: unknown): boolean {
  return e instanceof Error && e.name === 'NEEDS_AUTHENTICATION_ERR';
}
