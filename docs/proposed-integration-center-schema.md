# Proposed Integration Center schema (NOT APPLIED)

**Status:** Recommendation only for review.  
**Do not apply to Production in this foundation PR.**

When approved, a future migration could add:

## `integration_connections`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| agency_id | uuid | tenant |
| provider_id | text | catalog id |
| category | text | |
| status | text | connected / action_required / syncing / error / requested |
| external_account_id | text null | |
| external_tenant_id | text null | |
| created_at | timestamptz | |
| last_successful_sync_at | timestamptz null | |
| last_attempted_sync_at | timestamptz null | |
| next_sync_at | timestamptz null | |
| sync_direction | text | inbound / outbound / bidirectional |
| sync_mode | text | manual / scheduled / webhook / hybrid |
| error_code | text null | |
| error_message | text null | |
| reconnect_required | boolean | |
| disconnected_at | timestamptz null | |
| metadata | jsonb | non-secret only |

Credentials live in a **separate server-only secrets store** (or vault table with encryption), never in this row’s readable client columns and never in localStorage.

## `integration_external_ids`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| agency_id | uuid | |
| provider_id | text | |
| entity_type | text | clients / policies / carriers / mgas / producers / csrs |
| external_id | text | durable source id |
| alza_id | uuid | |
| external_secondary_ids | jsonb | |
| last_seen_at | timestamptz | |
| created_at | timestamptz | |
| unique | (agency_id, provider_id, entity_type, external_id) | |

## `integration_sync_runs`

History of sync started/completed/failed with counts; no secrets in logs.
