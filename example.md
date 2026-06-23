# AI Flow: "Hi, I want to explore EV services in North Palm Beach"

## Scenario
Customer is purchasing a home in North Palm Beach and wants to explore FPL EVolution Home services. Closing date is next week.

## Expected AI Behavior
Show property EV eligibility, display available plans, and **only** offer to schedule the move-in electric service start date. Do not offer EV assessment or enrollment until power is active.

---

## Step-by-Step Flow

### Step 1: Account overview
**Tool:** `get_my_account_overview`

**What the AI sees:**
- Customer: Emin Mugla
- Existing account: `5210099001` / Miami premise `60412233`
- Linked premises include `60587744` (North Palm Beach)
- **proactiveNextSteps:** "If the user mentioned a new city, area, move, new home, or EV service at a different location from the linked accounts, you MUST search available public-property records tools for the customer's properties in that city/area, then call get_premise_details and check_ev_eligibility for each candidate property. Do not answer generically based only on the current account data."

### Step 2: Discover the new property
**Tool:** Any available public-property records tool (e.g., search by owner, recent events, or address)

**What the AI sees:**
- Recent purchase: **320 Anchorage Dr, North Palm Beach, FL 33408**
- **Closing date: 2026-07-10**

### Step 3: Confirm ownership and link to FPL premise
**Tools:** (optional, in sequence)
1. `publicpropertymcp.match_property_to_customer` — confirms the customer owns the property (pass `customer_name` + `address` from the public records).
2. `pocmcpserver.match_property_to_customer` — links the address to the FPL customer and premise (pass `address` + `owner_name` from the public records).

**What the AI sees:**
- Property confirmed for Emin Mugla
- Resolved premise: **60587744**

### Step 4: Property details + EV eligibility
**Tools:** `pocmcpserver.get_premise_details` and `pocmcpserver.check_ev_eligibility` (for premise `60587744`)

> The closing date comes from the public-property records tool used in Step 2, not from `get_premise_details`.

**What `get_premise_details` shows:**
- **Address:** 320 Anchorage Dr, North Palm Beach, FL 33408
- **Service status:** Inactive — prior occupant moved out; awaiting new owner connect
- **Property type:** Single-family home with attached 2-car garage
- **EV eligibility:** ELIGIBLE
- **240V garage circuit:** NO — full installation required (~$36/mo)
- **WiFi at charging location:** yes
- **serviceActive:** false
- **nextAction:** Service is inactive. You MUST offer the customer to schedule move-in service. Fill in the `customerOfferTemplate` using the address and date from the public records tool and say the resulting sentence to the customer. If public records has a closing/move-in/renting date, use that date. If no date is available, ask the customer for their preferred date. Then call `schedule_move_in_service` using `premise_number="60587744"` and `requested_connect_date` set to that date. Do NOT offer or call `ev_assessment` or `enroll_ev_charging` yet.
- **customerOfferTemplate:** "Congratulations on your new home! I can schedule FPL electric service at [address] to start on [date]. Would you like me to do that? We can't schedule EV installation until power is active."
  - Filled example: "Congratulations on your new home! I can schedule FPL electric service at 320 Anchorage Dr, North Palm Beach, FL 33408 to start on July 10, 2026. Would you like me to do that? We can't schedule EV installation until power is active."

**What `check_ev_eligibility` shows:**
- **eligible:** true
- **recommended_install_type:** Full installation ($36/mo) — garage has no existing 240V circuit
- **alternate_install_type:** Equipment-only ($27/mo) — only if a 240V circuit is added first
- **serviceActive:** false
- **nextAction:** Service is inactive. You MUST offer the customer to schedule move-in service. Fill in the `customerOfferTemplate` using the address and date from the public records tool and say the resulting sentence to the customer. If public records has a closing/move-in/renting date, use that date. If no date is available, ask the customer for their preferred date. Then call `schedule_move_in_service` with `premise_number="60587744"` and `requested_connect_date` set to that date. Do NOT offer or call `schedule_ev_assessment` or `enroll_ev_charging` until power is active.
- **customerOfferTemplate:** "Congratulations on your new home! I can schedule FPL electric service at [address] to start on [date], then set up the EV charger after power is active. Would you like me to schedule the service now?"
  - Filled example: "Congratulations on your new home! I can schedule FPL electric service at 320 Anchorage Dr, North Palm Beach, FL 33408 to start on July 10, 2026, then set up the EV charger after power is active. Would you like me to schedule the service now?"

---

## Customer-Facing Response

> "Congratulations on your new home! I found it at 320 Anchorage Dr in North Palm Beach. The property is eligible for FPL EVolution Home, but the garage doesn't have a 240V circuit, so the recommended plan is **full installation at $36/month**. The equipment-only plan ($27/month) would only work if a 240V circuit is added first.
>
> Since electric service is not active yet, I can schedule power to start on your **closing date, July 10, 2026**. Would you like me to do that? We can't schedule the EV assessment or enrollment until power is connected."

---

## Step 5: Schedule move-in electric service

**Tool:** `pocmcpserver.schedule_move_in_service`
```json
{
  "premise_number": "60587744",
  "requested_connect_date": "2026-07-10"
}
```

**Response includes:**
- `serviceOrderId`, `scheduledConnectDate`, `message`
- `moveIntentQuestion`: "If the customer has an active FPL service at another premise, ask: 'Do you want to keep your existing FPL service active, or would you like to schedule a move-out there?'"

**Customer-facing follow-up after scheduling:**
> "Great, I've scheduled FPL electric service at 320 Anchorage Dr to start on July 10, 2026. You currently have active FPL service in Miami. Would you like to keep that service active, or would you like me to schedule a move-out there?"

## Step 6: Record move intent

**Tool:** `pocmcpserver.set_move_intent`
```json
{
  "intent": "keep_both"
}
```

**Note:** `set_move_intent` only records the customer's choice. It does NOT create or cancel any service orders. If the customer chooses `move_out_existing`, you must later confirm the existing premise and stop date before scheduling a stop-service order.
