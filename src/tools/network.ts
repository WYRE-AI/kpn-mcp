/** Tools 2–4 (design.md §4.3): the gateway-realm network and SIM-swap checks. All read-only. */
import type { Tool } from "@modelcontextprotocol/server";

/** Dutch address, shared by the disturbance and availability checks. */
const ADDRESS_PROPERTIES = {
  zipCode: {
    type: "string",
    description: 'Dutch postcode, e.g. "1234AB" (spaces and lowercase are accepted).',
  },
  houseNumber: { type: "integer", minimum: 1, description: "House number, e.g. 12." },
  houseNumberExtension: {
    type: "string",
    description: 'House number extension (toevoeging), e.g. "A" or "bis". Optional.',
  },
};

export const NETWORK_TOOLS: Tool[] = [
  // 2
  {
    name: "kpn_disturbances_check",
    description:
      "Check for current and planned KPN network outages/maintenance (broadband, fixed, " +
      "mobile, generic) affecting a Dutch address. Use first when a customer site on KPN " +
      "reports connectivity problems.",
    inputSchema: {
      type: "object",
      properties: ADDRESS_PROPERTIES,
      required: ["zipCode", "houseNumber"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  // 3
  {
    name: "kpn_availability_check",
    description:
      "Look up which KPN access technologies (fibre/copper) and max download/upload speeds " +
      "are available at a Dutch address, plus planned fibre dates and third-party fibre " +
      "info. For site surveys, upgrades and pre-sales.",
    inputSchema: {
      type: "object",
      properties: ADDRESS_PROPERTIES,
      required: ["zipCode", "houseNumber"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  // 4
  {
    name: "kpn_sim_swap_get_date",
    description:
      "Get the date of the most recent SIM swap on a KPN mobile number. Use before " +
      "resetting SMS-based MFA or passwords to detect SIM-swap fraud. KPN NL numbers only.",
    inputSchema: {
      type: "object",
      properties: {
        phoneNumber: {
          type: "string",
          description: "Mobile number: 06xxxxxxxx, +316xxxxxxxx or another E.164 number.",
        },
        maxAgeHours: {
          type: "integer",
          minimum: 1,
          description:
            "Optional. Adds swappedWithinMaxAge: true when the last SIM swap is at most this many hours ago.",
        },
      },
      required: ["phoneNumber"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];
