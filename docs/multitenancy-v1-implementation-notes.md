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

## Phase 2B (authored, not applied)

Two migrations: **2B-prep** then **2B-finalize**. Do not apply until dedicated staging review.

### Numbering

Counters move from `PRIMARY KEY (year)` to `PRIMARY KEY (agency_profile_id, year)`.

`next_transaction_number` / `next_producer_payment_batch_number` / `next_recovery_number` allocate from that identity.

Agency for a **new** number is:

1. `NEW.agency_profile_id` on the inserting row, else
2. `current_user_agency_profile_id()` (authenticated membership)

Never the first/singleton `agency_profile` row. The helper does **not** stamp `agency_profile_id` onto the row — that remains Phase 3/4. If neither source is present, numbering **raises** rather than guessing.

Historical `transaction_number` / `batch_number` / `recovery_number` values are never rewritten. Counter `last_value` is raised with `GREATEST(existing, max parsed suffix)`.

### Uniqueness

| Number | Rule |
|---|---|
| `client_number` | unique `(agency_profile_id, client_number)` when both present; **plus** transitional global unique on `lower(btrim(client_number))` until Phase 3 stamping (Production had no global unique; without it NULL + Tenant-1 could share a number) |
| `policy_number` | unique `(client_id, policy_number)` — **per client, not per agency** |
| `transaction_number` | unique `(agency_profile_id, transaction_number)` **additive**; **retain** `transactions_transaction_number_key` **and** `transactions_transaction_number_uidx` until Phase 3 |
| `batch_number` | unique `(agency_profile_id, batch_number)` **additive**; **retain** global `producer_payment_batches_batch_number_key` until Phase 3 |
| `recovery_number` | unique `(agency_profile_id, recovery_number)` **additive**; **retain** global `producer_commission_recoveries_recovery_number_key` until Phase 3 |
| Directory names (carrier/MGA/producer/CSR) | **no unique index** — labels, duplicates exist, two agencies may share a name; isolation is Phase 3 RLS |

NULL-agency unique bridges unique only the NULL bucket. They do **not** prevent `(Agency A, NUM)` + `(NULL, NUM)`. Stamp-safety is the retained/added **global** unique on the number. Drop global uniques in Phase 3 only after insert-stamping and backfill of remaining NULL numbered rows.

### Cross-tenant FKs

`UNIQUE (id, agency_profile_id)` on parents + composite FKs `(parent_id, agency_profile_id)`. MATCH SIMPLE: a NULL tenant on either side is not checked (RC inserts stay valid). Producer TEXT on transactions is not FK-enforceable.

MATCH SIMPLE gaps close in Phase 3/4 when inserts stamp `agency_profile_id` and remaining NULL business rows are backfilled, then `SET NOT NULL`. Stamp **parents before children** (clients → policies → transactions → receipts/batches/recoveries → items/allocations/recon rows/docs). `A` child + NULL parent is rejected by the composite FKs.

### NOT NULL

- **Counters:** `agency_profile_id SET NOT NULL` in 2B (only numbering functions write them).
- **App-written rows (clients, policies, transactions, …):** remain nullable until Phase 3/4 stamps inserts. `CHECK (... IS NOT NULL) NOT VALID` still rejects new NULL inserts, so it is **not** used.

### Singleton

Keep `agency_profile_singleton` until Phase 3/4. Removing it would allow Agency 2 before RLS/application isolation.

### `task_number_counters`

No repo application references (only Phase 2A exclusion). Production table exists; product ownership unconfirmed. **Not altered in 2B.**

### Agency B

Do not insert Tenant 2 until Phase 3/4: tenant stamping, RLS, NOT NULL, drop NULL-agency unique bridges, drop singleton.

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
| Transaction / batch / recovery **counters and numbers are global** (`year` PK; global UNIQUE on numbers) | Phase 2B moves counters to `(agency, year)`; **global number uniques retained** until Phase 3 stamping |
| Duplicate global unique indexes on `transactions.transaction_number` (`transactions_transaction_number_key` and `transactions_transaction_number_uidx`) | Phase 3 (drop **both** together after stamping; do not drop in 2B) |
| `task_number_counters` exists on Production; product ownership unconfirmed — **not** in Phase 2A | decide before 2B |
| Broad `anon` table GRANTs; isolation is policy-only | Phase 3 |
