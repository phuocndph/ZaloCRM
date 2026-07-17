const PROVIDER_ENV_KEYS: Record<string, readonly string[]> = {
  anthropic: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_AUTH_TOKEN', 'GEMINI_API_KEY'],
  openai: ['OPENAI_AUTH_TOKEN', 'OPENAI_API_KEY'],
  'openai-compatible': ['OPENAI_AUTH_TOKEN', 'OPENAI_API_KEY'],
  qwen: ['QWEN_AUTH_TOKEN'],
  kimi: ['KIMI_AUTH_TOKEN'],
  '9router': ['NINE_ROUTER_API_KEY'],
};

function validEnvironmentKey(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,100}$/.test(value);
}

/**
 * Resolve an environment variable name, never its secret value.
 *
 * An explicit `env:NAME` always wins. Legacy providers then use the same
 * aliases as config/index.ts (notably NINE_ROUTER_API_KEY rather than the
 * mechanically-derived, invalid 9ROUTER_API_KEY name).
 */
export function providerCredentialEnvironmentKey(provider: string, credentialRef?: string | null): string {
  const requested = credentialRef?.startsWith('env:') ? credentialRef.slice(4) : '';
  if (requested && validEnvironmentKey(requested)) return requested;

  const candidates = PROVIDER_ENV_KEYS[provider] ?? [];
  const configured = candidates.find((key) => Boolean(process.env[key]?.trim()));
  if (configured) return configured;
  if (candidates[0]) return candidates[0];
  return `${provider.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_API_KEY`;
}

