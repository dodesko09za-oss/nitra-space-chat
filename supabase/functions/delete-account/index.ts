import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const allowedOrigins = new Set([
  'https://nitraspace.xyz',
  'https://www.nitraspace.xyz',
  'https://nitra-space-social-preview.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5176',
])

const cors = (request: Request) => {
  const origin = request.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
const json = (request: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(request), 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(request) })
  const origin = request.headers.get('origin') || ''
  if (!allowedOrigins.has(origin)) return json(request, { error: 'Nepovolený pôvod.' }, 403)
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization?.startsWith('Bearer ') || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(request, { error: 'Authentication required' }, 401)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error: userError } = await userClient.auth.getUser()
  if (userError || !data.user) return json(request, { error: 'Invalid session' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await adminClient.auth.admin.deleteUser(data.user.id)
  if (error) return json(request, { error: 'Účet sa nepodarilo vymazať.' }, 400)
  return json(request, { success: true })
})
