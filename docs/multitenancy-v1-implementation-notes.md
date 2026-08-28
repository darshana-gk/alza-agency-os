# ALZA Flow Multi-Tenancy V1 — implementation notes

Source-only checklist. Do not treat this file as authorization to apply migrations or change Production.

## Phase 2A (authored)

Additive nullable `agency_profile_id` + FK + non-unique index + Tenant 1 backfill on:

- original 16 tables that lacked the column
- plus `transaction_number_counters` and `producer_payment_batch_number_counters`
- `recovery_number_counters` stays in the original 16
- `task_number_counters` is **not** included (product ownership unconfirmed)

Does not change RLS, numbering uniqueness, counter PKs, numbering functions, or application/Edge behavior.

### Timestamp preservation (Phase 2A backfill)

Live Production `public.set_updated_at()` is a BEFORE UPDATE trigger function (predating this repo) that assigns `NEW.updated_at := now()`. `UPDATE ... SET updated_at = updated_at` cannot preserve history.

Phase 2A therefore:

1. Catalog-discovers non-internal triggers whose function is `public.set_updated_at` on tables the backfill UPDATEs.
2. `ALTER TABLE ... DISABLE TRIGGER <exact name>` for those only.
3. Runs the `agency_profile_id` UPDATEs.
4. Re-enables the same triggers immediately.
5. On abort (`EXCEPTION WHEN OTHERS`), re-enables then re-raises so a failed migration cannot leave them disabled.

Known Production trigger names (catalog may find extras on staging):

- `agency_commission_receipts_set_updated_at`
- `carriers_set_updated_at`
- `csrs_set_updated_at`
- `mgas_set_updated_at`
- `producer_commission_recoveries_set_updated_at`
- `producer_payment_batches_set_updated_at`
- `transactions_set_updated_at`
- `users_set_updated_at`

`session_replication_role = replica` is **not** used: it would also skip unrelated integrity/security triggers (lifecycle, recovery cap, `alza_support` lock). `DISABLE TRIGGER ALL` is **not** used.

## Production findings deferred to later phases

Do not fix in Phase 2A. Track through Phase 3/4 (security) and Phase 2B (uniqueness):

| Finding | When |
|---|---|
| `users` RLS is effectively open (`Allow all users` ALL … `USING true` to `{public}`) | Phase 3 |
| `clients` has anonymous SELECT (`Allow anon read clients` … `true`) | Phase 3 |
| Directory SELECT is global (`USING true` on carriers/MGAs/producers/CSRs) | Phase 3 |
| CSR `transactions_update_ops` / `transactions_delete_ops` too broad (`is_ops_staff()`) | Phase 3 (approval RPCs + deny hard-delete) |
| Reconciliation RLS is ops-global (`is_ops_staff()`, no tenant predicate) | Phase 3 |
| `billing_subscriptions` SELECT is any Owner/Admin, no tenant predicate | Phase 3 |
| `agency-branding` bucket is public (entire-bucket SELECT) | Phase 3/4 storage |
| Transaction / batch / recovery **counters and numbers are global** (`year` PK; global UNIQUE on numbers) | Phase 2B |
| Duplicate global unique indexes on `transactions.transaction_number` (`transactions_transaction_number_key` and `transactions_transaction_number_uidx`) | Phase 2B |
| `task_number_counters` exists on Production; product ownership unconfirmed — **not** in Phase 2A | decide before 2B |
| Broad `anon` table GRANTs; isolation is policy-only | Phase 3 |
