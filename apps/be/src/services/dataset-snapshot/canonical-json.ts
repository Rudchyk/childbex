/**
 * Canonical JSON for hashed ML artifacts (the dataset export manifest). The
 * same rules as the Python side (`childbex_ml.canonical`); both test suites
 * share a golden vector:
 *
 * - object keys sorted (keys are ASCII schema names, so UTF-16 and code point
 *   order agree), no whitespace;
 * - integral numbers written as integers (`40.0` -> `40`), other finite
 *   numbers in the shortest round-trip form; exponents and non-finite
 *   numbers are rejected;
 * - strings as `JSON.stringify` writes them; `undefined` is rejected.
 *
 * For the values used this matches RFC 8785 (JCS).
 */
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError('Non-finite number.');
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) throw new CanonicalJsonError('Unsafe integer.');
      return String(value === 0 ? 0 : value);
    }
    const text = JSON.stringify(value);
    if (/e/i.test(text)) throw new CanonicalJsonError('Numbers needing an exponent are not supported.');
    return text;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.some(([, item]) => item === undefined)) {
      throw new CanonicalJsonError('Undefined values are not supported.');
    }
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new CanonicalJsonError(`Unsupported value type: ${typeof value}.`);
};
