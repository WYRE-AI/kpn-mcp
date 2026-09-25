/** Tool 1 (design.md §4.3): the connection check. */
import type { Tool } from "@modelcontextprotocol/server";

export const CORE_TOOLS: Tool[] = [
  // 1
  {
    name: "kpn_test_connection",
    description:
      "Verify KPN API Store credentials by minting OAuth tokens. Reports the account tier " +
      "(demo/prod), app name, whether the MSM (business mobile) token also mints, and the " +
      "last quota headers. Minting does not prove a product is enabled on the project.",
    inputSchema: {
      type: "object",
      properties: {
        includeMsm: {
          type: "boolean",
          description: "Also mint the MSM (business mobile) token (default true).",
        },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];
