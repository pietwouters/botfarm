const secretPatterns: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*['\"]?[A-Za-z0-9_\-\.]{8,}['\"]?/gi,
  /\b0x[a-fA-F0-9]{64}\b/g,
  /\b(?:mnemonic|seed phrase)\b[^\n]{0,200}/gi
];

export function maskPotentialSecrets(text: string): string {
  let output = text;
  for (const pattern of secretPatterns) {
    output = output.replace(pattern, "[REDACTED]");
  }

  return output;
}
