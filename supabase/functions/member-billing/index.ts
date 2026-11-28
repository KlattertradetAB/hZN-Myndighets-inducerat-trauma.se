import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Horizonten Gemenskap – betalning av medlemskap via Stripe.
// Priset hämtas alltid från tabellen membership_plans på servern, aldrig från webbläsaren.
// action "checkout": starta Stripe Checkout för en plan (år = engångsbetalning, månad = prenumeration)
// action "activate": verifiera en avslutad Checkout hos Stripe och aktivera medlemskapet
// action "refresh":  läs av månadsprenumerationen hos Stripe och förläng giltighetstiden
// action "cancel":   avsluta månadsprenumerationen vid periodens slut

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

const ALLOWED_RETURN = [
  /^https:\/\/(www\.)?horizonten\.nu\//,
  /^https:\/\/klattertradetab\.github\.io\//,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//,
];
const DEFAULT_RETURN = "https://horizonten.nu/medlem.html";

async function currentUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
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

async function stripe(key: string, path: string, method = "GET", params?: URLSearchParams) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? params.toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || "Stripe svarade med ett fel.");
  return j;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: svc, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}

async function getMember(userId: string) {
  const r = await fetch(`${SB_URL}/rest/v1/members?user_id=eq.${userId}&select=*`, { headers: svc });
  const rows = r.ok ? await r.json() : [];
  return rows[0] || null;
}

// Nya Stripe-versioner har periodens slut på prenumerationens rader, äldre på prenumerationen
const periodEnd = (sub: any): number | null =>
  sub?.current_period_end || sub?.items?.data?.[0]?.current_period_end || null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Fel metod." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const user = await currentUser(req);
    if (!user) return json({ error: "Du behöver logga in." }, 401);
    const member = await getMember(user.id);
    if (!member) return json({ error: "Du behöver slutföra din medlemsregistrering först." }, 400);
    if (member.status === "avstangd") return json({ error: "Ditt medlemskap är avstängt. Kontakta oss." }, 403);

    const key = await stripeKey();
    if (!key) return json({ error: "Kortbetalning är inte påslagen ännu. Kontakta oss så hjälper vi dig." }, 503);

    if (action === "checkout") {
      const pr = await fetch(`${SB_URL}/rest/v1/membership_plans?id=eq.${encodeURIComponent(String(body.plan_id || ""))}&active=eq.true&select=*`, { headers: svc });
      const plan = (pr.ok ? await pr.json() : [])[0];
      if (!plan) return json({ error: "Den planen finns inte." }, 400);
      if (plan.billing === "manad" && member.stripe_subscription_id) {
        return json({ error: "Du har redan en månadsprenumeration." }, 400);
      }

      const ret = String(body.return_url || "");
      const base = ALLOWED_RETURN.some((re) => re.test(ret)) ? ret.split("#")[0].split("?")[0] : DEFAULT_RETURN;

      const p = new URLSearchParams();
      p.append("mode", plan.billing === "manad" ? "subscription" : "payment");
      p.append("success_url", `${base}?betalning={CHECKOUT_SESSION_ID}#min-sida`);
      p.append("cancel_url", `${base}#min-sida`);
      p.append("client_reference_id", user.id);
      p.append("metadata[user_id]", user.id);
      p.append("metadata[plan_id]", plan.id);
      p.append("metadata[member_no]", String(member.member_no));
      p.append("locale", "sv");
      if (member.stripe_customer_id) p.append("customer", member.stripe_customer_id);
      else p.append("customer_email", member.email);
      p.append("line_items[0][quantity]", "1");
      p.append("line_items[0][price_data][currency]", "sek");
      p.append("line_items[0][price_data][unit_amount]", String(Math.round(plan.price_sek * 100)));
      p.append("line_items[0][price_data][product_data][name]",
        plan.billing === "manad" ? `${plan.title} (Horizonten Gemenskap)` : `${plan.title} – 12 månader (Horizonten Gemenskap)`);
      if (plan.billing === "manad") {
        p.append("line_items[0][price_data][recurring][interval]", "month");
        p.append("subscription_data[metadata][user_id]", user.id);
        p.append("subscription_data[metadata][plan_id]", plan.id);
      } else {
        p.append("payment_intent_data[metadata][user_id]", user.id);
        p.append("payment_intent_data[metadata][plan_id]", plan.id);
        if (!member.stripe_customer_id) p.append("customer_creation", "always");
      }
      const session = await stripe(key, "checkout/sessions", "POST", p);
      return json({ url: session.url });
    }

    if (action === "activate") {
      const sid = String(body.session_id || "");
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sid)) return json({ error: "Okänd betalning." }, 400);
      const s = await stripe(key, `checkout/sessions/${sid}?expand[]=subscription`);
      if (s.client_reference_id !== user.id || s.metadata?.user_id !== user.id) return json({ error: "Betalningen hör inte till ditt konto." }, 403);
      if (s.status !== "complete" || !["paid", "no_payment_required"].includes(s.payment_status)) {
        return json({ ok: false, pending: true, message: "Betalningen är inte klar ännu." });
      }
      const sub = s.subscription && typeof s.subscription === "object" ? s.subscription : null;
      const end = sub ? periodEnd(sub) : null;
      const res = await rpc("member_apply_payment", {
        p_user: user.id,
        p_plan: s.metadata.plan_id,
        p_amount: Math.round((s.amount_total || 0) / 100),
        p_method: "stripe",
        p_session: s.id,
        p_subscription: sub ? sub.id : null,
        p_customer: typeof s.customer === "string" ? s.customer : s.customer?.id || null,
        p_period_end: end ? new Date(end * 1000).toISOString() : null,
        p_note: null,
      });
      return json({ ok: true, ...res });
    }

    if (action === "refresh") {
      if (!member.stripe_subscription_id) return json({ ok: true, subscription: null });
      const sub = await stripe(key, `subscriptions/${encodeURIComponent(member.stripe_subscription_id)}`);
      const active = ["active", "trialing"].includes(sub.status);
      const end = periodEnd(sub);
      await rpc("member_sync_subscription", {
        p_user: user.id,
        p_subscription: sub.id,
        p_period_end: end ? new Date(end * 1000).toISOString() : new Date().toISOString(),
        p_active: active || sub.status === "past_due",
      });
      return json({ ok: true, subscription: { status: sub.status, cancel_at_period_end: !!sub.cancel_at_period_end, current_period_end: end } });
    }

    if (action === "cancel" || action === "resume") {
      if (!member.stripe_subscription_id) return json({ error: "Du har ingen månadsprenumeration." }, 400);
      const p = new URLSearchParams();
      p.append("cancel_at_period_end", action === "cancel" ? "true" : "false");
      const sub = await stripe(key, `subscriptions/${encodeURIComponent(member.stripe_subscription_id)}`, "POST", p);
      return json({ ok: true, subscription: { status: sub.status, cancel_at_period_end: !!sub.cancel_at_period_end, current_period_end: periodEnd(sub) } });
    }

    return json({ error: "Okänd åtgärd." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Okänt fel" }, 500);
  }
});
