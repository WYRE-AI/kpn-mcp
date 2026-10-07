/** Shared tool-result helpers, the handler signature, and argument validation. */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type { KpnClient } from "@wyre-ai/node-kpn/legacy";
import type { ElicitationContext } from "../elicitation.js";

export type ToolContent =
  | { type: "text"; text: string }
  /** Embedded binary resource, e.g. an invoice PDF (base64 `blob`). */
  | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /** The SDK's CallToolResult carries an open index signature — mirror it. */
  [key: string]: unknown;
}

/**
 * Every domain handler has this shape. Handlers may throw (ToolInputError,
 * KpnError, …): the dispatcher in handlers/index.ts turns every throw into an
 * isError result, so nothing ever escapes to the transport.
 */
export type ToolHandler = (
  client: KpnClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
) => Promise<ToolResult | InputRequiredResult>;

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Thrown for invalid tool arguments; the dispatcher maps it to isError. */
export class ToolInputError extends Error {}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolInputError(`Argument "${key}" is required and must be a non-empty string.`);
  }
  return value;
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`Argument "${key}" must be a string.`);
  }
  return value;
}

export function requireInteger(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isInteger(num)) {
    throw new ToolInputError(`Argument "${key}" is required and must be an integer.`);
  }
  return num;
}

export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    throw new ToolInputError(`Argument "${key}" must be a number.`);
  }
  return num;
}

/** Return a required boolean argument, or throw ToolInputError without coercing other types. */
export function requireBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") {
    throw new ToolInputError(`Argument "${key}" is required and must be a boolean.`);
  }
  return value;
}

/** Return a required allowed string value, or throw ToolInputError for invalid or absent input. */
export function requireEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T {
  const value = args[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ToolInputError(`Argument "${key}" is required and must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ToolInputError(`Argument "${key}" must be a boolean.`);
  }
  return value;
}

export function requireObject(
  args: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = args[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`Argument "${key}" is required and must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function optionalStringArray(
  args: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new ToolInputError(`Argument "${key}" must be an array of strings.`);
  }
  return value as string[];
}

export function optionalEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ToolInputError(`Argument "${key}" must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}
