import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import pg from "pg";
const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 30000,
});
const normalizeString = (value) => String(value ?? "").trim().toLowerCase();
const getCustomers = async () => {
    const result = await pool.query('SELECT customer_number, business_partner_id, first_name, last_name, full_name, email, mobile_phone, preferred_contact_method, preferred_language, customer_since, account_standing_flag FROM customers');
    return result.rows;
};
const matchesCustomerFilters = (customer, filters) => {
    const customerNumber = String(customer.customerNumber ?? "");
    const mobilePhone = String(customer.mobilePhone ?? "");
    const email = normalizeString(customer.email);
    const matchesCustomerNumber = !filters.customer_number || filters.customer_number === customerNumber;
    const matchesPhone = !filters.phone || filters.phone === mobilePhone;
    const matchesEmail = !filters.email || normalizeString(filters.email) === email;
    return matchesCustomerNumber && matchesPhone && matchesEmail;
};
const findMatchingCustomers = async (filters) => {
    const customers = await getCustomers();
    return customers.filter((customer) => matchesCustomerFilters(customer, filters));
};
const jsonContent = (payload) => ({
    content: [
        {
            type: "text",
            text: JSON.stringify(payload, null, 2)
        }
    ]
});
const findPremiseByAddress = async (address) => {
    const normalizedAddress = address.toLowerCase();
    const result = await pool.query(`SELECT * FROM premises WHERE 
     LOWER(address_line1 || ' ' || address_city || ' ' || address_state || ' ' || address_zip) LIKE $1`, [`%${normalizedAddress}%`]);
    return result.rows[0] || null;
};
const findAccounts = async (input) => {
    let premiseNumber = input.premise_number;
    if (input.address) {
        const premise = await findPremiseByAddress(input.address);
        premiseNumber = premise?.premise_number || input.premise_number;
    }
    const matchingCustomers = await findMatchingCustomers({
        customer_number: input.customer_number,
        phone: input.phone,
        email: input.email
    });
    if (matchingCustomers.length === 0) {
        return [];
    }
    const matchingCustomerNumbers = new Set(matchingCustomers.map((customer) => customer.customer_number).filter(Boolean));
    const query = `
    SELECT * FROM accounts 
    WHERE ($1::text = '' OR account_number = $1)
    AND ($2::text = '' OR customer_number = ANY($3::text[]))
    AND ($4::text = '' OR premise_number = $4)
  `;
    const result = await pool.query(query, [
        input.account_number || '',
        '',
        Array.from(matchingCustomerNumbers),
        premiseNumber || ''
    ]);
    return result.rows;
};
// Tool handler functions for direct invocation
const getCustomerProfileHandler = async (args) => {
    const { customer_number, phone, email } = args;
    const matches = await findMatchingCustomers({ customer_number, phone, email });
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
    const accounts = await findAccounts(input);
    const premiseNumbers = new Set(accounts.map((account) => account.premise_number).filter(Boolean));
    let premises = [];
    if (premiseNumbers.size > 0) {
        const premiseQuery = 'SELECT * FROM premises WHERE premise_number = ANY($1::text[])';
        const premiseResult = await pool.query(premiseQuery, [Array.from(premiseNumbers)]);
        premises = premiseResult.rows;
    }
    if (accounts.length === 0) {
        return {
            found: false,
            message: "No matching account found. Ask the customer for one lookup value: phone number, email address, account number, customer number, premise number, or service address. For voice, ask one question at a time."
        };
    }
    return {
        found: true,
        customerNumber: String(accounts[0]?.customer_number ?? ""),
        accounts,
        premises
    };
};
const getAccountSummaryHandler = async ({ account_number }) => {
    const result = await pool.query('SELECT * FROM accounts WHERE account_number = $1', [account_number]);
    return result.rows[0] || { found: false };
};
const getPremiseDetailsHandler = async ({ premise_number, address }) => {
    let premise = null;
    if (premise_number) {
        const result = await pool.query('SELECT * FROM premises WHERE premise_number = $1', [premise_number]);
        premise = result.rows[0];
    }
    else if (address) {
        premise = await findPremiseByAddress(address);
    }
    return premise || { found: false };
};
const getBillingInquiryHandler = async ({ account_number }) => {
    const result = await pool.query('SELECT * FROM billing WHERE account_number = $1 ORDER BY bill_date DESC LIMIT 1', [account_number]);
    const billing = result.rows[0];
    if (!billing)
        return { found: false };
    // Get charges for this bill
    const chargesResult = await pool.query('SELECT * FROM bill_charges WHERE billing_id = $1', [billing.id]);
    return {
        invoiceId: billing.invoice_id,
        billDate: billing.bill_date,
        dueDate: billing.due_date,
        amountDue: billing.amount_due,
        billingPeriod: `${billing.billing_period_start} to ${billing.billing_period_end}`,
        kwhUsed: billing.kwh_used,
        averageDailyKwh: billing.average_daily_kwh,
        averageDailyCostUsd: billing.average_daily_cost_usd,
        comparedToLastMonthPct: billing.compared_to_last_month_pct,
        comparedToLastYearPct: billing.compared_to_last_year_pct,
        charges: chargesResult.rows,
        evChargingKwh: billing.ev_charging_kwh,
        evOffPeakKwh: billing.ev_off_peak_kwh,
        evOnPeakKwh: billing.ev_on_peak_kwh,
        estimatedEvOffPeakSavingsUsd: billing.estimated_ev_off_peak_savings_usd
    };
};
const getPaymentHistoryHandler = async ({ account_number }) => {
    const paymentsResult = await pool.query('SELECT * FROM payment_history WHERE account_number = $1 ORDER BY payment_date DESC', [account_number]);
    const billingResult = await pool.query('SELECT autopay_enrolled, next_scheduled_payment_date, next_scheduled_payment_amount_usd FROM billing WHERE account_number = $1', [account_number]);
    const billing = billingResult.rows[0];
    return {
        payments: paymentsResult.rows,
        autopayEnrolled: billing?.autopay_enrolled || false,
        nextScheduledPaymentDate: billing?.next_scheduled_payment_date,
        nextScheduledPaymentAmountUsd: billing?.next_scheduled_payment_amount_usd
    };
};
const getUsageHistoryHandler = async ({ account_number }) => {
    const result = await pool.query('SELECT * FROM usage_history WHERE account_number = $1 ORDER BY month DESC', [account_number]);
    return result.rows;
};
const getEvEnrollmentHandler = async ({ account_number }) => {
    const result = await pool.query('SELECT * FROM ev_enrollments WHERE account_number = $1', [account_number]);
    return result.rows[0] || { enrolled: false };
};
const checkEvEligibilityHandler = async ({ premise_number }) => {
    const result = await pool.query('SELECT * FROM ev_eligibility WHERE premise_number = $1', [premise_number]);
    return result.rows[0] || { eligible: false, found: false };
};
const matchPropertyToCustomerHandler = async ({ address }) => {
    const premise = await findPremiseByAddress(address);
    if (premise?.premise_number !== "60587744") {
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
const getServiceConnectionQuoteHandler = async ({ premise_number }) => {
    const result = await pool.query('SELECT * FROM service_connection_quotes WHERE premise_number = $1', [premise_number]);
    return result.rows[0] || { found: false };
};
const startServiceConnectionHandler = async (input) => ({
    status: "SUBMITTED",
    serviceOrderId: "SO-NPB-7741200",
    premiseNumber: input.premise_number,
    scheduledConnectDate: "2026-06-13",
    message: "New residential power connection scheduled. No deposit required (existing customer in good standing). Confirmation also sent to customer email."
});
const enrollEvChargingHandler = async (input) => ({
    status: "ENROLLMENT_STARTED",
    enrollmentId: "EVH-NPB-330145",
    premiseNumber: input.premise_number,
    installType: input.install_type === "full" ? "Full installation" : "Equipment-only",
    monthlyCharge: input.install_type === "full" ? 36.00 : 27.00,
    nextStep: "Electrical assessment - we'll text a link to upload garage photos",
    estimatedCompletion: "2-3 months from electrical assessment",
    message: "Started FPL EVolution Home enrollment. Because there's no existing 240V circuit in the garage, full installation is recommended at $36/month."
});
const setMoveIntentHandler = async (input) => ({
    status: "RECORDED",
    intent: input.intent === "keep_both" ? "KEEP_BOTH" : "MOVE_OUT",
    message: "Noted that you intend to keep both the Miami and North Palm Beach properties. No move-out order created for the Miami account (5210099001)."
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
    }, async ({ account_number }) => jsonContent(await getAccountSummaryHandler({ account_number })));
    server.registerTool("get_premise_details", {
        description: "Return premise details by premise number or service address.",
        inputSchema: {
            premise_number: z.string().optional(),
            address: z.string().optional()
        }
    }, async ({ premise_number, address }) => {
        const premise = await getPremiseDetailsHandler({ premise_number, address });
        return jsonContent(premise);
    });
    server.registerTool("get_billing_inquiry", {
        description: "Return current bill, due date, charge breakdown, kWh usage and EV off-peak savings.",
        inputSchema: {
            account_number: z.string()
        }
    }, async ({ account_number }) => jsonContent(await getBillingInquiryHandler({ account_number })));
    server.registerTool("get_payment_history", {
        description: "Return recent payment history and AutoPay scheduling details.",
        inputSchema: {
            account_number: z.string()
        }
    }, async ({ account_number }) => jsonContent(await getPaymentHistoryHandler({ account_number })));
    server.registerTool("get_usage_history", {
        description: "Return monthly kWh, cost and EV charging kWh trend history.",
        inputSchema: {
            account_number: z.string()
        }
    }, async ({ account_number }) => jsonContent(await getUsageHistoryHandler({ account_number })));
    server.registerTool("get_ev_enrollment", {
        description: "Return FPL EVolution Home enrollment and charger details for an account.",
        inputSchema: {
            account_number: z.string()
        }
    }, async ({ account_number }) => jsonContent(await getEvEnrollmentHandler({ account_number })));
    server.registerTool("check_ev_eligibility", {
        description: "Return premise-specific FPL EVolution Home eligibility checks and recommended install type.",
        inputSchema: {
            premise_number: z.string()
        }
    }, async ({ premise_number }) => jsonContent(await checkEvEligibilityHandler({ premise_number })));
    server.registerTool("match_property_to_customer", {
        description: "Match a North Palm Beach property-registration event to the customer.",
        inputSchema: {
            address: z.string()
        }
    }, async ({ address }) => {
        const result = await matchPropertyToCustomerHandler({ address });
        return jsonContent(result);
    });
    server.registerTool("get_service_connection_quote", {
        description: "Return move-in connection quote, deposit status and earliest connection date for a premise.",
        inputSchema: {
            premise_number: z.string()
        }
    }, async ({ premise_number }) => jsonContent(await getServiceConnectionQuoteHandler({ premise_number })));
    server.registerTool("start_service_connection", {
        description: "Submit a new residential power connection request.",
        inputSchema: {
            premise_number: z.string(),
            account_number: z.string().optional(),
            requested_connect_date: z.string().optional()
        }
    }, async (input) => jsonContent(await startServiceConnectionHandler(input)));
    server.registerTool("enroll_ev_charging", {
        description: "Start FPL EVolution Home enrollment for a premise.",
        inputSchema: {
            premise_number: z.string(),
            install_type: z.enum(["full", "equipment_only"])
        }
    }, async (input) => jsonContent(await enrollEvChargingHandler(input)));
    server.registerTool("set_move_intent", {
        description: "Record whether the customer is keeping both homes or moving out of Miami.",
        inputSchema: {
            intent: z.enum(["keep_both", "move_out_miami"])
        }
    }, async (input) => jsonContent(await setMoveIntentHandler(input)));
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
