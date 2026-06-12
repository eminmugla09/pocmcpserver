import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import mockDataJson from "../data/mock_data.json" with { type: "json" };
const mockData = mockDataJson;
const getCustomers = () => {
    if (Array.isArray(mockData.customers) && mockData.customers.length > 0) {
        return mockData.customers;
    }
    return [mockData.customer];
};
const normalizeString = (value) => String(value ?? "").trim().toLowerCase();
const matchesCustomerFilters = (customer, filters) => {
    const customerNumber = String(customer.customerNumber ?? "");
    const mobilePhone = String(customer.mobilePhone ?? "");
    const email = normalizeString(customer.email);
    const matchesCustomerNumber = !filters.customer_number || filters.customer_number === customerNumber;
    const matchesPhone = !filters.phone || filters.phone === mobilePhone;
    const matchesEmail = !filters.email || normalizeString(filters.email) === email;
    return matchesCustomerNumber && matchesPhone && matchesEmail;
};
const findMatchingCustomers = (filters) => getCustomers().filter((customer) => matchesCustomerFilters(customer, filters));
const jsonContent = (payload) => ({
    content: [
        {
            type: "text",
            text: JSON.stringify(payload, null, 2)
        }
    ]
});
const findPremiseByAddress = (address) => {
    const normalizedAddress = address.toLowerCase();
    return Object.values(mockData.premises).find((premise) => {
        const premiseAddress = premise.address;
        const fullAddress = [premiseAddress?.line1, premiseAddress?.city, premiseAddress?.state, premiseAddress?.zip]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        return fullAddress.includes(normalizedAddress) || normalizedAddress.includes(premiseAddress?.line1?.toLowerCase() ?? "");
    });
};
const findAccounts = (input) => {
    const premise = input.address ? findPremiseByAddress(input.address) : undefined;
    const premiseNumber = input.premise_number ?? premise?.premiseNumber;
    const matchingCustomers = findMatchingCustomers({
        customer_number: input.customer_number,
        phone: input.phone,
        email: input.email
    });
    if (matchingCustomers.length === 0) {
        return [];
    }
    const matchingCustomerNumbers = new Set(matchingCustomers.map((customer) => String(customer.customerNumber ?? "")).filter(Boolean));
    return Object.values(mockData.accounts).filter((account) => {
        const matchesAccountNumber = !input.account_number || account.accountNumber === input.account_number;
        const matchesPremiseNumber = !premiseNumber || account.premiseNumber === premiseNumber;
        const matchesCustomerNumber = !account.customerNumber || matchingCustomerNumbers.has(String(account.customerNumber));
        return matchesAccountNumber && matchesPremiseNumber && matchesCustomerNumber;
    });
};
// Tool handler functions for direct invocation
const getCustomerProfileHandler = async (args) => {
    const { customer_number, phone, email } = args;
    const matches = findMatchingCustomers({ customer_number, phone, email });
    if (matches.length === 0) {
        return { found: false, message: "No matching customer profile found." };
    }
    if (matches.length === 1) {
        return matches[0];
    }
    return {
        found: true,
        multipleMatches: true,
        customers: matches
    };
};
const lookupAccountHandler = async (input) => {
    const accounts = findAccounts(input);
    const premiseNumbers = new Set(accounts.map((account) => account.premiseNumber));
    const premises = [...premiseNumbers].map((premiseNumber) => mockData.premises[premiseNumber]).filter(Boolean);
    if (accounts.length === 0) {
        return {
            found: false,
            message: "No matching account found. Ask the customer for one lookup value: phone number, email address, account number, customer number, premise number, or service address. For voice, ask one question at a time."
        };
    }
    return {
        found: true,
        customerNumber: String(accounts[0]?.customerNumber ?? ""),
        accounts,
        premises
    };
};
const getAccountSummaryHandler = async ({ account_number }) => mockData.accounts[account_number] ?? { found: false };
const getPremiseDetailsHandler = async ({ premise_number, address }) => {
    let premise;
    if (premise_number) {
        premise = mockData.premises[premise_number];
    }
    else if (address) {
        premise = findPremiseByAddress(address);
    }
    return premise ?? { found: false };
};
const getBillingInquiryHandler = async ({ account_number }) => mockData.billing[account_number]?.currentBill ?? { found: false };
const getPaymentHistoryHandler = async ({ account_number }) => ({
    payments: mockData.payment_history[account_number] ?? [],
    autopayEnrolled: mockData.billing[account_number]?.autopayEnrolled ?? false,
    nextScheduledPaymentDate: mockData.billing[account_number]?.nextScheduledPaymentDate
});
const getUsageHistoryHandler = async ({ account_number }) => mockData.usage_history[account_number] ?? [];
const getEvEnrollmentHandler = async ({ account_number }) => mockData.ev_enrollments[account_number] ?? { enrolled: false };
const checkEvEligibilityHandler = async ({ premise_number }) => mockData.ev_eligibility[premise_number] ?? { eligible: false, found: false };
const matchPropertyToCustomerHandler = async ({ address }) => {
    const premise = findPremiseByAddress(address);
    if (premise?.premiseNumber !== "60587744") {
        return { matched: false, event: "NO_MATCH" };
    }
    return {
        matchedCustomer: "1009988776",
        premiseNumber: "60587744",
        event: "NEW_OWNER_RECORDED",
        recordedDate: "2026-06-05",
        existingServices: ["FPL EVolution Home @ premise 60412233", "Registered EV: Tesla Model Y"]
    };
};
const getServiceConnectionQuoteHandler = async ({ premise_number }) => mockData.service_connection_quote[premise_number] ?? { found: false };
const startServiceConnectionHandler = async (input) => ({
    ...mockData.action_responses.start_service_connection,
    request: input
});
const enrollEvChargingHandler = async (input) => ({
    ...mockData.action_responses.enroll_ev_charging,
    request: input
});
const setMoveIntentHandler = async (input) => ({
    ...mockData.action_responses.set_move_intent,
    request: input
});
const createFplMcpServer = () => {
    const server = new McpServer({
        name: "fpl-agent-mcp",
        version: "0.2.0"
    }, {
        capabilities: {
            tools: {
                listChanged: true
            }
        }
    });
    server.registerTool("get_customer_profile", {
        description: "Identify the customer and return linked accounts, premises and registered EVs.",
        inputSchema: {
            customer_number: z.string().optional(),
            phone: z.string().optional(),
            email: z.string().optional()
        }
    }, async (args) => jsonContent(await getCustomerProfileHandler(args)));
    server.registerTool("lookup_account", {
        description: "Resolve residential account records by account, customer, phone, email, premise, or address.",
        inputSchema: {
            account_number: z.string().optional(),
            customer_number: z.string().optional(),
            phone: z.string().optional(),
            email: z.string().optional(),
            premise_number: z.string().optional(),
            address: z.string().optional()
        }
    }, async (input) => jsonContent(await lookupAccountHandler(input)));
    server.registerTool("get_account_summary", {
        description: "Return account status, standing, rate class, smart meter status, enrolled programs and flags.",
        inputSchema: {
            account_number: z.string()
        }
    }, async ({ account_number }) => jsonContent(mockData.accounts[account_number] ?? { found: false }));
    server.registerTool("get_premise_details", {
        description: "Return premise details by premise number or service address.",
        inputSchema: {
            premise_number: z.string().optional(),
            address: z.string().optional()
        }
    }, async ({ premise_number, address }) => {
        let premise;
        if (premise_number) {
            premise = mockData.premises[premise_number];
        }
        else if (address) {
            premise = findPremiseByAddress(address);
        }
        return jsonContent(premise ?? { found: false });
    });
    server.registerTool("get_billing_inquiry", {
        description: "Return current bill, due date, charge breakdown, kWh usage and EV off-peak savings.",
        inputSchema: {
            account_number: z.string()
        }
    }, async ({ account_number }) => jsonContent(mockData.billing[account_number]?.currentBill ?? { found: false }));
    server.registerTool("get_payment_history", {
        description: "Return recent payment history and AutoPay scheduling details.",
        inputSchema: {
            account_number: z.string()
        }
    }, async ({ account_number }) => jsonContent({
        payments: mockData.payment_history[account_number] ?? [],
        autopayEnrolled: mockData.billing[account_number]?.autopayEnrolled ?? false,
        nextScheduledPaymentDate: mockData.billing[account_number]?.nextScheduledPaymentDate
    }));
    server.registerTool("get_usage_history", {
        description: "Return monthly kWh, cost and EV charging kWh trend history.",
        inputSchema: {
            account_number: z.string()
        }
    }, async ({ account_number }) => jsonContent(mockData.usage_history[account_number] ?? []));
    server.registerTool("get_ev_enrollment", {
        description: "Return FPL EVolution Home enrollment and charger details for an account.",
        inputSchema: {
            account_number: z.string()
        }
    }, async ({ account_number }) => jsonContent(mockData.ev_enrollments[account_number] ?? { enrolled: false }));
    server.registerTool("check_ev_eligibility", {
        description: "Return premise-specific FPL EVolution Home eligibility checks and recommended install type.",
        inputSchema: {
            premise_number: z.string()
        }
    }, async ({ premise_number }) => jsonContent(mockData.ev_eligibility[premise_number] ?? { eligible: false, found: false }));
    server.registerTool("match_property_to_customer", {
        description: "Match a North Palm Beach property-registration event to the customer.",
        inputSchema: {
            address: z.string()
        }
    }, async ({ address }) => {
        const premise = findPremiseByAddress(address);
        if (premise?.premiseNumber !== "60587744") {
            return jsonContent({ matched: false, event: "NO_MATCH" });
        }
        return jsonContent({
            matchedCustomer: "1009988776",
            premiseNumber: "60587744",
            event: "NEW_OWNER_RECORDED",
            recordedDate: "2026-06-05",
            existingServices: ["FPL EVolution Home @ premise 60412233", "Registered EV: Tesla Model Y"]
        });
    });
    server.registerTool("get_service_connection_quote", {
        description: "Return move-in connection quote, deposit status and earliest connection date for a premise.",
        inputSchema: {
            premise_number: z.string()
        }
    }, async ({ premise_number }) => jsonContent(mockData.service_connection_quote[premise_number] ?? { found: false }));
    server.registerTool("start_service_connection", {
        description: "Submit a new residential power connection request.",
        inputSchema: {
            premise_number: z.string(),
            account_number: z.string().optional(),
            requested_connect_date: z.string().optional()
        }
    }, async (input) => jsonContent({
        ...mockData.action_responses.start_service_connection,
        request: input
    }));
    server.registerTool("enroll_ev_charging", {
        description: "Start FPL EVolution Home enrollment for a premise.",
        inputSchema: {
            premise_number: z.string(),
            install_type: z.enum(["full", "equipment_only"])
        }
    }, async (input) => jsonContent({
        ...mockData.action_responses.enroll_ev_charging,
        request: input
    }));
    server.registerTool("set_move_intent", {
        description: "Record whether the customer is keeping both homes or moving out of Miami.",
        inputSchema: {
            intent: z.enum(["keep_both", "move_out_miami"])
        }
    }, async (input) => jsonContent({
        ...mockData.action_responses.set_move_intent,
        request: input
    }));
    return server;
};
const readRequestBody = async (request) => {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0) {
        return undefined;
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
const setCorsHeaders = (response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, mcp-session-id");
    response.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, mcp-session-id");
};
const writeJson = (response, statusCode, payload) => {
    setCorsHeaders(response);
    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
};
const writeHtml = (response, statusCode, html) => {
    setCorsHeaders(response);
    response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
};
const privacyPageHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>FPL EV ChatGPT Privacy Notice</title>
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.5; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1f2933; }
      h1, h2 { color: #102a43; }
      code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>FPL EV ChatGPT Privacy Notice</h1>
    <p>Last updated: 2026-06-11</p>
    <p>This service provides MCP tools for an FPL EV assistant using sample data only. It is not an official FPL production service and does not connect to real FPL, SAP, MuleSoft, billing, permitting, notification, city-registration, or customer systems.</p>

    <h2>Data Used</h2>
    <p>The MCP tools return sample records bundled with the application. The sample data is invented and should not be treated as real customer information.</p>

    <h2>Data Collection</h2>
    <p>The server processes requests sent to <code>/mcp</code> so it can return tool responses. It does not intentionally collect, sell, or share personal information. Hosting and network providers may create standard operational logs such as request timestamps, paths, status codes, and IP metadata.</p>

    <h2>Data Storage</h2>
    <p>The application does not persist conversation content, user prompts, or tool-call inputs to an application database. Action tools return canned responses and do not create real service orders or enrollments.</p>

    <h2>Use Limits</h2>
    <p>Do not enter real customer data, account credentials, payment details, Social Security numbers, passwords, API keys, or other sensitive information into this service.</p>

    <h2>Contact</h2>
    <p>For questions, contact the owner of the deployed repository.</p>
  </body>
</html>`;
const handleMcpRequest = async (request, response) => {
    setCorsHeaders(response);
    if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
    }
    if (request.method !== "POST") {
        writeJson(response, 405, {
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: "Method not allowed. Use POST /mcp for this stateless MCP endpoint."
            },
            id: null
        });
        return;
    }
    // Inject Accept header if missing to satisfy StreamableHTTPServerTransport requirements
    const acceptHeader = request.headers.accept;
    if (!acceptHeader || (!acceptHeader.includes("application/json") || !acceptHeader.includes("text/event-stream"))) {
        request.headers.accept = "application/json, text/event-stream";
    }
    const body = await readRequestBody(request);
    // Handle initialize
    if (body?.method === "initialize") {
        const initResponse = {
            jsonrpc: "2.0",
            id: body.id,
            result: {
                protocolVersion: "2025-03-26",
                capabilities: {
                    tools: { listChanged: true }
                },
                serverInfo: {
                    name: "fpl-agent-mcp",
                    version: "0.2.0"
                }
            }
        };
        setCorsHeaders(response);
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(`event: message\ndata: ${JSON.stringify(initResponse)}\n\n`);
        response.end();
        return;
    }
    // Handle tools/list - manually construct response without execution field
    if (body?.method === "tools/list") {
        const server = createFplMcpServer();
        const transport = new StdioServerTransport();
        try {
            // Create a mock stdio transport to get the tools list
            // We'll use the server's internal method to get tools
            const tools = [
                { name: "get_customer_profile", description: "Identify the customer and return linked accounts, premises and registered EVs.", inputSchema: { type: "object", properties: { customer_number: { type: "string" }, phone: { type: "string" }, email: { type: "string" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "lookup_account", description: "Resolve residential account records by account, customer, phone, email, premise, or address.", inputSchema: { type: "object", properties: { account_number: { type: "string" }, customer_number: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, premise_number: { type: "string" }, address: { type: "string" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "get_account_summary", description: "Return account status, standing, rate class, smart meter status, enrolled programs and flags.", inputSchema: { type: "object", properties: { account_number: { type: "string" } }, required: ["account_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "get_premise_details", description: "Return premise details by premise number or service address.", inputSchema: { type: "object", properties: { premise_number: { type: "string" }, address: { type: "string" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "get_billing_inquiry", description: "Return current bill, due date, charge breakdown, kWh usage and EV off-peak savings.", inputSchema: { type: "object", properties: { account_number: { type: "string" } }, required: ["account_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "get_payment_history", description: "Return recent payment history and AutoPay scheduling details.", inputSchema: { type: "object", properties: { account_number: { type: "string" } }, required: ["account_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "get_usage_history", description: "Return monthly kWh, cost and EV charging kWh trend history.", inputSchema: { type: "object", properties: { account_number: { type: "string" } }, required: ["account_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "get_ev_enrollment", description: "Return FPL EVolution Home enrollment and charger details for an account.", inputSchema: { type: "object", properties: { account_number: { type: "string" } }, required: ["account_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "check_ev_eligibility", description: "Return premise-specific FPL EVolution Home eligibility checks and recommended install type.", inputSchema: { type: "object", properties: { premise_number: { type: "string" } }, required: ["premise_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "match_property_to_customer", description: "Match a North Palm Beach property-registration event to the customer.", inputSchema: { type: "object", properties: { address: { type: "string" } }, required: ["address"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "get_service_connection_quote", description: "Return move-in connection quote, deposit status and earliest connection date for a premise.", inputSchema: { type: "object", properties: { premise_number: { type: "string" } }, required: ["premise_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "start_service_connection", description: "Submit a new residential power connection request.", inputSchema: { type: "object", properties: { premise_number: { type: "string" }, account_number: { type: "string" }, requested_connect_date: { type: "string" } }, required: ["premise_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "enroll_ev_charging", description: "Start FPL EVolution Home enrollment for a premise.", inputSchema: { type: "object", properties: { premise_number: { type: "string" }, install_type: { type: "string", enum: ["full", "equipment_only"] } }, required: ["premise_number", "install_type"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
                { name: "set_move_intent", description: "Record whether the customer is keeping both homes or moving out of Miami.", inputSchema: { type: "object", properties: { intent: { type: "string", enum: ["keep_both", "move_out_miami"] } }, required: ["intent"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } }
            ];
            const toolsResponse = {
                jsonrpc: "2.0",
                id: body.id,
                result: { tools }
            };
            setCorsHeaders(response);
            response.writeHead(200, { "Content-Type": "text/event-stream" });
            response.write(`event: message\ndata: ${JSON.stringify(toolsResponse)}\n\n`);
            response.end();
        }
        catch (error) {
            console.error("Error handling tools/list", error);
            writeJson(response, 500, {
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: "Internal server error"
                },
                id: null
            });
        }
        finally {
            await server.close();
        }
        return;
    }
    // Handle all other requests through transport
    const server = createFplMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
    });
    try {
        await server.connect(transport);
        await transport.handleRequest(request, response, body);
    }
    catch (error) {
        console.error("Error handling MCP request", error);
        if (!response.headersSent) {
            writeJson(response, 500, {
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: "Internal server error"
                },
                id: null
            });
        }
    }
    finally {
        await transport.close();
        await server.close();
    }
};
const startHttpServer = () => {
    const port = Number(process.env.PORT ?? 3000);
    createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (url.pathname === "/health") {
            writeJson(response, 200, { status: "ok", mcpPath: "/mcp", privacyPath: "/privacy" });
            return;
        }
        if (url.pathname === "/privacy") {
            writeHtml(response, 200, privacyPageHtml);
            return;
        }
        if (url.pathname === "/mcp") {
            await handleMcpRequest(request, response);
            return;
        }
        writeJson(response, 404, { error: "Not found", mcpPath: "/mcp", healthPath: "/health", privacyPath: "/privacy" });
    }).listen(port, "0.0.0.0", () => {
        console.log(`FPL MCP HTTP server listening on port ${port}; endpoint: /mcp`);
    });
};
const startStdioServer = async () => {
    const server = createFplMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
};
if (process.env.MCP_TRANSPORT === "http" || process.env.PORT) {
    startHttpServer();
}
else {
    await startStdioServer();
}
