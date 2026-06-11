# Scenario 1: Customer Reaches Out

Emin initiates. The agent answers using his data, not generic web information.

Emin: Hey FPL. I just bought a place in North Palm Beach. Can I get EV home charging there, and what do I need to set up a charger in my garage?

FPL Agent: Congrats on the new home, Emin. Let me check your account and that specific property.

Tool trace:

- `get_customer_profile(phone="305-555-0142")`
- `match_property_to_customer(address="320 Anchorage Dr, North Palm Beach, FL 33408")`
- `check_ev_eligibility(premise_number="60587744")`

FPL Agent: Good news. 320 Anchorage Dr is eligible for FPL EVolution Home once power service is active there. It is a single-family home with an attached garage, it has a smart meter, and there is strong Wi-Fi at the garage.

FPL Agent: One thing to set up first: EVolution Home requires an active residential account in good standing at the home, and power is not connected there yet under your name. Once we turn service on, EV enrollment can move forward.

Emin: Okay. And the charger itself, what is involved?

FPL Agent: It is an all-in-one program with no upfront cost. There are two options: Get a charger, which is full installation at $36/month, or EV Ready, which is equipment-only at $27/month if you already have a 240-volt circuit in the garage.

Tool trace:

- `get_premise_details(premise_number="60587744")`
- `get_ev_enrollment(account_number="5210099001")`

FPL Agent: I checked the North Palm Beach garage record. There is no 240-volt circuit there yet, so I recommend the full installation at $36/month. The process is enroll, electrical assessment, garage photos, permit, installation in one visit, then plug in and charge.

FPL Agent: Since you already run our FPL EVolution Home charger at your Miami place, this would feel familiar: Level 2, 9.6 kW, Wi-Fi, and compatible with your Tesla using the adapter.

Emin: Nice. Let's line it up.

FPL Agent: I will do two things: start your power connection at North Palm Beach, then kick off the EVolution Home enrollment so it is ready after service goes live.

Tool trace:

- `get_service_connection_quote(premise_number="60587744")`
- `start_service_connection(premise_number="60587744")`
- `enroll_ev_charging(premise_number="60587744", install_type="full")`

FPL Agent: Done. Power connection is scheduled for June 13 with no deposit since you have been in good standing since 2018. Your EVolution Home enrollment is started. The next step is the electrical assessment, and I will text a link to upload garage photos.