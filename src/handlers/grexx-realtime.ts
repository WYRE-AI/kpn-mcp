/**
 * One handler for every spec in tools/grexx-realtime.ts.
 *
 * Arguments are validated against the spec, emitted in XSD order, and posted
 * with `GrexxClient.postRealtime`. The SDK throws for a non-success
 * `Status/Code`; this module also catches the HTTP 200 `NinaResponse`
 * envelope (`IsSuccess=false`, e.g. 109 XML validation error), which carries
 * no `Status` and would otherwise look like success.
 */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import {
  GrexxError,
  parseGrexxError,
  parseXml,
  type GrexxClient,
  type XmlObject,
  type XmlValue,
} from "@wyre-ai/node-kpn";
import { referenceNumber as defaultReferenceNumber } from "@wyre-ai/node-kpn/legacy";
import {
  ENABLED_GREXX_REALTIME_SPECS,
  GREXX_ADMIN_TOOLS_ENABLED,
  type GrexxField, type GrexxRealtimeSpec } from "../tools/grexx-realtime.js";
import { MASK } from "./masking.js";
import {
  errorResult,
  jsonResult,
  textResult,
  ToolInputError,
  type ToolResult,
} from "./results.js";
import { confirmDestructive, NO_ELICITATION, type ElicitationContext } from "../elicitation.js";

/**
 * SIM and line secrets: PIN/PUK/PUC codes, eSIM activation and confirmation
 * codes, and the PPP password RadiusCheck returns in clear text.
 */
const SECRET_KEY = /^(pin|puk|puc)\d?$|^(activationcode|confirmationcode|password|sippassword)$/i;

/** Readable names for common arguments; a field's own `label` wins. */
const DEFAULT_LABELS: Record<string, string> = {
  orderId: "Order number",
  orderIds: "Order numbers",
  customerId: "Customer number",
  contactId: "Contact ID",
  zipCode: "Postcode",
  phoneNumber: "Phone number",
  houseNumber: "House number",
  houseNumberExtension: "House number addition",
};

/** "dateModifiedFrom" -> "Date modified from". */
function humanize(arg: string): string {
  const words = arg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Choose the field label used in caller-facing validation errors. */
export function fieldLabel(field: GrexxField): string {
  return field.label ?? DEFAULT_LABELS[field.arg] ?? humanize(field.arg);
}

/** Validation errors are caller-facing sentences; they never show a regex. */
function fail(message: string): never {
  throw new ToolInputError(message);
}

/** The first "e.g. ..." example in a field description, if any. */
function exampleOf(field: GrexxField): string {
  const match = /e\.g\. ([^.;)]+(?:\.[a-z][^.;)]*)*)/.exec(field.description);
  return match ? ` Example: ${match[1].trim()}.` : "";
}

/** xs:int range. IRMA rejects anything outside it with 109. */
const XS_INT_MIN = -2147483648;
const XS_INT_MAX = 2147483647;

/** xs:dateTime needs a date AND a time. IRMA rejects a date-only value with 109. */
const XS_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** Accept a numeric value or decimal digit string within the field bounds. */
function readInteger(field: GrexxField, value: unknown): number {
  const num = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof num !== "number" || !Number.isInteger(num)) fail(`${fieldLabel(field)} must be a whole number.`);
  const min = field.min ?? XS_INT_MIN;
  const max = field.max ?? XS_INT_MAX;
  if (num < min) fail(`${fieldLabel(field)} must be at least ${min}.`);
  if (num > max) fail(`${fieldLabel(field)} must be at most ${max}.`);
  return num;
}

/** Normalize whitespace before checking string length, enums and patterns. */
function readString(field: GrexxField, value: unknown): string {
  if (Array.isArray(value)) {
    fail(`${fieldLabel(field)} takes one value, not a list${field.enum ? `, e.g. "${field.enum[0]}"` : ""}.`);
  }
  if (typeof value !== "string" || value.trim() === "") fail(`${fieldLabel(field)} can't be empty.`);
  const text = field.postcode ? value.replace(/\s+/g, "").toUpperCase() : value.trim();
  if (field.min !== undefined && text.length < field.min) {
    fail(field.min === 1 ? `${fieldLabel(field)} can't be empty.` : `${fieldLabel(field)} must be at least ${field.min} characters.`);
  }
  if (field.max !== undefined && text.length > field.max) fail(`${fieldLabel(field)} can be at most ${field.max} characters.`);
  if (field.enum && !field.enum.includes(text)) fail(`${fieldLabel(field)} must be one of: ${field.enum.join(", ")}.`);
  if (field.pattern && !field.pattern.test(text)) fail(field.formatHint ?? `${fieldLabel(field)} isn't in the expected format.${exampleOf(field)}`);
  return text;
}

/**
 * Server-generated values (never taken from the caller): the DeleteContact
 * Header's PartnerReference and DateCreated.
 */
function generatedValue(field: GrexxField): XmlValue {
  if (field.type === "object") {
    const result: Record<string, XmlValue> = {};
    for (const child of field.fields ?? []) result[child.element] = generatedValue(child);
    return result;
  }
  if (field.type === "dateTime") return new Date().toISOString();
  if (field.element === "PartnerReference") return defaultReferenceNumber();
  throw new Error(`No generator for server-generated field ${field.element}.`);
}

/**
 * xs:decimal forbids exponent notation. Expand only exponential number strings,
 * keeping every digit of the validated number without rounding to a money scale.
 * Ordinary decimal values stay numeric for existing request-body consumers.
 */
function decimalXmlValue(value: number): number | string {
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(String(value));
  if (!match) return value;
  const [, sign, whole, fraction = "", exponent] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Convert one argument to its XSD value; undefined when the optional argument is absent. */
function readField(field: GrexxField, args: Record<string, unknown>): XmlValue {
  if (field.generated === true) return generatedValue(field);
  const value = args[field.arg];
  if (value === undefined || value === null || value === "") {
    if (field.required) fail(`${fieldLabel(field)} (${field.arg}) is required.`);
    return undefined;
  }
  switch (field.type) {
    case "integer":
      return readInteger(field, value);
    case "decimal": {
      const num = typeof value === "string" && /^-?(\d+(\.\d+)?|\.\d+)$/.test(value.trim()) ? Number(value) : value;
      if (typeof num !== "number" || !Number.isFinite(num)) fail(`${fieldLabel(field)} must be a number, e.g. 24.95.`);
      const min = field.min ?? XS_INT_MIN;
      const max = field.max ?? XS_INT_MAX;
      if (num < min || num > max) fail(`${fieldLabel(field)} must be between ${min} and ${max}.`);
      return decimalXmlValue(num);
    }
    case "boolean":
      if (typeof value !== "boolean") {
        const text = typeof value === "string" ? ` (not the text "${value}")` : "";
        fail(`${fieldLabel(field)} must be true or false${text}.`);
      }
      return value;
    case "dateTime": {
      const text = readString(field, value);
      if (!XS_DATE_TIME.test(text) || Number.isNaN(Date.parse(text))) {
        fail(`${fieldLabel(field)} must be a date and time, e.g. "2025-01-01T00:00:00Z".`);
      }
      return text;
    }
    case "integerList": {
      if (!Array.isArray(value)) fail(`${fieldLabel(field)} must be a list.`);
      if (field.min !== undefined && value.length < field.min) fail(field.min === 1 ? `${fieldLabel(field)} can't be empty.` : `${fieldLabel(field)} needs at least ${field.min} items.`);
      if (field.max !== undefined && value.length > field.max) fail(`${fieldLabel(field)} can have at most ${field.max} items.`);
      const items = value.map((item) => readInteger({ ...field, min: 1, max: undefined }, item));
      return { [field.item ?? field.element]: items };
    }
    case "stringList": {
      if (!Array.isArray(value)) fail(`${fieldLabel(field)} must be an array.`);
      if (field.min !== undefined && value.length < field.min) fail(`${fieldLabel(field)} needs at least ${field.min} item(s).`);
      if (field.max !== undefined && value.length > field.max) fail(`${fieldLabel(field)} allows at most ${field.max} items.`);
      const items = value.map((item) => {
        if (typeof item !== "string") fail(`${fieldLabel(field)} must contain only strings.`);
        if (field.enum && !field.enum.includes(item)) fail(`${fieldLabel(field)} must be one of: ${field.enum.join(", ")}.`);
        return item;
      });
      return items;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${fieldLabel(field)} must be an object.`);
      const nested = value as Record<string, unknown>;
      const result: Record<string, XmlValue> = {};
      for (const child of field.fields ?? []) {
        const childValue = readField(child, nested);
        if (childValue !== undefined) result[child.element] = childValue;
      }
      return result;
    }
    default:
      return readString(field, value);
  }
}

/** Validate tool arguments and build the request body in XSD element order. */
export function buildRealtimeBody(spec: GrexxRealtimeSpec, args: Record<string, unknown>): Record<string, XmlValue> {
  const body: Record<string, XmlValue> = {};
  for (const field of spec.fields) {
    const value = readField(field, args);
    if (value !== undefined) body[field.element] = value;
  }
  const problem = spec.check?.(args);
  if (problem) throw new ToolInputError(problem);
  return body;
}

/** Copy of `value` with every secret leaf replaced by MASK; reports whether anything was masked. */
export function maskSecrets(value: unknown, state = { masked: false }): unknown {
  if (Array.isArray(value)) return value.map((item) => maskSecrets(item, state));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && typeof inner === "string" && inner !== "") {
      out[key] = MASK;
      state.masked = true;
    } else {
      out[key] = maskSecrets(inner, state);
    }
  }
  return out;
}

/** Narrow a parsed XML value to an object, or return an empty object. */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Read a nonempty string from a parsed XML leaf. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Grexx's HTTP 200 rejection envelope: `<NinaResponse><IsSuccess>false</IsSuccess>
 * <ErrorCode>109</ErrorCode>…`. It has no `Status`, so node-kpn returns it as
 * success. `parseGrexxError` gives it the SDK's typed error (108 rate limit,
 * 102 forbidden, …) so the usual error hints apply.
 */
export function ninaError(document: XmlObject, requestId?: string): GrexxError | undefined {
  const root = asRecord(document.NinaResponse);
  if (text(root.IsSuccess)?.toLowerCase() !== "false") return undefined;
  const details = asRecord(root.ErrorDetails).string;
  const detailText = (Array.isArray(details) ? details : [details]).map(text).filter(Boolean).join(" ");
  const message = [text(root.ErrorMessage) ?? "Grexx rejected the request", detailText].filter(Boolean).join(": ");
  return parseGrexxError(200, undefined, undefined, requestId, { code: text(root.ErrorCode), message });
}

/**
 * The NinaResponse behind an SDK error. node-kpn builders (ZipCodeCheck,
 * Prequalification, OrderData) reject it as an unexpected root element and
 * keep the raw body in `error.response`.
 */
export function ninaErrorFromResponse(error: GrexxError): GrexxError | undefined {
  if (typeof error.response !== "string" || !error.response.includes("<NinaResponse")) return undefined;
  try {
    return ninaError(parseXml(error.response), error.requestId);
  } catch {
    return undefined;
  }
}

/** Confirmation prompt for kpn_grexx_custom_price, built only from the validated request body. */
export function customPricePrompt(body: Record<string, unknown>): string {
  const decision = String(body.ConfirmationState ?? "");
  const orderId = String(body.OrderId ?? "");
  const verb = decision === "Rejected" ? "Reject" : "Accept";
  const prices: string[] = [];
  if (body.Price !== undefined) prices.push(`price: ${String(body.Price)}`);
  if (body.SetupPrice !== undefined) prices.push(`setup: ${String(body.SetupPrice)}`);
  if (body.TerminationPrice !== undefined) prices.push(`termination: ${String(body.TerminationPrice)}`);
  const lines = [`${verb} KPN's custom price on order ${orderId}?`, `  Order: ${orderId}`, `  Decision: ${decision}`];
  if (prices.length > 0) {
    const text = prices.join(", ");
    lines.push(`  ${text.charAt(0).toUpperCase()}${text.slice(1)}`);
  }
  if (body.Remark !== undefined) lines.push(`  Remark: ${String(body.Remark)}`);
  lines.push("  Reversible: not through this tool.", `[${verb} custom price] [Cancel]`);
  return lines.join("\n");
}

/** Format an optional validated value for a confirmation prompt. */
function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/** Describe only supplied changes, preserving explicit false and zero values. */
function changeLine(pairs: [string, unknown][]): string | undefined {
  const set = pairs.filter(([, value]) => value !== undefined && value !== "");
  if (set.length === 0) return undefined;
  return `  Change: ${set.map(([name, value]) => `${name} ${Array.isArray(value) ? value.join(", ") : str(value)}`).join(", ")}`;
}

/** Label the contact notification preferences shown in the confirmation prompt. */
function notificationPairs(details: Record<string, unknown>): [string, unknown][] {
  const prefs = asRecord(details.NotificationPreferences);
  return [
    ["system notifications", prefs.EnabledSystemNotifications],
    ["news notifications", prefs.EnabledNewsNotifications],
    ["usage alerts", prefs.EnabledThresholdAlerts],
  ];
}

/**
 * Confirmation prompt for a write tool, built only from the validated request
 * body (never from the tool description or raw arguments).
 */
export function realtimePrompt(spec: GrexxRealtimeSpec, body: Record<string, unknown>): string {
  const lines: (string | undefined)[] = [];
  switch (spec.tool) {
    case "kpn_grexx_custom_price":
      return customPricePrompt(body);
    case "kpn_grexx_create_contact": {
      const details = asRecord(body.ContactPostPutRequest);
      lines.push(
        "Add this contact to the KPN customer?",
        `  Customer: ${str(body.CustomerId)}`,
        changeLine([["name", details.DisplayName], ["email", details.Email], ["phone 1", details.Phone1], ["phone 2", details.Phone2], ...notificationPairs(details)]),
        "  Reversible: yes, update or remove the contact later.",
        "[Add contact] [Cancel]"
      );
      break;
    }
    case "kpn_grexx_update_contact": {
      const details = asRecord(body.ContactPostPutRequest);
      lines.push(
        "Change this KPN contact?",
        `  Contact: contact ${str(body.ContactId)} for customer ${str(body.CustomerId)}`,
        changeLine([["name", details.DisplayName], ["email", details.Email], ["phone 1", details.Phone1], ["phone 2", details.Phone2], ...notificationPairs(details)]),
        "  Reversible: yes, change it back later.",
        "[Change contact] [Cancel]"
      );
      break;
    }
    case "kpn_grexx_modify_voip_user":
      lines.push(
        "Change this VoIP user?",
        `  Order: ${str(body.OrderId)}`,
        changeLine([["name", `${str(body.FirstName)} ${str(body.LastName)}`.trim()], ["email", body.Email], ["number", body.PhoneNumber], ["extension", body.Extension]]),
        "  Reversible: yes, change it back later.",
        "[Change VoIP user] [Cancel]"
      );
      break;
    case "kpn_grexx_modify_device_profile":
      lines.push(
        "Change this VoIP device?",
        `  Order: ${str(body.OrderId)}`,
        changeLine([["device name", body.DeviceName], ["device type", body.DeviceType], ["MAC", body.MacAddress], ["device user name", body.DeviceUserName], ["line port", body.LinePort], ["SIP user name", body.SipUserName]]),
        "  Reversible: yes, change it back later. A wrong value can stop the phone working until it's corrected.",
        "[Change device] [Cancel]"
      );
      break;
    case "kpn_grexx_delete_contact":
      lines.push(
        "Permanently delete this KPN contact?",
        `  Contact: contact ${str(body.ContactId)} for customer ${str(body.CustomerId)}`,
        "  This can't be undone.",
        "[Delete contact] [Cancel]"
      );
      break;
    default:
      lines.push(`Run ${spec.tool}?`, changeLine(Object.entries(body).filter(([, value]) => typeof value !== "object")), "[Confirm] [Cancel]");
  }
  return lines.filter((line): line is string => line !== undefined).join("\n");
}

/** Post one realtime call and return its parsed response without raw XML. */
export async function callRealtime(
  client: GrexxClient,
  spec: GrexxRealtimeSpec,
  args: Record<string, unknown>,
  elicitation: ElicitationContext = NO_ELICITATION,
  adminEnabled: boolean = GREXX_ADMIN_TOOLS_ENABLED
): Promise<ToolResult | InputRequiredResult> {
  // Defence in depth: hidden admin tools are not in the handler map either.
  if (spec.admin === true && !adminEnabled) return errorResult(`Unknown tool: ${spec.tool}`);
  // Validate first: invalid arguments never reach the confirmation prompt.
  const body = buildRealtimeBody(spec, args);
  if (spec.destructive === true || spec.confirm === true || spec.admin === true) {
    const gate = confirmDestructive(elicitation, args, realtimePrompt(spec, body));
    if (gate.kind === "ask") return gate.result;
    if (gate.kind === "blocked") return errorResult(gate.message);
    if (gate.kind === "refused") return textResult("Cancelled; nothing was changed.");
    if (gate.kind !== "proceed") throw new Error("Unexpected destructive confirmation outcome.");
  }
  const result = await client.postRealtime(spec.request, body, { idempotent: spec.readOnly !== false });
  const rejected = ninaError(result.document, result.requestId);
  if (rejected) throw rejected;
  if (result.rootElement !== spec.response) {
    // No response body on the error: it could carry a secret this module would otherwise mask.
    throw new GrexxError(
      `Expected ${spec.response} but received <${result.rootElement}>`,
      result.httpStatus,
      undefined,
      result.code,
      result.requestId
    );
  }
  const root = asRecord(result.document[result.rootElement]);

  // Status is reported as code/messages; the rest is the call's payload.
  const data = Object.fromEntries(Object.entries(root).filter(([key]) => key !== "Status"));
  const state = { masked: false };
  const masked = maskSecrets(data, state);
  const output = {
    request: spec.request,
    response: result.rootElement,
    code: result.code ?? null,
    messages: result.messages,
    requestId: result.requestId ?? null,
    httpStatus: result.httpStatus,
    ...(state.masked ? { secretsMasked: true } : {}),
    data: masked,
  };
  // Responses without a Status block report failure only through ErrorMessage.
  // Error text can land in gateway logs, so it carries no response data.
  const errorMessage = text(root.ErrorMessage);
  if (errorMessage) {
    const meta = { request: output.request, response: output.response, code: output.code, requestId: output.requestId };
    return errorResult(`Grexx ${result.rootElement} reported an error: ${errorMessage}\n${JSON.stringify(meta, null, 2)}`);
  }
  return jsonResult(output);
}

export type GrexxRealtimeHandler = (
  client: GrexxClient,
  args: Record<string, unknown>,
  elicitation?: ElicitationContext
) => Promise<ToolResult | InputRequiredResult>;

/** Handler map for a set of specs; tools not in `specs` are unknown to the dispatcher. */
export function buildRealtimeHandlers(
  specs: readonly GrexxRealtimeSpec[],
  adminEnabled: boolean = GREXX_ADMIN_TOOLS_ENABLED
): Record<string, GrexxRealtimeHandler> {
  return Object.fromEntries(
    specs.map((spec) => [
      spec.tool,
      (client: GrexxClient, args: Record<string, unknown>, elicitation: ElicitationContext = NO_ELICITATION) =>
        callRealtime(client, spec, args, elicitation, adminEnabled),
    ])
  );
}

/** Only enabled specs: admin-only tools are absent unless KPN_GREXX_ADMIN_TOOLS_ENABLED is set. */
export const GREXX_REALTIME_HANDLERS: Record<string, GrexxRealtimeHandler> = buildRealtimeHandlers(ENABLED_GREXX_REALTIME_SPECS);
