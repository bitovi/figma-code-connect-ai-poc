export interface SecretResolution {
  value: string;
  redactedDescription: string;
}

export interface EnvSource {
  readonly [key: string]: string | undefined;
}

export class SecretError extends Error {
  readonly variableName: string;

  constructor(variableName: string, message?: string) {
    super(
      message ??
        `Environment variable ${variableName} is required but was not found or is empty`,
    );
    this.variableName = variableName;
  }
}

export function resolveEnvSecret(
  env: EnvSource,
  variableName: string,
): SecretResolution {
  const raw = env[variableName];

  if (typeof raw !== "string") {
    throw new SecretError(variableName);
  }

  const value = raw.trim();

  if (!value) {
    throw new SecretError(variableName);
  }

  return {
    value,
    redactedDescription: `${variableName} (length ${value.length})`,
  };
}

export function resolveFigmaPat(
  env: EnvSource,
  tokenEnv: string,
): SecretResolution {
  return resolveEnvSecret(env, tokenEnv);
}

