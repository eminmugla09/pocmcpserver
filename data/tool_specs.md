# EV ChatGPT MCP Tool Specs

**Stack-agnostic.** Implement these as MCP tools in whatever runtime is fastest for Emin
(Python FastMCP, Node `@modelcontextprotocol/sdk`, etc.). Every tool just reads the matching
record from `mock_data.json` and returns it — **no network calls, no real APIs**. Tool names,
arguments, and response shapes deliberately mirror the real FPL MuleSoft xAPIs (`/ev`, `/tmd`,
billusage) so the interface maps cleanly to the production design.

> All data is synthetic. See the `_README` keys in `mock_data.json`.

---

## Customer Defaults

| Thing | Value |
|-------|-------|
| Customer / Business Partner | `1009988776` (Emin Mugla) |
| Miami account (active, has EV charger) | `5210099001` / premise `60412233` |
| North Palm Beach premise (new home, no service yet) | premise `60587744` |
| New-home address (proactive trigger) | `320 Anchorage Dr, North Palm Beach, FL 33408` |

---

## Read tools

### 1. `get_customer_profile`
Identify the customer and see everything linked to them.
- **Args:** `customer_number` (optional), `phone` (optional), `email` (optional) — any one resolves Emin.
- **Returns:** `mock_data.customer` (name, contact, linked accounts, linked premises, **registeredVehicles**).
- **Maps to:** MuleSoft `customer_360` / SAP `/tmd Customer`.

### 2. `get_account_summary`
- **Args:** `account_number`
- **Returns:** `mock_data.accounts[account_number]` — rate class, standing, smart meter, **enrolledPrograms**, flags (`pastDueFlag`, `pendingConnectDisconnectFlag`, `taxExemptFlag`).
- **Maps to:** `account_360` / `slim_account_360`.

### 3. `get_premise_details`
- **Args:** `premise_number` **or** `address`
- **Returns:** `mock_data.premises[...]` — property type, service status, smart meter, `evolutionHomeEligible`, `existing240vCircuitInGarage`, and for the NPB premise `newOwnerOnRecord`.
- **Maps to:** `premise_360` / SAP `/tmd Premises`.

### 4. `get_billing_inquiry`
- **Args:** `account_number`
- **Returns:** `mock_data.billing[account_number].currentBill` — `amountDue`, `dueDate`, `kwhUsed`, charge breakdown, **EV off-peak vs on-peak kWh + estimated savings**.
- **Maps to:** `billing_inquiry`.

### 5. `get_payment_history`
- **Args:** `account_number`
- **Returns:** `mock_data.payment_history[account_number]` — list of payments (date, amount, method, confirmation). Also surface `autopayEnrolled` / `nextScheduledPaymentDate` from billing.
- **Maps to:** `payment_history`.

### 6. `get_usage_history`
- **Args:** `account_number`
- **Returns:** `mock_data.usage_history[account_number]` — monthly kWh, cost, EV charging kWh (for trend talk).
- **Maps to:** `meter_history`.

### 7. `get_ev_enrollment`
- **Args:** `account_number`
- **Returns:** `mock_data.ev_enrollments[account_number]` — program, `isFullInstallation`/`isEquipmentOnly`, `chargerId`, `chargerModel`, dates, monthly charge. Returns "not enrolled" for the NPB premise.
- **Maps to:** SAP `/ev Enroll`.

### 8. `check_ev_eligibility`
The differentiator for Scenario 1 — grounds the answer in Emin's actual premise.
- **Args:** `premise_number`
- **Returns:** `mock_data.ev_eligibility[premise_number]` — pass/fail per real fpl.com eligibility rule, `recommendedInstallType`, and the gating note ("establish power service first").
- **Maps to:** derived from SAP `/ev` + `/tmd` (eligibility logic FPL applies during enrollment).

### 9. `match_property_to_customer`  ← powers Scenario 2's proactivity
Simulates the "home registration feed for North Palm Beach City" event.
- **Args:** `address`
- **Returns:** `{ matchedCustomer: "1009988776", premiseNumber: "60587744", event: "NEW_OWNER_RECORDED", recordedDate: "2026-06-05", existingServices: ["FPL EVolution Home @ premise 60412233", "Registered EV: Tesla Model Y"] }`
- **Maps to:** external property/home-registration data joined to SAP business partner. This is the "agent reaches out" trigger.

---

## Action / write tools (return canned success from `mock_data.action_responses`)

### 10. `start_service_connection`
- **Args:** `premise_number`, `account_number` (optional), `requested_connect_date` (optional)
- **Returns:** `action_responses.start_service_connection` (deposit waived, scheduled connect date, service order id).
- **Maps to:** `move_in` / SAP `/movein` + `/serviceorder`.

### 11. `enroll_ev_charging`
- **Args:** `premise_number`, `install_type` (`full` | `equipment_only`)
- **Returns:** `action_responses.enroll_ev_charging` (enrollment id, next step = electrical assessment / garage photos).
- **Maps to:** SAP `/ev Enroll` (write).

### 12. `set_move_intent`
- **Args:** `keep_both` | `move_out_miami`
- **Returns:** `action_responses.set_move_intent` — records keep-both, no move-out order.
- **Maps to:** SAP `/nsmo` (move-out) — here just records intent.

---

## Minimal set

If Emin wants the smallest possible build, these 9 cover all three scenarios:
`get_customer_profile`, `get_account_summary`, `get_premise_details`, `get_billing_inquiry`,
`get_ev_enrollment`, `check_ev_eligibility`, `match_property_to_customer`,
`start_service_connection`, `enroll_ev_charging`.

## Making ChatGPT proactive (important)

The key behavior is **proactive tool use**. Put guidance like this in the MCP server /
custom GPT system instructions:

> You are the FPL customer assistant for Emin Mugla. At the start of a session, and whenever the
> user mentions a new address, a move, a new home, or an electric vehicle, **proactively call**
> `match_property_to_customer` and `check_ev_eligibility` before answering. Always ground answers
> in the customer's real account data (call `get_account_summary` / `get_billing_inquiry`) rather
> than giving generic information. When you detect a new property tied to this customer, proactively
> offer: (a) power connection, (b) EV home charging, and (c) ask whether they are moving or keeping
> both homes.
