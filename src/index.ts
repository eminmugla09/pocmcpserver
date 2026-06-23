import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import pg from "pg";
import { verifyToken, getUserCustomerNumbers, hasCustomerAccess } from "./auth.js";
import { runMigration } from "../migrate-db.js";

const { Pool } = pg;

const getDatabaseUrl = () => {
  const rawUrl = process.env.DATABASE_URL ?? "";
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const sslMode = parsed.searchParams.get("sslmode");
    const usesLegacySslMode = sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca";
    if (usesLegacySslMode && !parsed.searchParams.has("uselibpqcompat")) {
      parsed.searchParams.set("uselibpqcompat", "true");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};

const databaseUrl = getDatabaseUrl();

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 30000,
});

const normalizeString = (value: unknown) => String(value ?? "").trim().toLowerCase();

const getCustomers = async () => {
  const result = await pool.query(
    'SELECT customer_number, business_partner_id, first_name, last_name, full_name, email, mobile_phone, preferred_contact_method, preferred_language, customer_since, account_standing_flag FROM customers'
  );
  return result.rows;
};

const matchesCustomerFilters = (
  customer: Record<string, unknown>,
  filters: { customer_number?: string; phone?: string; email?: string }
) => {
  const customerNumber = String(customer.customer_number ?? "");
  const mobilePhone = String(customer.mobile_phone ?? "");
  const email = normalizeString(customer.email);

  const matchesCustomerNumber = !filters.customer_number || filters.customer_number === customerNumber;
  const matchesPhone = !filters.phone || filters.phone === mobilePhone;
  const matchesEmail = !filters.email || normalizeString(filters.email) === email;

  return matchesCustomerNumber && matchesPhone && matchesEmail;
};

const findMatchingCustomers = async (filters: { customer_number?: string; phone?: string; email?: string }) => {
  const customers = await getCustomers();
  return customers.filter((customer: any) => matchesCustomerFilters(customer, filters));
};

const jsonContent = (payload: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(payload, null, 2)
    }
  ]
});

const findPremiseByAddress = async (address: string) => {
  // Handle null or undefined input
  if (!address) {
    return null;
  }

  // Normalize: lowercase, strip punctuation, abbreviate common street suffixes, collapse spaces
  const normalize = (s: string) => s.toLowerCase()
    .replace(/\bdrive\b/g, 'dr').replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave')
    .replace(/\boulevard\b/g, 'blvd').replace(/\broad\b/g, 'rd').replace(/\bcourt\b/g, 'ct')
    .replace(/\blane\b/g, 'ln').replace(/\bplace\b/g, 'pl').replace(/\bcircle\b/g, 'cir')
    .replace(/[.,#]/g, '').replace(/\s+/g, ' ').trim();
  const normalizedInput = normalize(address);

  // Extract just the street part (before first comma if present)
  const streetPart = normalize(normalizedInput.split(',')[0]);

  // Try full address match first, then street-only match
  const result = await pool.query(
    `SELECT * FROM premises WHERE 
     LOWER(regexp_replace(address_line1 || ' ' || address_city || ' ' || address_state || ' ' || address_zip, '[.,#]+', '', 'g')) LIKE $1
     OR LOWER(regexp_replace(address_line1, '[.,#]+', '', 'g')) LIKE $2
     ORDER BY 
       CASE WHEN LOWER(regexp_replace(address_line1, '[.,#]+', '', 'g')) LIKE $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [`%${normalizedInput}%`, `%${streetPart}%`]
  );
  return result.rows[0] || null;
};

const formatPremisePublicRecordSummary = (premise: any) =>
  `Public record: ${premise.county || "unknown"} county` +
  ` | Recorded: ${premise.recorded_date ? new Date(premise.recorded_date).toDateString() : "not available"}` +
  ` | Closing date: ${premise.closing_date ? new Date(premise.closing_date).toDateString() : "not available"}` +
  ` | Purchase date: ${premise.purchase_date ? new Date(premise.purchase_date).toDateString() : (premise.closing_date ? new Date(premise.closing_date).toDateString() : "not available")}` +
  ` | Sale price: ${premise.sale_price != null ? `$${premise.sale_price.toLocaleString()}` : "not available"}` +
  ` | Assessed value: ${premise.assessed_value != null ? `$${premise.assessed_value.toLocaleString()}` : "not available"}` +
  ` | Parcel ID: ${premise.parcel_id || "not available"}` +
  ` | Document: ${premise.document_number || "not available"}` +
  ` | Book/page: ${premise.book_page || "not available"}` +
  ` | Source: ${premise.property_record_source || "not available"}` +
  ` | Confidence: ${premise.property_record_confidence || "not available"}` +
  ` | Previous owner: ${premise.previous_owner || "not available"}`;

const findAccounts = async (input: {
  account_number?: string;
  customer_number?: string;
  phone?: string;
  email?: string;
  premise_number?: string;
  address?: string;
}) => {
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

  const shouldFilterByCustomer = Boolean(input.customer_number || input.phone || input.email);

  if (shouldFilterByCustomer && matchingCustomers.length === 0) {
    return [];
  }

  const matchingCustomerNumbers = new Set(
    matchingCustomers.map((customer: any) => customer.customer_number).filter(Boolean)
  );

  const query = `
    SELECT * FROM accounts 
    WHERE ($1::text = '' OR account_number = $1)
    AND ($2::boolean = false OR customer_number = ANY($3::text[]))
    AND ($4::text = '' OR premise_number = $4)
  `;
  
  const result = await pool.query(query, [
    input.account_number || '',
    shouldFilterByCustomer,
    Array.from(matchingCustomerNumbers),
    premiseNumber || ''
  ]);
  
  return result.rows;
};

// Tool handler functions for direct invocation
const getMyAccountOverviewHandler = async (userId: string, email: string) => {
  // Get all linked accounts via user_customers
  const ucResult = await pool.query(
    `SELECT uc.customer_number, uc.is_primary, a.account_number, a.premise_number, a.status, a.standing, a.rate_class, a.past_due_flag, a.smart_meter_flag, a.service_address_line1, a.service_address_city, a.service_address_state, a.service_address_zip
     FROM user_customers uc
     INNER JOIN accounts a ON a.customer_number = uc.customer_number
     WHERE uc.user_id = $1
     ORDER BY uc.is_primary DESC, a.account_number ASC`,
    [userId]
  );

  if (ucResult.rows.length === 0) {
    return { found: false, message: "No linked accounts found for this user." };
  }

  const primaryAccount = ucResult.rows[0];

  // Get customer profile (shared across all accounts for this user)
  const customerResult = await pool.query(
    'SELECT customer_number, first_name, last_name, full_name, email, mobile_phone, preferred_language FROM customers WHERE customer_number = $1',
    [primaryAccount.customer_number]
  );
  const customer = customerResult.rows[0] || {};

  // Fetch billing + EV enrollment for every account in parallel
  const accountsData = await Promise.all(
    ucResult.rows.map(async (acct: any) => {
      const [billingResult, evResult] = await Promise.all([
        pool.query('SELECT * FROM billing WHERE account_number = $1 ORDER BY bill_date DESC LIMIT 1', [acct.account_number]),
        pool.query('SELECT * FROM ev_enrollments WHERE account_number = $1', [acct.account_number])
      ]);

      const billing = billingResult.rows[0];
      let billingInfo: any = null;
      if (billing) {
        const chargesResult = await pool.query('SELECT * FROM bill_charges WHERE billing_id = $1', [billing.id]);
        billingInfo = {
          invoiceId: billing.invoice_id,
          billDate: billing.bill_date,
          dueDate: billing.due_date,
          amountDue: billing.amount_due,
          billingPeriod: `${billing.billing_period_start} to ${billing.billing_period_end}`,
          kwhUsed: billing.kwh_used,
          averageDailyKwh: billing.average_daily_kwh,
          averageDailyCostUsd: billing.average_daily_cost_usd,
          charges: chargesResult.rows,
          evChargingKwh: billing.ev_charging_kwh,
          evOffPeakKwh: billing.ev_off_peak_kwh,
          estimatedEvOffPeakSavingsUsd: billing.estimated_ev_off_peak_savings_usd
        };
      }

      return {
        isPrimary: Boolean(acct.is_primary),
        accountNumber: acct.account_number,
        premiseNumber: acct.premise_number,
        status: acct.status,
        standing: acct.standing,
        rateClass: acct.rate_class,
        pastDueFlag: acct.past_due_flag,
        smartMeterFlag: acct.smart_meter_flag,
        serviceAddress: `${acct.service_address_line1}, ${acct.service_address_city}, ${acct.service_address_state} ${acct.service_address_zip}`,
        billing: billingInfo,
        evEnrollment: evResult.rows[0] || null
      };
    })
  );

  return {
    found: true,
    customer: {
      customerNumber: primaryAccount.customer_number,
      fullName: customer.full_name,
      email: customer.email,
      mobilePhone: customer.mobile_phone
    },
    accounts: accountsData,
    // Keep top-level shortcuts pointing to primary for single-account users / backward compat
    account: accountsData[0],
    billing: accountsData[0]?.billing ?? null,
    allAccounts: ucResult.rows.map((r: any) => r.account_number)
  };
};

const getCustomerProfileHandler = async (args: any) => {
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

const lookupAccountHandler = async (input: any) => {
  const accounts = await findAccounts(input);
  const premiseNumbers = new Set(accounts.map((account: any) => account.premise_number).filter(Boolean));
  
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

const getAccountSummaryHandler = async ({ account_number }: any) => {
  const result = await pool.query('SELECT * FROM accounts WHERE account_number = $1', [account_number]);
  return result.rows[0] || { found: false };
};

const getPremiseDetailsHandler = async ({ premise_number, address }: any) => {
  let premise: any = null;

  if (premise_number) {
    const result = await pool.query('SELECT * FROM premises WHERE premise_number = $1', [premise_number]);
    premise = result.rows[0];
  } else if (address) {
    premise = await findPremiseByAddress(address);
  }

  return premise || { found: false };
};

const getBillingInquiryHandler = async ({ account_number }: any) => {
  const result = await pool.query(
    'SELECT * FROM billing WHERE account_number = $1 ORDER BY bill_date DESC LIMIT 1',
    [account_number]
  );
  const billing = result.rows[0];
  if (!billing) return { found: false };
  
  // Get charges for this bill
  const chargesResult = await pool.query(
    'SELECT * FROM bill_charges WHERE billing_id = $1',
    [billing.id]
  );
  
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

const getPaymentHistoryHandler = async ({ account_number }: any) => {
  const paymentsResult = await pool.query(
    'SELECT * FROM payment_history WHERE account_number = $1 ORDER BY payment_date DESC',
    [account_number]
  );
  const billingResult = await pool.query(
    'SELECT autopay_enrolled, next_scheduled_payment_date, next_scheduled_payment_amount_usd FROM billing WHERE account_number = $1',
    [account_number]
  );
  const billing = billingResult.rows[0];
  
  return {
    payments: paymentsResult.rows,
    autopayEnrolled: billing?.autopay_enrolled || false,
    nextScheduledPaymentDate: billing?.next_scheduled_payment_date,
    nextScheduledPaymentAmountUsd: billing?.next_scheduled_payment_amount_usd
  };
};

const getUsageHistoryHandler = async ({ account_number }: any) => {
  const result = await pool.query(
    'SELECT * FROM usage_history WHERE account_number = $1 ORDER BY month DESC',
    [account_number]
  );
  return result.rows;
};

const getEvEnrollmentHandler = async ({ account_number }: any) => {
  const result = await pool.query(
    'SELECT * FROM ev_enrollments WHERE account_number = $1',
    [account_number]
  );
  const enrollment = result.rows[0];
  if (!enrollment) {
    return { enrolled: false };
  }

  const accountResult = await pool.query(
    'SELECT customer_number FROM accounts WHERE account_number = $1',
    [account_number]
  );
  const customerNumber = accountResult.rows[0]?.customer_number;

  let registeredVehicles: any[] = [];
  if (customerNumber) {
    const vehiclesResult = await pool.query(
      `SELECT vehicle_id, make, model, year, connector_type, premise_number, registered_date
       FROM registered_vehicles
       WHERE customer_number = $1
       ORDER BY registered_date DESC`,
      [customerNumber]
    );
    registeredVehicles = vehiclesResult.rows;
  }

  return {
    ...enrollment,
    enrolled: true,
    customerNumber: customerNumber || null,
    registeredVehicles
  };
};

const checkEvEligibilityHandler = async ({ premise_number }: any) => {
  const result = await pool.query(
    'SELECT * FROM ev_eligibility WHERE premise_number = $1',
    [premise_number]
  );
  const eligibility = result.rows[0] || { eligible: false, found: false };

  const premiseResult = await pool.query(
    'SELECT service_status FROM premises WHERE premise_number = $1',
    [premise_number]
  );
  const premise = premiseResult.rows[0];
  const serviceStatus = premise?.service_status || "unknown";
  const serviceActive = !/inactive|pending|awaiting/i.test(serviceStatus);

  const recommendedInstallType = (eligibility.recommended_install_type || "").toLowerCase().includes("equipment") ? "equipment_only" : "full";
  const nextAction = serviceActive
    ? `Call enroll_ev_charging with premise_number="${premise_number}" and install_type="${recommendedInstallType}".`
    : `Call schedule_move_in_service with premise_number="${premise_number}" and requested_connect_date="[closing/move-in date]" to schedule power service, then call enroll_ev_charging after activation.`;

  return {
    ...eligibility,
    serviceStatus,
    serviceActive,
    nextAction,
    instructions: eligibility.notes || nextAction
  };
};

const matchPropertyToCustomerHandler = async ({ address }: any) => {
  const premise = await findPremiseByAddress(address);

  if (!premise) {
    return { matched: false, event: "NO_MATCH" };
  }

  const activeAccountResult = premise.active_account_number
    ? await pool.query(
        `SELECT a.account_number, a.customer_number, c.full_name
         FROM accounts a
         INNER JOIN customers c ON c.customer_number = a.customer_number
         WHERE a.account_number = $1`,
        [premise.active_account_number]
      )
    : { rows: [] };

  const ownerMatchResult = activeAccountResult.rows.length > 0
    ? activeAccountResult
    : await pool.query(
        `SELECT NULL::text AS account_number, customer_number, full_name
         FROM customers
         WHERE $1 ILIKE '%' || full_name || '%'
         ORDER BY customer_since ASC
         LIMIT 1`,
        [premise.new_owner_on_record || ""]
      );

  const matchedCustomer = ownerMatchResult.rows[0] || null;
  const existingServicesResult = matchedCustomer?.customer_number
    ? await pool.query(
        `SELECT a.account_number, a.premise_number, a.status, a.service_address_line1,
                a.service_address_city, a.service_address_state, a.service_address_zip,
                COALESCE(json_agg(DISTINCT ap.program_name) FILTER (WHERE ap.program_name IS NOT NULL), '[]') AS programs
         FROM accounts a
         LEFT JOIN account_programs ap ON ap.account_number = a.account_number
         WHERE a.customer_number = $1
         GROUP BY a.account_number
         ORDER BY a.account_number`,
        [matchedCustomer.customer_number]
      )
    : { rows: [] };

  const registeredVehiclesResult = matchedCustomer?.customer_number
    ? await pool.query(
        `SELECT vehicle_id, make, model, year, connector_type, premise_number
         FROM registered_vehicles
         WHERE customer_number = $1
         ORDER BY registered_date DESC`,
        [matchedCustomer.customer_number]
      )
    : { rows: [] };

  return {
    matched: Boolean(matchedCustomer),
    matchedCustomer: matchedCustomer?.customer_number || null,
    matchedCustomerName: matchedCustomer?.full_name || null,
    premiseNumber: premise.premise_number,
    event: matchedCustomer ? "CUSTOMER_LINKED_TO_PREMISE" : "PREMISE_FOUND_NO_CUSTOMER_MATCH",
    serviceStatus: premise.service_status,
    newOwnerOnRecord: premise.new_owner_on_record || null,
    publicRecordSummary: formatPremisePublicRecordSummary(premise),
    publicRecord: {
      recordedDate: premise.recorded_date,
      closingDate: premise.closing_date,
      purchaseDate: premise.purchase_date || premise.closing_date,
      salePrice: premise.sale_price,
      assessedValue: premise.assessed_value,
      county: premise.county,
      parcelId: premise.parcel_id,
      legalDescription: premise.legal_description,
      documentNumber: premise.document_number,
      bookPage: premise.book_page,
      source: premise.property_record_source,
      confidence: premise.property_record_confidence,
      previousOwner: premise.previous_owner
    },
    existingServices: existingServicesResult.rows,
    registeredVehicles: registeredVehiclesResult.rows
  };
};

const getServiceConnectionQuoteHandler = async ({ premise_number }: any) => {
  const result = await pool.query(
    'SELECT * FROM service_connection_quotes WHERE premise_number = $1',
    [premise_number]
  );
  return result.rows[0] || { found: false };
};

const startServiceConnectionHandler = async (input: any) => {
  // Idempotency check — return existing SUBMITTED order if one already exists for this premise
  const existing = await pool.query(
    `SELECT * FROM service_connection_orders WHERE premise_number = $1 AND status = 'SUBMITTED' ORDER BY created_at DESC LIMIT 1`,
    [input.premise_number]
  );
  if (existing.rows.length > 0) {
    const order = existing.rows[0];
    const quote = await getServiceConnectionQuoteHandler({ premise_number: input.premise_number });
    return {
      status: order.status,
      serviceOrderId: order.service_order_id,
      premiseNumber: order.premise_number,
      accountNumber: order.account_number,
      serviceAddress: quote.address || null,
      requestedConnectDate: order.requested_connect_date,
      scheduledConnectDate: order.scheduled_connect_date,
      connectionFeeUsd: quote.connection_fee_usd ?? null,
      rateClass: quote.rate_class || null,
      message: `ALREADY SUBMITTED — do NOT call start_service_connection again. Service order ${order.service_order_id} is already active for this premise. The premise service_status will update when power is connected. Next step: wait for activation, then call enroll_ev_charging.`,
      createdAt: order.created_at,
      duplicate: true
    };
  }

  const quote = await getServiceConnectionQuoteHandler({ premise_number: input.premise_number });
  // Use today's date if the quote dates are in the past
  const today = new Date().toISOString().split('T')[0];
  const quoteDate = quote.earliest_connect_date
    ? new Date(quote.earliest_connect_date).toISOString().split('T')[0]
    : null;
  const scheduledConnectDate = input.requested_connect_date
    || (quoteDate && quoteDate >= today ? quoteDate : today);

  let depositSummary = "Deposit status was not available for this premise.";
  if (quote.found !== false && quote.deposit_required) {
    depositSummary = `Deposit may be required: ${quote.deposit_reason || "reason not specified"}.`;
  }
  if (quote.found !== false && !quote.deposit_required) {
    const depositReason = quote.deposit_reason ? `: ${quote.deposit_reason}` : "";
    depositSummary = `No deposit required${depositReason}.`;
  }

  const serviceOrderId = makeId("SO");
  const message = `New residential power connection submitted for the resolved premise. ${depositSummary}`;
  const result = await pool.query(
    `INSERT INTO service_connection_orders
      (service_order_id, premise_number, account_number, requested_connect_date, scheduled_connect_date, status, message)
     VALUES ($1, $2, $3, $4, $5, 'SUBMITTED', $6)
     RETURNING service_order_id, premise_number, account_number, requested_connect_date, scheduled_connect_date, status, message, created_at`,
    [
      serviceOrderId,
      input.premise_number,
      input.account_number || null,
      input.requested_connect_date || null,
      scheduledConnectDate,
      message
    ]
  );

  const order = result.rows[0];

  return {
    status: order.status,
    serviceOrderId: order.service_order_id,
    premiseNumber: order.premise_number,
    accountNumber: order.account_number,
    serviceAddress: quote.address || null,
    requestedConnectDate: order.requested_connect_date,
    scheduledConnectDate: order.scheduled_connect_date,
    connectionFeeUsd: quote.connection_fee_usd ?? null,
    rateClass: quote.rate_class || null,
    message: `${order.message} Service order ${order.service_order_id} is now SUBMITTED. Do NOT call start_service_connection again for this premise. Power is scheduled to be connected on ${order.scheduled_connect_date}. After service is active, call enroll_ev_charging with premise_number="${order.premise_number}" and install_type="full".`,
    createdAt: order.created_at
  };
};

const scheduleMoveInServiceHandler = async (input: any) => {
  if (!input.requested_connect_date) {
    return {
      status: "SCHEDULING_FAILED",
      serviceOrderId: null,
      premiseNumber: input.premise_number,
      accountNumber: input.account_number || null,
      requestedConnectDate: null,
      scheduledConnectDate: null,
      message: "requested_connect_date is required to schedule move-in service. Please provide the customer's closing or move-in date.",
      createdAt: new Date().toISOString()
    };
  }

  return startServiceConnectionHandler(input);
};

const enrollEvChargingHandler = async (input: any) => {
  const eligibility = await checkEvEligibilityHandler({ premise_number: input.premise_number });

  if (!eligibility.eligible) {
    return {
      status: "NOT_ELIGIBLE",
      enrollmentId: null,
      premiseNumber: input.premise_number,
      accountNumber: input.account_number || null,
      installType: input.install_type,
      monthlyCharge: null,
      eligibilityFound: eligibility.found !== false,
      recommendedInstallType: eligibility.recommended_install_type || null,
      nextStep: "No enrollment created.",
      estimatedCompletion: "N/A",
      message: `This premise is not eligible for FPL EVolution Home enrollment. No enrollment order was created.`,
      instructions: eligibility.notes || "Check eligibility details above."
    };
  }

  if (!eligibility.serviceActive) {
    return {
      status: "PENDING_SERVICE_ACTIVATION",
      enrollmentId: null,
      premiseNumber: input.premise_number,
      accountNumber: input.account_number || null,
      installType: input.install_type,
      monthlyCharge: null,
      eligibilityFound: eligibility.found !== false,
      recommendedInstallType: eligibility.recommended_install_type || null,
      nextStep: "Start electric service first.",
      estimatedCompletion: "After power service is activated.",
      message: `EV enrollment cannot be completed because power service is not active at this premise. Call schedule_move_in_service with premise_number="${input.premise_number}" and requested_connect_date="[closing/move-in date]" first, then call enroll_ev_charging again after activation.`,
      instructions: eligibility.notes || `Call schedule_move_in_service with premise_number="${input.premise_number}" and requested_connect_date="[closing/move-in date]" first.`
    };
  }

  const monthlyCharge = input.install_type === "full" ? 36 : 27;
  const installType = input.install_type === "full" ? "Full installation" : "Equipment-only";
  const readinessNote = eligibility.notes
    ? ` Eligibility note: ${eligibility.notes}`
    : "";

  const enrollmentId = makeId("EVH");
  const nextStep = input.install_type === "full"
    ? "Electrical assessment and garage readiness review."
    : "Equipment-only enrollment review.";
  const estimatedCompletion = input.install_type === "full"
    ? "Estimated after electrical assessment and permitting."
    : "Estimated after equipment review and scheduling.";
  const message = `Started FPL EVolution Home enrollment for the resolved premise using ${installType.toLowerCase()} at $${monthlyCharge}/month.${readinessNote}`;
  const result = await pool.query(
    `INSERT INTO ev_enrollment_orders
      (enrollment_id, premise_number, account_number, install_type, monthly_charge, next_step, estimated_completion, status, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ENROLLMENT_STARTED', $8)
     RETURNING enrollment_id, premise_number, account_number, install_type, monthly_charge, next_step, estimated_completion, status, message, created_at`,
    [
      enrollmentId,
      input.premise_number,
      input.account_number || null,
      input.install_type,
      monthlyCharge,
      nextStep,
      estimatedCompletion,
      message
    ]
  );

  const order = result.rows[0];

  return {
    status: order.status,
    enrollmentId: order.enrollment_id,
    premiseNumber: order.premise_number,
    accountNumber: order.account_number,
    installType: order.install_type,
    monthlyCharge: order.monthly_charge,
    eligibilityFound: eligibility.found !== false,
    recommendedInstallType: eligibility.recommended_install_type || null,
    nextStep: order.next_step,
    estimatedCompletion: order.estimated_completion,
    message: order.message,
    createdAt: order.created_at
  };
};

const setMoveIntentHandler = async (input: any) => {
  const message = input.intent === "keep_both"
    ? "Noted that you intend to keep your existing service active while starting service at the new premise. No move-out order was created."
    : "Noted that you intend to move out of an existing premise. No stop-service order is created until the existing premise and stop date are explicitly confirmed.";
  const result = await pool.query(
    `INSERT INTO move_intents (customer_number, intent, message)
     VALUES ($1, $2, $3)
     RETURNING customer_number, intent, message, created_at`,
    [input.customer_number, input.intent, message]
  );
  const moveIntent = result.rows[0];

  return {
    status: "RECORDED",
    customerNumber: moveIntent.customer_number,
    intent: moveIntent.intent,
    message: moveIntent.message,
    createdAt: moveIntent.created_at
  };
};

const makeVehicleId = () => `EVREG-${Math.floor(1000 + Math.random() * 9000)}`;

const registerVehicleHandler = async (input: any) => {
  const { customer_number, linked_premise, make, model, year, connector_type, vehicle_id } = input;
  const finalVehicleId = vehicle_id || makeVehicleId();

  const result = await pool.query(
    `INSERT INTO registered_vehicles
      (vehicle_id, customer_number, premise_number, make, model, year, connector_type, registered_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE)
     RETURNING vehicle_id, customer_number, premise_number, make, model, year, connector_type, registered_date`,
    [
      finalVehicleId,
      customer_number,
      linked_premise || null,
      make,
      model,
      year,
      connector_type
    ]
  );

  return {
    status: "REGISTERED",
    message: "Vehicle registered successfully.",
    vehicle: result.rows[0]
  };
};

const updateRegisteredVehicleHandler = async (input: any) => {
  const { vehicle_id, linked_premise, make, model, year, connector_type } = input;

  const updates: string[] = [];
  const values: any[] = [];

  if (linked_premise !== undefined) {
    updates.push(`premise_number = $${updates.length + 1}`);
    values.push(linked_premise || null);
  }
  if (make !== undefined) {
    updates.push(`make = $${updates.length + 1}`);
    values.push(make);
  }
  if (model !== undefined) {
    updates.push(`model = $${updates.length + 1}`);
    values.push(model);
  }
  if (year !== undefined) {
    updates.push(`year = $${updates.length + 1}`);
    values.push(year);
  }
  if (connector_type !== undefined) {
    updates.push(`connector_type = $${updates.length + 1}`);
    values.push(connector_type);
  }

  if (updates.length === 0) {
    return { status: "NO_CHANGES", message: "No update fields were provided." };
  }

  values.push(vehicle_id);
  const result = await pool.query(
    `UPDATE registered_vehicles
     SET ${updates.join(", ")}
     WHERE vehicle_id = $${updates.length + 1}
     RETURNING vehicle_id, customer_number, premise_number, make, model, year, connector_type, registered_date`,
    values
  );

  if (result.rows.length === 0) {
    return { status: "NOT_FOUND", message: "Vehicle not found." };
  }

  return {
    status: "UPDATED",
    message: "Vehicle updated successfully.",
    vehicle: result.rows[0]
  };
};

const removeRegisteredVehicleHandler = async ({ vehicle_id }: any) => {
  const result = await pool.query(
    `DELETE FROM registered_vehicles
     WHERE vehicle_id = $1
     RETURNING vehicle_id, customer_number, premise_number, make, model, year, connector_type, registered_date`,
    [vehicle_id]
  );

  if (result.rows.length === 0) {
    return { status: "NOT_FOUND", message: "Vehicle not found." };
  }

  return {
    status: "REMOVED",
    message: "Vehicle removed successfully.",
    vehicle: result.rows[0]
  };
};

const makeId = (prefix: string) => `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;

const ensurePersistenceTables = async () => {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_connection_orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      service_order_id VARCHAR(50) UNIQUE NOT NULL,
      premise_number VARCHAR(20) NOT NULL,
      account_number VARCHAR(20),
      requested_connect_date DATE,
      scheduled_connect_date DATE,
      status VARCHAR(50),
      message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ev_enrollment_orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      enrollment_id VARCHAR(50) UNIQUE NOT NULL,
      premise_number VARCHAR(20) NOT NULL,
      account_number VARCHAR(20),
      install_type VARCHAR(50),
      monthly_charge DECIMAL(10, 2),
      next_step TEXT,
      estimated_completion TEXT,
      status VARCHAR(50),
      message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS move_intents (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      customer_number VARCHAR(20) NOT NULL,
      intent VARCHAR(50) NOT NULL,
      message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_orders (
      service_order_id TEXT PRIMARY KEY,
      account_number TEXT,
      order_type TEXT NOT NULL,
      from_premise TEXT,
      to_premise TEXT,
      effective_date DATE,
      status TEXT NOT NULL,
      cancel_reason TEXT,
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      account_number TEXT PRIMARY KEY,
      method_type TEXT NOT NULL,
      last4 TEXT,
      label TEXT,
      metadata JSONB,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_notification_preferences (
      customer_number TEXT PRIMARY KEY,
      billing_channel TEXT NOT NULL,
      outage_channel TEXT NOT NULL,
      marketing_opt_in BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS authorized_users (
      id BIGSERIAL PRIMARY KEY,
      account_number TEXT NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_number, user_email)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_cases (
      case_id TEXT PRIMARY KEY,
      account_number TEXT NOT NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS verification_sessions (
      session_id TEXT PRIMARY KEY,
      customer_number TEXT NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      challenge_code_hint TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      account_number TEXT,
      customer_number TEXT,
      details JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT,
      code_challenge_method TEXT,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS client_id TEXT`);
  await pool.query(`ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS code_challenge TEXT`);
  await pool.query(`ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS code_challenge_method TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      refresh_token TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      revoked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS client_id TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT,
      client_name TEXT,
      redirect_uris JSONB NOT NULL,
      grant_types JSONB NOT NULL,
      response_types JSONB NOT NULL,
      token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

const addAudit = async (action: string, details: Record<string, unknown>) => {
  const accountNumber = typeof details.account_number === "string"
    ? details.account_number
    : (typeof details.accountNumber === "string" ? details.accountNumber : null);
  const customerNumber = typeof details.customer_number === "string"
    ? details.customer_number
    : (typeof details.customerNumber === "string" ? details.customerNumber : null);

  await pool.query(
    `INSERT INTO audit_log (id, action, account_number, customer_number, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      makeId("AUD"),
      action,
      accountNumber,
      customerNumber,
      JSON.stringify(details)
    ]
  );
};

const setAutopayHandler = async ({ account_number, payment_method }: any) => {
  const latestBillResult = await pool.query(
    `SELECT due_date, amount_due FROM billing
     WHERE account_number = $1
     ORDER BY bill_date DESC
     LIMIT 1`,
    [account_number]
  );
  const latestBill = latestBillResult.rows[0];

  const updateResult = await pool.query(
    `UPDATE billing
     SET autopay_enrolled = TRUE,
         next_scheduled_payment_date = $2,
         next_scheduled_payment_amount_usd = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE account_number = $1
     RETURNING account_number`,
    [account_number, latestBill?.due_date || null, latestBill?.amount_due || null]
  );

  if (updateResult.rowCount === 0) {
    return {
      status: "NOT_FOUND",
      accountNumber: account_number,
      message: "Billing record not found for account."
    };
  }

  if (payment_method) {
    await pool.query(
      `INSERT INTO payment_methods (account_number, method_type, metadata, updated_at)
       VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (account_number)
       DO UPDATE SET method_type = EXCLUDED.method_type,
                     metadata = EXCLUDED.metadata,
                     updated_at = CURRENT_TIMESTAMP`,
      [account_number, String(payment_method.methodType || payment_method.method_type || "unknown"), JSON.stringify(payment_method)]
    );
  }

  await addAudit("set_autopay", { account_number });
  return {
    status: "AUTOPAY_ENABLED",
    accountNumber: account_number,
    nextScheduledPaymentDate: latestBill?.due_date || null,
    nextScheduledPaymentAmountUsd: latestBill?.amount_due || null
  };
};

const cancelAutopayHandler = async ({ account_number }: any) => {
  const updateResult = await pool.query(
    `UPDATE billing
     SET autopay_enrolled = FALSE,
         next_scheduled_payment_date = NULL,
         next_scheduled_payment_amount_usd = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE account_number = $1
     RETURNING account_number`,
    [account_number]
  );

  if (updateResult.rowCount === 0) {
    return {
      status: "NOT_FOUND",
      accountNumber: account_number,
      message: "Billing record not found for account."
    };
  }

  await addAudit("cancel_autopay", { account_number });
  return {
    status: "AUTOPAY_DISABLED",
    accountNumber: account_number
  };
};

const updatePaymentMethodHandler = async ({ account_number, method_type, last4, label }: any) => {
  await pool.query(
    `INSERT INTO payment_methods (account_number, method_type, last4, label, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (account_number)
     DO UPDATE SET method_type = EXCLUDED.method_type,
                   last4 = EXCLUDED.last4,
                   label = EXCLUDED.label,
                   metadata = EXCLUDED.metadata,
                   updated_at = CURRENT_TIMESTAMP`,
    [
      account_number,
      method_type,
      last4 || null,
      label || null,
      JSON.stringify({ methodType: method_type, last4: last4 || null, label: label || null })
    ]
  );

  await addAudit("update_payment_method", { account_number, method_type });

  const paymentMethod = {
    methodType: method_type,
    last4: last4 || null,
    label: label || null,
    updatedAt: new Date().toISOString()
  };

  return {
    status: "PAYMENT_METHOD_UPDATED",
    accountNumber: account_number,
    paymentMethod
  };
};

const requestPaymentExtensionHandler = async ({ account_number, requested_due_date, reason }: any) => {
  const updateResult = await pool.query(
    `UPDATE billing
     SET due_date = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id FROM billing
       WHERE account_number = $1
       ORDER BY bill_date DESC
       LIMIT 1
     )
     RETURNING account_number`,
    [account_number, requested_due_date]
  );

  if (updateResult.rowCount === 0) {
    return {
      status: "NOT_FOUND",
      accountNumber: account_number,
      message: "Billing record not found for account."
    };
  }

  await addAudit("request_payment_extension", { account_number, requested_due_date, reason: reason || null });

  return {
    status: "APPROVED",
    accountNumber: account_number,
    extendedDueDate: requested_due_date,
    message: "Payment extension request approved for this bill cycle."
  };
};

const getDisconnectionRiskHandler = async ({ account_number }: any) => {
  const accountResult = await pool.query('SELECT past_due_flag FROM accounts WHERE account_number = $1', [account_number]);
  const billResult = await pool.query(
    `SELECT due_date, amount_due, payment_status
     FROM billing
     WHERE account_number = $1
     ORDER BY bill_date DESC
     LIMIT 1`,
    [account_number]
  );

  const account = accountResult.rows[0];
  const bill = billResult.rows[0];
  const isPastDue = Boolean(account?.past_due_flag);
  const riskLevel = isPastDue ? "MEDIUM" : "LOW";

  return {
    accountNumber: account_number,
    riskLevel,
    pastDueFlag: isPastDue,
    dueDate: bill?.due_date || null,
    amountDue: bill?.amount_due || null,
    paymentStatus: bill?.payment_status || "Current",
    recommendation: isPastDue ? "Pay or request extension to avoid service interruption." : "No disconnection risk detected."
  };
};

const startStopTransferServiceHandler = async ({ action, account_number, from_premise, to_premise, effective_date }: any) => {
  const serviceOrderId = makeId("SO");
  await pool.query(
    `INSERT INTO service_orders
      (service_order_id, account_number, order_type, from_premise, to_premise, effective_date, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED', '{}'::jsonb)`,
    [serviceOrderId, account_number, action, from_premise || null, to_premise || null, effective_date || null]
  );
  await addAudit("start_stop_transfer_service", { account_number, action, serviceOrderId });

  const order = {
    serviceOrderId,
    accountNumber: account_number,
    type: action,
    fromPremise: from_premise || null,
    toPremise: to_premise || null,
    effectiveDate: effective_date || null,
    status: "SCHEDULED"
  };
  return order;
};

const scheduleReconnectHandler = async ({ account_number, reconnect_date }: any) => {
  const serviceOrderId = makeId("SO");
  await pool.query(
    `INSERT INTO service_orders
      (service_order_id, account_number, order_type, effective_date, status, metadata)
     VALUES ($1, $2, 'reconnect', $3, 'SCHEDULED', '{}'::jsonb)`,
    [serviceOrderId, account_number, reconnect_date]
  );
  await addAudit("schedule_reconnect", { account_number, reconnect_date, serviceOrderId });

  const order = {
    serviceOrderId,
    accountNumber: account_number,
    type: "reconnect",
    effectiveDate: reconnect_date,
    status: "SCHEDULED"
  };
  return order;
};

const updateServiceStartDateHandler = async ({ service_order_id, new_start_date }: any) => {
  const result = await pool.query(
    `UPDATE service_orders
     SET effective_date = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE service_order_id = $1
     RETURNING *`,
    [service_order_id, new_start_date]
  );

  if (result.rows.length === 0) {
    return { status: "NOT_FOUND", message: "Service order not found." };
  }

  await addAudit("update_service_start_date", { service_order_id, new_start_date });
  const row = result.rows[0];
  return {
    status: "UPDATED",
    order: {
      serviceOrderId: row.service_order_id,
      accountNumber: row.account_number,
      type: row.order_type,
      fromPremise: row.from_premise,
      toPremise: row.to_premise,
      effectiveDate: row.effective_date,
      status: row.status,
      cancelReason: row.cancel_reason
    }
  };
};

const getServiceOrdersHandler = async ({ account_number }: any) => {
  const result = account_number
    ? await pool.query('SELECT * FROM service_orders WHERE account_number = $1 ORDER BY created_at DESC', [account_number])
    : await pool.query('SELECT * FROM service_orders ORDER BY created_at DESC');

  return result.rows.map((row: any) => ({
    serviceOrderId: row.service_order_id,
    accountNumber: row.account_number,
    type: row.order_type,
    fromPremise: row.from_premise,
    toPremise: row.to_premise,
    effectiveDate: row.effective_date,
    status: row.status,
    cancelReason: row.cancel_reason,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
};

const cancelServiceOrderHandler = async ({ service_order_id, reason }: any) => {
  const result = await pool.query(
    `UPDATE service_orders
     SET status = 'CANCELLED',
         cancel_reason = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE service_order_id = $1
     RETURNING *`,
    [service_order_id, reason || null]
  );

  if (result.rows.length === 0) {
    return { status: "NOT_FOUND", message: "Service order not found." };
  }

  await addAudit("cancel_service_order", { service_order_id });
  const row = result.rows[0];
  return {
    status: "CANCELLED",
    order: {
      serviceOrderId: row.service_order_id,
      accountNumber: row.account_number,
      type: row.order_type,
      fromPremise: row.from_premise,
      toPremise: row.to_premise,
      effectiveDate: row.effective_date,
      status: row.status,
      cancelReason: row.cancel_reason
    }
  };
};

const getEvChargingSessionsHandler = async ({ account_number, months }: any) => {
  const maxMonths = Math.min(Math.max(Number(months || 3), 1), 12);
  const usageResult = await pool.query(
    `SELECT month, ev_charging_kwh
     FROM usage_history
     WHERE account_number = $1
     ORDER BY month DESC
     LIMIT $2`,
    [account_number, maxMonths]
  );

  return usageResult.rows.map((row: any) => ({
    month: row.month,
    totalKwh: row.ev_charging_kwh || 0,
    sessions: Math.max(1, Math.round((row.ev_charging_kwh || 0) / 30)),
    averageSessionKwh: row.ev_charging_kwh ? Number((row.ev_charging_kwh / Math.max(1, Math.round(row.ev_charging_kwh / 30))).toFixed(2)) : 0
  }));
};

const updateEvEnrollmentPlanHandler = async ({ account_number, install_type }: any) => {
  const isFull = install_type === "full";
  const monthlyCharge = isFull ? 36 : 27;

  const result = await pool.query(
    `UPDATE ev_enrollments
     SET is_full_installation = $2,
         is_equipment_only = $3,
         monthly_charge = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE account_number = $1
     RETURNING *`,
    [account_number, isFull, !isFull, monthlyCharge]
  );

  await addAudit("update_ev_enrollment_plan", { account_number, install_type });
  return {
    status: result.rows.length > 0 ? "UPDATED" : "NOT_FOUND",
    enrollment: result.rows[0] || null
  };
};

const pauseEvEnrollmentHandler = async ({ account_number, reason }: any) => {
  const result = await pool.query(
    `UPDATE ev_enrollments
     SET status = 'Paused',
         updated_at = CURRENT_TIMESTAMP
     WHERE account_number = $1
     RETURNING *`,
    [account_number]
  );
  await addAudit("pause_ev_enrollment", { account_number, reason: reason || null });
  return { status: result.rows.length > 0 ? "PAUSED" : "NOT_FOUND", enrollment: result.rows[0] || null };
};

const cancelEvEnrollmentHandler = async ({ account_number, reason }: any) => {
  const result = await pool.query(
    `UPDATE ev_enrollments
     SET status = 'Cancelled',
         updated_at = CURRENT_TIMESTAMP
     WHERE account_number = $1
     RETURNING *`,
    [account_number]
  );
  await addAudit("cancel_ev_enrollment", { account_number, reason: reason || null });
  return { status: result.rows.length > 0 ? "CANCELLED" : "NOT_FOUND", enrollment: result.rows[0] || null };
};

const scheduleEvAssessmentHandler = async ({ premise_number, preferred_date }: any) => {
  const premiseResult = await pool.query(
    'SELECT service_status FROM premises WHERE premise_number = $1',
    [premise_number]
  );
  const premise = premiseResult.rows[0];
  const serviceStatus = premise?.service_status || "unknown";
  const serviceActive = !/inactive|pending|awaiting/i.test(serviceStatus);

  if (!serviceActive) {
    return {
      status: "PENDING_SERVICE_ACTIVATION",
      assessmentId: null,
      premiseNumber: premise_number,
      preferredDate: preferred_date || null,
      message: `EV assessment cannot be scheduled because power service is not active at this premise. Schedule electric service first with schedule_move_in_service(premise_number="${premise_number}", requested_connect_date="[closing/move-in date]"). After power is active, schedule the EV assessment.`,
      instructions: `Call schedule_move_in_service with premise_number="${premise_number}" and requested_connect_date="[closing/move-in date]" first.`
    };
  }

  const assessmentId = makeId("EVA");
  await pool.query(
    `INSERT INTO service_orders
      (service_order_id, account_number, order_type, effective_date, status, metadata)
     VALUES ($1, NULL, 'ev_assessment', $2, 'SCHEDULED', $3::jsonb)`,
    [assessmentId, preferred_date || null, JSON.stringify({ premiseNumber: premise_number })]
  );
  await addAudit("schedule_ev_assessment", { premise_number, assessmentId });

  const assessment = {
    assessmentId,
    premiseNumber: premise_number,
    preferredDate: preferred_date || null,
    status: "SCHEDULED"
  };
  return assessment;
};

const uploadGarageRequirementsStatusHandler = async ({ premise_number, photos_uploaded, wifi_ready, circuit_240v_ready, notes }: any) => {
  const result = await pool.query(
    `UPDATE premises
     SET strong_wifi_at_charging_location = COALESCE($2, strong_wifi_at_charging_location),
         existing_240v_circuit_in_garage = COALESCE($3, existing_240v_circuit_in_garage),
         updated_at = CURRENT_TIMESTAMP
     WHERE premise_number = $1
     RETURNING *`,
    [premise_number, wifi_ready, circuit_240v_ready]
  );

  await addAudit("upload_garage_requirements_status", { premise_number, photos_uploaded: Boolean(photos_uploaded), notes: notes || null });
  return {
    status: result.rows.length > 0 ? "RECORDED" : "NOT_FOUND",
    premise: result.rows[0] || null,
    photosUploaded: Boolean(photos_uploaded),
    notes: notes || null
  };
};

const updateContactInfoHandler = async ({ customer_number, email, mobile_phone }: any) => {
  const result = await pool.query(
    `UPDATE customers
     SET email = COALESCE($2, email),
         mobile_phone = COALESCE($3, mobile_phone),
         updated_at = CURRENT_TIMESTAMP
     WHERE customer_number = $1
     RETURNING *`,
    [customer_number, email || null, mobile_phone || null]
  );
  await addAudit("update_contact_info", { customer_number });
  return { status: result.rows.length > 0 ? "UPDATED" : "NOT_FOUND", customer: result.rows[0] || null };
};

const updateNotificationPreferencesHandler = async ({ customer_number, billing_channel, outage_channel, marketing_opt_in }: any) => {
  const preferences = {
    customerNumber: customer_number,
    billingChannel: billing_channel || "email",
    outageChannel: outage_channel || "sms",
    marketingOptIn: Boolean(marketing_opt_in),
    updatedAt: new Date().toISOString()
  };

  await pool.query(
    `INSERT INTO customer_notification_preferences
      (customer_number, billing_channel, outage_channel, marketing_opt_in, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (customer_number)
     DO UPDATE SET billing_channel = EXCLUDED.billing_channel,
                   outage_channel = EXCLUDED.outage_channel,
                   marketing_opt_in = EXCLUDED.marketing_opt_in,
                   updated_at = CURRENT_TIMESTAMP`,
    [customer_number, preferences.billingChannel, preferences.outageChannel, preferences.marketingOptIn]
  );

  await addAudit("update_notification_preferences", { customer_number });
  return { status: "UPDATED", preferences };
};

const setPreferredLanguageHandler = async ({ customer_number, preferred_language }: any) => {
  const result = await pool.query(
    `UPDATE customers
     SET preferred_language = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE customer_number = $1
     RETURNING customer_number, preferred_language`,
    [customer_number, preferred_language]
  );
  await addAudit("set_preferred_language", { customer_number, preferred_language });
  return { status: result.rows.length > 0 ? "UPDATED" : "NOT_FOUND", customer: result.rows[0] || null };
};

const manageAuthorizedUsersHandler = async ({ account_number, operation, user_email, role }: any) => {
  if (operation === "list") {
    const result = await pool.query(
      `SELECT user_email AS email, role, created_at AS "addedAt"
       FROM authorized_users
       WHERE account_number = $1
       ORDER BY created_at DESC`,
      [account_number]
    );
    return { accountNumber: account_number, authorizedUsers: result.rows };
  }

  if (operation === "add" && user_email) {
    await pool.query(
      `INSERT INTO authorized_users (account_number, user_email, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_number, user_email)
       DO UPDATE SET role = EXCLUDED.role`,
      [account_number, user_email, role || "viewer"]
    );
  }

  if (operation === "remove" && user_email) {
    await pool.query(
      `DELETE FROM authorized_users
       WHERE account_number = $1 AND user_email = $2`,
      [account_number, user_email]
    );
  }

  await addAudit("manage_authorized_users", { account_number, operation, user_email: user_email || null });

  const result = await pool.query(
    `SELECT user_email AS email, role, created_at AS "addedAt"
     FROM authorized_users
     WHERE account_number = $1
     ORDER BY created_at DESC`,
    [account_number]
  );
  return { accountNumber: account_number, authorizedUsers: result.rows };
};

const setPaperlessBillingHandler = async ({ account_number, enabled }: any) => {
  if (enabled) {
    await pool.query(
      `INSERT INTO account_programs (account_number, program_name)
       VALUES ($1, 'Paperless Billing')
       ON CONFLICT (account_number, program_name)
       DO NOTHING`,
      [account_number]
    );
  } else {
    await pool.query(
      `DELETE FROM account_programs
       WHERE account_number = $1 AND program_name = 'Paperless Billing'`,
      [account_number]
    );
  }

  await addAudit("set_paperless_billing", { account_number, enabled: Boolean(enabled) });
  return { status: "UPDATED", accountNumber: account_number, paperlessBillingEnabled: Boolean(enabled) };
};

const getRatePlanOptionsHandler = async ({ account_number }: any) => {
  const accountResult = await pool.query('SELECT rate_class FROM accounts WHERE account_number = $1', [account_number]);
  const currentRate = accountResult.rows[0]?.rate_class || "RS-1 Residential Service";

  return {
    accountNumber: account_number,
    currentRate,
    options: [
      { ratePlan: "RS-1 Residential Service", estimatedMonthlyDeltaUsd: 0 },
      { ratePlan: "TOU-EV Off-Peak", estimatedMonthlyDeltaUsd: -18.5 },
      { ratePlan: "Budget Billing", estimatedMonthlyDeltaUsd: 0, note: "Payment smoothing option" }
    ]
  };
};

const compareRatePlanSavingsHandler = async ({ account_number, candidate_rate }: any) => {
  const usageResult = await pool.query(
    `SELECT AVG(kwh) AS avg_kwh, AVG(cost_usd) AS avg_cost
     FROM usage_history
     WHERE account_number = $1`,
    [account_number]
  );

  const avgKwh = Number(usageResult.rows[0]?.avg_kwh || 0);
  const avgCost = Number(usageResult.rows[0]?.avg_cost || 0);
  const estimatedCost = candidate_rate === "TOU-EV Off-Peak" ? avgCost * 0.9 : avgCost;

  return {
    accountNumber: account_number,
    candidateRate: candidate_rate,
    averageMonthlyKwh: Number(avgKwh.toFixed(2)),
    currentEstimatedMonthlyCostUsd: Number(avgCost.toFixed(2)),
    candidateEstimatedMonthlyCostUsd: Number(estimatedCost.toFixed(2)),
    projectedSavingsUsd: Number((avgCost - estimatedCost).toFixed(2))
  };
};

const getPeakAlertsHandler = async ({ account_number }: any) => {
  const usageResult = await pool.query(
    `SELECT month, kwh
     FROM usage_history
     WHERE account_number = $1
     ORDER BY month DESC
     LIMIT 3`,
    [account_number]
  );

  const alerts = usageResult.rows
    .filter((row: any) => Number(row.kwh) > 1200)
    .map((row: any) => ({ month: row.month, type: "HIGH_USAGE", message: `Usage exceeded threshold with ${row.kwh} kWh.` }));

  return {
    accountNumber: account_number,
    alerts,
    hasAlerts: alerts.length > 0
  };
};

const recommendEvChargingWindowHandler = async ({ account_number }: any) => {
  const bill = await getBillingInquiryHandler({ account_number });
  const offPeakRatio = bill.evChargingKwh ? Number(((bill.evOffPeakKwh / bill.evChargingKwh) * 100).toFixed(1)) : 0;

  return {
    accountNumber: account_number,
    recommendedWindow: "22:00-06:00",
    offPeakRatioPct: offPeakRatio,
    recommendation: "Charge overnight to maximize off-peak savings and reduce on-peak usage."
  };
};

const projectedNextBillHandler = async ({ account_number }: any) => {
  const result = await pool.query(
    `SELECT cost_usd, kwh
     FROM usage_history
     WHERE account_number = $1
     ORDER BY month DESC
     LIMIT 3`,
    [account_number]
  );

  if (result.rows.length === 0) {
    return { found: false, message: "No usage history found for projection." };
  }

  const avgCost = result.rows.reduce((sum: number, row: any) => sum + Number(row.cost_usd || 0), 0) / result.rows.length;
  const avgKwh = result.rows.reduce((sum: number, row: any) => sum + Number(row.kwh || 0), 0) / result.rows.length;
  const projectedCost = avgCost * 1.05;

  return {
    accountNumber: account_number,
    projectedNextBillUsd: Number(projectedCost.toFixed(2)),
    projectedKwh: Number(avgKwh.toFixed(0)),
    basis: "Rolling 3-month average with seasonal uplift."
  };
};

const createSupportCaseHandler = async ({ account_number, category, subject, description, priority }: any) => {
  const caseId = makeId("CASE");
  await pool.query(
    `INSERT INTO support_cases
      (case_id, account_number, category, subject, description, priority, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')`,
    [caseId, account_number, category, subject, description, priority || "normal"]
  );
  await addAudit("create_support_case", { account_number, caseId, category });

  const supportCase = {
    caseId,
    accountNumber: account_number,
    category,
    subject,
    description,
    priority: priority || "normal",
    status: "OPEN"
  };
  return supportCase;
};

const getCaseStatusHandler = async ({ case_id }: any) => {
  const result = await pool.query('SELECT * FROM support_cases WHERE case_id = $1', [case_id]);
  if (result.rows.length === 0) {
    return { found: false, message: "Case not found." };
  }

  const supportCase = result.rows[0];
  return {
    caseId: supportCase.case_id,
    accountNumber: supportCase.account_number,
    category: supportCase.category,
    subject: supportCase.subject,
    description: supportCase.description,
    priority: supportCase.priority,
    status: supportCase.status,
    createdAt: supportCase.created_at,
    updatedAt: supportCase.updated_at
  };
};

const verifyIdentityStepupHandler = async ({ customer_number, method }: any) => {
  const sessionId = makeId("STEPUP");
  await pool.query(
    `INSERT INTO verification_sessions
      (session_id, customer_number, method, status, challenge_code_hint)
     VALUES ($1, $2, $3, 'VERIFICATION_SENT', '***123')`,
    [sessionId, customer_number, method]
  );
  await addAudit("verify_identity_stepup", { customer_number, method, sessionId });

  const session = {
    sessionId,
    customerNumber: customer_number,
    method,
    status: "VERIFICATION_SENT",
    challengeCodeHint: "***123"
  };
  return session;
};

const auditActivityLogHandler = async ({ account_number, customer_number, limit }: any) => {
  const maxItems = Math.min(Math.max(Number(limit || 20), 1), 100);

  const result = await pool.query(
    `SELECT id, action, account_number, customer_number, details, created_at
     FROM audit_log
     WHERE ($1::text = '' OR account_number = $1)
       AND ($2::text = '' OR customer_number = $2)
     ORDER BY created_at DESC
     LIMIT $3`,
    [account_number || '', customer_number || '', maxItems]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    action: row.action,
    account_number: row.account_number,
    customer_number: row.customer_number,
    timestamp: row.created_at,
    ...(row.details || {})
  }));
};

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

server.registerTool(
  "get_customer_profile",
  {
    description: "Identify the customer and return linked accounts, premises and registered EVs.",
    inputSchema: {
      customer_number: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional()
    }
  },
  async (args) => jsonContent(await getCustomerProfileHandler(args))
);

server.registerTool(
  "lookup_account",
  {
    description: "Resolve residential account records by account, customer, phone, email, premise, or address.",
    inputSchema: {
      account_number: z.string().optional(),
      customer_number: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      premise_number: z.string().optional(),
      address: z.string().optional()
    }
  },
  async (input) => jsonContent(await lookupAccountHandler(input))
);

server.registerTool(
  "get_account_summary",
  {
    description: "Return account status, standing, rate class, smart meter status, enrolled programs and flags.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async ({ account_number }) => jsonContent(await getAccountSummaryHandler({ account_number }))
);

server.registerTool(
  "get_premise_details",
  {
    description: "Return premise details by premise number or service address. Includes the closing_date from public-property records. When service is inactive, the response tells you to call schedule_move_in_service with the returned premise_number and closing/move-in date. Do NOT schedule_ev_assessment or enroll_ev_charging while service is inactive. Use after resolving the address through public-property records (e.g., for a home purchase) or direct customer input. For EV questions, call this and check_ev_eligibility together in sequence.",
    inputSchema: {
      premise_number: z.string().optional(),
      address: z.string().optional()
    }
  },
  async ({ premise_number, address }) => {
    const premise = await getPremiseDetailsHandler({ premise_number, address });
    if (!premise || premise.found === false) {
      return {
        content: [{
          type: "text" as const,
          text: `Premise not found for ${address || premise_number}. Do NOT call get_premise_details again. Instead, call start_service_connection with the address to create a new service connection, or schedule_move_in_service if the customer has a closing/move-in date.`
        }]
      };
    }
    const status = premise.service_status || "unknown";
    const isInactive = status.toLowerCase().includes("inactive") || status.toLowerCase().includes("pending") || status.toLowerCase().includes("awaiting");
    const has240v = premise.existing_240v_circuit_in_garage;
    const hasWifi = premise.strong_wifi_at_charging_location;
    const evEligible = premise.evolution_home_eligible;
    const summary = [
      `Premise ${premise.premise_number} | ${premise.address_line1}, ${premise.address_city}, ${premise.address_state} ${premise.address_zip}`,
      `Service status: ${status}`,
      `Property type: ${premise.property_type || "unknown"}`,
      formatPremisePublicRecordSummary(premise),
      `EV eligibility: ${evEligible ? "ELIGIBLE" : "not eligible"}`,
      `240V garage circuit: ${has240v ? "YES — equipment-only install possible" : "NO — full installation required (~$36/mo)"}`,
      `WiFi at charging location: ${hasWifi ? "yes" : "no"}`,
      isInactive
        ? `ACTION: Service is inactive. Use schedule_move_in_service with premise_number="${premise.premise_number}" and requested_connect_date="${premise.closing_date || premise.purchase_date || "[customer's closing/move-in date]"}" to schedule power. Do NOT schedule_ev_assessment or enroll_ev_charging yet. After service is active, call schedule_ev_assessment or enroll_ev_charging.`
        : `Service is active. You can call schedule_ev_assessment or enroll_ev_charging with premise_number="${premise.premise_number}" now.`
    ].join("\n");
    return {
      content: [{
        type: "text" as const,
        text: `${summary}\n\nFull premise data:\n${JSON.stringify(premise, null, 2)}`
      }]
    };
  }
);

server.registerTool(
  "get_billing_inquiry",
  {
    description: "Return current bill, due date, charge breakdown, kWh usage and EV off-peak savings.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async ({ account_number }) => jsonContent(await getBillingInquiryHandler({ account_number }))
);

server.registerTool(
  "get_payment_history",
  {
    description: "Return recent payment history and AutoPay scheduling details.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async ({ account_number }) =>
    jsonContent(await getPaymentHistoryHandler({ account_number }))
);

server.registerTool(
  "get_usage_history",
  {
    description: "Return monthly kWh, cost and EV charging kWh trend history.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async ({ account_number }) => jsonContent(await getUsageHistoryHandler({ account_number }))
);

server.registerTool(
  "get_ev_enrollment",
  {
    description: "Return FPL EVolution Home enrollment and charger details for an account.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async ({ account_number }) => jsonContent(await getEvEnrollmentHandler({ account_number }))
);

server.registerTool(
  "check_ev_eligibility",
  {
    description: "Return premise-specific FPL EVolution Home eligibility checks and recommended install type. The response includes recommended_install_type, alternate_install_type, serviceActive (true/false), nextAction, and instructions. Display both EV plans to the customer. If serviceActive is false, nextAction tells you to call schedule_move_in_service with the closing/move-in date before any EV assessment or enrollment. Do NOT schedule_ev_assessment or enroll_ev_charging while service is inactive. Proactively offer to schedule move-in service using the closing_date from get_premise_details or public-property records. Requires premise_number. Call immediately after get_premise_details for the same premise.",
    inputSchema: {
      premise_number: z.string()
    }
  },
  async ({ premise_number }) => jsonContent(await checkEvEligibilityHandler({ premise_number }))
);

server.registerTool(
  "match_property_to_customer",
  {
    description: "Link a known new-property street address to the existing FPL customer and premise. Returns full public-record details including the closing/purchase date, sale price, assessed value, county, parcel ID, and source. Use after an available public-property records connector/tool finds a recent property event, or when the customer directly provides the new address. This tool cannot discover public records by owner; if no public-property connector/tool is available, ask the customer for the street address.",
    inputSchema: {
      address: z.string()
    }
  },
  async ({ address }) => {
    const result = await matchPropertyToCustomerHandler({ address });
    return jsonContent(result);
  }
);

server.registerTool(
  "get_service_connection_quote",
  {
    description: "Optional preview of move-in connection fees, deposit, and earliest date for a premise. Skip this if the user already confirmed they want service connected; call start_service_connection directly instead. Use only when the user explicitly asks for a quote or timing before committing.",
    inputSchema: {
      premise_number: z.string()
    }
  },
  async ({ premise_number }) => jsonContent(await getServiceConnectionQuoteHandler({ premise_number }))
);

server.registerTool(
  "start_service_connection",
  {
    description: "Submit or schedule a new residential power connection (move-in / start service) for a resolved premise. Provide requested_connect_date to schedule the move-in date, e.g., the customer's closing or move-in date. This is the tool to offer when a customer is purchasing a home and needs power turned on. IDEMPOTENT: if a SUBMITTED order already exists, the existing order is returned. Call directly when get_premise_details/check_ev_eligibility shows inactive service and the customer has agreed to a date; do not ask for a separate quote first.",
    inputSchema: {
      premise_number: z.string(),
      account_number: z.string().optional(),
      requested_connect_date: z.string().optional()
    }
  },
  async (input) =>
    jsonContent(await startServiceConnectionHandler(input))
);

server.registerTool(
  "schedule_move_in_service",
  {
    description: "Schedule a move-in electric service start date for a resolved premise. Requires premise_number and requested_connect_date (the closing or move-in date). This is the primary tool to use when a customer is purchasing a home and needs power turned on by a specific date. It is idempotent and will return an existing SUBMITTED order if one already exists. Only call after the customer confirms the address/premise and provides a move-in or closing date.",
    inputSchema: {
      premise_number: z.string(),
      account_number: z.string().optional(),
      requested_connect_date: z.string()
    }
  },
  async (input) =>
    jsonContent(await scheduleMoveInServiceHandler(input))
);

server.registerTool(
  "enroll_ev_charging",
  {
    description: "Submit FPL EVolution Home EV charging enrollment for a premise. This tool will reject the enrollment if the premise is not eligible or if power service is not active yet; the response then includes the exact next step (usually schedule_move_in_service). Call right after schedule_move_in_service when the user has agreed to EV home charging, but note that power will not be active until the scheduled connect date. Use the install_type from check_ev_eligibility ('full' for no 240V circuit, 'equipment_only' for existing 240V circuit). Do not ask for a separate confirmation unless the install type is ambiguous.",
    inputSchema: {
      premise_number: z.string(),
      account_number: z.string().optional(),
      install_type: z.enum(["full", "equipment_only"])
    }
  },
  async (input) =>
    jsonContent(await enrollEvChargingHandler(input))
);

server.registerTool(
  "set_move_intent",
  {
    description: "Record whether the customer is keeping existing electric service active while starting service at the new premise, or wants to move out/stop service at an existing premise. Only call after the customer explicitly confirms their intent. Never stop existing service based only on a public-property event, inferred move, city mention, or EV inquiry.",
    inputSchema: {
      customer_number: z.string().optional(),
      intent: z.enum(["keep_both", "move_out_existing", "move_out_miami"])
    }
  },
  async (input) =>
    jsonContent(await setMoveIntentHandler(input))
);

server.registerTool(
  "register_vehicle",
  {
    description: "Register a new EV for a customer account.",
    inputSchema: {
      customer_number: z.string(),
      linked_premise: z.string().optional(),
      make: z.string(),
      model: z.string(),
      year: z.number().int().min(1990).max(2100),
      connector_type: z.string(),
      vehicle_id: z.string().optional()
    }
  },
  async (input) => jsonContent(await registerVehicleHandler(input))
);

server.registerTool(
  "update_registered_vehicle",
  {
    description: "Update an existing registered vehicle.",
    inputSchema: {
      vehicle_id: z.string(),
      linked_premise: z.string().optional(),
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.number().int().min(1990).max(2100).optional(),
      connector_type: z.string().optional()
    }
  },
  async (input) => jsonContent(await updateRegisteredVehicleHandler(input))
);

server.registerTool(
  "remove_registered_vehicle",
  {
    description: "Remove a registered vehicle by vehicle id.",
    inputSchema: {
      vehicle_id: z.string()
    }
  },
  async (input) => jsonContent(await removeRegisteredVehicleHandler(input))
);

server.registerTool(
  "set_autopay",
  {
    description: "Enable autopay for an account.",
    inputSchema: {
      account_number: z.string(),
      payment_method: z.record(z.string(), z.any()).optional()
    }
  },
  async (input) => jsonContent(await setAutopayHandler(input))
);

server.registerTool(
  "cancel_autopay",
  {
    description: "Disable autopay for an account.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async (input) => jsonContent(await cancelAutopayHandler(input))
);

server.registerTool(
  "update_payment_method",
  {
    description: "Update stored payment method metadata for an account.",
    inputSchema: {
      account_number: z.string(),
      method_type: z.string(),
      last4: z.string().optional(),
      label: z.string().optional()
    }
  },
  async (input) => jsonContent(await updatePaymentMethodHandler(input))
);

server.registerTool(
  "request_payment_extension",
  {
    description: "Request and apply a payment extension for the latest bill.",
    inputSchema: {
      account_number: z.string(),
      requested_due_date: z.string(),
      reason: z.string().optional()
    }
  },
  async (input) => jsonContent(await requestPaymentExtensionHandler(input))
);

server.registerTool(
  "get_disconnection_risk",
  {
    description: "Get disconnection risk for an account based on standing and bill status.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async (input) => jsonContent(await getDisconnectionRiskHandler(input))
);

server.registerTool(
  "start_stop_transfer_service",
  {
    description: "Create a start, stop, or transfer service order.",
    inputSchema: {
      action: z.enum(["start", "stop", "transfer"]),
      account_number: z.string(),
      from_premise: z.string().optional(),
      to_premise: z.string().optional(),
      effective_date: z.string().optional()
    }
  },
  async (input) => jsonContent(await startStopTransferServiceHandler(input))
);

server.registerTool(
  "schedule_reconnect",
  {
    description: "Schedule reconnect service order for an account.",
    inputSchema: {
      account_number: z.string(),
      reconnect_date: z.string()
    }
  },
  async (input) => jsonContent(await scheduleReconnectHandler(input))
);

server.registerTool(
  "update_service_start_date",
  {
    description: "Update an existing service order start date.",
    inputSchema: {
      service_order_id: z.string(),
      new_start_date: z.string()
    }
  },
  async (input) => jsonContent(await updateServiceStartDateHandler(input))
);

server.registerTool(
  "get_service_orders",
  {
    description: "List all service orders for an account. Do not call this routinely before start_service_connection; start_service_connection is idempotent and will return an existing order if one already exists. Only use this when the user asks about existing orders or when a previous tool response explicitly references a service order that needs inspection.",
    inputSchema: {
      account_number: z.string().optional()
    }
  },
  async (input) => jsonContent(await getServiceOrdersHandler(input))
);

server.registerTool(
  "cancel_service_order",
  {
    description: "Cancel a scheduled service order.",
    inputSchema: {
      service_order_id: z.string(),
      reason: z.string().optional()
    }
  },
  async (input) => jsonContent(await cancelServiceOrderHandler(input))
);

server.registerTool(
  "get_ev_charging_sessions",
  {
    description: "Get derived EV charging session history.",
    inputSchema: {
      account_number: z.string(),
      months: z.number().int().min(1).max(12).optional()
    }
  },
  async (input) => jsonContent(await getEvChargingSessionsHandler(input))
);

server.registerTool(
  "update_ev_enrollment_plan",
  {
    description: "Update EV enrollment plan type (full or equipment_only).",
    inputSchema: {
      account_number: z.string(),
      install_type: z.enum(["full", "equipment_only"])
    }
  },
  async (input) => jsonContent(await updateEvEnrollmentPlanHandler(input))
);

server.registerTool(
  "pause_ev_enrollment",
  {
    description: "Pause EV enrollment for an account.",
    inputSchema: {
      account_number: z.string(),
      reason: z.string().optional()
    }
  },
  async (input) => jsonContent(await pauseEvEnrollmentHandler(input))
);

server.registerTool(
  "cancel_ev_enrollment",
  {
    description: "Cancel EV enrollment for an account.",
    inputSchema: {
      account_number: z.string(),
      reason: z.string().optional()
    }
  },
  async (input) => jsonContent(await cancelEvEnrollmentHandler(input))
);

server.registerTool(
  "schedule_ev_assessment",
  {
    description: "Schedule an on-site EV electrical assessment for a premise. Requires active power service at the premise. If service is not active, the tool returns PENDING_SERVICE_ACTIVATION and instructs you to schedule electric service first with schedule_move_in_service. Required before full installation can begin. Customer will receive a link to upload garage photos.",
    inputSchema: {
      premise_number: z.string(),
      preferred_date: z.string().optional()
    }
  },
  async (input) => jsonContent(await scheduleEvAssessmentHandler(input))
);

server.registerTool(
  "upload_garage_requirements_status",
  {
    description: "Upload/record garage readiness status for EV installation.",
    inputSchema: {
      premise_number: z.string(),
      photos_uploaded: z.boolean().optional(),
      wifi_ready: z.boolean().optional(),
      circuit_240v_ready: z.boolean().optional(),
      notes: z.string().optional()
    }
  },
  async (input) => jsonContent(await uploadGarageRequirementsStatusHandler(input))
);

server.registerTool(
  "update_contact_info",
  {
    description: "Update customer contact info.",
    inputSchema: {
      customer_number: z.string(),
      email: z.string().optional(),
      mobile_phone: z.string().optional()
    }
  },
  async (input) => jsonContent(await updateContactInfoHandler(input))
);

server.registerTool(
  "update_notification_preferences",
  {
    description: "Update customer notification preferences.",
    inputSchema: {
      customer_number: z.string(),
      billing_channel: z.enum(["sms", "email", "both"]).optional(),
      outage_channel: z.enum(["sms", "email", "both"]).optional(),
      marketing_opt_in: z.boolean().optional()
    }
  },
  async (input) => jsonContent(await updateNotificationPreferencesHandler(input))
);

server.registerTool(
  "set_preferred_language",
  {
    description: "Set preferred language for a customer.",
    inputSchema: {
      customer_number: z.string(),
      preferred_language: z.string()
    }
  },
  async (input) => jsonContent(await setPreferredLanguageHandler(input))
);

server.registerTool(
  "manage_authorized_users",
  {
    description: "Add/remove/list authorized users for an account.",
    inputSchema: {
      account_number: z.string(),
      operation: z.enum(["add", "remove", "list"]),
      user_email: z.string().optional(),
      role: z.string().optional()
    }
  },
  async (input) => jsonContent(await manageAuthorizedUsersHandler(input))
);

server.registerTool(
  "set_paperless_billing",
  {
    description: "Enable or disable paperless billing program.",
    inputSchema: {
      account_number: z.string(),
      enabled: z.boolean()
    }
  },
  async (input) => jsonContent(await setPaperlessBillingHandler(input))
);

server.registerTool(
  "get_rate_plan_options",
  {
    description: "Get available rate plan options for account.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async (input) => jsonContent(await getRatePlanOptionsHandler(input))
);

server.registerTool(
  "compare_rate_plan_savings",
  {
    description: "Compare estimated savings for a candidate rate plan.",
    inputSchema: {
      account_number: z.string(),
      candidate_rate: z.string()
    }
  },
  async (input) => jsonContent(await compareRatePlanSavingsHandler(input))
);

server.registerTool(
  "get_peak_alerts",
  {
    description: "Get account peak usage alerts.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async (input) => jsonContent(await getPeakAlertsHandler(input))
);

server.registerTool(
  "recommend_ev_charging_window",
  {
    description: "Recommend EV charging window based on account behavior.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async (input) => jsonContent(await recommendEvChargingWindowHandler(input))
);

server.registerTool(
  "projected_next_bill",
  {
    description: "Project next bill amount from recent usage.",
    inputSchema: {
      account_number: z.string()
    }
  },
  async (input) => jsonContent(await projectedNextBillHandler(input))
);

server.registerTool(
  "create_support_case",
  {
    description: "Create support case for an account issue.",
    inputSchema: {
      account_number: z.string(),
      category: z.string(),
      subject: z.string(),
      description: z.string(),
      priority: z.enum(["low", "normal", "high"]).optional()
    }
  },
  async (input) => jsonContent(await createSupportCaseHandler(input))
);

server.registerTool(
  "get_case_status",
  {
    description: "Get support case status by case id.",
    inputSchema: {
      case_id: z.string()
    }
  },
  async (input) => jsonContent(await getCaseStatusHandler(input))
);

server.registerTool(
  "verify_identity_stepup",
  {
    description: "Initiate step-up identity verification challenge.",
    inputSchema: {
      customer_number: z.string(),
      method: z.enum(["sms", "email"])
    }
  },
  async (input) => jsonContent(await verifyIdentityStepupHandler(input))
);

server.registerTool(
  "audit_activity_log",
  {
    description: "Retrieve audited account/customer activity log.",
    inputSchema: {
      account_number: z.string().optional(),
      customer_number: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional()
    }
  },
  async (input) => jsonContent(await auditActivityLogHandler(input))
);

  return server;
};

const readRequestBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks);
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return raw; // callers parse as URLSearchParams
  }

  return JSON.parse(raw.toString("utf8"));
};

const setCorsHeaders = (response: ServerResponse) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, mcp-session-id");
  response.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, mcp-session-id");
};

const writeJson = (response: ServerResponse, statusCode: number, payload: unknown) => {
  setCorsHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
};

const writeHtml = (response: ServerResponse, statusCode: number, html: string) => {
  setCorsHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
};

const toSingleHeaderValue = (value: string | string[] | undefined) => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return "";
};

const logEvent = (level: "info" | "warn" | "error", event: string, details: Record<string, unknown>) => {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...details
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
};

const ACCOUNT_SCOPED_TOOLS = new Set([
  "get_account_summary",
  "get_billing_inquiry",
  "get_payment_history",
  "get_usage_history",
  "get_ev_enrollment",
  "start_service_connection",
  "schedule_move_in_service",
  "enroll_ev_charging",
  "set_autopay",
  "cancel_autopay",
  "update_payment_method",
  "request_payment_extension",
  "get_disconnection_risk",
  "start_stop_transfer_service",
  "schedule_reconnect",
  "get_service_orders",
  "get_ev_charging_sessions",
  "update_ev_enrollment_plan",
  "pause_ev_enrollment",
  "cancel_ev_enrollment",
  "manage_authorized_users",
  "set_paperless_billing",
  "get_rate_plan_options",
  "compare_rate_plan_savings",
  "get_peak_alerts",
  "recommend_ev_charging_window",
  "projected_next_bill",
  "create_support_case"
]);

const CUSTOMER_SCOPED_TOOLS = new Set([
  "get_customer_profile",
  "register_vehicle",
  "set_move_intent",
  "update_contact_info",
  "update_notification_preferences",
  "set_preferred_language",
  "verify_identity_stepup"
]);

const getDefaultAccountNumberForUser = async (userId: string) => {
  const result = await pool.query(
    `SELECT a.account_number
     FROM user_customers uc
     INNER JOIN accounts a ON a.customer_number = uc.customer_number
     WHERE uc.user_id = $1
     ORDER BY uc.is_primary DESC, a.account_number ASC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0]?.account_number ?? null;
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

const handleMcpRequest = async (request: IncomingMessage, response: ServerResponse) => {
  setCorsHeaders(response);

  const requestId = toSingleHeaderValue(request.headers["x-request-id"]) || makeId("REQ");

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
  const mcpMethod = typeof body?.method === "string" ? body.method : "unknown";
  const mcpToolName = mcpMethod === "tools/call" && typeof body?.params?.name === "string"
    ? body.params.name
    : null;
  const mcpSessionId = toSingleHeaderValue(request.headers["mcp-session-id"]);

  logEvent("info", "mcp.request.received", {
    requestId,
    mcpMethod,
    mcpToolName,
    mcpSessionId,
    hasAuthHeader: Boolean(request.headers.authorization)
  });

  const logMcpError = (statusCode: number, code: number, message: string) => {
    logEvent("warn", "mcp.request.error", {
      requestId,
      statusCode,
      mcpMethod,
      mcpToolName,
      mcpSessionId,
      code,
      message
    });
  };

  // Verify JWT token for tool calls (except initialize and tools/list)
  if (body?.method === "tools/call" && body.params?.name) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logMcpError(401, -32001, "Authentication required. Provide a valid JWT token in the Authorization header.");
      writeJson(response, 401, {
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Authentication required. Provide a valid JWT token in the Authorization header."
        },
        id: body.id
      });
      return;
    }

    const token = authHeader.substring(7);
    try {
      const decoded = verifyToken(token);
      if (!decoded.userId) {
        logMcpError(401, -32001, "Invalid token format.");
        writeJson(response, 401, {
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Invalid token format."
          },
          id: body.id
        });
        return;
      }
      
      const userCustomerNumbers = await getUserCustomerNumbers(decoded.userId);
      const toolName = String(body.params.name ?? "");
      if (!body.params.arguments || typeof body.params.arguments !== "object") {
        body.params.arguments = {};
      }

      const toolArguments = body.params.arguments as Record<string, unknown>;
      const shouldEnforceCustomerAccess = userCustomerNumbers.length > 0;

      if (toolName === "lookup_account") {
        const hasAnyLookupValue = ["account_number", "customer_number", "phone", "email", "premise_number", "address"]
          .some((key) => typeof toolArguments[key] === "string" && String(toolArguments[key]).trim() !== "");
        if (!hasAnyLookupValue && decoded.email) {
          toolArguments.email = decoded.email;
        }
      }

      if (shouldEnforceCustomerAccess && CUSTOMER_SCOPED_TOOLS.has(toolName) && typeof toolArguments.customer_number !== "string") {
        toolArguments.customer_number = userCustomerNumbers[0];
      }

      if (shouldEnforceCustomerAccess && ACCOUNT_SCOPED_TOOLS.has(toolName) && typeof toolArguments.account_number !== "string") {
        const defaultAccountNumber = await getDefaultAccountNumberForUser(decoded.userId);
        if (defaultAccountNumber) {
          toolArguments.account_number = defaultAccountNumber;
          logEvent("info", "mcp.auth.account_resolved", {
            requestId,
            mcpToolName: toolName,
            resolvedAccount: defaultAccountNumber,
            userEmail: decoded.email
          });
        }
      }
      
      // Check if user has access to the requested customer data
      if (toolArguments.customer_number) {
        const customerNumber = toolArguments.customer_number;
        if (shouldEnforceCustomerAccess && typeof customerNumber === 'string' && !await hasCustomerAccess(decoded.userId, customerNumber)) {
          logMcpError(403, -32002, "Access denied. You don't have permission to access this customer's data.");
          writeJson(response, 403, {
            jsonrpc: "2.0",
            error: {
              code: -32002,
              message: "Access denied. You don't have permission to access this customer's data."
            },
            id: body.id
          });
          return;
        }
      }

      if (toolArguments.account_number && shouldEnforceCustomerAccess && typeof toolArguments.account_number === "string") {
        const accountResult = await pool.query(
          "SELECT customer_number FROM accounts WHERE account_number = $1",
          [toolArguments.account_number]
        );
        const accountCustomerNumber = accountResult.rows[0]?.customer_number;
        if (accountCustomerNumber && !userCustomerNumbers.includes(accountCustomerNumber)) {
          logEvent("warn", "mcp.auth.account_access_denied", {
            requestId,
            mcpToolName: toolName,
            requestedAccount: toolArguments.account_number,
            accountCustomer: accountCustomerNumber,
            userCustomers: userCustomerNumbers,
            userEmail: decoded.email
          });
          writeJson(response, 403, {
            jsonrpc: "2.0",
            error: {
              code: -32002,
              message: "Access denied. You don't have permission to access this account's data."
            },
            id: body.id
          });
          return;
        }
      }

      // Intercept get_my_account_overview - handle directly with userId from JWT
      if (toolName === "get_my_account_overview") {
        logEvent("info", "mcp.tool.get_my_account_overview", { requestId, userEmail: decoded.email, userId: decoded.userId });
        const overviewResult = await getMyAccountOverviewHandler(decoded.userId, decoded.email || "");
        const mcpResponse = {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(overviewResult) }]
          }
        };
        setCorsHeaders(response);
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(`event: message\ndata: ${JSON.stringify(mcpResponse)}\n\n`);
        response.end();
        return;
      }
    } catch (error) {
      logMcpError(401, -32001, "Invalid or expired token.");
      writeJson(response, 401, {
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Invalid or expired token."
        },
        id: body.id
      });
      return;
    }
  }

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
        { name: "get_my_account_overview", description: "USE THIS FIRST for any billing, account status, profile, EV service, move-in, new-home, city or area change, or balance question from an authenticated user. No parameters needed — resolves everything from login. Returns all linked accounts with billing, account status, service address, EV enrollment, customer full name, email, and phone. For EV or new-home questions, after this call resolve the street address through a public-property records connector or by asking the customer, then call get_premise_details and check_ev_eligibility in sequence. Display both EV plans from the check_ev_eligibility response. If the customer is purchasing or moving into the home and service is not active, proactively offer to schedule move-in electric service with schedule_move_in_service using the closing_date from public records or the customer's move-in date as requested_connect_date. Do not schedule_ev_assessment or enroll_ev_charging before service is active.", inputSchema: { type: "object", properties: {}, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_customer_profile", description: "Look up a customer by customer_number, phone, or email. Returns name, contact info, linked accounts, premises, and registered EVs. Use for agent/lookup flows or when the authenticated user is not the customer being queried. Do NOT use this to get billing — use get_my_account_overview instead.", inputSchema: { type: "object", properties: { customer_number: { type: "string" }, phone: { type: "string" }, email: { type: "string" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "lookup_account", description: "Resolve a residential account by account_number, customer_number, phone, email, premise_number, or address. Use when you need to find an account that is not linked to the current authenticated user. Do NOT call this for the logged-in user's own account — use get_my_account_overview instead.", inputSchema: { type: "object", properties: { account_number: { type: "string" }, customer_number: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, premise_number: { type: "string" }, address: { type: "string" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_account_summary", description: "Return account status, standing (Good/Past Due), rate class (e.g. RS-1, TOU-EV), smart meter flag, enrolled programs, and account flags for a specific account. Use when you need deeper account-level detail beyond what get_my_account_overview provides. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_premise_details", description: "Return property details for a service address or premise number. Includes property type, service status, garage readiness (240V circuit, WiFi), EV suitability, and closing_date from public-property records. When service is inactive, the response tells you to call schedule_move_in_service with the returned premise_number and closing/move-in date. Do NOT schedule_ev_assessment or enroll_ev_charging while service is inactive. Use after resolving the address through public-property records (e.g., for a home purchase) or direct customer input. For EV questions, call this and check_ev_eligibility together in sequence.", inputSchema: { type: "object", properties: { premise_number: { type: "string" }, address: { type: "string" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_billing_inquiry", description: "Return detailed billing for a specific account: current bill amount, due date, billing period, kWh used, average daily cost, full charge-line breakdown (base, fuel, non-fuel, EVolution, taxes), and EV off-peak savings. Use when you need billing for a non-primary account or deeper detail than get_my_account_overview provides. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_payment_history", description: "Return recent payments (date, amount, method) and AutoPay status including next scheduled payment date and amount. Use for questions like 'did my payment go through', 'when is my next autopay', or 'show my payment history'. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_usage_history", description: "Return month-by-month kWh usage, cost, and EV charging kWh going back up to 12 months. Use for questions about usage trends, seasonal comparisons, or 'why is my bill higher this month'. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_ev_enrollment", description: "Return FPL EVolution Home EV charging enrollment details: charger ID, model, status (Active/Paused/Cancelled), install type (full/equipment_only), monthly charge, install date, and registered vehicles linked to this account. Use for questions about 'which car', 'my EV charger', 'EVolution Home plan', or EV charging setup.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "check_ev_eligibility", description: "Check whether a specific premise is eligible for FPL EVolution Home EV charging enrollment. Returns eligibility status, recommended_install_type, alternate_install_type, serviceActive, nextAction, and instructions. Display both EV plans to the customer. If serviceActive is false, nextAction tells you to call schedule_move_in_service with the closing/move-in date before any EV assessment or enrollment. Do NOT schedule_ev_assessment or enroll_ev_charging while service is inactive. Proactively offer to schedule move-in service using the closing_date from get_premise_details or public-property records. Requires premise_number. Call immediately after get_premise_details for the same premise.", inputSchema: { type: "object", properties: { premise_number: { type: "string" } }, required: ["premise_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "match_property_to_customer", description: "Link a known new-property street address to the existing FPL customer and premise, simulating a home-registration event. Use after an available public-property records connector/tool finds a recent property event, or when the customer directly provides the new address. This tool cannot discover public records by owner; if no public-property connector/tool is available, ask the customer for the street address.", inputSchema: { type: "object", properties: { address: { type: "string" } }, required: ["address"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_service_connection_quote", description: "Optional preview of move-in power connection fees, deposit, and earliest date for a premise. SKIP this if the user has already said 'start service', 'connect power', or otherwise confirmed they want service connected; call start_service_connection directly instead. Use only when the user explicitly asks for a quote or timing before committing.", inputSchema: { type: "object", properties: { premise_number: { type: "string" } }, required: ["premise_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "start_service_connection", description: "Submit a new residential power connection (move-in / start service) for a resolved premise. Provide requested_connect_date to schedule a move-in date. IDEMPOTENT: if a SUBMITTED order already exists, the existing order is returned. Call this when the customer has confirmed they want service connected and provided a date. The response tells you the next step (enroll_ev_charging after activation).", inputSchema: { type: "object", properties: { premise_number: { type: "string" }, account_number: { type: "string" }, requested_connect_date: { type: "string" } }, required: ["premise_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "schedule_move_in_service", description: "Schedule a move-in electric service start date for a resolved premise. Requires premise_number and requested_connect_date (the closing or move-in date). This is the PRIMARY tool to use when a customer is purchasing a home and needs power turned on by a specific date. It is idempotent and returns an existing SUBMITTED order if one already exists. Use the closing_date from get_premise_details or the public-property records as the requested_connect_date. Only call after the customer confirms the address and the date.", inputSchema: { type: "object", properties: { premise_number: { type: "string" }, account_number: { type: "string" }, requested_connect_date: { type: "string" } }, required: ["premise_number", "requested_connect_date"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "enroll_ev_charging", description: "Submit an FPL EVolution Home EV charging enrollment for a premise. This tool will reject the enrollment if the premise is not eligible or if power service is not active yet; the response then includes the exact next step (usually schedule_move_in_service). Call right after schedule_move_in_service when the user has agreed to EV home charging, but note that power will not be active until the scheduled connect date. Use the install_type from check_ev_eligibility. account_number auto-resolved from login if omitted. Do not ask for a separate confirmation unless the install type is ambiguous.", inputSchema: { type: "object", properties: { premise_number: { type: "string" }, account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, install_type: { type: "string", enum: ["full", "equipment_only"] } }, required: ["premise_number", "install_type"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "set_move_intent", description: "Record the customer's intent when moving: 'keep_both' means they are keeping existing FPL service active AND starting service at the new address; 'move_out_existing' means they may stop service at an existing address after the existing premise and stop date are explicitly confirmed. 'move_out_miami' is kept for older Miami demo flows. Only call after explicit customer confirmation — never stop service based only on a public-property event, inferred move, city mention, or EV inquiry. customer_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { customer_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, intent: { type: "string", enum: ["keep_both", "move_out_existing", "move_out_miami"] } }, required: ["intent"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "register_vehicle", description: "Register a new electric vehicle for a customer. Required: make, model, year, connector_type (e.g. J1772, CCS, CHAdeMO, Tesla). Links the EV to the customer's FPL account for EV charging tracking. customer_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { customer_number: { type: "string" }, linked_premise: { type: "string" }, make: { type: "string" }, model: { type: "string" }, year: { type: "number" }, connector_type: { type: "string" }, vehicle_id: { type: "string" } }, required: ["customer_number", "make", "model", "year", "connector_type"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "update_registered_vehicle", description: "Update an existing registered EV's details (make, model, year, connector_type, linked_premise). Use when the customer changes their vehicle or corrects registration info. Requires vehicle_id from get_ev_enrollment.", inputSchema: { type: "object", properties: { vehicle_id: { type: "string" }, linked_premise: { type: "string" }, make: { type: "string" }, model: { type: "string" }, year: { type: "number" }, connector_type: { type: "string" } }, required: ["vehicle_id"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "remove_registered_vehicle", description: "Remove a registered EV from the customer's account by vehicle_id. Use when the customer no longer owns the vehicle. Requires vehicle_id from get_ev_enrollment.", inputSchema: { type: "object", properties: { vehicle_id: { type: "string" } }, required: ["vehicle_id"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "set_autopay", description: "Enroll an account in AutoPay so bills are paid automatically on the due date. Optionally provide payment_method details (type, card/bank info). Returns next scheduled payment date and amount. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, payment_method: { type: "object" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "cancel_autopay", description: "Cancel AutoPay enrollment for an account. Future bills will require manual payment. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "update_payment_method", description: "Update the stored payment method for an account (e.g. new credit card, bank account). Provide method_type (credit_card, bank_account), last4 digits, and a display label. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, method_type: { type: "string" }, last4: { type: "string" }, label: { type: "string" } }, required: ["method_type"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "request_payment_extension", description: "Extend the due date on the current bill. Use when the customer cannot pay by the original due date and wants more time. Provide requested_due_date (YYYY-MM-DD) and optional reason. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, requested_due_date: { type: "string" }, reason: { type: "string" } }, required: ["requested_due_date"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_disconnection_risk", description: "Check whether an account is at risk of disconnection based on past-due status and outstanding balance. Returns risk level (LOW/MEDIUM/HIGH), due date, amount due, and recommended action. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "start_stop_transfer_service", description: "Create a service order to start, stop, or transfer electric service. action must be 'start', 'stop', or 'transfer'. For transfers, provide both from_premise and to_premise. Only call after explicit customer confirmation — stopping service is irreversible until reconnected. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["start", "stop", "transfer"] }, account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, from_premise: { type: "string" }, to_premise: { type: "string" }, effective_date: { type: "string" } }, required: ["action"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "schedule_reconnect", description: "Schedule a service reconnection after a disconnection. Provide reconnect_date (YYYY-MM-DD). account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, reconnect_date: { type: "string" } }, required: ["reconnect_date"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "update_service_start_date", description: "Change the effective date on an existing scheduled service order. Requires service_order_id from get_service_orders.", inputSchema: { type: "object", properties: { service_order_id: { type: "string" }, new_start_date: { type: "string" } }, required: ["service_order_id", "new_start_date"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_service_orders", description: "List all service orders for an account. DO NOT call this routinely before start_service_connection; start_service_connection is idempotent and will return an existing order if one already exists. Only use this when the user asks about existing orders or when a previous tool response explicitly references a service order that needs inspection.", inputSchema: { type: "object", properties: { account_number: { type: "string" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "cancel_service_order", description: "Cancel a scheduled service order that has not yet been executed. Requires service_order_id. Provide a reason for audit purposes.", inputSchema: { type: "object", properties: { service_order_id: { type: "string" }, reason: { type: "string" } }, required: ["service_order_id"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_ev_charging_sessions", description: "Return derived monthly EV charging session history: total kWh, estimated session count, and average kWh per session. Use for questions like 'how much have I charged my car' or 'how many EV sessions last month'. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, months: { type: "number" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "update_ev_enrollment_plan", description: "Change the FPL EVolution Home plan type for an account: 'full' ($36/month, includes electrical install) or 'equipment_only' ($27/month, charger swap only). account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, install_type: { type: "string", enum: ["full", "equipment_only"] } }, required: ["install_type"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "pause_ev_enrollment", description: "Temporarily pause FPL EVolution Home enrollment for an account (e.g. while traveling or during renovation). Provide an optional reason. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, reason: { type: "string" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "cancel_ev_enrollment", description: "Permanently cancel FPL EVolution Home enrollment for an account. Only call after explicit customer confirmation. Provide an optional reason. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, reason: { type: "string" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "schedule_ev_assessment", description: "Schedule an on-site EV electrical assessment for a premise. Requires active power service at the premise. If service is not active, the tool returns PENDING_SERVICE_ACTIVATION and instructs you to schedule electric service first with schedule_move_in_service. Required before full installation can begin. Customer will receive a link to upload garage photos. preferred_date is optional (YYYY-MM-DD).", inputSchema: { type: "object", properties: { premise_number: { type: "string" }, preferred_date: { type: "string" } }, required: ["premise_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "upload_garage_requirements_status", description: "Record garage readiness for EV charger installation: whether photos have been uploaded, whether WiFi is available at the charging location, and whether a 240V circuit exists. Use after the customer completes pre-install steps.", inputSchema: { type: "object", properties: { premise_number: { type: "string" }, photos_uploaded: { type: "boolean" }, wifi_ready: { type: "boolean" }, circuit_240v_ready: { type: "boolean" }, notes: { type: "string" } }, required: ["premise_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "update_contact_info", description: "Update the email address or mobile phone number on file for a customer. customer_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { customer_number: { type: "string" }, email: { type: "string" }, mobile_phone: { type: "string" } }, required: ["customer_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "update_notification_preferences", description: "Update how the customer receives billing and outage notifications: 'sms', 'email', or 'both'. Also controls marketing opt-in. customer_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { customer_number: { type: "string" }, billing_channel: { type: "string", enum: ["sms", "email", "both"] }, outage_channel: { type: "string", enum: ["sms", "email", "both"] }, marketing_opt_in: { type: "boolean" } }, required: ["customer_number"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "set_preferred_language", description: "Set the preferred language for a customer's communications (e.g. 'EN', 'ES'). customer_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { customer_number: { type: "string" }, preferred_language: { type: "string" } }, required: ["customer_number", "preferred_language"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "manage_authorized_users", description: "Add, remove, or list users authorized to manage an account on behalf of the primary account holder. operation must be 'add', 'remove', or 'list'. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, operation: { type: "string", enum: ["add", "remove", "list"] }, user_email: { type: "string" }, role: { type: "string" } }, required: ["operation"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "set_paperless_billing", description: "Enable or disable paperless billing (e-bills only, no paper mail). enabled=true turns it on, enabled=false reverts to paper. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, enabled: { type: "boolean" } }, required: ["enabled"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_rate_plan_options", description: "Return available rate plans for an account and estimated monthly cost delta vs current plan. Use when the customer asks about saving money, switching to a time-of-use rate, or EV-specific pricing like TOU-EV Off-Peak. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "compare_rate_plan_savings", description: "Estimate monthly savings if the customer switches to a specific rate plan, based on their actual usage history. candidate_rate should match a plan name from get_rate_plan_options. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, candidate_rate: { type: "string" } }, required: ["candidate_rate"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_peak_alerts", description: "Return high-usage alerts for recent months where kWh exceeded the account's threshold. Use to explain unexpected bill spikes or proactively alert the customer to high usage periods. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "recommend_ev_charging_window", description: "Recommend the best time window to charge an EV to maximize off-peak savings, based on the account's EV charging pattern. Returns recommended hours and current off-peak ratio. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "projected_next_bill", description: "Project the next bill amount using a rolling 3-month usage average with seasonal adjustment. Use for questions like 'what will my next bill be' or 'how much should I budget'. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "create_support_case", description: "Open a support case for a billing dispute, service issue, EV installation problem, or other concern. Requires category, subject, and description. priority is 'low', 'normal', or 'high'. Returns a case_id for follow-up. account_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { account_number: { type: "string", description: "Optional. Auto-resolved from authenticated user if omitted." }, category: { type: "string" }, subject: { type: "string" }, description: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high"] } }, required: ["category", "subject", "description"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "get_case_status", description: "Check the current status of a support case by case_id. Use when the customer asks for an update on an existing case.", inputSchema: { type: "object", properties: { case_id: { type: "string" } }, required: ["case_id"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "verify_identity_stepup", description: "Initiate a step-up identity verification challenge for sensitive operations (e.g. billing changes, account transfers). Sends a code via sms or email. customer_number auto-resolved from login if omitted.", inputSchema: { type: "object", properties: { customer_number: { type: "string" }, method: { type: "string", enum: ["sms", "email"] } }, required: ["customer_number", "method"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } },
        { name: "audit_activity_log", description: "Retrieve a chronological log of actions taken on an account or for a customer: payments, service orders, AutoPay changes, EV enrollment events, etc. Use for account history questions or to audit recent changes.", inputSchema: { type: "object", properties: { account_number: { type: "string" }, customer_number: { type: "string" }, limit: { type: "number" } }, additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#" } }
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
    } catch (error) {
        logEvent("error", "mcp.tools_list.error", {
          requestId,
          mcpMethod,
          mcpSessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      writeJson(response, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    } finally {
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
  } catch (error) {
    logEvent("error", "mcp.request.handler_error", {
      requestId,
      mcpMethod,
      mcpToolName,
      mcpSessionId,
      error: error instanceof Error ? error.message : String(error)
    });

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
  } finally {
    await transport.close();
    await server.close();
  }
};

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID ?? "chatgpt-fpl-agent";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET ?? "";
const JWT_SECRET_VALUE = process.env.JWT_SECRET ?? "change-me";
const generateRefreshToken = () => `${makeId("RT")}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const generateClientId = () => `mcp-client-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

const createOAuthEndpoint = (request: IncomingMessage, path: string) => {
  const host = request.headers.host ?? "localhost";
  return `https://${host}${path}`;
};

const getConfiguredClient = () => ({
  client_id: OAUTH_CLIENT_ID,
  client_secret: OAUTH_CLIENT_SECRET || null,
  client_name: "FPL ChatGPT Connector",
  redirect_uris: [] as string[],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: OAUTH_CLIENT_SECRET ? "client_secret_post" : "none"
});

const getRegisteredOauthClient = async (clientId: string) => {
  if (clientId === OAUTH_CLIENT_ID) {
    return getConfiguredClient();
  }

  const result = await pool.query(
    `SELECT client_id, client_secret, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method
     FROM oauth_clients
     WHERE client_id = $1`,
    [clientId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    client_id: row.client_id,
    client_secret: row.client_secret,
    client_name: row.client_name,
    redirect_uris: Array.isArray(row.redirect_uris) ? row.redirect_uris : [],
    grant_types: Array.isArray(row.grant_types) ? row.grant_types : [],
    response_types: Array.isArray(row.response_types) ? row.response_types : [],
    token_endpoint_auth_method: row.token_endpoint_auth_method
  };
};

const verifyPkceChallenge = (verifier: string, challenge: string, method: string | null) => {
  if (!challenge) {
    return true;
  }

  if ((method ?? "plain") === "plain") {
    return verifier === challenge;
  }

  if (method === "S256") {
    const hash = createHash("sha256").update(verifier).digest("base64url");
    return hash === challenge;
  }

  return false;
};

const parseRequestBodyFields = (raw: unknown, request: IncomingMessage) => {
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(Buffer.isBuffer(raw) ? raw.toString() : JSON.stringify(raw));
  }

  const fields = new URLSearchParams();
  const body = (raw || {}) as Record<string, string>;
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      fields.set(key, value);
    }
  }
  return fields;
};

const oauthLoginPageHtml = (params: string, error?: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FPL Agent – Sign In</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f0f4f8;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:40px;width:100%;max-width:400px}
    .logo{font-size:22px;font-weight:700;color:#0050a0;margin-bottom:8px}
    .subtitle{color:#666;font-size:14px;margin-bottom:28px}
    label{display:block;font-size:13px;font-weight:600;color:#333;margin-bottom:6px}
    input{width:100%;padding:10px 14px;border:1px solid #d0d7de;border-radius:8px;font-size:15px;margin-bottom:18px;outline:none;transition:border .2s}
    input:focus{border-color:#0050a0}
    button{width:100%;padding:12px;background:#0050a0;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
    button:hover{background:#003d7a}
    .error{background:#fff0f0;border:1px solid #f88;color:#c00;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:18px}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⚡ FPL Agent</div>
    <div class="subtitle">Sign in to connect your FPL account to ChatGPT</div>
    ${error ? `<div class="error">${error}</div>` : ""}
    <form method="POST" action="/oauth/authorize?${params}">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autocomplete="username" placeholder="your@email.com">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••••">
      <button type="submit">Sign In &amp; Authorize</button>
    </form>
  </div>
</body>
</html>`;

const handleOAuthAuthorize = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const responseType = url.searchParams.get("response_type");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "plain";
  const params = url.searchParams.toString();

  const oauthClient = clientId ? await getRegisteredOauthClient(clientId) : null;

  if (!oauthClient || responseType !== "code") {
    writeHtml(response, 400, oauthLoginPageHtml(params, "Invalid client or response_type."));
    return;
  }

  if (oauthClient.redirect_uris.length > 0 && !oauthClient.redirect_uris.includes(redirectUri)) {
    writeHtml(response, 400, oauthLoginPageHtml(params, "Invalid redirect_uri."));
    return;
  }

  if (request.method === "GET") {
    writeHtml(response, 200, oauthLoginPageHtml(params));
    return;
  }

  // POST – process login form
  const body = await readRequestBody(request);
  const formText = Buffer.isBuffer(body) ? body.toString() : JSON.stringify(body);
  const formParams = new URLSearchParams(formText);
  const email = formParams.get("email")?.toLowerCase() ?? "";
  const password = formParams.get("password") ?? "";

  if (!email || !password) {
    writeHtml(response, 400, oauthLoginPageHtml(params, "Email and password are required."));
    return;
  }

  // Validate credentials against users table
  const bcrypt = await import("bcrypt");
  const userResult = await pool.query(
    "SELECT id, email, password_hash, is_active FROM users WHERE email = $1",
    [email]
  );

  if (userResult.rows.length === 0) {
    writeHtml(response, 401, oauthLoginPageHtml(params, "Invalid email or password."));
    return;
  }

  const user = userResult.rows[0];
  if (!user.is_active) {
    writeHtml(response, 401, oauthLoginPageHtml(params, "Account is deactivated."));
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    writeHtml(response, 401, oauthLoginPageHtml(params, "Invalid email or password."));
    return;
  }

  // Issue authorization code (10 min TTL)
  const code = makeId("CODE") + "-" + Math.random().toString(36).slice(2);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO oauth_codes (code, client_id, user_id, email, redirect_uri, code_challenge, code_challenge_method, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [code, oauthClient.client_id, user.id, user.email, redirectUri, codeChallenge, codeChallengeMethod, expiresAt]
  );

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);

  setCorsHeaders(response);
  response.writeHead(302, { Location: redirectUrl.toString() });
  response.end();
};

const handleOAuthToken = async (request: IncomingMessage, response: ServerResponse) => {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const raw = await readRequestBody(request);
  const bodyFields = parseRequestBodyFields(raw, request);
  const grantType = bodyFields.get("grant_type") ?? "";
  const code = bodyFields.get("code") ?? "";
  const redirectUri = bodyFields.get("redirect_uri") ?? "";
  let clientId = bodyFields.get("client_id") ?? "";
  let clientSecret = bodyFields.get("client_secret") ?? "";
  const codeVerifier = bodyFields.get("code_verifier") ?? "";
  const refreshTokenGrant = bodyFields.get("refresh_token") ?? "";

  // Also check Authorization header for client credentials
  const authHeader = request.headers.authorization ?? "";
  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const [hId, hSecret] = decoded.split(":");
    if (!clientId) clientId = hId;
    if (!clientSecret) clientSecret = hSecret;
  }

  const oauthClient = clientId ? await getRegisteredOauthClient(clientId) : null;

  if (!oauthClient) {
    writeJson(response, 401, { error: "invalid_client" });
    return;
  }

  if (oauthClient.token_endpoint_auth_method === "client_secret_post" || oauthClient.token_endpoint_auth_method === "client_secret_basic") {
    if (!oauthClient.client_secret || clientSecret !== oauthClient.client_secret) {
      writeJson(response, 401, { error: "invalid_client" });
      return;
    }
  }

  if (grantType === "refresh_token") {
    const tokenResult = await pool.query(
      `SELECT user_id, email, expires_at, revoked, client_id
       FROM oauth_refresh_tokens
       WHERE refresh_token = $1`,
      [refreshTokenGrant]
    );

    if (tokenResult.rows.length === 0) {
      writeJson(response, 400, { error: "invalid_grant", error_description: "Refresh token not found." });
      return;
    }

    const refreshRow = tokenResult.rows[0];
    if (refreshRow.client_id !== oauthClient.client_id) {
      writeJson(response, 400, { error: "invalid_grant", error_description: "Refresh token client mismatch." });
      return;
    }
    if (refreshRow.revoked) {
      writeJson(response, 400, { error: "invalid_grant", error_description: "Refresh token revoked." });
      return;
    }
    if (new Date(refreshRow.expires_at) < new Date()) {
      writeJson(response, 400, { error: "invalid_grant", error_description: "Refresh token expired." });
      return;
    }

    const jwt = await import("jsonwebtoken");
    const refreshedAccessToken = jwt.default.sign(
      { userId: refreshRow.user_id, email: refreshRow.email },
      JWT_SECRET_VALUE,
      { expiresIn: "1y" }
    );

    writeJson(response, 200, {
      access_token: refreshedAccessToken,
      token_type: "Bearer",
      expires_in: 31536000,
      refresh_token: refreshTokenGrant
    });
    return;
  }

  if (grantType !== "authorization_code") {
    writeJson(response, 400, { error: "unsupported_grant_type" });
    return;
  }

  const codeResult = await pool.query(
    `SELECT client_id, user_id, email, redirect_uri, code_challenge, code_challenge_method, expires_at, used
     FROM oauth_codes WHERE code = $1`,
    [code]
  );

  if (codeResult.rows.length === 0) {
    writeJson(response, 400, { error: "invalid_grant", error_description: "Code not found." });
    return;
  }

  const row = codeResult.rows[0];
  if (row.client_id !== oauthClient.client_id) {
    writeJson(response, 400, { error: "invalid_grant", error_description: "Authorization code client mismatch." });
    return;
  }
  if (row.used) {
    writeJson(response, 400, { error: "invalid_grant", error_description: "Code already used." });
    return;
  }
  if (new Date(row.expires_at) < new Date()) {
    writeJson(response, 400, { error: "invalid_grant", error_description: "Code expired." });
    return;
  }
  if (row.redirect_uri !== redirectUri) {
    writeJson(response, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch." });
    return;
  }
  if (row.code_challenge && !verifyPkceChallenge(codeVerifier, row.code_challenge, row.code_challenge_method)) {
    writeJson(response, 400, { error: "invalid_grant", error_description: "PKCE verification failed." });
    return;
  }

  // Mark code used
  await pool.query("UPDATE oauth_codes SET used = TRUE WHERE code = $1", [code]);

  // Issue access token (1 year JWT so ChatGPT stays connected)
  const jwt = await import("jsonwebtoken");
  const accessToken = jwt.default.sign(
    { userId: row.user_id, email: row.email },
    JWT_SECRET_VALUE,
    { expiresIn: "1y" }
  );

  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO oauth_refresh_tokens (refresh_token, client_id, user_id, email, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [refreshToken, oauthClient.client_id, row.user_id, row.email, refreshExpiresAt]
  );

  writeJson(response, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 31536000,
    refresh_token: refreshToken
  });
};

const handleOAuthRegister = async (request: IncomingMessage, response: ServerResponse) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== "POST") {
    writeJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  const raw = await readRequestBody(request);
  const body = (raw || {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((value): value is string => typeof value === "string")
    : [];

  if (redirectUris.length === 0) {
    writeJson(response, 400, { error: "invalid_client_metadata", error_description: "redirect_uris is required." });
    return;
  }

  const tokenEndpointAuthMethod = typeof body.token_endpoint_auth_method === "string"
    ? body.token_endpoint_auth_method
    : "none";
  const clientId = generateClientId();
  const clientSecret = generateRefreshToken();
  const clientName = typeof body.client_name === "string" ? body.client_name : "MCP Client";
  const grantTypes = Array.isArray(body.grant_types)
    ? body.grant_types.filter((value): value is string => typeof value === "string")
    : ["authorization_code", "refresh_token"];
  const responseTypes = Array.isArray(body.response_types)
    ? body.response_types.filter((value): value is string => typeof value === "string")
    : ["code"];

  await pool.query(
    `INSERT INTO oauth_clients
      (client_id, client_secret, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
    [
      clientId,
      clientSecret,
      clientName,
      JSON.stringify(redirectUris),
      JSON.stringify(grantTypes),
      JSON.stringify(responseTypes),
      tokenEndpointAuthMethod
    ]
  );

  writeJson(response, 201, {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    client_name: clientName
  });
};

const handleOAuthMetadata = async (request: IncomingMessage, response: ServerResponse) => {
  writeJson(response, 200, {
    issuer: createOAuthEndpoint(request, ""),
    authorization_endpoint: createOAuthEndpoint(request, "/oauth/authorize"),
    token_endpoint: createOAuthEndpoint(request, "/oauth/token"),
    registration_endpoint: createOAuthEndpoint(request, "/register"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"]
  });
};

const handleOpenIdConfiguration = async (request: IncomingMessage, response: ServerResponse) => {
  writeJson(response, 200, {
    issuer: createOAuthEndpoint(request, ""),
    authorization_endpoint: createOAuthEndpoint(request, "/oauth/authorize"),
    token_endpoint: createOAuthEndpoint(request, "/oauth/token"),
    registration_endpoint: createOAuthEndpoint(request, "/register"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["openid", "profile", "email"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256", "HS256"]
  });
};

const handleOAuthRefresh = async (request: IncomingMessage, response: ServerResponse) => {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const raw = await readRequestBody(request);
  let refreshToken = "";
  let clientId = "";
  let clientSecret = "";

  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const p = new URLSearchParams(Buffer.isBuffer(raw) ? raw.toString() : JSON.stringify(raw));
    refreshToken = p.get("refresh_token") ?? "";
    clientId = p.get("client_id") ?? "";
    clientSecret = p.get("client_secret") ?? "";
  } else {
    const b = (raw || {}) as Record<string, string>;
    refreshToken = b.refresh_token ?? "";
    clientId = b.client_id ?? "";
    clientSecret = b.client_secret ?? "";
  }

  const authHeader = request.headers.authorization ?? "";
  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const [hId, hSecret] = decoded.split(":");
    if (!clientId) clientId = hId;
    if (!clientSecret) clientSecret = hSecret;
  }

  if (clientId !== OAUTH_CLIENT_ID || clientSecret !== OAUTH_CLIENT_SECRET) {
    writeJson(response, 401, { error: "invalid_client" });
    return;
  }

  if (!refreshToken) {
    writeJson(response, 400, { error: "invalid_request", error_description: "refresh_token is required." });
    return;
  }

  const tokenResult = await pool.query(
    `SELECT user_id, email, expires_at, revoked
     FROM oauth_refresh_tokens
     WHERE refresh_token = $1`,
    [refreshToken]
  );

  if (tokenResult.rows.length === 0) {
    writeJson(response, 400, { error: "invalid_grant", error_description: "Refresh token not found." });
    return;
  }

  const row = tokenResult.rows[0];
  if (row.revoked) {
    writeJson(response, 400, { error: "invalid_grant", error_description: "Refresh token revoked." });
    return;
  }
  if (new Date(row.expires_at) < new Date()) {
    writeJson(response, 400, { error: "invalid_grant", error_description: "Refresh token expired." });
    return;
  }

  const jwt = await import("jsonwebtoken");
  const accessToken = jwt.default.sign(
    { userId: row.user_id, email: row.email },
    JWT_SECRET_VALUE,
    { expiresIn: "1y" }
  );

  writeJson(response, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 31536000,
    refresh_token: refreshToken
  });
};

const startHttpServer = () => {
  const port = Number(process.env.PORT ?? 3000);

  const httpServer = createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = toSingleHeaderValue(request.headers["x-request-id"]) || makeId("REQ");
    request.headers["x-request-id"] = requestId;
    response.setHeader("X-Request-Id", requestId);
    let pathname = request.url ?? "/";

    response.on("finish", () => {
      logEvent("info", "http.request.complete", {
        requestId,
        method: request.method ?? "UNKNOWN",
        path: pathname,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt
      });
    });

    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      pathname = url.pathname;

      if (url.pathname === "/health") {
        writeJson(response, 200, { status: "ok", mcpPath: "/mcp", privacyPath: "/privacy" });
        return;
      }

      if (url.pathname === "/privacy") {
        writeHtml(response, 200, privacyPageHtml);
        return;
      }

      if (url.pathname === "/.well-known/oauth-authorization-server") {
        await handleOAuthMetadata(request, response);
        return;
      }

      if (
        url.pathname === "/.well-known/openid-configuration" ||
        url.pathname === "/mcp/.well-known/openid-configuration" ||
        url.pathname === "/.well-known/openid-configuration/mcp"
      ) {
        await handleOpenIdConfiguration(request, response);
        return;
      }

      if (url.pathname === "/oauth/authorize" || url.pathname === "/authorize") {
        await handleOAuthAuthorize(request, response, url);
        return;
      }

      if (url.pathname === "/oauth/token" || url.pathname === "/token") {
        await handleOAuthToken(request, response);
        return;
      }

      if (url.pathname === "/oauth/refresh" || url.pathname === "/refresh") {
        await handleOAuthRefresh(request, response);
        return;
      }

      if (url.pathname === "/register") {
        await handleOAuthRegister(request, response);
        return;
      }

      if (url.pathname === "/mcp") {
        await handleMcpRequest(request, response);
        return;
      }

      writeJson(response, 404, { error: "Not found", mcpPath: "/mcp", healthPath: "/health", privacyPath: "/privacy" });
    } catch (error) {
      logEvent("error", "http.route.error", {
        requestId,
        method: request.method ?? "UNKNOWN",
        path: pathname,
        error: error instanceof Error ? error.message : String(error)
      });
      if (!response.headersSent) {
        writeJson(response, 500, { error: "Internal server error" });
      }
    }
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`FPL MCP HTTP server listening on port ${port}; endpoint: /mcp`);
  });

  return httpServer;
};

const startStdioServer = async () => {
  const server = createFplMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

await ensurePersistenceTables();

// Run database migration on startup, but skip if running in test mode
// Tests will handle migration separately
if (!process.env.DATABASE_URL?.includes('_test_')) {
  await runMigration();
}

// Only start the server when this file is the runtime entrypoint.
// Tests set START_SERVER=false to import the module without blocking on stdio.
if (process.env.START_SERVER !== "false") {
  if (process.env.MCP_TRANSPORT === "http" || process.env.PORT) {
    startHttpServer();
  } else {
    await startStdioServer();
  }
}

export {
  pool,
  createFplMcpServer,
  getMyAccountOverviewHandler,
  getCustomerProfileHandler,
  lookupAccountHandler,
  getAccountSummaryHandler,
  getPremiseDetailsHandler,
  getBillingInquiryHandler,
  getPaymentHistoryHandler,
  getUsageHistoryHandler,
  getEvEnrollmentHandler,
  checkEvEligibilityHandler,
  matchPropertyToCustomerHandler,
  getServiceConnectionQuoteHandler,
  startServiceConnectionHandler,
  scheduleMoveInServiceHandler,
  enrollEvChargingHandler,
  setMoveIntentHandler,
  registerVehicleHandler,
  updateRegisteredVehicleHandler,
  removeRegisteredVehicleHandler,
  setAutopayHandler,
  cancelAutopayHandler,
  updatePaymentMethodHandler,
  requestPaymentExtensionHandler,
  getDisconnectionRiskHandler,
  startStopTransferServiceHandler,
  scheduleReconnectHandler,
  updateServiceStartDateHandler,
  getServiceOrdersHandler,
  cancelServiceOrderHandler,
  getEvChargingSessionsHandler,
  updateEvEnrollmentPlanHandler,
  pauseEvEnrollmentHandler,
  cancelEvEnrollmentHandler,
  scheduleEvAssessmentHandler,
  uploadGarageRequirementsStatusHandler,
  updateContactInfoHandler,
  updateNotificationPreferencesHandler,
  setPreferredLanguageHandler,
  manageAuthorizedUsersHandler,
  setPaperlessBillingHandler,
  getRatePlanOptionsHandler,
  compareRatePlanSavingsHandler,
  getPeakAlertsHandler,
  recommendEvChargingWindowHandler,
  projectedNextBillHandler,
  createSupportCaseHandler,
  getCaseStatusHandler,
  verifyIdentityStepupHandler,
  auditActivityLogHandler,
  findAccounts,
  findPremiseByAddress,
  findMatchingCustomers,
  jsonContent,
  makeId,
  addAudit,
  startHttpServer
};