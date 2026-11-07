import { describe, expect, it, vi } from "vitest";
import { renderRealtimeBody, type GrexxClient } from "@wyre-ai/node-kpn";
import { CONFIRM_ARG, type ElicitationContext } from "../elicitation.js";
import { buildRealtimeBody, customPricePrompt } from "../handlers/grexx-realtime.js";
import { handleGrexxToolCall } from "../handlers/index.js";
import type { ToolResult } from "../handlers/results.js";
import { GREXX_REALTIME_SPECS } from "../tools/grexx-realtime.js";

const SPEC = GREXX_REALTIME_SPECS.find((spec) => spec.tool === "kpn_grexx_custom_price")!;
const BASE_ARGS = { orderId: 123456, confirmationState: "Accepted" };
const UNDERFLOW = `0.${"0".repeat(323)}1`;
const MIN_DECIMAL = `0.${"0".repeat(323)}5`;

const PRICE_FIELDS = [
  { arg: "price", element: "Price", label: "Price" },
  { arg: "setupPrice", element: "SetupPrice", label: "Setup price" },
  { arg: "terminationPrice", element: "TerminationPrice", label: "Termination price" },
];

const LOSSY_DECIMALS = [
  { name: "long fractional price", value: "24.123456789012345678" },
  { name: "rounded fraction", value: "0.10000000000000001" },
  { name: "negative leading-point fraction", value: "-.50000000000000001" },
  { name: "leading and trailing zeros around a lossy price", value: " 00024.123456789012345678000 " },
  { name: "positive underflow", value: UNDERFLOW },
  { name: "negative underflow", value: `-${UNDERFLOW}` },
  { name: "rounded subnormal", value: `0.${"0".repeat(323)}6` },
  { name: "long fractional tail", value: `24.95${"0".repeat(300)}1` },
  { name: "fraction rounded down to the upper bound", value: "2147483647.000000001" },
  { name: "fraction rounded up to the lower bound", value: "-2147483648.000000001" },
];

const EXACT_DECIMALS = [
  { name: "ordinary fractional price", value: "24.95", expected: 24.95 },
  { name: "leading decimal point", value: ".5", expected: 0.5 },
  { name: "negative leading decimal point", value: "-.5", expected: -0.5 },
  { name: "leading and trailing zeros", value: " 00024.95000 ", expected: 24.95 },
  { name: "negative leading and trailing zeros", value: "-00024.95000", expected: -24.95 },
  { name: "integer with fractional zeros", value: "00024.0000", expected: 24 },
  { name: "zero", value: "000.0000", expected: 0 },
  { name: "negative zero", value: "-000.0000", expected: -0 },
  { name: "leading-point zero", value: ".0000", expected: 0 },
  { name: "negative leading-point zero", value: "-.0000", expected: -0 },
  { name: "more than two decimal places", value: "24.123456789012344", expected: 24.123456789012344 },
  { name: "small price requiring exponent expansion", value: "0.0000001234567890123456", expected: "0.0000001234567890123456" },
  { name: "smallest subnormal", value: MIN_DECIMAL, expected: MIN_DECIMAL },
  { name: "negative smallest subnormal", value: `-${MIN_DECIMAL}`, expected: `-${MIN_DECIMAL}` },
  { name: "arbitrarily many redundant zeros", value: `${"0".repeat(200)}24.95${"0".repeat(200)}`, expected: 24.95 },
  { name: "upper bound", value: "2147483647.000", expected: 2147483647 },
  { name: "lower bound", value: "-2147483648.000", expected: -2147483648 },
];

describe.each(PRICE_FIELDS)("$arg decimal-string precision", ({ arg, element, label }) => {
  it.each(LOSSY_DECIMALS)("rejects $name instead of silently rounding", ({ value }) => {
    expect(() => buildRealtimeBody(SPEC, { ...BASE_ARGS, [arg]: value })).toThrow(
      `${label} can't be represented without losing decimal precision.`
    );
  });

  it.each(EXACT_DECIMALS)("preserves $name in the body, XML and prompt", ({ value, expected }) => {
    const body = buildRealtimeBody(SPEC, { ...BASE_ARGS, [arg]: value });
    expect(body[element]).toBe(expected);
    const xml = renderRealtimeBody(SPEC.request, body);
    expect(xml).toContain(`<${element}>${String(expected)}</${element}>`);
    expect(customPricePrompt(body)).toContain(String(expected));
  });

  it.each([
    { name: "before interactive confirmation", context: { clientCapabilities: { elicitation: { form: {} } } } },
    { name: "with explicit gateway confirmation", context: {} },
    {
      name: "after interactive confirmation",
      context: {
        clientCapabilities: { elicitation: { form: {} } },
        inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
      },
    },
  ] satisfies Array<{ name: string; context: ElicitationContext }>)(
    "rejects lossy prices $name without posting", async ({ context }) => {
      for (const value of ["24.123456789012345678", UNDERFLOW]) {
        const postRealtime = vi.fn();
        const client = { postRealtime } as unknown as GrexxClient;
        const result = await handleGrexxToolCall(client, SPEC.tool, {
          ...BASE_ARGS, [arg]: value, [CONFIRM_ARG]: true,
        }, context) as ToolResult;

        expect(result.isError).toBe(true);
        expect(result).not.toHaveProperty("inputRequests");
        expect((result.content[0] as { text: string }).text).toContain(
          `${label} can't be represented without losing decimal precision.`
        );
        expect(postRealtime).not.toHaveBeenCalled();
      }
    }
  );

  it.each(["2147483648", "-2147483649", 2147483648, -2147483649])(
    "keeps range validation for %s", (value) => {
      expect(() => buildRealtimeBody(SPEC, { ...BASE_ARGS, [arg]: value })).toThrow(
        `${label} must be between -2147483648 and 2147483647.`
      );
    }
  );

  it.each([NaN, Infinity, -Infinity, "Infinity", "NaN", "1".repeat(400), "1e-7", "+.5", "24."])(
    "keeps finite-number and decimal grammar validation for %s", (value) => {
      expect(() => buildRealtimeBody(SPEC, { ...BASE_ARGS, [arg]: value })).toThrow(
        `${label} must be a number, e.g. 24.95.`
      );
    }
  );
});
