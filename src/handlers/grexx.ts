/**
 * Phase 1 handlers. Each one calls the matching KpnGrexxClient method.
 * Method names are the 2.0 client exports (zipCodeCheck, getSim, …).
 */
import type { CustomerDataRequest, IrmaCallResult, OrderSummaryRequest } from "@wyre-ai/node-kpn";
import {
  CARRIER_PRODUCT_TYPES,
  CUSTOMER_ORDER_BY,
  ORDER_STATES,
  PREQUALIFICATION_PRODUCT_TYPES,
  PRODUCT_GROUPS,
  SYMPTOM_CODES,
  ZIP_CODE_PORTFOLIOS,
} from "@wyre-ai/node-kpn";
import { maskSecrets } from "./masking.js";
import {
  errorResult,
  jsonResult,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  optionalStringArray,
  requireBoolean,
  requireEnum,
  requireInteger,
  requireIntegerArray,
  requireString,
  type ToolHandler,
  type ToolResult,
} from "./results.js";

function present(result: IrmaCallResult<unknown>): ToolResult {
  const masked = result.data === undefined ? undefined : maskSecrets(result.data);
  return jsonResult({
    rootElement: result.rootElement,
    grexxCode: result.grexxCode,
    grexxCodeMessage: result.grexxCodeMessage,
    message: result.message,
    orderStatus: result.orderStatus,
    ...(masked?.masked ? { secretsMasked: true } : {}),
    data: masked?.value,
  });
}

const testConnection: ToolHandler = async (client) => {
  const result = await client.testConnection();
  if (!result.ok) {
    return errorResult(`Grexx connection check failed.\n${JSON.stringify(result, null, 2)}`);
  }
  return jsonResult(result);
};

const zipcodeCheck: ToolHandler = async (client, args) =>
  present(
    await client.zipCodeCheck({
      Portfolio: requireEnum(args, "portfolio", ZIP_CODE_PORTFOLIOS),
      ZipCode: requireString(args, "zipCode"),
      HouseNr: requireInteger(args, "houseNumber"),
      HouseNrExtension: optionalString(args, "houseNumberExtension"),
      ServiceId: optionalString(args, "serviceId"),
      RoomNumber: optionalString(args, "roomNumber"),
      IsRoomNumberKnown: requireBoolean(args, "isRoomNumberKnown"),
      Suppliers: optionalStringArray(args, "suppliers"),
    })
  );

const prequalification: ToolHandler = async (client, args) =>
  present(
    await client.prequalification({
      ZipCode: requireString(args, "zipCode"),
      HouseNr: requireInteger(args, "houseNumber"),
      HouseNrExtension: optionalString(args, "houseNumberExtension"),
      RoomNumber: optionalString(args, "roomNumber"),
      HasBroadband: requireBoolean(args, "hasBroadband"),
      HasPhone: requireBoolean(args, "hasPhone"),
      OrderId: optionalString(args, "orderId"),
      PhoneNumber: optionalString(args, "phoneNumber"),
      ProductTypeCode: requireEnum(args, "productTypeCode", PREQUALIFICATION_PRODUCT_TYPES),
      ReferencePhoneNumber: optionalString(args, "referencePhoneNumber"),
      ServiceId: optionalString(args, "serviceId"),
      Suppliers: optionalStringArray(args, "suppliers"),
      IsraSpecs: optionalString(args, "israSpecs"),
      IsComplexAddress: optionalBoolean(args, "isComplexAddress"),
    })
  );

const carrierInfo: ToolHandler = async (client, args) =>
  present(
    await client.carrierInfo({
      ProductType: requireEnum(args, "productType", CARRIER_PRODUCT_TYPES),
      ZipCode: requireString(args, "zipCode"),
      HouseNumber: requireInteger(args, "houseNumber"),
      HouseNumberExt: optionalString(args, "houseNumberExt"),
      PhoneNumber: optionalString(args, "phoneNumber"),
      IsraSpecification: optionalString(args, "israSpecification"),
      ServiceId: optionalString(args, "serviceId"),
    })
  );

const radiusCheck: ToolHandler = async (client, args) =>
  present(await client.radiusCheck({ OrderId: requireInteger(args, "orderId") }));

const rasCheck: ToolHandler = async (client, args) =>
  present(await client.rasCheck({ OrderId: requireInteger(args, "orderId") }));

const startLineDiagnose: ToolHandler = async (client, args) => {
  const partnerReference = optionalString(args, "partnerReference");
  const dateCreated = optionalString(args, "dateCreated");
  return present(
    await client.startLineDiagnose({
      OrderId: requireInteger(args, "orderId"),
      SymptomCode: requireEnum(args, "symptomCode", SYMPTOM_CODES),
      ...(partnerReference || dateCreated
        ? { Header: { PartnerReference: partnerReference, DateCreated: dateCreated ?? "" } }
        : {}),
    })
  );
};

function customerRequest(args: Record<string, unknown>): CustomerDataRequest {
  return {
    Id: optionalInteger(args, "id"),
    Name: optionalString(args, "name"),
    Street: optionalString(args, "street"),
    ZipCode: optionalString(args, "zipCode"),
    City: optionalString(args, "city"),
    CountryCode: optionalString(args, "countryCode"),
    Phone1: optionalString(args, "phone1"),
    Phone2: optionalString(args, "phone2"),
    DebitNr: optionalString(args, "debitNr"),
    ExternalId: optionalString(args, "externalId"),
    ChamberOfCommerceNr: optionalString(args, "chamberOfCommerceNr"),
    VATNr: optionalString(args, "vatNr"),
    IncludeInactiveCustomers: optionalBoolean(args, "includeInactiveCustomers"),
    OrderByMember: optionalEnum(args, "orderByMember", CUSTOMER_ORDER_BY),
    OrderByDescending: optionalBoolean(args, "orderByDescending"),
    Skip: optionalInteger(args, "skip"),
    Take: optionalInteger(args, "take"),
  };
}

function orderSummaryRequest(args: Record<string, unknown>): OrderSummaryRequest {
  return {
    CustomerId: optionalInteger(args, "customerId"),
    OrderState: optionalEnum(args, "orderState", ORDER_STATES),
    ProductGroup: optionalEnum(args, "productGroup", PRODUCT_GROUPS),
    ProductName: optionalString(args, "productName"),
    DateActiveFrom: optionalString(args, "dateActiveFrom"),
    DateActiveTo: optionalString(args, "dateActiveTo"),
    DateModifiedFrom: optionalString(args, "dateModifiedFrom"),
    DateModifiedTo: optionalString(args, "dateModifiedTo"),
    Label: optionalString(args, "label"),
    Attribute: optionalString(args, "attribute"),
    Skip: optionalInteger(args, "skip"),
    Take: optionalInteger(args, "take"),
  };
}

const customerData: ToolHandler = async (client, args) =>
  present(await client.customerData(customerRequest(args)));

const orderSummary: ToolHandler = async (client, args) =>
  present(await client.orderSummary(orderSummaryRequest(args)));

const orderData: ToolHandler = async (client, args) =>
  present(await client.orderData({ OrderId: requireInteger(args, "orderId") }));

const getSim: ToolHandler = async (client, args) =>
  present(await client.getSim({ OrderId: requireInteger(args, "orderId") }));

const mobileSettings: ToolHandler = async (client, args) =>
  present(await client.getMobileSettings({ OrderId: requireInteger(args, "orderId") }));

const mobileUsage: ToolHandler = async (client, args) =>
  present(await client.getMobileSubscriptionUsage({ OrderId: requireInteger(args, "orderId") }));

const mobileOrders: ToolHandler = async (client, args) =>
  present(
    await client.getMobileSubscriptionOrders({
      OrderIds: requireIntegerArray(args, "orderIds", 1, 50),
    })
  );

const availablePortings: ToolHandler = async (client, args) => {
  const customerId = optionalInteger(args, "customerId");
  const hipGroupOrderId = optionalInteger(args, "hipGroupOrderId");
  if (customerId === undefined && hipGroupOrderId === undefined) {
    return errorResult(
      "Invalid arguments for kpn_grexx_available_portings: provide customerId or hipGroupOrderId."
    );
  }
  return present(
    await client.availablePortings({
      MobileSubscripionCustomerId: customerId,
      HipGroupOrderId: hipGroupOrderId,
    })
  );
};

export const GREXX_HANDLERS: Record<string, ToolHandler> = {
  kpn_grexx_test_connection: testConnection,
  kpn_grexx_zipcode_check: zipcodeCheck,
  kpn_grexx_prequalification: prequalification,
  kpn_grexx_carrier_info: carrierInfo,
  kpn_grexx_radius_check: radiusCheck,
  kpn_grexx_ras_check: rasCheck,
  kpn_grexx_start_line_diagnose: startLineDiagnose,
  kpn_grexx_customer_data: customerData,
  kpn_grexx_order_summary: orderSummary,
  kpn_grexx_order_data: orderData,
  kpn_grexx_get_sim: getSim,
  kpn_grexx_mobile_settings: mobileSettings,
  kpn_grexx_mobile_usage: mobileUsage,
  kpn_grexx_mobile_orders: mobileOrders,
  kpn_grexx_available_portings: availablePortings,
};
