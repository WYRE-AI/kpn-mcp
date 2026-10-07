/**
 * Phase-1 Grexx handlers. OAuth minting and XML live in `@wyre-ai/node-kpn`.
 * This module only checks JSON types and maps SDK results and errors.
 */
import {
  ZIP_CODE_PORTFOLIOS,
  ZIP_CODE_SUPPLIERS,
  type GrexxClient,
  type ZipCodeCheckInput,
  type ZipCodePortfolio,
  type ZipCodeSupplier,
} from "@wyre-ai/node-kpn";
import {
  jsonResult,
  optionalString,
  optionalStringArray,
  requireBoolean,
  requireEnum,
  requireInteger,
  requireString,
  ToolInputError,
  type ToolResult,
} from "./results.js";

/**
 * Public reference address used in the 2026-10-07 acceptatie smoke
 * (ZipCodeCheckRequest_V6, portfolio All, 1012JS / 1). Not a customer record.
 */
export const GREXX_CONNECTION_PROBE: ZipCodeCheckInput = {
  portfolio: "All",
  zipCode: "1012JS",
  houseNumber: 1,
  isRoomNumberKnown: false,
};

export type GrexxToolHandler = (
  client: GrexxClient,
  args: Record<string, unknown>
) => Promise<ToolResult>;

/** Probe the public reference address through the SDK and summarize OAuth/realtime success. */
async function testConnection(client: GrexxClient): Promise<ToolResult> {
  const result = await client.zipCodeCheck(GREXX_CONNECTION_PROBE);
  return jsonResult({
    ok: true,
    auth: "oauth_client_credentials",
    probe: {
      request: "ZipCodeCheckRequest_V6",
      portfolio: GREXX_CONNECTION_PROBE.portfolio,
      zipCode: GREXX_CONNECTION_PROBE.zipCode,
      houseNumber: GREXX_CONNECTION_PROBE.houseNumber,
      isRoomNumberKnown: GREXX_CONNECTION_PROBE.isRoomNumberKnown,
    },
    code: result.code ?? null,
    messages: result.messages,
    supplierNames: result.suppliers
      .map((supplier) => supplier.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0),
    supplierCount: result.suppliers.length,
    httpStatus: result.httpStatus,
    requestId: result.requestId ?? null,
    note:
      "OAuth client_credentials (scope=all) was accepted and POST /realtime returned a success code. " +
      "Basic Auth is not used. The probe checks public reference address 1012JS 1 and does not read a customer record.",
  });
}

/** Validate tool arguments for the SDK request; throw ToolInputError for invalid types or suppliers. */
function readZipCodeInput(args: Record<string, unknown>): ZipCodeCheckInput {
  const portfolio = requireEnum(args, "portfolio", ZIP_CODE_PORTFOLIOS) as ZipCodePortfolio;
  const zipCode = requireString(args, "zipCode");
  const houseNumber = requireInteger(args, "houseNumber");
  const isRoomNumberKnown = requireBoolean(args, "isRoomNumberKnown");
  const houseNumberExtension = optionalString(args, "houseNumberExtension");
  const serviceId = optionalString(args, "serviceId");
  const roomNumber = optionalString(args, "roomNumber");
  const suppliers = optionalStringArray(args, "suppliers");
  if (suppliers) {
    for (const supplier of suppliers) {
      if (!(ZIP_CODE_SUPPLIERS as readonly string[]).includes(supplier)) {
        throw new ToolInputError(
          `Argument "suppliers" must only contain: ${ZIP_CODE_SUPPLIERS.join(", ")}.`
        );
      }
    }
  }
  return {
    portfolio,
    zipCode,
    houseNumber,
    isRoomNumberKnown,
    ...(houseNumberExtension ? { houseNumberExtension } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(roomNumber ? { roomNumber } : {}),
    ...(suppliers ? { suppliers: suppliers as ZipCodeSupplier[] } : {}),
  };
}

/** Look up address availability and return parsed Grexx results without the raw XML. */
async function zipcodeCheck(
  client: GrexxClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const result = await client.zipCodeCheck(readZipCodeInput(args));
  return jsonResult({
    code: result.code,
    messages: result.messages,
    suppliers: result.suppliers,
    requestId: result.requestId,
    httpStatus: result.httpStatus,
  });
}

export const GREXX_HANDLERS: Record<string, GrexxToolHandler> = {
  /** Run the fixed connection probe without accepting caller-supplied address arguments. */
  kpn_grexx_test_connection: (client) => testConnection(client),
  kpn_grexx_zipcode_check: zipcodeCheck,
};
