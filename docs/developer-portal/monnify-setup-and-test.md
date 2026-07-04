# Monnify Reserved Accounts: Setup and Test Guide

This guide gets the Fleximotion reserved-account integration working in Monnify sandbox without waiting for production approval. It also records the production controls that must remain visible as the integration matures.

## What We Are Building

Each active operator receives a persistent Monnify customer reserved account. Deposits to that account are:

1. Reported quickly by a signed Monnify webhook.
2. independently verified against Monnify's transaction API.
3. matched to the operator through Fleximotion's account reference.
4. delivered to Ops as an idempotent normalized deposit event.
5. checked again by a periodic reconciliation job.

The payments integration service owns provider credentials, reserved-account mappings, raw webhook evidence, and reconciliation runs. Ops owns the canonical operator balance and financial position presented across MOS.

## Important Constraints

- A phone number alone is not sufficient to create a reserved account. Monnify's request requires a customer name and email, plus the contract code and a unique account reference.
- Monnify states that BVN or NIN verification is required for payments above the applicable regulatory limit. Raw BVN or NIN must never be committed to the repository, stored in ordinary logs, or passed through the public Ops API.
- Sandbox uses Monnify's transaction simulator. A real bank transfer to a sandbox account should not be treated as the acceptance test.
- Production account review, compliance, KYC, bank allocation, and go-live approval may introduce external waiting time. Start those activities in parallel; they must not block the sandbox build.
- Webhooks are the low-latency path, not the only correctness mechanism. A scheduled reconciliation job must backfill missed or delayed events.

## 1. Create the Sandbox Configuration

Create or obtain a Monnify sandbox account, then retrieve:

- API key
- secret key
- contract code
- webhook configuration access

Configure these outside source control:

```dotenv
MONNIFY_PROVIDER_MODE=sandbox
MONNIFY_BASE_URL=https://sandbox.monnify.com
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_CONTRACT_CODE=
MONNIFY_WEBHOOK_PUBLIC_URL=
```

Do not expose the API key or secret in a browser bundle. Production should use a secrets manager and separate credentials from sandbox.

For local development without Monnify credentials, use:

```bash
npm run dev:payments-api
```

For Monnify sandbox testing after credentials are configured, use:

```bash
npm run dev:payments-api:sandbox
```

## 2. Expose a Sandbox Webhook URL

Monnify must be able to reach the local webhook handler over HTTPS. Use an approved temporary tunnel during local testing and set:

```text
https://<temporary-host>/payments/v1/webhooks/monnify
```

The handler must preserve the unmodified request body and relevant headers before asynchronous processing. It should acknowledge validly formed requests quickly and perform verification, matching, and downstream delivery in a worker.

## 3. Create a Test Operator

Use a dedicated internal test operator linked to a real test person record. The test record should include:

- operator ID
- full name
- email address
- phone number for internal contact/testing
- amoeba assignment

Your own phone number may be used on the internal test person, but the reserved-account request still requires the name and email fields described above.

## 4. Provision the Reserved Account

Call the Fleximotion payments boundary:

```bash
curl -X POST "$PAYMENTS_BASE_URL/operators/$OPERATOR_ID/reserved-account" \
  -H "Authorization: Bearer $FLEXI_TOKEN" \
  -H "Idempotency-Key: monnify-provision-$OPERATOR_ID-v1" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Fleximotion Sandbox Operator",
    "customer_email": "sandbox-operator@example.com",
    "currency_code": "NGN"
  }'
```

The service creates a stable Monnify `accountReference`, calls Monnify's reserved-account endpoint, and stores the returned bank-account mapping. Repeating the same request with the same idempotency key must not create a second reserved account.

For KYC-enabled tests, pass only an opaque `kyc_reference` created by the approved encrypted KYC workflow. Do not send a raw BVN or NIN through this API.

## 5. Simulate a Deposit

Use the Monnify sandbox simulator to send a payment to the generated reserved account. Record:

- expected operator
- amount
- simulator/payment reference
- time initiated

The acceptance path is:

```text
simulator payment
  -> signed webhook
  -> raw evidence stored
  -> signature accepted
  -> transaction verified with Monnify
  -> reserved account matched to operator
  -> normalized deposit delivered to Ops
  -> finance view reflects the new financial position
```

## 6. Verify the Result

Confirm all of the following:

- one raw webhook-evidence record exists;
- one verified provider transaction exists;
- the reserved account maps to the intended operator;
- exactly one normalized deposit was delivered to Ops;
- the operator's financial position changed by the expected amount;
- Finance can see the deposit status and timestamp within its assigned scope;
- Manager and Supervisor views expose only the financial summary authorized for those roles.

The Payments Integration API exposes these review endpoints:

```text
GET  /payments/v1/reserved-accounts
GET  /payments/v1/webhook-events
GET  /payments/v1/transactions
POST /payments/v1/transactions/{transaction_reference}/verify
POST /payments/v1/transactions/{transaction_reference}/settle
POST /payments/v1/transactions/{transaction_reference}/finance-approve
GET  /payments/v1/reconciliation-runs
POST /payments/v1/reconciliation-runs
GET  /payments/v1/accounting-period-closes
POST /payments/v1/accounting-period-closes
```

Reserved-account rows include `current_balance_ngn`, `total_deposits_ngn`, and `last_deposit_at`. In local simulated mode these are projected from verified deposit events; in production they should be reconciled against Monnify/bank balance data when the provider exposes it.

Deposit transactions use the state sequence `received -> verified -> matched -> delivered_to_ops -> reconciled -> settled -> finance_approved`. Phase 4D closes the local workflow through settlement, finance approval and accounting-period close.

## 7. Test Failure and Replay Behaviour

Run these tests before accepting the sandbox slice:

1. Replay the same webhook and confirm no duplicate balance movement.
2. Submit an invalid signature and confirm it is rejected and audited.
3. Submit a valid event for an unknown account and confirm it is quarantined for Finance review.
4. Interrupt downstream Ops delivery, retry it, and confirm eventual single delivery.
5. Re-run reserved-account provisioning with the same idempotency key.
6. Verify a known transaction manually through the transaction-verification endpoint.
7. Confirm the transaction list shows the expected state transition.

## 8. Test Scheduled Reconciliation

Run a bounded reconciliation for the test period:

```bash
curl -X POST "$PAYMENTS_BASE_URL/reconciliation-runs" \
  -H "Authorization: Bearer $FLEXI_TOKEN" \
  -H "Idempotency-Key: monnify-reconcile-2026-06-12-sandbox" \
  -H "Content-Type: application/json" \
  -d '{
    "period_start": "2026-06-12T00:00:00+01:00",
    "period_end": "2026-06-12T23:59:59+01:00"
  }'
```

The run should compare Monnify's authoritative transactions with local verified and delivered deposits, repair safe omissions, and create explicit exceptions for anything that cannot be matched automatically.

Production scheduling should include:

- frequent incremental reconciliation for recent transactions;
- a daily closed-period reconciliation;
- retries with backoff;
- alerts when webhook freshness, provider access, delivery, or reconciliation falls outside target;
- manual replay controls with a complete audit trail.

## Production Readiness Gate

- Production Monnify account and contract are approved.
- Production API credentials are stored in a secrets manager.
- Public webhook endpoint uses HTTPS and provider signature verification.
- KYC handling has an approved encrypted storage and access model.
- Sandbox and production data cannot mix.
- Transaction verification and idempotent Ops delivery are enabled.
- Scheduled reconciliation and exception alerts are operational.
- Finance has unmatched-receipt, provider-health, and reconciliation views.
- Audit retention and personal-data handling are approved.
- A low-value live deposit has completed end to end before wider operator rollout.

## Phase 4C Local Acceptance

The MOS-side Phase 4C slice is complete when:

- simulated reserved-account provisioning writes back to Ops;
- signed simulated deposits create raw webhook evidence and one deposit transaction;
- replayed deposits do not duplicate Ops cash movements;
- invalid signatures are rejected and audited;
- valid events for unknown accounts are quarantined;
- manual verification can safely replay matching and delivery;
- reconciliation marks delivered deposits as reconciled;
- Finance can see provider mode, reserved accounts, deposit count, unmatched evidence and reconciliation runs.

## Official References

- [Monnify customer reserved accounts](https://developers.monnify.com/docs/collections/recurring-payments/reserved-accounts)
- [Monnify developer documentation](https://developers.monnify.com/)

Provider field names, signature rules, and production requirements must be checked against the active Monnify documentation at implementation time.
