# EV ChatGPT POC — Demo Scripts

Three scripts for the leadership demo. **[bracketed italics]** = the tool the agent calls behind
the scenes (show this on screen / in the trace to prove governed API access). Language is adapted
from fpl.com's FPL EVolution® Home program. All data comes from `mock_data.json` (synthetic).

Customer: **Emin Mugla** — Miami condo with an EVolution Home charger; just bought a single-family
home at **320 Anchorage Dr, North Palm Beach, FL 33408**.

---

## Scenario 1 — Customer reaches out (text + voice)

*Emin initiates. The agent answers using HIS data, not generic web info.*

**Emin:** Hey FPL — I just bought a place in North Palm Beach. Can I get EV home charging there,
and what do I need to set up a charger in my garage?

**FPL Agent:** Congrats on the new home, Emin. Let me check your account and that specific property.
> *[`get_customer_profile(phone="305-555-0142")`]*
> *[`match_property_to_customer(address="320 Anchorage Dr, North Palm Beach, FL 33408")`]*
> *[`check_ev_eligibility(premise_number="60587744")`]*

Good news — **320 Anchorage Dr is eligible** for FPL EVolution Home. It's a single-family home with
an attached garage, it has a smart meter, and there's strong Wi-Fi at the garage. Those are the
boxes we need to check.

One thing to set up first: EVolution Home requires an **active residential account in good standing**
at the home, and power isn't connected there yet under your name. Once we turn service on, EV
enrollment can go right through.

**Emin (voice):** Okay. And the charger itself — what's involved?

**FPL Agent:** It's an all-in-one program, no upfront cost. There are two options:
- **Get a charger — full installation, $36/month.** We do the electrical work for a 240-volt
  circuit, handle all permitting, and install a Level 2 charger. Typically completed in 2–3 months.
- **EV Ready — equipment-only, $27/month.** If you already have a 240-volt circuit in the garage,
  we just install and hardwire our charger. Usually 1–2 months.

> *[`get_premise_details(premise_number="60587744")`]*

I checked your garage record — there's **no 240-volt circuit there yet**, so I'd recommend the
**full installation at $36/month**. The process is five steps: enroll, electrical assessment (you
send us a couple of garage photos), permit, install in a single visit, then plug in and charge.

You'd also get **discounted off-peak charging** — and since you already run our charger at your Miami
place, you know the drill. The charger's the same model: Level 2, 9.6 kW, Wi-Fi, works with your
Tesla using the adapter.

**Emin:** Nice. Let's line it up.

**FPL Agent:** I'll do two things: start your power connection at North Palm Beach, then kick off the
EVolution Home enrollment so it's ready right after service goes live.
> *[`start_service_connection(premise_number="60587744")`]*
> *[`enroll_ev_charging(premise_number="60587744", install_type="full")`]*

Done. Power connection is scheduled for **June 13** with **no deposit** since you've been in good
standing since 2018. Your EVolution Home enrollment is started — next step is the electrical
assessment, and I'll text a link to upload garage photos. Anything else?

---

## Scenario 2 — Agent reaches out, proactively (voice-first)

*The agent is plugged into North Palm Beach City's home-registration feed. It sees a new-owner
record, recognizes Emin as an existing customer with a registered EV and an EVolution charger, and
calls him — unprompted.*

> *Trigger event (on screen): home-registration feed → new owner recorded at 320 Anchorage Dr.*
> *[`match_property_to_customer(address="320 Anchorage Dr, North Palm Beach, FL 33408")`
>   → matchedCustomer 1009988776, event NEW_OWNER_RECORDED]*
> *[`get_customer_profile(customer_number="1009988776")`
>   → registered EV: Tesla Model Y; EVolution Home charger at Miami premise 60412233]*

**FPL Agent (voice, outbound):** Hi Emin, this is your FPL assistant. Congratulations on the new home
at **320 Anchorage Dr in North Palm Beach** — I saw it come through on the property records. Since
you're already an FPL customer with us in Miami, I wanted to get ahead of a few things for you. Do
you have a minute?

**Emin:** Uh, sure.

**FPL Agent:** Great. Three quick things:

**(a) Power connection.** Service at the North Palm Beach home isn't on under your name yet. I can
schedule your electric connection now.
> *[`get_premise_details(premise_number="60587744")` → inactive, awaiting new-owner connect]*
> *[`start_service_connection(premise_number="60587744")`]*
I can have it **connected as early as June 13, with no deposit** since you're in good standing.

**(b) EV home charging.** I see you've got a **Tesla Model Y registered** and you already run an FPL
EVolution Home charger at your Miami condo.
> *[`check_ev_eligibility(premise_number="60587744")`]*
The North Palm Beach home **qualifies** for EVolution Home too. Your garage there doesn't have a
240-volt circuit yet, so I'd set you up on the **full installation at $36/month** — same charger and
same off-peak discount you have today. Want me to start that enrollment so it's ready when power goes
live?

**Emin:** Yes, do it.
> *[`enroll_ev_charging(premise_number="60587744", install_type="full")`]*
**FPL Agent:** Started. Next step is a quick electrical assessment — I'll text a link for garage
photos.

**(c) Your Miami account.** Last thing — are you **moving from Miami to North Palm Beach**, or
**keeping both homes**? That tells me whether to schedule a move-out at the Miami condo or leave it
active.

**Emin:** Keeping both.

**FPL Agent:** Perfect.
> *[`set_move_intent(keep_both)`]*
I'll **keep your Miami account active** — no move-out, and your Miami EVolution charger stays right
where it is. You'll get a confirmation for the North Palm Beach connection and EV enrollment by
email. Welcome to the neighborhood, Emin.

---

## Bonus Scenario — Account info (proactive + on-demand)

*Shows billing / usage / payment-date data via governed API access. Run it two ways.*

### 3a. Customer asks
**Emin:** What's my current FPL bill and when's it due?

**FPL Agent:**
> *[`get_account_summary(account_number="5210099001")`]*
> *[`get_billing_inquiry(account_number="5210099001")`]*

Your current bill is **$168.74**, due **June 18**. It covers **1,142 kWh** for the April 27–May 27
period — about **$5.62 a day**, and roughly **3% lower than the same month last year**. You're on
AutoPay, so it'll draft automatically on the 18th. Want the charge breakdown or your payment history?

**Emin:** How much of that was the car?

**FPL Agent:** Of the 1,142 kWh, about **286 kWh was EV charging** — and **261 of those were off-peak**,
which saved you roughly **$21 this month** versus charging on-peak. Charging overnight is doing its
job.

### 3b. Agent proactively brings it up
**FPL Agent (start of session):**
> *[`get_billing_inquiry(account_number="5210099001")`]*
> *[`get_payment_history(account_number="5210099001")`]*

Quick heads-up, Emin: your **June bill of $168.74 is due in 7 days, on June 18**, and AutoPay is set
to cover it — nothing you need to do. Your usage is trending **down** for the third month in a row.
Want me to walk through it?

---

## Trace cheat-sheet (what to show on screen)

| Scenario | Key tools that prove "governed API access" |
|----------|---------------------------------------------|
| 1 | `match_property_to_customer`, `check_ev_eligibility`, `get_premise_details`, `enroll_ev_charging` |
| 2 | **proactive** `match_property_to_customer` (event-triggered), `get_customer_profile`, `start_service_connection`, `enroll_ev_charging`, `set_move_intent` |
| Bonus | `get_account_summary`, `get_billing_inquiry`, `get_payment_history` |
