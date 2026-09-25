/**
 * PIN/PUK masking. MSM contract details carry the SIM's PIN and PUK in clear
 * text. Every tool that returns contract (or order) details passes them
 * through `maskContract` — only the gated kpn_mobile_contracts_get_puk tool
 * reads the raw value.
 */

export const MASK = "••••";

/** Keys that hold SIM secrets: pin, puk, and numbered variants (pin2, puk2). */
const SECRET_KEY = /^(pin|puk)\d?$/i;

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

/**
 * Return a copy with every pin/puk value (at any depth) replaced by "••••",
 * plus `pinPukMasked: true` at the top level whenever anything was masked.
 * The input is never mutated.
 */
export function maskContract<T>(details: T): T & { pinPukMasked?: true } {
  const state = { masked: false };
  const masked = maskDeep(details, state) as T & { pinPukMasked?: true };
  if (state.masked && masked !== null && typeof masked === "object" && !Array.isArray(masked)) {
    masked.pinPukMasked = true;
  }
  return masked;
}
