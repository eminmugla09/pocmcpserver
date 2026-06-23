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

### 10. `start_service_connection` (move-in / start service)
- **Args:** `premise_number`, `account_number` (optional), `requested_connect_date` (optional) for scheduling a move-in date
- **Returns:** `action_responses.start_service_connection` (deposit waived, scheduled connect date, service order id). Idempotent — returns an existing SUBMITTED order if one already exists for the premise.
- **Maps to:** `move_in` / SAP `/movein` + `/serviceorder`.

### 11. `schedule_move_in_service` (schedule move-in / closing date)
- **Args:** `premise_number`, `account_number` (optional), `requested_connect_date` (required — the closing or move-in date)
- **Returns:** `action_responses.schedule_move_in_service` (same as start_service_connection). Idempotent — returns an existing SUBMITTED order if one already exists for the premise.
- **Use when:** A customer is purchasing a home and has a closing or move-in date. Use the `closing_date` from public-property records or `get_premise_details` as the `requested_connect_date`.
- **Maps to:** `move_in` / SAP `/movein` + `/serviceorder`.

### 12. `enroll_ev_charging`
- **Args:** `premise_number`, `install_type` (`full` | `equipment_only`)
- **Returns:** `action_responses.enroll_ev_charging` (enrollment id, next step = electrical assessment / garage photos) **only if the premise has active power service**. If the user tries to enroll before power is connected, the tool returns `status: "PENDING_SERVICE_ACTIVATION"` and instructs the assistant to call `schedule_move_in_service` first.
- **Important:** Do not offer or call this tool while service is inactive. Only schedule move-in electric service first.
- **Maps to:** SAP `/ev Enroll` (write).

### 13. `schedule_ev_assessment`
- **Args:** `premise_number`, `preferred_date` (optional)
- **Returns:** `action_responses.schedule_ev_assessment` (assessment id, status) **only if the premise has active power service**. If service is not active, returns `status: "PENDING_SERVICE_ACTIVATION"` and instructs the assistant to call `schedule_move_in_service` first.
- **Important:** Do not offer or call this tool while service is inactive. Only schedule move-in electric service first.
- **Maps to:** SAP service order (write).

### 14. `set_move_intent`
- **Args:** `keep_both` | `move_out_miami`
- **Returns:** `action_responses.set_move_intent` — records keep-both, no move-out order.
- **Maps to:** SAP `/nsmo` (move-out) — here just records intent.

---

## Minimal set

If Emin wants the smallest possible build, these 10 cover all three scenarios:
`get_customer_profile`, `get_account_summary`, `get_premise_details`, `get_billing_inquiry`,
`get_ev_enrollment`, `check_ev_eligibility`, `match_property_to_customer`,
`start_service_connection`, `schedule_move_in_service`, `enroll_ev_charging`.

## Making ChatGPT proactive (important)

The key behavior is **proactive tool use**. Put guidance like this in the MCP server /
custom GPT system instructions:

> You are the FPL customer assistant for Emin Mugla. At the start of a session, and whenever the
> user mentions a new address, a move, a new home, or an electric vehicle, **proactively call**
> `get_my_account_overview`, then resolve the address and call `get_premise_details` and
> `check_ev_eligibility` in sequence before answering. Always ground answers in the customer's real
> account data rather than giving generic information. Display both EV plans from `check_ev_eligibility`
> (full vs equipment-only). When the customer is purchasing a home and service is not active yet,
> **only** proactively offer to schedule move-in electric service with `schedule_move_in_service` using
> their closing or move-in date as `requested_connect_date`. Do **not** offer or call `schedule_ev_assessment`
> or `enroll_ev_charging` while service is inactive. After power is active, offer `schedule_ev_assessment`
> and `enroll_ev_charging`. Proactively ask whether they are moving or keeping both homes.
