export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-razorpay-signature, x-razorpay-event-id',
}

export function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function fail(code: string, message: string, status = 400) {
  return jsonResponse({ ok: false, code, message }, status)
}

export function ok(body: Record<string, unknown> = {}, status = 200) {
  return jsonResponse({ ok: true, ...body }, status)
}
