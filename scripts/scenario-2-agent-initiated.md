# Scenario 2: Agent Reaches Out Proactively

The agent is plugged into a synthetic North Palm Beach home-registration feed. It sees a new-owner record, recognizes Emin as an existing customer with a registered EV and an FPL EVolution Home charger, and calls him first.

Trigger trace:

- Home-registration feed: new owner recorded at 320 Anchorage Dr
- `match_property_to_customer(address="320 Anchorage Dr, North Palm Beach, FL 33408")`
- `get_customer_profile(customer_number="1009988776")`

FPL Agent voice: Hi Emin, this is your FPL assistant. Congratulations on the new home at 320 Anchorage Dr in North Palm Beach. I saw it come through on the property records. Since you are already an FPL customer with us in Miami, I wanted to get ahead of a few things for you. Do you have a minute?

Emin: Sure.

FPL Agent: Great. Three quick things.

FPL Agent: First, power connection. Service at the North Palm Beach home is not on under your name yet. I can schedule your electric connection now.

Tool trace:

- `get_premise_details(premise_number="60587744")`
- `get_service_connection_quote(premise_number="60587744")`

FPL Agent: I can have it connected as early as June 13 with no deposit because you are in good standing.

FPL Agent: Second, EV home charging. I see you have a Tesla Model Y registered and you already run an FPL EVolution Home charger at your Miami home.

Tool trace:

- `get_ev_enrollment(account_number="5210099001")`
- `check_ev_eligibility(premise_number="60587744")`

FPL Agent: The North Palm Beach home qualifies for EVolution Home once power service is active. Your garage there does not have a 240-volt circuit yet, so I would set you up on the full installation at $36/month: the same style of Level 2 charger and off-peak charging benefit you have today. Want me to start that enrollment so it is ready when power goes live?

Emin: Yes, do it.

Tool trace:

- `start_service_connection(premise_number="60587744")`
- `enroll_ev_charging(premise_number="60587744", install_type="full")`

FPL Agent: Started. Next step is a quick electrical assessment. I will text a link for garage photos.

FPL Agent: Third, your Miami account. Are you moving from Miami to North Palm Beach, or keeping both homes? That tells me whether to schedule a move-out at the Miami home or leave it active.

Emin: Keeping both.

Tool trace:

- `set_move_intent(intent="keep_both")`

FPL Agent: Perfect. I will keep your Miami account active. No move-out order was created, and your Miami EVolution charger stays right where it is. You will get a confirmation for the North Palm Beach connection and EV enrollment by email.