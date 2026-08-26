/** Shipped with Billing V2 only — absent from Production / integrations legacy bundles. */
export const BILLING_CATALOG_UI_VERSION = 'v2' as const

export type BuildInfo = {
  billingCatalogUiVersion: typeof BILLING_CATALOG_UI_VERSION
  commitSha: string
  commitRef: string
  vercelEnv: string
  isVercelPreview: boolean
}

function viteString(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : 'local'
}

export function getBuildInfo(): BuildInfo {
  const commitSha = viteString('VITE_VERCEL_GIT_COMMIT_SHA')
  const commitRef = viteString('VITE_VERCEL_GIT_COMMIT_REF')
  const vercelEnv = viteString('VITE_VERCEL_ENV')
  return {
    billingCatalogUiVersion: BILLING_CATALOG_UI_VERSION,
    commitSha,
    commitRef,
    vercelEnv,
    isVercelPreview: vercelEnv === 'preview',
  }
}

export function formatBuildFingerprint(info = getBuildInfo()): string {
  const shortSha = info.commitSha === 'local' ? 'local' : info.commitSha.slice(0, 7)
  return `Billing catalog ${info.billingCatalogUiVersion} · ${info.commitRef} · ${shortSha}`
}
