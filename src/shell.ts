export type SupportedShell = 'bash' | 'fish' | 'zsh';

export function resolveSupportedShell(
  requestedShell: string | undefined,
  detectedShell: string | undefined,
): SupportedShell | null {
  const requested = normalizeShell(requestedShell);

  if (requested) {
    return requested;
  }

  return normalizeShell(detectedShell);
}

function normalizeShell(value: string | undefined): SupportedShell | null {
  if (!value) {
    return null;
  }

  const candidate = value.split('/').at(-1)?.toLowerCase();

  switch (candidate) {
    case 'bash':
    case 'fish':
    case 'zsh':
      return candidate;
    default:
      return null;
  }
}
