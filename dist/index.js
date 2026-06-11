import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import mockDataJson from "../data/mock_data.json" with { type: "json" };
const mockData = mockDataJson;
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
const createFplMcpServer = () => {
    const server = new McpServer({
        name: "fpl-agent-mcp",
        version: "0.2.0"
    });
    server.registerTool("get_customer_profile", {
        description: "Identify the synthetic demo customer and return linked accounts, premises and registered EVs.",
        inputSchema: {
            customer_number: z.string().optional(),
            phone: z.string().optional(),
            email: z.string().optional()
        }
    }, async ({ customer_number, phone, email }) => {
        const matchesCustomerNumber = !customer_number || customer_number === mockData.customer.customerNumber;
        const matchesPhone = !phone || phone === mockData.customer.mobilePhone;
        const matchesEmail = !email || email.toLowerCase() === String(mockData.customer.email).toLowerCase();
        if (!matchesCustomerNumber || !matchesPhone || !matchesEmail) {
            return jsonContent({ found: false, message: "No matching synthetic customer profile found." });
        }
        return jsonContent(mockData.customer);
    });
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
        description: "Simulate matching a North Palm Beach property-registration event to the synthetic customer.",
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
        description: "Mock action that submits a new residential power connection request.",
        inputSchema: {
            premise_number: z.string(),
            account_number: z.string().optional(),
            requested_connect_date: z.string().optional()
        }
    }, async (input) => jsonContent({
        ...mockData.demo_write_responses.start_service_connection,
        request: input
    }));
    server.registerTool("enroll_ev_charging", {
        description: "Mock action that starts FPL EVolution Home enrollment for a premise.",
        inputSchema: {
            premise_number: z.string(),
            install_type: z.enum(["full", "equipment_only"])
        }
    }, async (input) => jsonContent({
        ...mockData.demo_write_responses.enroll_ev_charging,
        request: input
    }));
    server.registerTool("set_move_intent", {
        description: "Mock action that records whether the customer is keeping both homes or moving out of Miami.",
        inputSchema: {
            intent: z.enum(["keep_both", "move_out_miami"])
        }
    }, async (input) => jsonContent({
        ...mockData.demo_write_responses.set_move_intent,
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
    const server = createFplMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
    });
    try {
        const body = await readRequestBody(request);
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
            writeJson(response, 200, { status: "ok", mcpPath: "/mcp" });
            return;
        }
        if (url.pathname === "/mcp") {
            await handleMcpRequest(request, response);
            return;
        }
        writeJson(response, 404, { error: "Not found", mcpPath: "/mcp", healthPath: "/health" });
    }).listen(port, () => {
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
