import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Horizonten Gemenskap – konton för medlemmar.
// action "signup":   skapa konto + medlemsrad (öppet, utan inloggning)
// action "complete": skapa medlemsrad för ett befintligt konto (t.ex. en admin som vill bli medlem)
// action "delete":   radera det egna kontot (GDPR – rätten att bli bortglömd)
// action "admin_reset_password": admin sätter ett tillfälligt lösenord åt en medlem
// action "admin_delete": admin raderar en medlem

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

const TERMS_VERSION = "2026-11-28";
const MEMBER_TYPES = ["ordinarie", "ungdom_familj", "stod_samverkan"];
const SITE = "https://horizonten.nu/medlem.html";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function currentUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { ...u, token } : null;
}

async function isAdmin(token: string) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/is_survey_admin`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  return r.ok && (await r.json()) === true;
}

async function stripeKey() {
  const env = Deno.env.get("STRIPE_SECRET_KEY");
  if (env && /^sk_(live|test)_/.test(env)) return env;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/get_stripe_config`, { method: "POST", headers: svc, body: "{}" });
    if (r.ok) { const c = await r.json(); if (c && /^sk_(live|test)_/.test(c.stripe_secret_key || "")) return c.stripe_secret_key; }
  } catch (_) { /* ignore */ }
  return "";
}

async function sendWelcome(to: string, name: string) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/get_wheel_mail_config`, { method: "POST", headers: svc, body: "{}" });
    const cfg = r.ok ? (await r.json()) || {} : {};
    const apiKey = Deno.env.get("RESEND_API_KEY") || cfg.resend_api_key;
    const from = Deno.env.get("MEMBER_FROM_EMAIL") || cfg.member_from_email || cfg.wheel_from_email || "Horizonten <onboarding@resend.dev>";
    if (!apiKey) return false;
    const first = name.split(" ")[0] || name;
    const text = `Hej ${first}!\n\nVälkommen till Horizonten Gemenskap. Ditt konto är skapat och du loggar in med din e-postadress och det lösenord du valde:\n${SITE}#logga-in\n\nPå din medlemssida ser du din nivå, dina förmåner och kan gå in i medlemschatten och biblioteket.\n\nVarma hälsningar,\nBilly Ljungberg och Jeanette Johansson\nHorizonten`;
    const html = `<!DOCTYPE html><html lang="sv"><body style="margin:0;background:#F6F4F0;font-family:Inter,Helvetica,Arial,sans-serif;color:#13202E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #DCD8D1;border-radius:16px;padding:32px 28px">
<tr><td style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#B5520C;padding-bottom:10px">Horizonten Gemenskap</td></tr>
<tr><td style="font-family:Georgia,serif;font-size:26px;font-weight:bold;padding-bottom:16px">Välkommen, ${esc(first)}!</td></tr>
<tr><td style="font-size:16px;line-height:1.6;padding-bottom:16px">Ditt konto är skapat. Du loggar in med din e-postadress och det lösenord du valde.</td></tr>
<tr><td style="font-size:16px;line-height:1.6;padding-bottom:22px">På din medlemssida ser du din nivå och dina förmåner, och där hittar du medlemschatten och biblioteket.</td></tr>
<tr><td><a href="${SITE}#logga-in" style="display:inline-block;background:#05223B;color:#fff;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:12px">Till min medlemssida</a></td></tr>
<tr><td style="font-size:15px;line-height:1.6;padding-top:24px">Varma hälsningar,<br>Billy Ljungberg och Jeanette Johansson<br>Horizonten</td></tr>
</table></td></tr></table></body></html>`;
    const m = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: "Välkommen till Horizonten Gemenskap", html, text }),
    });
    return m.ok;
  } catch (_) {
    return false;
  }
}

async function insertMember(row: Record<string, unknown>) {
  const r = await fetch(`${SB_URL}/rest/v1/members`, {
    method: "POST",
    headers: { ...svc, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return (await r.json())[0];
}

async function cancelSubscription(subId: string | null) {
  if (!subId) return;
  const key = await stripeKey();
  if (!key) return;
  await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => {});
}

async function deleteUserCompletely(userId: string) {
  // Medlemsraden
  const mr = await fetch(`${SB_URL}/rest/v1/members?user_id=eq.${userId}&select=stripe_subscription_id`, { headers: svc });
  const rows = mr.ok ? await mr.json() : [];
  await cancelSubscription(rows[0]?.stripe_subscription_id || null);
  // Betalningar sparas enligt bokföringslagen, men kopplas loss från kontot (user_id blir null via ON DELETE SET NULL)
  // Chattinlägg och medlemsrad raderas via ON DELETE CASCADE när kontot tas bort
  const d = await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc });
  if (!d.ok) throw new Error("Kontot kunde inte raderas: " + (await d.text()).slice(0, 200));
}

function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = new Uint32Array(14);
  crypto.getRandomValues(a);
  return "Hz-" + Array.from(a, (n) => chars[n % chars.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Fel metod." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "signup") {
      if (body.website) return json({ ok: true }); // fälla för robotar
      const email = clean(body.email, 254).toLowerCase();
      const password = String(body.password || "");
      const full_name = clean(body.full_name, 120);
      const phone = clean(body.phone, 40) || null;
      const org_name = clean(body.org_name, 160) || null;
      const member_type = MEMBER_TYPES.includes(body.member_type) ? body.member_type : "ordinarie";

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Ange en giltig e-postadress." }, 400);
      if (full_name.length < 2) return json({ error: "Ange ditt för- och efternamn." }, 400);
      if (password.length < 10) return json({ error: "Lösenordet måste vara minst 10 tecken." }, 400);
      if (body.accept_terms !== true) return json({ error: "Du behöver godkänna stadgarna och medlemsvillkoren." }, 400);
      if (body.accept_privacy !== true) return json({ error: "Du behöver godkänna integritetspolicyn." }, 400);
      if (member_type === "stod_samverkan" && body.is_org && !org_name) return json({ error: "Ange organisationens namn." }, 400);

      const cu = await fetch(`${SB_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: svc,
        body: JSON.stringify({
          email, password, email_confirm: true,
          app_metadata: { hz_source: "member_signup" },
          user_metadata: { full_name },
        }),
      });
      const created = await cu.json().catch(() => ({}));
      if (!cu.ok) {
        const msg = String(created.msg || created.message || created.error_description || "");
        if (cu.status === 422 || /already|registered|exists/i.test(msg)) {
          return json({ error: "Det finns redan ett konto med den e-postadressen. Logga in i stället.", code: "exists" }, 409);
        }
        if (/password/i.test(msg)) return json({ error: "Välj ett starkare lösenord (minst 10 tecken, gärna en hel mening)." }, 400);
        return json({ error: "Kontot kunde inte skapas just nu. Försök igen om en stund." }, 400);
      }

      try {
        await insertMember({
          user_id: created.id, email, full_name, phone, org_name, member_type,
          newsletter: body.newsletter === true, terms_version: TERMS_VERSION,
        });
      } catch (e) {
        await fetch(`${SB_URL}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: svc }).catch(() => {});
        throw e;
      }
      const mailed = await sendWelcome(email, full_name);
      return json({ ok: true, welcome_email: mailed });
    }

    const user = await currentUser(req);
    if (!user) return json({ error: "Du behöver logga in." }, 401);

    if (action === "complete") {
      const full_name = clean(body.full_name, 120) || clean(user.user_metadata?.full_name, 120);
      if (full_name.length < 2) return json({ error: "Ange ditt för- och efternamn." }, 400);
      if (body.accept_terms !== true || body.accept_privacy !== true) return json({ error: "Du behöver godkänna villkoren och integritetspolicyn." }, 400);
      const ex = await fetch(`${SB_URL}/rest/v1/members?user_id=eq.${user.id}&select=user_id`, { headers: svc });
      if (ex.ok && (await ex.json()).length) return json({ ok: true, already: true });
      await insertMember({
        user_id: user.id, email: String(user.email).toLowerCase(), full_name,
        phone: clean(body.phone, 40) || null, org_name: clean(body.org_name, 160) || null,
        member_type: MEMBER_TYPES.includes(body.member_type) ? body.member_type : "ordinarie",
        newsletter: body.newsletter === true, terms_version: TERMS_VERSION,
      });
      return json({ ok: true });
    }

    if (action === "delete") {
      if (body.confirm !== "RADERA") return json({ error: "Skriv RADERA för att bekräfta." }, 400);
      if (await isAdmin(user.token)) return json({ error: "Admin-konton raderas inte härifrån." }, 400);
      await deleteUserCompletely(user.id);
      return json({ ok: true });
    }

    if (action === "admin_reset_password" || action === "admin_delete") {
      if (!(await isAdmin(user.token))) return json({ error: "Behörighet saknas." }, 403);
      const target = clean(body.user_id, 64);
      if (!/^[0-9a-f-]{36}$/.test(target)) return json({ error: "Okänd medlem." }, 400);
      const mr = await fetch(`${SB_URL}/rest/v1/members?user_id=eq.${target}&select=email`, { headers: svc });
      const mrows = mr.ok ? await mr.json() : [];
      if (!mrows.length) return json({ error: "Medlemmen finns inte." }, 404);
      const ar = await fetch(`${SB_URL}/rest/v1/survey_admins?email=eq.${encodeURIComponent(String(mrows[0].email).toLowerCase())}&select=email`, { headers: svc });
      if (ar.ok && (await ar.json()).length) return json({ error: "Det här kontot är ett admin-konto och hanteras i Supabase." }, 400);
      if (action === "admin_delete") {
        await deleteUserCompletely(target);
        return json({ ok: true });
      }
      const pw = tempPassword();
      const u = await fetch(`${SB_URL}/auth/v1/admin/users/${target}`, {
        method: "PUT", headers: svc, body: JSON.stringify({ password: pw }),
      });
      if (!u.ok) return json({ error: "Lösenordet kunde inte sättas." }, 400);
      return json({ ok: true, password: pw });
    }

    return json({ error: "Okänd åtgärd." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Okänt fel" }, 500);
  }
});
