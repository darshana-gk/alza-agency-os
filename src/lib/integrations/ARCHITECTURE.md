# Integration Center V1 — Architecture Notes

Foundation only. No live vendor connectors. No Production migration applied.

## Sync pipeline

`Source → Fetch → Normalize → Map → Validate → Deduplicate → ALZA canonical model → Sync result/history`

## Canonical routing

AMS/CRM connectors must write to existing ALZA entities: Clients, Policies, Carriers, MGAs, Producers, CSRs.
Reuse Onboarding V1 validation/deduplication principles. No vendor shadow copies of those entities.

## External identifiers

Durable map: `(agency_id, provider_id, entity_type, external_id) → alza_id`.
Incremental sync must not rely on names alone.

## Conflict / field ownership

- External source may own policy number / effective dates when connected.
- ALZA owns reconciliation status, receipt confirmation, and internal commission workflow.
- Manual ALZA edits must not be silently overwritten without explicit rules.
- Complex conflict resolution is deferred.

## Carrier/MGA commission feeds

Normalized feed lines hand off to **existing** Reconciliation staging → matching → review → receipt confirmation.
Manual statement upload remains supported. Do not build a second reconciliation engine.

## Payment / bank / accounting evidence

Evidence associates to expected settlements. Amount match alone never auto-confirms commission receipt.

## Security

OAuth/API credentials: server-side encrypted/managed only. Never browser/localStorage. Never in the provider catalog.

## Proposed schema (NOT APPLIED)

See `docs/proposed-integration-center-schema.md`. Stop before applying any production migration.
