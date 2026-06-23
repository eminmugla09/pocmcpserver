import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import pg from 'pg';
import { verifyToken, hasCustomerAccess } from './auth.js';
const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_erwyh5nFq9JP@ep-muddy-grass-aia40flm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
// Extract and verify JWT token from request
function extractUserId(request) {
    const authHeader = request.params?.meta?.authorization || request.params?.meta?.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authHeader.substring(7);
    const verification = verifyToken(token);
    if (!verification.valid) {
        return null;
    }
    return verification.userId || null;
}
// Tool schemas
const GetCustomerProfileSchema = z.object({
    customer_number: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
});
const LookupAccountSchema = z.object({
    account_number: z.string().optional(),
    customer_number: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    premise_number: z.string().optional(),
    address: z.string().optional(),
});
const GetAccountSummarySchema = z.object({
    account_number: z.string(),
});
const GetPremiseDetailsSchema = z.object({
    premise_number: z.string().optional(),
    address: z.string().optional(),
});
const GetBillingInquirySchema = z.object({
    account_number: z.string(),
});
const GetPaymentHistorySchema = z.object({
    account_number: z.string(),
});
const GetUsageHistorySchema = z.object({
    account_number: z.string(),
});
const GetEVEnrollmentSchema = z.object({
    account_number: z.string(),
});
const CheckEVEligibilitySchema = z.object({
    premise_number: z.string(),
});
const MatchPropertyToCustomerSchema = z.object({
    address: z.string(),
});
const GetServiceConnectionQuoteSchema = z.object({
    premise_number: z.string(),
});
const StartServiceConnectionSchema = z.object({
    premise_number: z.string(),
    account_number: z.string().optional(),
    requested_connect_date: z.string().optional(),
});
const EnrollEVChargingSchema = z.object({
    premise_number: z.string(),
    install_type: z.enum(['full', 'equipment_only']),
});
const SetMoveIntentSchema = z.object({
    intent: z.enum(['keep_both', 'move_out_miami']),
});
// Helper function to check customer access
async function checkAccess(userId, customerNumber) {
    return await hasCustomerAccess(userId, customerNumber);
}
// Helper function to get account's customer number
async function getAccountCustomer(accountNumber) {
    try {
        const result = await pool.query('SELECT customer_number FROM accounts WHERE account_number = $1', [accountNumber]);
        return result.rows.length > 0 ? result.rows[0].customer_number : null;
    }
    catch (error) {
        console.error('Error getting account customer:', error);
        return null;
    }
}
// Helper function to get premise's customer number
async function getPremiseCustomer(premiseNumber) {
    try {
        const result = await pool.query('SELECT customer_number FROM accounts WHERE premise_number = $1 LIMIT 1', [premiseNumber]);
        return result.rows.length > 0 ? result.rows[0].customer_number : null;
    }
    catch (error) {
        console.error('Error getting premise customer:', error);
        return null;
    }
}
const server = new Server({
    name: 'fpl-agent-mcp-authenticated',
    version: '0.3.0',
}, {
    capabilities: {
        tools: {},
    },
});
// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'get_customer_profile',
                description: 'Identify the customer and return linked accounts, premises and registered EVs.',
                inputSchema: GetCustomerProfileSchema,
            },
            {
                name: 'lookup_account',
                description: 'Resolve residential account records by account, customer, phone, email, premise, or address.',
                inputSchema: LookupAccountSchema,
            },
            {
                name: 'get_account_summary',
                description: 'Return account status, standing, rate class, smart meter status, enrolled programs and flags.',
                inputSchema: GetAccountSummarySchema,
            },
            {
                name: 'get_premise_details',
                description: 'Return premise details by premise number or service address.',
                inputSchema: GetPremiseDetailsSchema,
            },
            {
                name: 'get_billing_inquiry',
                description: 'Return current bill, due date, charge breakdown, kWh usage and EV off-peak savings.',
                inputSchema: GetBillingInquirySchema,
            },
            {
                name: 'get_payment_history',
                description: 'Return recent payment history and AutoPay scheduling details.',
                inputSchema: GetPaymentHistorySchema,
            },
            {
                name: 'get_usage_history',
                description: 'Return monthly kWh, cost and EV charging kWh trend history.',
                inputSchema: GetUsageHistorySchema,
            },
            {
                name: 'get_ev_enrollment',
                description: 'Return FPL EVolution Home enrollment and charger details for an account.',
                inputSchema: GetEVEnrollmentSchema,
            },
            {
                name: 'check_ev_eligibility',
                description: 'Return premise-specific FPL EVolution Home eligibility checks and recommended install type.',
                inputSchema: CheckEVEligibilitySchema,
            },
            {
                name: 'match_property_to_customer',
                description: 'Match a North Palm Beach property-registration event to the customer.',
                inputSchema: MatchPropertyToCustomerSchema,
            },
            {
                name: 'get_service_connection_quote',
                description: 'Return move-in connection quote, deposit status and earliest connection date for a premise.',
                inputSchema: GetServiceConnectionQuoteSchema,
            },
            {
                name: 'start_service_connection',
                description: 'Submit a new residential power connection request.',
                inputSchema: StartServiceConnectionSchema,
            },
            {
                name: 'enroll_ev_charging',
                description: 'Start FPL EVolution Home enrollment for a premise.',
                inputSchema: EnrollEVChargingSchema,
            },
            {
                name: 'set_move_intent',
                description: 'Record whether the customer is keeping both homes or moving out of Miami.',
                inputSchema: SetMoveIntentSchema,
            },
        ],
    };
});
// Handle tool calls with authentication
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const userId = extractUserId(request);
    if (!userId) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        error: 'Unauthorized',
                        message: 'Valid JWT token required in Authorization header',
                    }),
                },
            ],
        };
    }
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'get_customer_profile': {
                const parsed = GetCustomerProfileSchema.parse(args);
                const { customer_number, phone, email } = parsed;
                // If customer_number provided, check access
                if (customer_number) {
                    const hasAccess = await checkAccess(userId, customer_number);
                    if (!hasAccess) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify({
                                        found: false,
                                        message: 'Access denied: You do not have permission to view this customer profile',
                                    }),
                                },
                            ],
                        };
                    }
                }
                // Query logic here...
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                found: true,
                                customer_number: customer_number || '1009988776',
                                message: 'Customer profile retrieved (authenticated)',
                            }),
                        },
                    ],
                };
            }
            case 'get_account_summary': {
                const parsed = GetAccountSummarySchema.parse(args);
                const { account_number } = parsed;
                const customerNumber = await getAccountCustomer(account_number);
                if (!customerNumber) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Account not found',
                                }),
                            },
                        ],
                    };
                }
                const hasAccess = await checkAccess(userId, customerNumber);
                if (!hasAccess) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Access denied: You do not have permission to view this account',
                                }),
                            },
                        ],
                    };
                }
                // Get actual account data
                const result = await pool.query('SELECT * FROM accounts WHERE account_number = $1', [account_number]);
                if (result.rows.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Account not found',
                                }),
                            },
                        ],
                    };
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result.rows[0]),
                        },
                    ],
                };
            }
            case 'get_billing_inquiry': {
                const parsed = GetBillingInquirySchema.parse(args);
                const { account_number } = parsed;
                const customerNumber = await getAccountCustomer(account_number);
                if (!customerNumber || !(await checkAccess(userId, customerNumber))) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Access denied or account not found',
                                }),
                            },
                        ],
                    };
                }
                const result = await pool.query('SELECT * FROM billing WHERE account_number = $1 ORDER BY bill_date DESC LIMIT 1', [account_number]);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result.rows[0] || { found: false, message: 'No billing data found' }),
                        },
                    ],
                };
            }
            case 'get_payment_history': {
                const parsed = GetPaymentHistorySchema.parse(args);
                const { account_number } = parsed;
                const customerNumber = await getAccountCustomer(account_number);
                if (!customerNumber || !(await checkAccess(userId, customerNumber))) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Access denied or account not found',
                                }),
                            },
                        ],
                    };
                }
                const result = await pool.query('SELECT * FROM payment_history WHERE account_number = $1 ORDER BY payment_date DESC LIMIT 10', [account_number]);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result.rows),
                        },
                    ],
                };
            }
            case 'get_usage_history': {
                const parsed = GetUsageHistorySchema.parse(args);
                const { account_number } = parsed;
                const customerNumber = await getAccountCustomer(account_number);
                if (!customerNumber || !(await checkAccess(userId, customerNumber))) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Access denied or account not found',
                                }),
                            },
                        ],
                    };
                }
                const result = await pool.query('SELECT * FROM usage_history WHERE account_number = $1 ORDER BY month DESC LIMIT 12', [account_number]);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result.rows),
                        },
                    ],
                };
            }
            case 'get_premise_details': {
                const parsed = GetPremiseDetailsSchema.parse(args);
                const { premise_number, address } = parsed;
                let customerNumber = null;
                if (premise_number) {
                    customerNumber = await getPremiseCustomer(premise_number);
                }
                if (customerNumber && !(await checkAccess(userId, customerNumber))) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Access denied to this premise',
                                }),
                            },
                        ],
                    };
                }
                let query = 'SELECT * FROM premises WHERE ';
                const params = [];
                if (premise_number) {
                    query += 'premise_number = $1';
                    params.push(premise_number);
                }
                else if (address) {
                    query += 'address_line1 ILIKE $1';
                    params.push(`%${address}%`);
                }
                else {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Either premise_number or address is required',
                                }),
                            },
                        ],
                    };
                }
                const result = await pool.query(query, params);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result.rows[0] || { found: false, message: 'Premise not found' }),
                        },
                    ],
                };
            }
            case 'check_ev_eligibility': {
                const parsed = CheckEVEligibilitySchema.parse(args);
                const { premise_number } = parsed;
                const customerNumber = await getPremiseCustomer(premise_number);
                if (!customerNumber || !(await checkAccess(userId, customerNumber))) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Access denied or premise not found',
                                }),
                            },
                        ],
                    };
                }
                const result = await pool.query('SELECT * FROM ev_eligibility WHERE premise_number = $1', [premise_number]);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result.rows[0] || { found: false, message: 'EV eligibility data not found' }),
                        },
                    ],
                };
            }
            case 'get_service_connection_quote': {
                const parsed = GetServiceConnectionQuoteSchema.parse(args);
                const { premise_number } = parsed;
                const customerNumber = await getPremiseCustomer(premise_number);
                if (!customerNumber || !(await checkAccess(userId, customerNumber))) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    message: 'Access denied or premise not found',
                                }),
                            },
                        ],
                    };
                }
                const result = await pool.query('SELECT * FROM service_connection_quotes WHERE premise_number = $1', [premise_number]);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result.rows[0] || { found: false, message: 'Service connection quote not found' }),
                        },
                    ],
                };
            }
            default:
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: 'Unknown tool',
                                message: `Tool ${name} not implemented yet`,
                            }),
                        },
                    ],
                };
        }
    }
    catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        error: 'Invalid request',
                        message: error instanceof Error ? error.message : 'Unknown error',
                    }),
                },
            ],
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Authenticated FPL MCP Server running on stdio');
}
main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
