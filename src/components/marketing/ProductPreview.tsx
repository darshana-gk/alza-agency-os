import { Play } from 'lucide-react'

export interface ProductPreviewProps {
  title: string
  description: string
  /** When provided, renders a real clip. Omit until assets exist — never a broken video. */
  videoSrc?: string
}

export function ProductPreview({ title, description, videoSrc }: ProductPreviewProps) {
  const hasClip = Boolean(videoSrc && videoSrc.trim())

  return (
    <figure className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="relative aspect-video overflow-hidden bg-slate-900">
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-1.5 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-white/30" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-white/30" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-white/30" aria-hidden="true" />
          <span className="ml-2 truncate text-[11px] font-medium text-white/70">{title}</span>
        </div>
        {hasClip ? (
          <video
            className="h-full w-full object-cover"
            controls
            playsInline
            preload="metadata"
            src={videoSrc}
          >
            {title}
          </video>
        ) : (
          <div
            className="flex h-full flex-col items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(37,99,235,0.35),transparent_42%),radial-gradient(circle_at_80%_80%,rgba(13,148,136,0.28),transparent_40%),linear-gradient(160deg,#0f172a,#1e293b)] px-6 text-center"
            role="img"
            aria-label={`${title} product clip coming soon`}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white">
              <Play className="h-6 w-6 fill-white" aria-hidden="true" />
            </span>
            <p className="mt-4 text-sm font-medium text-white">Clip coming soon</p>
            <p className="mt-1 max-w-xs text-xs text-white/70">
              A short 15–40 second walkthrough will appear here.
            </p>
          </div>
        )}
      </div>
      <figcaption className="flex flex-1 flex-col px-5 py-4">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{description}</p>
      </figcaption>
    </figure>
  )
}
