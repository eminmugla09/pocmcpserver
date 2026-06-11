# Bonus Scenario: Account Info

This scenario shows billing, usage and payment-date data via governed-style tool access.

## Customer Asks

Emin: What is my current FPL bill and when is it due?

Tool trace:

- `get_account_summary(account_number="5210099001")`
- `get_billing_inquiry(account_number="5210099001")`

FPL Agent: Your current bill is $168.74, due June 18. It covers 1,142 kWh for the April 27 to May 27 period, about $5.62 a day, and roughly 3% lower than the same month last year. You are on AutoPay, so it will draft automatically on the 18th. Want the charge breakdown or your payment history?

Emin: How much of that was the car?

FPL Agent: Of the 1,142 kWh, about 286 kWh was EV charging, and 261 of those were off-peak. That saved you roughly $21 this month versus charging on-peak.

## Agent Proactively Brings It Up

Tool trace:

- `get_billing_inquiry(account_number="5210099001")`
- `get_payment_history(account_number="5210099001")`
- `get_usage_history(account_number="5210099001")`

FPL Agent: Quick heads-up, Emin: your June bill of $168.74 is due in 7 days, on June 18, and AutoPay is set to cover it. Your usage is trending down for the third month in a row. Want me to walk through it?