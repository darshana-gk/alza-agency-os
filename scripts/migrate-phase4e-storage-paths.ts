/**
 * Phase 4E idempotent storage copy: legacy → agency-prefixed paths.
 *
 * STAGING ONLY unless the caller explicitly passes a matching linked ref.
 * Aborts if the linked project is Production.
 *
 *   npx tsx scripts/migrate-phase4e-storage-paths.ts
 *   npx tsx scripts/migrate-phase4e-storage-paths.ts --self-test
 *
 * Does not delete legacy objects. Does not drop Phase 3D compatibility policies.
 * Unknown prefixes (e.g. staging/dummy-invoice.pdf) are skipped, not rewritten.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AGENCY_BRANDING_BUCKET,
  SUPPORTING_DOCUMENTS_BUCKET,
  agencyBrandingLogoPath,
  parseLegacyBrandingLogoPath,
  parseLegacySupportingDocumentPath,
  parsePrefixedBrandingLogoPath,
  parsePrefixedSupportingDocumentPath,
  supportingDocumentObjectPath,
} from '../src/lib/storagePaths.ts'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const TENANT1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const SELF_TEST = process.argv.includes('--self-test')

type ObjectRow = { bucket_id: string; name: string }
type DocRow = {
  id: string
  agency_profile_id: string | null
  entity_type: string
  entity_id: string
  storage_path: string
}

function readLinkedRef(): string {
  return readFileSync(resolve('supabase/.temp/project-ref'), 'utf8').trim()
}

function loadKeys(): { url: string; anon: string; service: string } {
  const json = execSync(`npx supabase projects api-keys --project-ref ${STAGING_REF} -o json`, {
    encoding: 'utf8',
  })
  const raw = JSON.parse(json.replace(/^\uFEFF/, ''))
  const list = Array.isArray(raw) ? raw : raw?.api_keys ?? []
  let anon = ''
  let service = ''
  for (const row of list) {
    const name = String(row.name ?? row.id ?? '').toLowerCase()
    const key = String(row.api_key ?? row.key ?? '')
    if (name.includes('anon')) anon = key
    if (name.includes('service_role') || name === 'service') service = key
  }
  if (!anon || !service) throw new Error('missing staging anon or service_role key')
  const url = `https://${STAGING_REF}.supabase.co`
  if (url.includes(PRODUCTION_REF)) throw new Error('ABORT: production URL')
  return { url, anon, service }
}

function dbQuery(sql: string): unknown {
  const file = resolve('tmp-phase4e-migrate-query.sql')
  writeFileSync(file, sql, 'utf8')
  const out = execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${file}`, {
    encoding: 'utf8',
  })
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`no JSON in db query output: ${out.slice(0, 400)}`)
  return JSON.parse(out.slice(start, end + 1))
}

function inspectPayload(): {
  objects: ObjectRow[]
  docs: DocRow[]
  logos: Array<{ id: string; logo_url: string | null }>
} {
  const raw = dbQuery(`
SELECT jsonb_build_object(
  'objects', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('bucket_id', bucket_id, 'name', name) ORDER BY bucket_id, name), '[]'::jsonb)
    FROM storage.objects
    WHERE bucket_id IN ('agency-branding', 'supporting-documents', 'reconciliation-statements')
  ),
  'docs', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'agency_profile_id', agency_profile_id,
      'entity_type', entity_type,
      'entity_id', entity_id,
      'storage_path', storage_path
    ) ORDER BY id), '[]'::jsonb)
    FROM public.supporting_documents
  ),
  'logos', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'logo_url', logo_url) ORDER BY id), '[]'::jsonb)
    FROM public.agency_profile
  )
) AS inspect
`) as { rows?: Array<{ inspect: Record<string, unknown> }> }
  const inspect = raw.rows?.[0]?.inspect
  if (!inspect) throw new Error('inspect returned no rows')
  return {
    objects: (inspect.objects as ObjectRow[]) ?? [],
    docs: (inspect.docs as DocRow[]) ?? [],
    logos: (inspect.logos as Array<{ id: string; logo_url: string | null }>) ?? [],
  }
}

async function objectExists(admin: SupabaseClient, bucket: string, path: string): Promise<boolean> {
  const { data, error } = await admin.storage.from(bucket).download(path)
  return !error && Boolean(data)
}

async function copyIfNeeded(
  admin: SupabaseClient,
  bucket: string,
  source: string,
  dest: string,
): Promise<'copied' | 'already' | 'missing-source'> {
  const sourceOk = await objectExists(admin, bucket, source)
  if (!sourceOk) return 'missing-source'
  const destOk = await objectExists(admin, bucket, dest)
  if (destOk) return 'already'
  const { error } = await admin.storage.from(bucket).copy(source, dest)
  if (error) throw new Error(`copy ${bucket}:${source} → ${dest}: ${error.message}`)
  return 'copied'
}

function agencyForLegacyDoc(docs: DocRow[], entityType: string, entityId: string, sourcePath: string): string | null {
  const byPath = docs.find((d) => d.storage_path === sourcePath && d.agency_profile_id)
  if (byPath?.agency_profile_id) return String(byPath.agency_profile_id)
  const byEntity = docs.find(
    (d) => d.entity_type === entityType && d.entity_id === entityId && d.agency_profile_id,
  )
  if (byEntity?.agency_profile_id) return String(byEntity.agency_profile_id)
  return null
}

async function migrateInventory(
  admin: SupabaseClient,
  snapshot: ReturnType<typeof inspectPayload>,
): Promise<{
  copied: string[]
  already: string[]
  skipped: string[]
  dbUpdated: string[]
}> {
  const copied: string[] = []
  const already: string[] = []
  const skipped: string[] = []
  const dbUpdated: string[] = []

  for (const obj of snapshot.objects) {
    if (obj.bucket_id === AGENCY_BRANDING_BUCKET) {
      if (parsePrefixedBrandingLogoPath(obj.name)) continue
      const legacy = parseLegacyBrandingLogoPath(obj.name)
      if (!legacy) {
        skipped.push(`${obj.bucket_id}:${obj.name}`)
        continue
      }
      const dest = agencyBrandingLogoPath(legacy.agencyProfileId, legacy.ext)
      const result = await copyIfNeeded(admin, AGENCY_BRANDING_BUCKET, obj.name, dest)
      if (result === 'copied') copied.push(`${obj.name} → ${dest}`)
      if (result === 'already') already.push(`${obj.name} → ${dest}`)
      if (result === 'copied' || result === 'already') {
        const logo = snapshot.logos.find((l) => l.id === legacy.agencyProfileId)
        const url = logo?.logo_url ?? ''
        if (!url || url.includes(obj.name) || url.includes(`logo/${legacy.agencyProfileId}`)) {
          const { data: pub } = admin.storage.from(AGENCY_BRANDING_BUCKET).getPublicUrl(dest)
          const { error } = await admin
            .from('agency_profile')
            .update({ logo_url: pub.publicUrl, updated_at: new Date().toISOString() })
            .eq('id', legacy.agencyProfileId)
          if (error) throw new Error(`logo_url update: ${error.message}`)
          dbUpdated.push(`agency_profile.logo_url ${legacy.agencyProfileId}`)
        }
      }
      continue
    }

    if (obj.bucket_id === SUPPORTING_DOCUMENTS_BUCKET) {
      if (parsePrefixedSupportingDocumentPath(obj.name)) continue
      const legacy = parseLegacySupportingDocumentPath(obj.name)
      if (!legacy) {
        skipped.push(`${obj.bucket_id}:${obj.name}`)
        continue
      }
      const agencyId = agencyForLegacyDoc(snapshot.docs, legacy.entityType, legacy.entityId, obj.name)
      if (!agencyId) {
        skipped.push(`${obj.bucket_id}:${obj.name} (no tenant mapping)`)
        continue
      }
      const dest = supportingDocumentObjectPath(agencyId, legacy.entityType, legacy.entityId, legacy.rest)
      const result = await copyIfNeeded(admin, SUPPORTING_DOCUMENTS_BUCKET, obj.name, dest)
      if (result === 'copied') copied.push(`${obj.name} → ${dest}`)
      if (result === 'already') already.push(`${obj.name} → ${dest}`)
      if (result === 'copied' || result === 'already') {
        const { data, error } = await admin
          .from('supporting_documents')
          .update({ storage_path: dest })
          .eq('storage_path', obj.name)
          .select('id')
        if (error) throw new Error(`storage_path update: ${error.message}`)
        for (const row of data ?? []) dbUpdated.push(`supporting_documents ${row.id}`)
      }
      continue
    }
  }

  for (const doc of snapshot.docs) {
    const path = doc.storage_path
    if (!path) continue
    if (parsePrefixedSupportingDocumentPath(path)) continue
    if (parseLegacySupportingDocumentPath(path)) continue
    skipped.push(`db:${doc.id} storage_path=${path} (unknown prefix, left unchanged)`)
  }

  return { copied, already, skipped, dbUpdated }
}

async function runSelfTest(admin: SupabaseClient): Promise<void> {
  const tag = `phase4e-selftest-${Date.now()}`
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  )
  const legacyLogo = `logo/${TENANT1}.png`
  const destLogo = agencyBrandingLogoPath(TENANT1, 'png')
  const legacyDoc = `transaction/${tag}/probe.txt`
  const destDoc = supportingDocumentObjectPath(TENANT1, 'transaction', tag, 'probe.txt')
  const cleanup = [legacyLogo, destLogo]
  const docCleanup = [legacyDoc, destDoc]

  try {
    const upLogo = await admin.storage.from(AGENCY_BRANDING_BUCKET).upload(legacyLogo, png, {
      upsert: true,
      contentType: 'image/png',
    })
    if (upLogo.error) throw new Error(`self-test logo seed: ${upLogo.error.message}`)
    const first = await copyIfNeeded(admin, AGENCY_BRANDING_BUCKET, legacyLogo, destLogo)
    const second = await copyIfNeeded(admin, AGENCY_BRANDING_BUCKET, legacyLogo, destLogo)
    if (first !== 'copied' && first !== 'already') throw new Error(`self-test logo copy: ${first}`)
    if (second !== 'already') throw new Error(`self-test logo not idempotent: ${second}`)

    const upDoc = await admin.storage.from(SUPPORTING_DOCUMENTS_BUCKET).upload(legacyDoc, new Blob(['probe']), {
      upsert: true,
      contentType: 'text/plain',
    })
    if (upDoc.error) throw new Error(`self-test doc seed: ${upDoc.error.message}`)
    const docFirst = await copyIfNeeded(admin, SUPPORTING_DOCUMENTS_BUCKET, legacyDoc, destDoc)
    const docSecond = await copyIfNeeded(admin, SUPPORTING_DOCUMENTS_BUCKET, legacyDoc, destDoc)
    if (docFirst !== 'copied' && docFirst !== 'already') throw new Error(`self-test doc copy: ${docFirst}`)
    if (docSecond !== 'already') throw new Error(`self-test doc not idempotent: ${docSecond}`)
    console.log(`  OK: self-test copied ${legacyLogo} → ${destLogo} (idempotent=${second})`)
    console.log(`  OK: self-test copied ${legacyDoc} → ${destDoc} (idempotent=${docSecond})`)
  } finally {
    await admin.storage.from(AGENCY_BRANDING_BUCKET).remove(cleanup)
    await admin.storage.from(SUPPORTING_DOCUMENTS_BUCKET).remove(docCleanup)
  }
}

async function main() {
  const linked = readLinkedRef()
  if (linked !== STAGING_REF || linked === PRODUCTION_REF) {
    throw new Error(`ABORT linked ${linked}`)
  }
  const { url, service } = loadKeys()
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

  const snapshot = inspectPayload()
  console.log(
    JSON.stringify(
      {
        objectCount: snapshot.objects.length,
        docRows: snapshot.docs.length,
        objects: snapshot.objects,
        docs: snapshot.docs.map((d) => ({ id: d.id, storage_path: d.storage_path })),
      },
      null,
      2,
    ),
  )

  const result = await migrateInventory(admin, snapshot)
  console.log(JSON.stringify({ migration: result }, null, 2))

  if (SELF_TEST) {
    await runSelfTest(admin)
  }

  console.log('Phase 4E storage migration complete (legacy objects preserved).')
}

main().catch((err) => {
  console.error(String(err?.stack ?? err))
  process.exit(1)
})
