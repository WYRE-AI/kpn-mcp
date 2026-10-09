/** Grexx phase-1 handlers against a mocked GrexxClient. No live credentials. */
import { describe, expect, it, vi } from "vitest";
import {
  GrexxAuthenticationError,
  GrexxRateLimitError,
  GrexxValidationError,
  type GrexxClient,
  type OrderDataResult,
  type PrequalificationResult,
  type ZipCodeCheckResult,
} from "@wyre-ai/node-kpn";
import { GREXX_CONNECTION_PROBE } from "../handlers/grexx.js";
import { describeGrexxError, handleGrexxToolCall, handleToolCall } from "../handlers/index.js";
import type { ToolResult } from "../handlers/results.js";

const SAMPLE: ZipCodeCheckResult = {
  code: "Success",
  messages: [],
  suppliers: [
    { name: "KPN", speeds: [] },
    { name: "KPNWEAS", speeds: [] },
    { name: "Tele2Fiber", speeds: [] },
  ],
  rawXml: "<ZipCodeCheckResponse_V5><Status><Code>Success</Code></Status></ZipCodeCheckResponse_V5>",
  requestId: "a8b5882a-0767-4a75-b751-3059d1b61193",
  httpStatus: 200,
};

/** Extract the first text content item from a handler result for assertions. */
function text(result: unknown): string {
  return (result as ToolResult).content[0].type === "text"
    ? ((result as ToolResult).content[0] as { text: string }).text
    : "";
}

const PREQUAL_SAMPLE: PrequalificationResult = {
  city: "Amsterdam",
  extension: "A",
  houseNumber: "1",
  street: "Damrak",
  zipCode: "9999ZZ",
  israSpecs: ["spec-a"],
  serviceId: "SVC1",
  ftuType: "FTU_TY01",
  nlsType: 6,
  lineType: "Fiber",
  remarks: ["one"],
  errorClass: "Functional",
  errorMessage: "no coverage",
  products: [
    {
      productCode: "FIBER",
      name: "Fiber",
      availability: "Green",
      distributionType: "FTTH",
      isVectoring: null,
      tariffCluster: "C1",
    },
  ],
  rawXml:
    "<PrequalificationResponse_V1><NlsType>6</NlsType><ErrorClass>Functional</ErrorClass></PrequalificationResponse_V1>",
  requestId: "req-prequal-1",
  httpStatus: 200,
};

const ORDER_SAMPLE: OrderDataResult = {
  status: { messages: [], code: "Success" },
  order: { customerId: 42, productCode: "FIBER100", quantity: 1 },
  rawXml: "<OrderDataResponse_V1><Status><Code>Success</Code></Status><Order><CustomerId>42</CustomerId></Order></OrderDataResponse_V1>",
  requestId: "req-order-1",
  httpStatus: 200,
};

type GrexxStub = GrexxClient & {
  zipCodeCheck: ReturnType<typeof vi.fn>;
  prequalification: ReturnType<typeof vi.fn>;
  orderData: ReturnType<typeof vi.fn>;
};

/** Create a network-free Grexx client. Zipcode, prequalification, and order data are overridable. */
function stub(
  zipCodeCheck = vi.fn(async () => SAMPLE),
  prequalification = vi.fn(async () => PREQUAL_SAMPLE),
  orderData = vi.fn(async () => ORDER_SAMPLE)
): GrexxStub {
  return { zipCodeCheck, prequalification, orderData } as unknown as GrexxStub;
}

describe("kpn_grexx_test_connection", () => {
  it("probes ZipCodeCheck 1012JS/1 and does not return raw XML", async () => {
    const client = stub();
    const result = (await handleGrexxToolCall(client, "kpn_grexx_test_connection", {})) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(client.zipCodeCheck).toHaveBeenCalledWith(GREXX_CONNECTION_PROBE);
    const body = JSON.parse(text(result));
    expect(body.ok).toBe(true);
    expect(body.auth).toBe("oauth_client_credentials");
    expect(body.code).toBe("Success");
    expect(body.supplierNames).toEqual(["KPN", "KPNWEAS", "Tele2Fiber"]);
    expect(body.requestId).toBe(SAMPLE.requestId);
    expect(body.note).toContain("HTTP Basic first");
    expect(body.note).toContain(
      "may fall back to form-body client_id/client_secret after HTTP 400/401 invalid_client"
    );
    expect(body.note).toContain("Basic Auth is not sent on POST /realtime");
    expect(text(result)).not.toContain(SAMPLE.rawXml);
  });

  it("maps an OAuth failure to isError without calling a second auth scheme", async () => {
    const client = stub(
      vi.fn(async () => {
        throw new GrexxAuthenticationError(
          "invalid_client. Refusing to call /realtime without a token.",
          400,
          undefined,
          "invalid_client",
          "3a1575f5-b483-46ec-a7df-cdea9c0da51b"
        );
      })
    );
    const previous = process.env.AUTH_MODE;
    delete process.env.AUTH_MODE;
    try {
      const result = (await handleGrexxToolCall(client, "kpn_grexx_test_connection", {})) as ToolResult;
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("invalid_client");
      expect(text(result)).toContain("KPN_GREXX_USERNAME and KPN_GREXX_PASSWORD");
      expect(text(result)).not.toContain("X-KPN-Grexx-Username");
      expect(text(result)).toContain("Basic Auth is not accepted");
      expect(text(result)).toContain("3a1575f5-b483-46ec-a7df-cdea9c0da51b");
    } finally {
      if (previous === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previous;
    }
  });

  it("names the gateway credential headers when AUTH_MODE is gateway", async () => {
    const previous = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "gateway";
    try {
      const client = stub(
        vi.fn(async () => {
          throw new GrexxAuthenticationError("invalid_client", 401, undefined, "invalid_client");
        })
      );
      const result = (await handleGrexxToolCall(client, "kpn_grexx_test_connection", {})) as ToolResult;
      expect(text(result)).toContain("X-KPN-Grexx-Username and X-KPN-Grexx-Password");
      expect(text(result)).not.toContain("KPN_GREXX_USERNAME");
      expect(text(result)).toContain("OAuth client_credentials");
    } finally {
      if (previous === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previous;
    }
  });
});

describe("kpn_grexx_zipcode_check", () => {
  const args = {
    portfolio: "All",
    zipCode: "1012 JS",
    houseNumber: 1,
    isRoomNumberKnown: false,
    suppliers: ["KPN", "Tele2Fiber"],
  };

  it("passes the SDK input through and omits rawXml", async () => {
    const client = stub();
    const result = (await handleGrexxToolCall(client, "kpn_grexx_zipcode_check", args)) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(client.zipCodeCheck).toHaveBeenCalledWith({
      portfolio: "All",
      zipCode: "1012 JS",
      houseNumber: 1,
      isRoomNumberKnown: false,
      suppliers: ["KPN", "Tele2Fiber"],
    });
    const body = JSON.parse(text(result));
    expect(body.code).toBe("Success");
    expect(body.suppliers).toHaveLength(3);
    expect(body.rawXml).toBeUndefined();
    expect(text(result)).not.toContain("<ZipCodeCheckResponse_V5>");
  });

  it("rejects a supplier the SDK does not know", async () => {
    const client = stub();
    const result = (await handleGrexxToolCall(client, "kpn_grexx_zipcode_check", {
      ...args,
      suppliers: ["NotASupplier"],
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Invalid arguments");
    expect(client.zipCodeCheck).not.toHaveBeenCalled();
  });

  it("rejects a missing room flag before the client is called", async () => {
    const client = stub();
    const result = (await handleGrexxToolCall(client, "kpn_grexx_zipcode_check", {
      portfolio: "Business",
      zipCode: "1012JS",
      houseNumber: 1,
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("isRoomNumberKnown");
    expect(client.zipCodeCheck).not.toHaveBeenCalled();
  });

  it("surfaces SDK validation and rate-limit errors", async () => {
    const invalid = stub(
      vi.fn(async () => {
        throw new GrexxValidationError(
          "ZipCode must be a Dutch postcode, for example 1012JS.",
          0,
          undefined,
          "invalid_zipcode"
        );
      })
    );
    const invalidResult = (await handleGrexxToolCall(invalid, "kpn_grexx_zipcode_check", {
      ...args,
      zipCode: "nope",
    })) as ToolResult;
    expect(invalidResult.isError).toBe(true);
    expect(text(invalidResult)).toBe(
      "Invalid arguments for kpn_grexx_zipcode_check: ZipCode must be a Dutch postcode, for example 1012JS."
    );
    expect(text(invalidResult)).not.toContain("Grexx error (HTTP 0");

    const house = stub(
      vi.fn(async () => {
        throw new GrexxValidationError("HouseNumber must be a positive integer.", 0, undefined, "invalid_house_number");
      })
    );
    const houseResult = (await handleGrexxToolCall(house, "kpn_grexx_zipcode_check", {
      ...args,
      houseNumber: 0,
    })) as ToolResult;
    expect(text(houseResult)).toContain("Invalid arguments for kpn_grexx_zipcode_check:");
    expect(text(houseResult)).toContain("HouseNumber must be a positive integer.");
    expect(text(houseResult)).not.toContain("Grexx error (HTTP 0");

    const remote = stub(
      vi.fn(async () => {
        throw new GrexxValidationError("Request failed validation.", 400, undefined, "400");
      })
    );
    const remoteResult = (await handleGrexxToolCall(remote, "kpn_grexx_zipcode_check", args)) as ToolResult;
    expect(text(remoteResult)).toContain("Grexx error (HTTP 400, 400): Request failed validation.");
    expect(text(remoteResult)).not.toContain("Invalid arguments");

    const limited = new GrexxRateLimitError("Grexx rate limit exceeded (108 Too Many Requests)", 429, undefined, "108");
    limited.retryAfter = 8;
    const slow = stub(vi.fn(async () => {
      throw limited;
    }));
    const slowResult = (await handleGrexxToolCall(slow, "kpn_grexx_zipcode_check", args)) as ToolResult;
    expect(text(slowResult)).toContain("retry after 8s");
    expect(describeGrexxError(limited)).toContain("108");
  });
});

describe("kpn_grexx_prequalification", () => {
  const args = {
    zipCode: "9999ZZ",
    houseNumber: 1,
    hasBroadband: true,
    hasPhone: false,
    productTypeCode: "FIBER",
    serviceId: "SVC1",
    suppliers: ["Kpn", "Tele2Fiber"],
  };

  it("passes the SDK input through and omits rawXml", async () => {
    const client = stub();
    const result = (await handleGrexxToolCall(client, "kpn_grexx_prequalification", {
      ...args,
      houseNumberExtension: "A",
      roomNumber: "kamer 1",
      orderId: "OID42",
      phoneNumber: "020-123",
      referencePhoneNumber: "010111",
      israSpecs: "spec-a",
      isComplexAddress: false,
    })) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(client.prequalification).toHaveBeenCalledWith({
      zipCode: "9999ZZ",
      houseNumber: 1,
      hasBroadband: true,
      hasPhone: false,
      productTypeCode: "FIBER",
      houseNumberExtension: "A",
      roomNumber: "kamer 1",
      orderId: "OID42",
      phoneNumber: "020-123",
      referencePhoneNumber: "010111",
      serviceId: "SVC1",
      suppliers: ["Kpn", "Tele2Fiber"],
      israSpecs: "spec-a",
      isComplexAddress: false,
    });
    const body = JSON.parse(text(result));
    expect(body.city).toBe("Amsterdam");
    expect(body.street).toBe("Damrak");
    expect(body.zipCode).toBe("9999ZZ");
    expect(body.products).toEqual(PREQUAL_SAMPLE.products);
    expect(body.errorClass).toBe("Functional");
    expect(body.errorMessage).toBe("no coverage");
    expect(body.requestId).toBe(PREQUAL_SAMPLE.requestId);
    expect(body.rawXml).toBeUndefined();
    expect(text(result)).not.toContain("<PrequalificationResponse_V1>");
  });

  it("accepts ReferencePhoneNumber alone when HasBroadband is true", async () => {
    const client = stub();
    const result = (await handleGrexxToolCall(client, "kpn_grexx_prequalification", {
      zipCode: "9999ZZ",
      houseNumber: 1,
      hasBroadband: true,
      hasPhone: false,
      productTypeCode: "FTTHTele",
      referencePhoneNumber: "010111",
    })) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(client.prequalification).toHaveBeenCalledWith({
      zipCode: "9999ZZ",
      houseNumber: 1,
      hasBroadband: true,
      hasPhone: false,
      productTypeCode: "FTTHTele",
      referencePhoneNumber: "010111",
    });
  });

  it("rejects HasBroadband without ServiceId or ReferencePhoneNumber before the client is called", async () => {
    const client = stub();
    const missing = (await handleGrexxToolCall(client, "kpn_grexx_prequalification", {
      zipCode: "9999ZZ",
      houseNumber: 1,
      hasBroadband: true,
      hasPhone: false,
      productTypeCode: "FTTHTele",
    })) as ToolResult;
    expect(missing.isError).toBe(true);
    expect(text(missing)).toBe(
      "Invalid arguments for kpn_grexx_prequalification: HasBroadband requires ServiceId or ReferencePhoneNumber."
    );
    const blank = (await handleGrexxToolCall(client, "kpn_grexx_prequalification", {
      zipCode: "9999ZZ",
      houseNumber: 1,
      hasBroadband: true,
      hasPhone: false,
      productTypeCode: "FTTHTele",
      serviceId: "  ",
      referencePhoneNumber: "",
    })) as ToolResult;
    expect(blank.isError).toBe(true);
    expect(text(blank)).toContain("HasBroadband requires ServiceId or ReferencePhoneNumber.");
    expect(client.prequalification).not.toHaveBeenCalled();
  });

  it("allows HasBroadband false without a broadband reference", async () => {
    const client = stub();
    const result = (await handleGrexxToolCall(client, "kpn_grexx_prequalification", {
      zipCode: "9999ZZ",
      houseNumber: 1,
      hasBroadband: false,
      hasPhone: false,
      productTypeCode: "FTTHTele",
    })) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(client.prequalification).toHaveBeenCalledWith({
      zipCode: "9999ZZ",
      houseNumber: 1,
      hasBroadband: false,
      hasPhone: false,
      productTypeCode: "FTTHTele",
    });
  });

  it("rejects a product type or supplier the SDK does not know", async () => {
    const client = stub();
    const product = (await handleGrexxToolCall(client, "kpn_grexx_prequalification", {
      ...args,
      productTypeCode: "Fiber",
    })) as ToolResult;
    expect(product.isError).toBe(true);
    expect(text(product)).toContain("Invalid arguments");
    expect(text(product)).toContain("productTypeCode");
    const supplier = (await handleGrexxToolCall(client, "kpn_grexx_prequalification", {
      ...args,
      suppliers: ["KPN"],
    })) as ToolResult;
    expect(supplier.isError).toBe(true);
    expect(text(supplier)).toContain("Invalid arguments");
    expect(client.prequalification).not.toHaveBeenCalled();
  });

  it("surfaces SDK validation and rate-limit errors", async () => {
    const invalid = stub(
      vi.fn(),
      vi.fn(async () => {
        throw new GrexxValidationError("OrderId must match OID[0-9]+.", 0, undefined, "invalid_order_id");
      })
    );
    const invalidResult = (await handleGrexxToolCall(invalid, "kpn_grexx_prequalification", {
      ...args,
      orderId: "oid1",
    })) as ToolResult;
    expect(invalidResult.isError).toBe(true);
    expect(text(invalidResult)).toBe(
      "Invalid arguments for kpn_grexx_prequalification: OrderId must match OID[0-9]+."
    );
    expect(text(invalidResult)).not.toContain("Grexx error (HTTP 0");

    const remote = stub(
      vi.fn(),
      vi.fn(async () => {
        throw new GrexxValidationError("Request failed validation.", 400, undefined, "400");
      })
    );
    const remoteResult = (await handleGrexxToolCall(remote, "kpn_grexx_prequalification", args)) as ToolResult;
    expect(text(remoteResult)).toContain("Grexx error (HTTP 400, 400): Request failed validation.");
    expect(text(remoteResult)).not.toContain("Invalid arguments");

    const limited = new GrexxRateLimitError("Grexx rate limit exceeded (108 Too Many Requests)", 429, undefined, "108");
    limited.retryAfter = 8;
    const slow = stub(
      vi.fn(),
      vi.fn(async () => {
        throw limited;
      })
    );
    const slowResult = (await handleGrexxToolCall(slow, "kpn_grexx_prequalification", args)) as ToolResult;
    expect(text(slowResult)).toContain("retry after 8s");
    expect(describeGrexxError(limited)).toContain("108");
  });
});

describe("kpn_grexx_order_data", () => {
  it("passes the order id through and returns customer id, product code, and quantity", async () => {
    const client = stub();
    const result = (await handleGrexxToolCall(client, "kpn_grexx_order_data", { orderId: 42 })) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(client.orderData).toHaveBeenCalledWith({ orderId: 42 });
    const body = JSON.parse(text(result));
    expect(body.status).toEqual({ messages: [], code: "Success" });
    expect(body.order).toEqual({ customerId: 42, productCode: "FIBER100", quantity: 1 });
    expect(body.requestId).toBe(ORDER_SAMPLE.requestId);
    expect(body.httpStatus).toBe(200);
    expect(body.rawXml).toBeUndefined();
    expect(text(result)).not.toContain("<OrderDataResponse_V1>");
  });

  it("rejects a missing or non-integer order id before the client is called", async () => {
    const client = stub();
    const missing = (await handleGrexxToolCall(client, "kpn_grexx_order_data", {})) as ToolResult;
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("Invalid arguments for kpn_grexx_order_data:");
    expect(text(missing)).toContain("orderId");
    const fraction = (await handleGrexxToolCall(client, "kpn_grexx_order_data", { orderId: 1.5 })) as ToolResult;
    expect(fraction.isError).toBe(true);
    expect(text(fraction)).toContain("orderId");
    expect(client.orderData).not.toHaveBeenCalled();
  });

  it("surfaces SDK validation and rate-limit errors", async () => {
    const invalid = stub(
      vi.fn(),
      vi.fn(),
      vi.fn(async () => {
        throw new GrexxValidationError("OrderId must be an xs:int.", 0, undefined, "invalid_order_id");
      })
    );
    const invalidResult = (await handleGrexxToolCall(invalid, "kpn_grexx_order_data", {
      orderId: 2147483648,
    })) as ToolResult;
    expect(invalidResult.isError).toBe(true);
    expect(text(invalidResult)).toBe(
      "Invalid arguments for kpn_grexx_order_data: OrderId must be an xs:int."
    );
    expect(text(invalidResult)).not.toContain("Grexx error (HTTP 0");

    const remote = stub(
      vi.fn(),
      vi.fn(),
      vi.fn(async () => {
        throw new GrexxValidationError("Request failed validation.", 400, undefined, "400");
      })
    );
    const remoteResult = (await handleGrexxToolCall(remote, "kpn_grexx_order_data", { orderId: 7 })) as ToolResult;
    expect(text(remoteResult)).toContain("Grexx error (HTTP 400, 400): Request failed validation.");
    expect(text(remoteResult)).not.toContain("Invalid arguments");

    const limited = new GrexxRateLimitError("Grexx rate limit exceeded (108 Too Many Requests)", 429, undefined, "108");
    limited.retryAfter = 3;
    const slow = stub(
      vi.fn(),
      vi.fn(),
      vi.fn(async () => {
        throw limited;
      })
    );
    const slowResult = (await handleGrexxToolCall(slow, "kpn_grexx_order_data", { orderId: 7 })) as ToolResult;
    expect(text(slowResult)).toContain("retry after 3s");
  });
});

describe("active surface dispatch", () => {
  it("unknown names and legacy names are isError when the legacy flag is off", async () => {
    for (const name of ["kpn_nope", "kpn_disturbances_check", "constructor", "__proto__"]) {
      const result = (await handleToolCall({ grexx: stub() }, name, {})) as ToolResult;
      expect(result.isError, name).toBe(true);
      expect(text(result), name).toContain("Unknown tool");
    }
  });

  it("a Grexx tool without a client names the Grexx credentials", async () => {
    const result = (await handleToolCall({}, "kpn_grexx_test_connection", {})) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("KPN_GREXX_USERNAME");
    expect(text(result)).toContain("X-KPN-Grexx-Username");
  });
});
