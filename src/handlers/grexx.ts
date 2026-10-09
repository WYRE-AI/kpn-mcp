/**
 * Phase-1 Grexx handlers. OAuth minting and XML live in `@wyre-ai/node-kpn`.
 * This module only checks JSON types and maps SDK results and errors.
 */
import {
  PREQUALIFICATION_PRODUCT_TYPES,
  PREQUALIFICATION_SUPPLIERS,
  ZIP_CODE_PORTFOLIOS,
  ZIP_CODE_SUPPLIERS,
  type GrexxClient,
  type OrderDataInput,
  type PrequalificationInput,
  type PrequalificationProductType,
  type PrequalificationSupplier,
  type ZipCodeCheckInput,
  type ZipCodePortfolio,
  type ZipCodeSupplier,
} from "@wyre-ai/node-kpn";
import {
  jsonResult,
  optionalBoolean,
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
      "GrexxClient tries HTTP Basic first and may fall back to form-body client_id/client_secret after HTTP 400/401 invalid_client. " +
      "Basic Auth is not sent on POST /realtime. " +
      "The probe checks public reference address 1012JS 1 and does not read a customer record.",
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

/** Drop the realtime document. Tool results stay on the parsed fields. */
function withoutRawXml<T extends { rawXml: string }>(result: T): Omit<T, "rawXml"> {
  const { rawXml, ...body } = result;
  void rawXml;
  return body;
}

/** Validate prequalification arguments, including the HasBroadband reference rule. */
function readPrequalificationInput(args: Record<string, unknown>): PrequalificationInput {
  const zipCode = requireString(args, "zipCode");
  const houseNumber = requireInteger(args, "houseNumber");
  const hasBroadband = requireBoolean(args, "hasBroadband");
  const hasPhone = requireBoolean(args, "hasPhone");
  const productTypeCode = requireEnum(
    args,
    "productTypeCode",
    PREQUALIFICATION_PRODUCT_TYPES
  ) as PrequalificationProductType;
  const houseNumberExtension = optionalString(args, "houseNumberExtension");
  const roomNumber = optionalString(args, "roomNumber");
  const orderId = optionalString(args, "orderId");
  const phoneNumber = optionalString(args, "phoneNumber");
  const referencePhoneNumber = optionalString(args, "referencePhoneNumber");
  const serviceId = optionalString(args, "serviceId");
  const israSpecs = optionalString(args, "israSpecs");
  const isComplexAddress = optionalBoolean(args, "isComplexAddress");
  const suppliers = optionalStringArray(args, "suppliers");
  if (suppliers) {
    for (const supplier of suppliers) {
      if (!(PREQUALIFICATION_SUPPLIERS as readonly string[]).includes(supplier)) {
        throw new ToolInputError(
          `Argument "suppliers" must only contain: ${PREQUALIFICATION_SUPPLIERS.join(", ")}.`
        );
      }
    }
  }
  const broadbandReference =
    (serviceId !== undefined && serviceId.trim() !== "") ||
    (referencePhoneNumber !== undefined && referencePhoneNumber.trim() !== "");
  if (hasBroadband && !broadbandReference) {
    throw new ToolInputError("HasBroadband requires ServiceId or ReferencePhoneNumber.");
  }
  return {
    zipCode,
    houseNumber,
    hasBroadband,
    hasPhone,
    productTypeCode,
    ...(houseNumberExtension ? { houseNumberExtension } : {}),
    ...(roomNumber ? { roomNumber } : {}),
    ...(orderId ? { orderId } : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(referencePhoneNumber ? { referencePhoneNumber } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(israSpecs ? { israSpecs } : {}),
    ...(isComplexAddress !== undefined ? { isComplexAddress } : {}),
    ...(suppliers ? { suppliers: suppliers as PrequalificationSupplier[] } : {}),
  };
}

/** Look up address and product availability. The result does not include raw XML. */
async function prequalification(
  client: GrexxClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const result = await client.prequalification(readPrequalificationInput(args));
  return jsonResult(withoutRawXml(result));
}

/** Validate the OrderData order id before the SDK builds OrderDataRequest_V1. */
function readOrderDataInput(args: Record<string, unknown>): OrderDataInput {
  return { orderId: requireInteger(args, "orderId") };
}

/** Look up an order. The result is status plus customer id, product code, and quantity. */
async function orderData(client: GrexxClient, args: Record<string, unknown>): Promise<ToolResult> {
  const result = await client.orderData(readOrderDataInput(args));
  return jsonResult(withoutRawXml(result));
}

export const GREXX_HANDLERS: Record<string, GrexxToolHandler> = {
  /** Run the fixed connection probe without accepting caller-supplied address arguments. */
  kpn_grexx_test_connection: (client) => testConnection(client),
  kpn_grexx_zipcode_check: zipcodeCheck,
  kpn_grexx_prequalification: prequalification,
  kpn_grexx_order_data: orderData,
};
