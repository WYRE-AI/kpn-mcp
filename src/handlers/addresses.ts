/** Dutch address and phone-number normalization for tool arguments. */
import { ToolInputError } from "./results.js";

const NL_ZIP = /^[1-9][0-9]{3}[A-Z]{2}$/;

/** "1234 ab" → "1234AB". Throws ToolInputError unless it is a Dutch postcode. */
export function normalizeZip(value: string): string {
  const zip = value.replace(/\s+/g, "").toUpperCase();
  if (!NL_ZIP.test(zip)) {
    throw new ToolInputError(
      `"${value}" is not a Dutch postcode; expected four digits and two letters, e.g. 1234AB.`
    );
  }
  return zip;
}

/**
 * Normalize a Dutch mobile number to E.164: 06xxxxxxxx, 316xxxxxxxx and
 * +316xxxxxxxx all become +316xxxxxxxx. Other `+`-prefixed E.164 numbers pass
 * through (KPN answers those itself); anything else is a ToolInputError.
 */
export function normalizeNlMobile(value: string): string {
  const number = value.replace(/[\s\-().]/g, "");
  let match = /^06(\d{8})$/.exec(number) ?? /^\+?316(\d{8})$/.exec(number);
  if (match) return `+316${match[1]}`;
  match = /^\+[1-9]\d{6,14}$/.exec(number);
  if (match) return number;
  throw new ToolInputError(
    `"${value}" is not a mobile number; use 06xxxxxxxx, +316xxxxxxxx or another E.164 number.`
  );
}
