import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const allowedOrigins = new Set([
  'https://nitraspace.xyz',
  'https://www.nitraspace.xyz',
  'https://nitra-space-social-preview.vercel.app',
  'http://localhost:5173',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://nitraspace.xyz',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function response(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return response(request, { error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return response(request, { error: 'Authentication required' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response(request, { error: 'Server configuration error' }, 500)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return response(request, { error: 'Invalid session' }, 401)

  const { data: isAdmin, error: adminError } = await userClient.rpc('is_admin')
  if (adminError || isAdmin !== true) return response(request, { error: 'Admin access required' }, 403)

  let payload: { action?: string; user_id?: string }
  try {
    payload = await request.json()
  } catch {
    return response(request, { error: 'Invalid JSON body' }, 400)
  }

  if (!['ban', 'unban'].includes(payload.action || '') || !payload.user_id) {
    return response(request, { error: 'Invalid admin action' }, 400)
  }
  if (payload.user_id === userData.user.id) return response(request, { error: 'Admin cannot ban own account' }, 400)

  const { data: targetIsAdmin, error: targetError } = await userClient.rpc('admin_target_is_admin', { p_target: payload.user_id })
  if (targetError) return response(request, { error: targetError.message }, 400)
  if (targetIsAdmin) return response(request, { error: 'Another admin account cannot be banned' }, 400)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const banned = payload.action === 'ban'
  const { error: updateError } = await adminClient.auth.admin.updateUserById(payload.user_id, {
    ban_duration: banned ? '876000h' : 'none',
  })
  if (updateError) return response(request, { error: updateError.message }, 400)

  const { error: auditError } = await adminClient.rpc('admin_record_ban', {
    p_admin: userData.user.id,
    p_target: payload.user_id,
    p_banned: banned,
  })
  if (auditError) {
    const { error: rollbackError } = await adminClient.auth.admin.updateUserById(payload.user_id, {
      ban_duration: banned ? 'none' : '876000h',
    })
    if (rollbackError) console.error('Auth ban rollback failed:', rollbackError.message)
    return response(request, { error: auditError.message }, 500)
  }

  return response(request, { success: true, banned })
})
