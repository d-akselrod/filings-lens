let loaded = false;

/** Reads a secret from the environment, loading the git-ignored .env.local once. Never prints the value. */
export function requireEnv(name: 'GEMINI_API_KEY' | 'OPENROUTER_API_KEY' | 'SEC_USER_AGENT'): string {
  if (!loaded) {
    loaded = true;
    try {
      process.loadEnvFile('.env.local');
    } catch {
      // no .env.local — fall back to the process environment
    }
  }
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}
