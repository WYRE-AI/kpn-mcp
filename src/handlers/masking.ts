/**
 * Mask Grexx secrets before they reach a tool result: SIM PUK (`Puc1`),
 * eSIM activation/confirmation codes, and RADIUS `Password`.
 */

export const MASK = "••••";

/** Secret field names from the Phase 1 response XSDs, plus pin/puk variants. */
const SECRET_KEY = /^(pin|puk|puc1|password|activationcode|confirmationcode)\d?$/i;

function maskDeep(value: unknown, state: { masked: boolean }): unknown {
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, state));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && inner !== undefined && inner !== null) {
      out[key] = MASK;
      state.masked = true;
    } else {
      out[key] = maskDeep(inner, state);
    }
  }
  return out;
}

/** Copy `value` with secret fields replaced. The input is never mutated. */
export function maskSecrets<T>(value: T): { value: T; masked: boolean } {
  const state = { masked: false };
  return { value: maskDeep(value, state) as T, masked: state.masked };
}
