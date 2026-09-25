/** Tools 2–4: disturbance check, availability check and SIM-swap date (gateway realm). */
import {
  NotFoundError,
  type AddressAlert,
  type Disturbance,
  type KpnClient,
} from "@wyre-technology/node-kpn";
import { normalizeNlMobile, normalizeZip } from "./addresses.js";
import {
  errorResult,
  jsonResult,
  optionalNumber,
  optionalString,
  requireInteger,
  requireString,
  textResult,
  ToolInputError,
  type ToolHandler,
  type ToolResult,
} from "./results.js";

interface Address {
  zipCode: string;
  houseNumber: number;
  houseNumberExtension?: string;
}

function readAddress(args: Record<string, unknown>): Address {
  const zipCode = normalizeZip(requireString(args, "zipCode"));
  const houseNumber = requireInteger(args, "houseNumber");
  if (houseNumber < 1) throw new ToolInputError('Argument "houseNumber" must be 1 or more.');
  const extension = optionalString(args, "houseNumberExtension")?.trim();
  return { zipCode, houseNumber, ...(extension ? { houseNumberExtension: extension } : {}) };
}

function formatAddress(a: Address): string {
  return `${a.zipCode} ${a.houseNumber}${a.houseNumberExtension ? ` ${a.houseNumberExtension}` : ""}`;
}

/** KPN reports an unknown or malformed address as alerts; turn them into one error line. */
function alertError(address: Address, alerts: AddressAlert[], extra = ""): ToolResult {
  const reasons = alerts
    .map((a) => [a.code, a.description ?? a.code_message].filter(Boolean).join(": "))
    .join("; ");
  return errorResult(`KPN did not recognise the address ${formatAddress(address)}: ${reasons}.${extra}`);
}

/** `long_description` is HTML; tool output is plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const CATEGORIES = ["broadband", "fixed", "mobile", "generic"] as const;

async function checkDisturbances(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const address = readAddress(args);
  const result = await client.disturbances.getByAddress(address);
  if (result.alerts?.length) return alertError(address, result.alerts);

  const clean = (d: Disturbance): Disturbance =>
    d.long_description ? { ...d, long_description: stripHtml(d.long_description) } : d;
  const categories = Object.fromEntries(
    CATEGORIES.map((c) => [c, (result[c] ?? []).map(clean)])
  ) as Record<(typeof CATEGORIES)[number], Disturbance[]>;
  const all = CATEGORIES.flatMap((c) => categories[c]);

  // Deliberate exception to the empty-result rule (design.md §4.3): "no outage" is a real answer.
  if (all.length === 0) {
    return textResult(`No known KPN disturbances at this address.\nAddress: ${formatAddress(address)}`);
  }

  return jsonResult({
    summary: {
      total: all.length,
      open: all.filter((d) => d.state?.toLowerCase() === "open").length,
      byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, categories[c].length])),
    },
    ...categories,
  });
}

async function checkAvailability(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const address = readAddress(args);
  const result = await client.availability.getByAddress(address);
  const { alerts, ...info } = result;
  if (alerts.length) {
    // An ambiguous address comes back with the valid extensions; offer them.
    const extensions = info.available_on_address?.house_number_extensions ?? [];
    const hint = extensions.length
      ? ` Valid house number extensions: ${extensions.join(", ")}.`
      : "";
    return alertError(address, alerts, hint);
  }
  if (!info.available_on_address && !info.fixed_info && !info.fiber_info && !info.bandwidth) {
    return errorResult(`No KPN availability information found for ${formatAddress(address)}.`);
  }
  return jsonResult({ address: formatAddress(address), ...info });
}

async function getSimSwapDate(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const phoneNumber = normalizeNlMobile(requireString(args, "phoneNumber"));
  const maxAgeHours = optionalNumber(args, "maxAgeHours");
  if (maxAgeHours !== undefined && (!Number.isInteger(maxAgeHours) || maxAgeHours < 1)) {
    throw new ToolInputError('Argument "maxAgeHours" must be a whole number of hours, 1 or more.');
  }

  let latestSimChange: string | null;
  try {
    ({ latestSimChange } = await client.simSwap.retrieveDate(phoneNumber));
  } catch (error) {
    // Other operators' numbers are unknown to KPN (design.md §7.7).
    if (error instanceof NotFoundError) {
      return errorResult(
        `${phoneNumber} is not a KPN mobile number or unknown to KPN, so no SIM-swap date is available.`
      );
    }
    throw error;
  }

  // No date is not proof of "never swapped": treat the number as unverified.
  if (!latestSimChange) {
    return errorResult(
      `KPN returned no SIM-swap date for ${phoneNumber}; the SIM-swap history could not be verified.`
    );
  }

  const ageHours = (Date.now() - Date.parse(latestSimChange)) / 3_600_000;
  if (Number.isNaN(ageHours)) {
    return errorResult(`KPN returned an unreadable SIM-swap date for ${phoneNumber}: "${latestSimChange}".`);
  }
  return jsonResult({
    phoneNumber,
    latestSimChange,
    hoursSinceSimChange: Math.floor(ageHours),
    ...(maxAgeHours !== undefined ? { swappedWithinMaxAge: ageHours <= maxAgeHours } : {}),
  });
}

export const NETWORK_HANDLERS: Record<string, ToolHandler> = {
  kpn_disturbances_check: checkDisturbances,
  kpn_availability_check: checkAvailability,
  kpn_sim_swap_get_date: getSimSwapDate,
};
