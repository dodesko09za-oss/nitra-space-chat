import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const allowedOrigins = new Set([
  'https://nitraspace.xyz',
  'https://www.nitraspace.xyz',
  'https://nitra-space-social-preview.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
])

function headers(request: Request) {
  const origin = request.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(request), 'Content-Type': 'application/json' } })
}

function ageFrom(date: string) {
  const birth = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(birth.getTime())) return -1
  const today = new Date()
  let age = today.getUTCFullYear() - birth.getUTCFullYear()
  if (today.getUTCMonth() < birth.getUTCMonth() || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age--
  return age
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(request) })
  const origin = request.headers.get('origin') || ''
  if (!allowedOrigins.has(origin)) return json(request, { error: 'Nepovolený pôvod požiadavky.' }, 403)
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(request, { error: 'Server configuration error' }, 500)
  if (request.headers.get('apikey') !== anonKey) return json(request, { error: 'Neplatná požiadavka.' }, 401)

  let body: { email?: string; password?: string; display_name?: string; birth_date?: string; terms_accepted?: boolean }
  try { body = await request.json() } catch { return json(request, { error: 'Neplatné údaje.' }, 400) }

  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const displayName = String(body.display_name || '').trim()
  const birthDate = String(body.birth_date || '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(request, { error: 'Zadaj platný email.' }, 400)
  if (password.length < 6 || password.length > 72) return json(request, { error: 'Heslo musí mať 6 až 72 znakov.' }, 400)
  if (!displayName || displayName.length > 50) return json(request, { error: 'Meno musí mať 1 až 50 znakov.' }, 400)
  if (ageFrom(birthDate) < 16) return json(request, { error: 'Social účet je dostupný od 16 rokov.' }, 400)
  if (body.terms_accepted !== true) return json(request, { error: 'Musíš súhlasiť s podmienkami.' }, 400)

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { display_name: displayName, birth_date: birthDate, terms_accepted: true, terms_version: '2026-08-22' },
  })
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      const passwordClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data: loginData, error: loginError } = await passwordClient.auth.signInWithPassword({ email, password })
      if (loginData.session) return json(request, { success: true })
      if (!/confirm/i.test(loginError?.message || '')) {
        return json(request, { success: false, error: 'Účet s týmto emailom už existuje alebo heslo nie je správne.' })
      }

      let existingUserId = ''
      for (let page = 1; page <= 10 && !existingUserId; page++) {
        const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (usersError) return json(request, { success: false, error: 'Existujúci účet sa nepodarilo dokončiť.' })
        existingUserId = usersPage.users.find((user) => user.email?.toLowerCase() === email)?.id || ''
        if (usersPage.users.length < 1000) break
      }
      if (!existingUserId) return json(request, { success: false, error: 'Existujúci účet sa nenašiel.' })
      const { error: confirmError } = await admin.auth.admin.updateUserById(existingUserId, { email_confirm: true })
      if (confirmError) return json(request, { success: false, error: 'Účet sa nepodarilo aktivovať.' })
      return json(request, { success: true })
    }
    return json(request, { success: false, error: error.message })
  }
  return json(request, { success: true }, 201)
})
