/**
 * One handler for every spec in tools/grexx-realtime.ts.
 *
 * Arguments are validated against the spec, emitted in XSD order, and posted
 * with `GrexxClient.postRealtime`. The SDK throws for a non-success
 * `Status/Code`; this module also catches the HTTP 200 `NinaResponse`
 * envelope (`IsSuccess=false`, e.g. 109 XML validation error), which carries
 * no `Status` and would otherwise look like success.
 */
import {
  GrexxError,
  parseGrexxError,
  parseXml,
  type GrexxClient,
  type XmlObject,
  type XmlValue,
} from "@wyre-ai/node-kpn";
import { GREXX_REALTIME_SPECS, type GrexxField, type GrexxRealtimeSpec } from "../tools/grexx-realtime.js";
import { MASK } from "./masking.js";
import { errorResult, jsonResult, ToolInputError, type ToolResult } from "./results.js";

/**
 * SIM and line secrets: PIN/PUK/PUC codes, eSIM activation and confirmation
 * codes, and the PPP password RadiusCheck returns in clear text.
 */
const SECRET_KEY = /^(pin|puk|puc)\d?$|^(activationcode|confirmationcode|password)$/i;

function fail(field: GrexxField, message: string): never {
  throw new ToolInputError(`Argument "${field.arg}" ${message}`);
}

/** xs:int range. IRMA rejects anything outside it with 109. */
const XS_INT_MIN = -2147483648;
const XS_INT_MAX = 2147483647;

/** xs:dateTime needs a date AND a time. IRMA rejects a date-only value with 109. */
const XS_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

function readInteger(field: GrexxField, value: unknown): number {
  const num = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof num !== "number" || !Number.isInteger(num)) fail(field, "must be an integer.");
  const min = field.min ?? XS_INT_MIN;
  const max = field.max ?? XS_INT_MAX;
  if (num < min) fail(field, `must be at least ${min}.`);
  if (num > max) fail(field, `must be at most ${max}.`);
  return num;
}

function readString(field: GrexxField, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") fail(field, "must be a non-empty string.");
  const text = field.postcode ? value.replace(/\s+/g, "").toUpperCase() : value.trim();
  if (field.enum && !field.enum.includes(text)) fail(field, `must be one of: ${field.enum.join(", ")}.`);
  if (field.pattern && !field.pattern.test(text)) fail(field, `does not match ${field.pattern.source}.`);
  return text;
}

/** Convert one argument to its XSD value; undefined when the optional argument is absent. */
function readField(field: GrexxField, args: Record<string, unknown>): XmlValue {
  const value = args[field.arg];
  if (value === undefined || value === null || value === "") {
    if (field.required) fail(field, "is required.");
    return undefined;
  }
  switch (field.type) {
    case "integer":
      return readInteger(field, value);
    case "boolean":
      if (typeof value !== "boolean") fail(field, "must be a boolean.");
      return value;
    case "dateTime": {
      const text = readString(field, value);
      if (!XS_DATE_TIME.test(text) || Number.isNaN(Date.parse(text))) {
        fail(field, 'must be an xs:dateTime with a time, e.g. "2025-01-01T00:00:00Z".');
      }
      return text;
    }
    case "integerList": {
      if (!Array.isArray(value)) fail(field, "must be an array.");
      if (field.min !== undefined && value.length < field.min) fail(field, `needs at least ${field.min} item(s).`);
      if (field.max !== undefined && value.length > field.max) fail(field, `allows at most ${field.max} items.`);
      const items = value.map((item) => readInteger({ ...field, min: 1, max: undefined }, item));
      return { [field.item ?? field.element]: items };
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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

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

/** Post one realtime call and return its parsed response without raw XML. */
export async function callRealtime(
  client: GrexxClient,
  spec: GrexxRealtimeSpec,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const body = buildRealtimeBody(spec, args);
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

export const GREXX_REALTIME_HANDLERS: Record<string, (client: GrexxClient, args: Record<string, unknown>) => Promise<ToolResult>> =
  Object.fromEntries(GREXX_REALTIME_SPECS.map((spec) => [spec.tool, (client: GrexxClient, args: Record<string, unknown>) => callRealtime(client, spec, args)]));
