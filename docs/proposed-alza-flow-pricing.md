# Proposed ALZA Flow pricing (not wired to Production billing on this branch)

**Source of annual discount rule (confirmed in repo WIP, not inventing):**

In `src/lib/billingCatalog.ts` (local WIP / non-Production tree):

- `annualPriceFromMonthly(monthly) = monthly * 10`
- Quote summary includes **"2 months free"**
- Equivalent: pay for 10 months, get 12

Production/`origin/main` still uses legacy Essential/Professional only.
This document prepares the catalog for a future billing branch — **do not apply from Integration Center alone**.

## ALZA Flow (purchasable when Razorpay plans exist)

| Users | Monthly | Annual (10×) | List annual (12×) | Savings |
|---|---:|---:|---:|---:|
| 1–3 | $399 | $3,990 | $4,788 | $798 |
| 4–10 | $599 | $5,990 | $7,188 | $1,198 |
| 11–25 | $899 | $8,990 | $10,788 | $1,798 |
| 26–50 | $1,099 | $10,990 | $13,188 | $2,198 |
| 51–100 | $1,499+/mo | Contact / not automated checkout | — | — |
| 100+ / complex | Custom | Custom | — | — |

## ALZA Flow Pay (display only — Coming Soon, NOT purchasable)

| Users | Monthly (display) | Annual display (10×) |
|---|---:|---:|
| 1–3 | $499 | $4,990 |
| 4–10 | $699 | $6,990 |
| 11–25 | $999 | $9,990 |
| 26–50 | $1,299 | $12,990 |
| 51–100 | $1,799+/mo | Contact / not checkout |
| 100+ / complex | Custom | Custom |

## Legacy (existing subs only — no new checkout)

- Essential $299/mo
- Professional $499/mo

## Still required before Production billing cutover

1. Ship catalog UI on a billing-focused change set (Monthly | Annual toggle, Flow Pay Coming Soon).
2. Additive `plan_key` / interval schema on `billing_subscriptions` (`agency_profile`).
3. Create Razorpay Plans + secrets for checkout-eligible Flow bands.
4. Block new Essential/Professional checkout; keep webhook compatibility for legacy rows.
5. Soft seat entitlements; hard gate later.
