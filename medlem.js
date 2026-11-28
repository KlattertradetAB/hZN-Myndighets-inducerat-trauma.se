/* Horizonten Gemenskap – medlemssidan (medlem.html)
   Konto, medlemsnivå, betalning via Stripe, medlemschatt, bibliotek och event.
   Säkerheten ligger i databasen (RLS) och i edge-funktionerna member-account och member-billing. */
(function () {
  "use strict";
  const CFG = window.HZ_SUPABASE || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const SKEY = "hz-member-session";
  const PLAN_KEY = "hz-member-plan";

  const LEVEL_NAME = { gratis: "Gratis Medlem", stod: "Horizonten Stöd", premium: "Gemenskap Premium" };
  const TIER_SHORT = { gratis: "alla medlemmar", stod: "Horizonten Stöd", premium: "Gemenskap Premium" };
  const TYPE_NAME = { ordinarie: "Ordinarie medlem", ungdom_familj: "Ungdoms- och familjemedlem", stod_samverkan: "Stöd-/samverkansmedlem", heders: "Hedersmedlem" };
  const RANK = { gratis: 0, stod: 1, premium: 2 };
  const PROTECTED = ["min-sida", "chatt", "bibliotek-las", "slutfor", "nytt-losenord"];
  const DOCS = ["stadgar", "villkor", "integritetspolicy", "chattregler", "kulturbarare", "ramverk"];

  let session = null, me = null, plans = [], current = "", pendingHash = "", refreshedSub = false;

  /* ---------------- Hjälpfunktioner ---------------- */
  function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 4500); }
  function setMsg(el, text, kind) { el.textContent = text; el.className = "msg " + (kind || ""); el.hidden = !text; }
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" }) : "");
  const fmtTime = (d) => {
    const t = new Date(d), now = new Date();
    const same = t.toDateString() === now.toDateString();
    return same ? t.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })
      : t.toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) + " " + t.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  };
  const memberNo = (n) => "HZ-" + String(n || 0).padStart(6, "0");
  const kr = (n) => Number(n || 0).toLocaleString("sv-SE") + " kr";
  const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  const level = () => (me && me.level) || null;
  const canSee = (minTier) => !!me && (me.is_admin || (level() !== null && RANK[level()] >= RANK[minTier]));

  function md(text) {
    // Enkel formatering för bibliotekstexter: ## rubrik, - punkt, **fet**, tomrad = nytt stycke
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const out = []; let para = [], list = [];
    const flushP = () => { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } };
    const flushL = () => { if (list.length) { out.push("<ul>" + list.map((l) => "<li>" + inline(l) + "</li>").join("") + "</ul>"); list = []; } };
    String(text || "").replace(/\r/g, "").split("\n").forEach((line) => {
      const l = line.trimEnd();
      if (/^##\s+/.test(l)) { flushP(); flushL(); out.push("<h3>" + inline(l.replace(/^##\s+/, "")) + "</h3>"); }
      else if (/^[-•]\s+/.test(l)) { flushP(); list.push(l.replace(/^[-•]\s+/, "")); }
      else if (!l.trim()) { flushP(); flushL(); }
      else { flushL(); para.push(l); }
    });
    flushP(); flushL();
    return out.join("\n");
  }

  /* ---------------- API ---------------- */
  async function auth(path, body, method) {
    const r = await fetch(CFG.url + "/auth/v1/" + path, {
      method: method || "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.key, ...(session && method === "PUT" ? { Authorization: "Bearer " + (await token()) } : {}) },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error_description || j.msg || j.message || "Något gick fel."), { status: r.status, code: j.error_code || j.code });
    return j;
  }
  function saveSession(j) {
    session = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || (session && session.email) || "", uid: (j.user && j.user.id) || (session && session.uid) || "" };
    try { localStorage.setItem(SKEY, JSON.stringify(session)); } catch (e) { /* privat läge */ }
  }
  function clearSession() { session = null; me = null; try { localStorage.removeItem(SKEY); } catch (e) {} }
  async function token() {
    if (!session) return null;
    if (Date.now() > session.exp - 60000) {
      try { saveSession(await auth("token?grant_type=refresh_token", { refresh_token: session.refresh })); }
      catch (e) { clearSession(); updateNav(); throw new Error("Du har loggats ut. Logga in igen."); }
    }
    return session.access;
  }
  async function rest(path, opts) {
    opts = opts || {};
    const t = session ? await token() : null;
    const r = await fetch(CFG.url + "/rest/v1/" + path, {
      ...opts,
      headers: { apikey: CFG.key, Authorization: "Bearer " + (t || CFG.key), "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (r.status === 401 && session) { clearSession(); updateNav(); throw new Error("Du har loggats ut. Logga in igen."); }
    const txt = await r.text();
    const j = txt ? (() => { try { return JSON.parse(txt); } catch (e) { return txt; } })() : null;
    if (!r.ok) throw new Error((j && (j.message || j.hint)) || ("Fel " + r.status));
    return j;
  }
  const rpc = (name, args) => rest("rpc/" + name, { method: "POST", body: JSON.stringify(args || {}) });
  async function fn(name, body) {
    const t = session ? await token() : null;
    const r = await fetch(CFG.url + "/functions/v1/" + name, {
      method: "POST",
      headers: { apikey: CFG.key, Authorization: "Bearer " + (t || CFG.key), "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw Object.assign(new Error(j.error || ("Fel " + r.status)), { status: r.status, code: j.code });
    return j;
  }
  async function loadMe() { me = session ? await rpc("member_me").catch(() => null) : null; updateNav(); return me; }

  /* ---------------- Navigering ---------------- */
  function updateNav() {
    const a = $("nav-account");
    if (session) { a.textContent = "Min sida"; a.href = "#min-sida"; } else { a.textContent = "Logga in"; a.href = "#logga-in"; }
    const ov = $("ov-login");
    if (ov) { ov.textContent = session ? "Till min medlemssida" : "Jag är redan medlem"; ov.href = session ? "#min-sida" : "#logga-in"; }
  }

  async function route() {
    let v = location.hash.slice(1) || "oversikt";
    let libId = null;
    if (v.startsWith("bibliotek/")) { libId = v.split("/")[1]; v = "bibliotek-las"; }
    if (!document.querySelector('[data-view="' + v + '"]')) v = "oversikt";
    if (PROTECTED.includes(v) && !session) { pendingHash = location.hash; v = "logga-in"; }
    if (session && !me && ["min-sida", "chatt", "bibliotek-las"].includes(v)) { await loadMe(); if (!me) v = "slutfor"; }
    if ((v === "logga-in" || v === "bli-medlem") && session && me) { location.replace("#min-sida"); return; }

    current = v;
    document.querySelectorAll("[data-view]").forEach((s) => (s.hidden = s.dataset.view !== v));
    $("doc-nav").hidden = !DOCS.includes(v);
    document.querySelectorAll("#doc-nav a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === "#" + v ? "page" : "false"));
    document.querySelectorAll(".nav a[data-nav]").forEach((a) => {
      const n = a.dataset.nav;
      const on = n === v || (n === "docs" && DOCS.includes(v)) || (n === "bibliotek" && v === "bibliotek-las") || (n === "oversikt" && v === "bli-medlem");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (v !== "chatt") stopPolling();
    window.scrollTo(0, 0);
    const h = document.querySelector('[data-view="' + v + '"] h1');
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }

    try {
      if (v === "bli-medlem") prepSignup();
      if (v === "min-sida") await renderMine();
      if (v === "chatt") await renderChat();
      if (v === "bibliotek") await renderLibrary();
      if (v === "bibliotek-las") await renderLibItem(libId);
      if (v === "slutfor") prepComplete();
    } catch (e) { toast(e.message); }
  }

  /* ---------------- Priser ---------------- */
  async function loadPlans() {
    try {
      plans = await rest("membership_plans?select=*&active=eq.true&order=sort_order.asc");
      plans.forEach((p) => document.querySelectorAll('[data-price="' + p.id + '"]').forEach((el) => (el.textContent = kr(p.price_sek))));
      const ids = plans.map((p) => p.id);
      document.querySelectorAll('#su-plans input[name="su-plan"]').forEach((i) => { if (i.value !== "gratis" && !ids.includes(i.value)) i.closest(".opt").hidden = true; });
    } catch (e) { plans = []; }
  }

  /* ---------------- Bli medlem ---------------- */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-plan]");
    if (a) { try { sessionStorage.setItem(PLAN_KEY, a.dataset.plan); } catch (x) {} }
  });
  function prepSignup() {
    let p = "gratis";
    try { p = sessionStorage.getItem(PLAN_KEY) || "gratis"; } catch (x) {}
    const r = document.querySelector('#su-plans input[value="' + p + '"]');
    if (r) r.checked = true;
    syncType();
  }
  function syncType() {
    const t = (document.querySelector('input[name="su-type"]:checked') || {}).value;
    $("su-org-wrap").hidden = t !== "stod_samverkan";
    $("su-guardian-wrap").hidden = t !== "ungdom_familj";
  }
  document.querySelectorAll('input[name="su-type"]').forEach((i) => i.addEventListener("change", syncType));

  $("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("su-err"), btn = $("su-btn");
    setMsg(err, "");
    const full_name = $("su-name").value.trim(), email = $("su-email").value.trim().toLowerCase(), password = $("su-pass").value;
    const plan = (document.querySelector('input[name="su-plan"]:checked') || {}).value || "gratis";
    const member_type = (document.querySelector('input[name="su-type"]:checked') || {}).value || "ordinarie";
    if (full_name.length < 2) return setMsg(err, "Ange ditt för- och efternamn.", "err");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg(err, "Ange en giltig e-postadress.", "err");
    if (password.length < 10) return setMsg(err, "Lösenordet måste vara minst 10 tecken.", "err");
    if (member_type === "ungdom_familj" && !$("su-guardian").checked) return setMsg(err, "Bekräfta att din vårdnadshavare godkänt medlemskapet om du är under 18 år.", "err");
    if (!$("su-terms").checked) return setMsg(err, "Du behöver godkänna stadgarna och medlemsvillkoren.", "err");
    if (!$("su-privacy").checked) return setMsg(err, "Du behöver godkänna integritetspolicyn.", "err");
    btn.disabled = true; btn.textContent = "Skapar ditt konto…";
    try {
      await fn("member-account", {
        action: "signup", email, password, full_name, phone: $("su-phone").value.trim(),
        org_name: $("su-org").value.trim(), member_type, newsletter: $("su-news").checked,
        accept_terms: true, accept_privacy: true, website: $("su-website").value,
      });
      saveSession(await auth("token?grant_type=password", { email, password }));
      await loadMe();
      try { sessionStorage.removeItem(PLAN_KEY); } catch (x) {}
      $("su-pass").value = "";
      if (plan !== "gratis") {
        btn.textContent = "Går till betalningen…";
        try { await startCheckout(plan); return; }
        catch (x) { toast(x.message); }
      }
      toast("Välkommen till Horizonten Gemenskap!");
      location.hash = "min-sida";
    } catch (x) {
      if (x.code === "exists") setMsg(err, "Det finns redan ett konto med den e-postadressen. Logga in i stället – eller välj Glömt lösenordet.", "err");
      else setMsg(err, x.message, "err");
    } finally { btn.disabled = false; btn.textContent = "Skapa mitt konto"; }
  });

  async function startCheckout(planId) {
    const r = await fn("member-billing", { action: "checkout", plan_id: planId, return_url: location.origin + location.pathname });
    if (!r.url) throw new Error("Betalningen kunde inte startas.");
    location.href = r.url;
  }

  /* ---------------- Logga in / ut ---------------- */
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("li-err"), btn = $("li-btn");
    setMsg(err, "");
    const email = $("li-email").value.trim(), password = $("li-pass").value;
    if (!email || !password) return setMsg(err, "Fyll i e-post och lösenord.", "err");
    btn.disabled = true; btn.textContent = "Loggar in…";
    try {
      saveSession(await auth("token?grant_type=password", { email, password }));
      $("li-pass").value = "";
      await loadMe();
      const to = me ? (pendingHash && pendingHash !== "#logga-in" ? pendingHash : "#min-sida") : "#slutfor";
      pendingHash = "";
      location.hash = to.slice(1);
    } catch (x) {
      setMsg(err, x.status === 400 ? "Fel e-post eller lösenord." : x.message, "err");
    } finally { btn.disabled = false; btn.textContent = "Logga in"; }
  });

  $("logout-btn").addEventListener("click", () => {
    const t = session && session.access;
    if (t) fetch(CFG.url + "/auth/v1/logout", { method: "POST", headers: { apikey: CFG.key, Authorization: "Bearer " + t } }).catch(() => {});
    clearSession(); updateNav(); location.hash = "oversikt"; toast("Du är utloggad.");
  });

  $("forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const m = $("fg-msg"), email = $("fg-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg(m, "Ange en giltig e-postadress.", "err");
    $("fg-btn").disabled = true;
    try { await auth("recover?redirect_to=" + encodeURIComponent(location.origin + location.pathname), { email }); } catch (x) { /* visa samma svar oavsett */ }
    setMsg(m, "Om adressen finns hos oss har vi skickat en länk. Hör av dig till oss om inget mejl kommer.", "ok");
    $("fg-btn").disabled = false;
  });

  $("newpw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const m = $("np-msg"), p1 = $("np-1").value, p2 = $("np-2").value;
    if (p1.length < 10) return setMsg(m, "Lösenordet måste vara minst 10 tecken.", "err");
    if (p1 !== p2) return setMsg(m, "Lösenorden matchar inte.", "err");
    try { await auth("user", { password: p1 }, "PUT"); setMsg(m, "Klart! Ditt nya lösenord är sparat.", "ok"); setTimeout(() => (location.hash = "min-sida"), 1200); }
    catch (x) { setMsg(m, x.message, "err"); }
  });

  /* ---------------- Slutför (konto utan medlemsprofil) ---------------- */
  function prepComplete() { if (session && !$("cp-name").value) $("cp-name").value = ""; }
  $("complete-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("cp-err"); setMsg(err, "");
    if (!$("cp-terms").checked || !$("cp-privacy").checked) return setMsg(err, "Du behöver godkänna villkoren och integritetspolicyn.", "err");
    try {
      await fn("member-account", { action: "complete", full_name: $("cp-name").value.trim(), phone: $("cp-phone").value.trim(), newsletter: $("cp-news").checked, accept_terms: true, accept_privacy: true });
      await loadMe(); location.hash = "min-sida";
    } catch (x) { setMsg(err, x.message, "err"); }
  });

  /* ---------------- Min sida ---------------- */
  async function renderMine() {
    if (!me) await loadMe();
    if (!me) { location.replace("#slutfor"); return; }
    if (me.stripe_subscription_id && !refreshedSub) {
      refreshedSub = true;
      try { const r = await fn("member-billing", { action: "refresh" }); me.subscription = r.subscription; await loadMe(); me.subscription = r.subscription; } catch (e) { /* visa ändå */ }
    }
    const lv = level();
    const paidActive = lv === "stod" || lv === "premium";
    $("h-min").textContent = "Hej " + firstName(me.full_name) + "!";

    // Medlemskortet
    const badges = [];
    if (me.kulturbarare) badges.push('<span class="badge">Kulturbärare</span>');
    if (me.member_type === "heders") badges.push('<span class="badge">Hedersmedlem</span>');
    let statusLine = "";
    if (me.status === "uttradd") statusLine = '<p style="margin:0">Du utträdde ur föreningen ' + esc(fmtDate(me.left_at)) + '. Ditt konto finns kvar som gratiskonto.</p><div class="row"><button class="btn small accent" type="button" id="rejoin-btn">Återinträd i föreningen</button></div>';
    else if (me.status === "avstangd") statusLine = '<p style="margin:0">Ditt konto är avstängt. Kontakta oss om du har frågor.</p>';
    else if (me.tier !== "gratis" && !paidActive && me.member_type !== "heders") statusLine = '<p style="margin:0">Ditt medlemskap i ' + esc(LEVEL_NAME[me.tier]) + " gick ut " + esc(fmtDate(me.paid_until)) + ". Förnya nedan när du vill.</p>";
    $("mcard").innerHTML =
      '<span class="meta">Medlemsnummer ' + esc(memberNo(me.member_no)) + "</span>" +
      '<span class="lvl">' + esc(LEVEL_NAME[lv] || "Gratis Medlem") + "</span>" +
      '<span class="meta">' + esc(TYPE_NAME[me.member_type] || "") + (me.org_name ? " · " + esc(me.org_name) : "") + "</span>" +
      (paidActive && me.member_type !== "heders"
        ? '<span class="meta">' + (me.billing === "manad" ? "Betald till och med " : "Giltigt till och med ") + esc(fmtDate(me.paid_until)) + "</span>"
        : "") +
      (badges.length ? '<div class="row">' + badges.join("") + "</div>" : "") + statusLine;
    const rj = $("rejoin-btn");
    if (rj) rj.onclick = async () => { try { await rpc("member_rejoin"); await loadMe(); renderMine(); toast("Välkommen tillbaka!"); } catch (x) { toast(x.message); } };

    // Förmåner
    const B = {
      gratis: ["Egen medlemssida", "Öppna medlemschatten", "Grundläggande arbetsblad i biblioteket", "Nyhetsbrev och notiser (om du valt det)"],
      stod: ["10 % rabatt på korta workshops och föreläsningar", "Reducerat pris vid bokning av sessioner", "Ett urval ur biblioteket"],
      premium: ["20 % rabatt på korta workshops och föreläsningar", "10 % rabatt på längre utbildningar", "Reducerat pris vid bokning av sessioner", "Fullt bibliotek med bilagor och färdighetsträning", "Stängda, nischade och modererade chattrum", "Förtur vid kursbokningar (48 timmar)", "Exklusiva live-webbinarier och Q&A"],
    };
    let list = B.gratis.slice();
    if (lv === "stod") list = list.concat(B.stod);
    if (lv === "premium") list = list.filter((x) => !/Grundläggande/.test(x)).concat(B.premium);
    $("mbenefits").innerHTML = "<h3>Dina förmåner</h3>" +
      '<ul class="benefits" style="margin-top:10px">' + list.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" +
      (paidActive ? '<p class="muted small" style="margin:12px 0 0">Uppge ditt medlemsnummer <strong>' + esc(memberNo(me.member_no)) + "</strong> när du bokar en session, workshop eller utbildning så dras din rabatt av.</p>" : "") +
      '<div class="row" style="margin-top:14px"><a class="btn small" href="#chatt">Till medlemschatten</a><a class="btn small ghost" href="#bibliotek">Biblioteket</a></div>';

    renderPlans(lv);
    renderEvents();
    renderKultur(lv);

    // Profil
    $("pf-name").value = me.full_name || ""; $("pf-phone").value = me.phone || ""; $("pf-org").value = me.org_name || ""; $("pf-news").checked = !!me.newsletter;
    $("pf-org-wrap").hidden = me.member_type !== "stod_samverkan";

    // Betalningar
    try {
      const pays = await rest("member_payments?select=*&order=created_at.desc");
      $("mpayments").innerHTML = pays.length
        ? pays.map((p) => '<div class="item"><div><h4>' + esc(LEVEL_NAME[p.tier] || p.plan_id) + (p.billing === "manad" ? " · månad" : " · år") + "</h4><p>" + esc(fmtDate(p.created_at)) + " · " + esc(kr(p.amount_sek)) + (p.period_end ? " · gäller till " + esc(fmtDate(p.period_end)) : "") + "</p></div></div>").join("")
        : '<p class="muted" style="margin:0">Inga betalningar ännu.' + (me.billing === "manad" ? " Månadsdragningar syns i ditt kvitto från Stripe." : "") + "</p>";
    } catch (e) { $("mpayments").innerHTML = '<p class="muted">Kunde inte hämta betalningar.</p>'; }
  }

  function renderPlans(lv) {
    const box = $("mplans");
    if (me.status === "avstangd") { box.innerHTML = "<h3>Medlemsnivå</h3><p class='muted'>Kontakta oss om ditt konto.</p>"; return; }
    if (me.member_type === "heders") { box.innerHTML = "<h3>Medlemsnivå</h3><p class='muted'>Som hedersmedlem är du befriad från medlemsavgift och har full tillgång.</p>"; return; }
    const sub = me.subscription || null;
    if (me.stripe_subscription_id) {
      const ending = sub && sub.cancel_at_period_end;
      box.innerHTML = "<h3>Gemenskap Premium per månad</h3>" +
        '<p class="muted">' + (ending ? "Prenumerationen är avslutad och gäller till och med " + esc(fmtDate(me.paid_until)) + "." : "Prenumerationen förnyas automatiskt varje månad. Nästa dragning sker omkring " + esc(fmtDate(me.paid_until)) + ".") + "</p>" +
        '<div class="row">' + (ending ? '<button class="btn small" type="button" id="sub-resume">Fortsätt prenumerationen</button>' : '<button class="btn small ghost" type="button" id="sub-cancel">Avsluta månadsprenumerationen</button>') + "</div>";
      const c = $("sub-cancel"), r = $("sub-resume");
      if (c) c.onclick = async () => {
        if (!confirm("Vill du avsluta månadsprenumerationen? Premium gäller till och med den period du redan betalat.")) return;
        try { const x = await fn("member-billing", { action: "cancel" }); me.subscription = x.subscription; renderPlans(lv); toast("Prenumerationen är avslutad."); } catch (e) { toast(e.message); }
      };
      if (r) r.onclick = async () => {
        try { const x = await fn("member-billing", { action: "resume" }); me.subscription = x.subscription; renderPlans(lv); toast("Prenumerationen fortsätter."); } catch (e) { toast(e.message); }
      };
      return;
    }
    const curRank = RANK[lv] || 0;
    // Ett aktivt årsmedlemskap byts inte mot månadsbetalning (då skulle resten av året gå förlorat)
    const shown = plans.filter((p) => RANK[p.tier] >= curRank && !(curRank > 0 && p.billing === "manad" && p.tier === lv));
    const label = (p) => {
      if (p.tier === lv) return p.billing === "manad" ? "Byt till per månad" : "Förläng 12 månader";
      return curRank > 0 ? "Uppgradera" : "Välj";
    };
    box.innerHTML = "<h3>" + (curRank ? "Förläng eller uppgradera" : "Bli betalande medlem") + "</h3>" +
      '<p class="muted small">Årsmedlemskap förnyas inte automatiskt. Per månad är en löpande prenumeration som du kan avsluta när du vill.</p>' +
      '<div class="list">' + shown.map((p) =>
        '<div class="item"><div><h4>' + esc(p.title) + " · " + esc(kr(p.price_sek)) + (p.billing === "manad" ? " / månad" : " / år") + "</h4><p>" + esc(p.description || "") + '</p></div><button class="btn small' + (p.tier === "premium" ? " accent" : "") + '" type="button" data-buy="' + esc(p.id) + '">' + esc(label(p)) + "</button></div>").join("") + "</div>" +
      '<p class="muted small" style="margin:12px 0 0">Vill du hellre betala med Swish eller faktura? Mejla oss så registrerar vi betalningen åt dig.</p>';
    box.querySelectorAll("[data-buy]").forEach((b) => (b.onclick = async () => {
      if (curRank > RANK[(plans.find((p) => p.id === b.dataset.buy) || {}).tier]) return;
      b.disabled = true; b.textContent = "Går till betalningen…";
      try { await startCheckout(b.dataset.buy); } catch (e) { toast(e.message); b.disabled = false; b.textContent = "Försök igen"; }
    }));
  }

  async function renderEvents() {
    const box = $("mevents");
    try {
      const [cat, open] = await Promise.all([rpc("events_catalog"), rest("member_events?select=id,link,location&active=eq.true")]);
      const links = {}; (open || []).forEach((e) => (links[e.id] = e));
      box.innerHTML = cat.length ? cat.map((e) => {
        const l = links[e.id];
        const when = new Date(e.starts_at).toLocaleString("sv-SE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        return '<div class="item"><div><h4>' + esc(e.title) + "</h4><p>" + esc(when) + (l && l.location ? " · " + esc(l.location) : "") + (e.description ? "<br>" + esc(e.description) : "") + "</p></div>" +
          (e.unlocked ? (l && l.link ? '<a class="btn small" href="' + esc(l.link) + '" target="_blank" rel="noopener">Delta</a>' : '<span class="lock">Länk kommer</span>') : '<span class="lock">🔒 ' + esc(TIER_SHORT[e.min_tier]) + "</span>") + "</div>";
      }).join("") : '<p class="muted" style="margin:0">Inga inplanerade just nu. Vi meddelar nya datum i nyhetsbrevet och här.</p>';
    } catch (e) { box.innerHTML = '<p class="muted">Kunde inte hämta event.</p>'; }
  }

  function renderKultur(lv) {
    const box = $("mkultur");
    let html = "<h3>Kulturbärare</h3>";
    if (me.kulturbarare) html += '<p><span class="badge">Kulturbärare</span></p><p class="muted">Tack för att du vårdar fältet av trygghet och utveckling. Markeringen syns i din profil och i medlemschatten.</p>';
    else if (me.kulturbarare_requested_at) html += '<p class="muted">Ditt löfte är mottaget ' + esc(fmtDate(me.kulturbarare_requested_at)) + ". Vi bekräftar det så snart vi kan.</p>";
    else if (lv === "stod" || lv === "premium") html += '<blockquote style="margin:10px 0;padding:12px 16px;border-left:3px solid var(--accent);font-style:italic">”Jag lovar att efter bästa förmåga bidra till en miljö där vi växer tillsammans. Jag väljer att se möjligheter där andra ser hinder, och jag strävar efter att alltid vara en främjande kraft för mina medmänniskor och för Horizonten Medlemsförening.”</blockquote><div class="row"><button class="btn small accent" type="button" id="kultur-btn">Jag avger Kulturbärarens löfte</button><a href="#kulturbarare">Läs om uppdraget</a></div>';
    else html += '<p class="muted">Som betalande medlem kan du bli Kulturbärare – trygghetsvärd och fadder för nya medlemmar. <a href="#kulturbarare">Läs manifestet</a>.</p>';
    box.innerHTML = html;
    const b = $("kultur-btn");
    if (b) b.onclick = async () => { try { await rpc("member_request_kulturbarare"); await loadMe(); renderKultur(level()); toast("Tack! Ditt löfte är mottaget."); } catch (e) { toast(e.message); } };
  }

  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const m = $("pf-msg");
    try {
      await rpc("member_update_profile", { p_full_name: $("pf-name").value, p_phone: $("pf-phone").value, p_org_name: $("pf-org").value, p_newsletter: $("pf-news").checked });
      await loadMe(); setMsg(m, "Sparat.", "ok"); $("h-min").textContent = "Hej " + firstName(me.full_name) + "!";
    } catch (x) { setMsg(m, x.message, "err"); }
  });

  $("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const m = $("pw-msg"), p1 = $("pw-1").value, p2 = $("pw-2").value;
    if (p1.length < 10) return setMsg(m, "Lösenordet måste vara minst 10 tecken.", "err");
    if (p1 !== p2) return setMsg(m, "Lösenorden matchar inte.", "err");
    try { await auth("user", { password: p1 }, "PUT"); setMsg(m, "Lösenordet är bytt.", "ok"); $("pw-1").value = $("pw-2").value = ""; }
    catch (x) { setMsg(m, x.message, "err"); }
  });

  $("export-btn").addEventListener("click", async () => {
    try {
      const [pays, msgs] = await Promise.all([
        rest("member_payments?select=*&order=created_at.asc"),
        rest("chat_messages?select=room_id,body,created_at&user_id=eq." + encodeURIComponent(session.uid || "") + "&order=id.asc").catch(() => []),
      ]);
      const data = { exporterad: new Date().toISOString(), konto: { email: session.email }, medlemskap: me, betalningar: pays, chattinlagg: msgs };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "mina-uppgifter-horizonten.json";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (x) { toast(x.message); }
  });

  $("leave-btn").addEventListener("click", async () => {
    if (me.status !== "aktiv") { toast("Du är inte aktiv medlem i föreningen."); return; }
    if (!confirm("Vill du utträda ur föreningen? Medlemskapet upphör direkt och erlagda avgifter återbetalas inte (stadgarna § 2.4). Ditt konto finns kvar som gratiskonto.")) return;
    try {
      if (me.stripe_subscription_id) await fn("member-billing", { action: "cancel" }).catch(() => {});
      await rpc("member_leave"); await loadMe(); await renderMine();
      setMsg($("rights-msg"), "Ditt utträde är registrerat.", "ok");
    } catch (x) { setMsg($("rights-msg"), x.message, "err"); }
  });

  $("delete-btn").addEventListener("click", async () => {
    const ans = prompt("Det här raderar ditt konto, din medlemsprofil och dina chattinlägg för alltid. Betalningsuppgifter sparas så länge bokföringslagen kräver.\n\nSkriv RADERA för att bekräfta.");
    if (ans === null) return;
    if (ans.trim().toUpperCase() !== "RADERA") { toast("Kontot raderades inte."); return; }
    try { await fn("member-account", { action: "delete", confirm: "RADERA" }); clearSession(); updateNav(); location.hash = "oversikt"; toast("Ditt konto är raderat."); }
    catch (x) { setMsg($("rights-msg"), x.message, "err"); }
  });

  /* ---------------- Betalning tillbaka från Stripe ---------------- */
  async function handlePaymentReturn() {
    const q = new URLSearchParams(location.search);
    const sid = q.get("betalning");
    if (!sid) return;
    history.replaceState(null, "", location.pathname + location.hash);
    if (!session) return;
    const box = $("pay-msg");
    setMsg(box, "Vi bekräftar din betalning…", "");
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fn("member-billing", { action: "activate", session_id: sid });
        if (r.ok) {
          await loadMe(); refreshedSub = false;
          setMsg(box, "Tack! Ditt medlemskap i " + (LEVEL_NAME[r.tier] || "Horizonten") + " är aktivt till och med " + fmtDate(r.paid_until) + ".", "ok");
          if (current === "min-sida") await renderMine();
          return;
        }
      } catch (e) { setMsg(box, e.message, "err"); return; }
      await new Promise((res) => setTimeout(res, 2000));
    }
    setMsg(box, "Betalningen är inte bekräftad ännu. Ladda om sidan om en stund, eller kontakta oss om det inte löser sig.", "err");
  }

  /* ---------------- Bibliotek ---------------- */
  async function renderLibrary() {
    const box = $("lib-list");
    try {
      if (session && !me) await loadMe();
      const items = await rpc("library_catalog");
      if (!items.length) { box.innerHTML = '<p class="muted">Biblioteket fylls på inom kort.</p>'; return; }
      const kind = { arbetsblad: "Arbetsblad", ovning: "Övning", text: "Text", film: "Film" };
      box.innerHTML = items.map((it) => {
        let action;
        if (it.unlocked) action = '<a class="btn small" href="#bibliotek/' + it.id + '">Läs</a>';
        else if (!session) action = it.min_tier === "gratis" ? '<a class="btn small ghost" href="#bli-medlem">Gratis konto</a>' : '<span class="lock">🔒 ' + esc(TIER_SHORT[it.min_tier]) + "</span>";
        else action = '<a class="lock" href="#min-sida">🔒 ' + esc(TIER_SHORT[it.min_tier]) + "</a>";
        return '<div class="item"><div><span class="kicker" style="margin:0">' + esc(kind[it.kind] || "") + "</span><h4>" + esc(it.title) + "</h4><p>" + esc(it.summary || "") + "</p></div>" + action + "</div>";
      }).join("");
    } catch (e) { box.innerHTML = '<p class="muted">Kunde inte hämta biblioteket.</p>'; }
  }
  async function renderLibItem(id) {
    const box = $("lib-item");
    box.innerHTML = '<p class="spinner">Hämtar…</p>';
    const rows = /^\d+$/.test(String(id)) ? await rest("library_items?select=*&id=eq." + id) : [];
    if (!rows.length) { box.innerHTML = '<h1>Inte tillgängligt</h1><p class="muted">Det här materialet ingår i en annan medlemsnivå eller finns inte längre.</p><p><a href="#min-sida">Se medlemsnivåer</a></p>'; return; }
    const it = rows[0];
    box.innerHTML = '<span class="kicker">' + esc(TIER_SHORT[it.min_tier] === "alla medlemmar" ? "Bas" : TIER_SHORT[it.min_tier]) + '</span><h1 id="h-libitem" tabindex="-1">' + esc(it.title) + "</h1>" +
      (it.summary ? '<p class="lede">' + esc(it.summary) + "</p>" : "") + md(it.body) +
      '<p class="muted small" style="margin-top:28px">Materialet är upphovsrättsskyddat och får endast användas för privat bruk.</p>';
  }

  /* ---------------- Chatt ---------------- */
  let rooms = [], roomId = null, lastId = 0, pollTimer = null;
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  async function renderChat() {
    if (!me) await loadMe();
    if (!me) { location.replace("#slutfor"); return; }
    if (me.status === "avstangd") { $("chat-ui").hidden = true; $("chat-rules-gate").hidden = false; $("chat-rules-gate").innerHTML = "<h3>Chatten är inte tillgänglig</h3><p class='muted'>Ditt konto är avstängt från chatten. Kontakta oss om du har frågor.</p>"; return; }
    const accepted = !!me.chat_rules_accepted_at || me.is_admin;
    $("chat-rules-gate").hidden = accepted;
    $("chat-ui").hidden = !accepted;
    if (!accepted) return;
    rooms = await rest("chat_rooms?select=*&active=eq.true&order=sort_order.asc");
    if (!roomId || !rooms.some((r) => r.id === roomId)) roomId = (rooms.find((r) => canSee(r.min_tier)) || rooms[0] || {}).id || null;
    drawRooms();
    await openRoom(roomId);
  }
  $("accept-rules-btn").addEventListener("click", async () => {
    try { await rpc("member_accept_chat_rules"); await loadMe(); await renderChat(); } catch (e) { toast(e.message); }
  });

  function drawRooms() {
    $("rooms").innerHTML = rooms.map((r) => {
      const open = canSee(r.min_tier);
      return '<button type="button" class="room' + (open ? "" : " locked") + '" data-room="' + r.id + '" aria-current="' + (r.id === roomId) + '"><strong>' + (open ? "" : "🔒 ") + esc(r.name) + "</strong><small>" +
        (r.min_tier === "gratis" ? "Öppen för alla medlemmar" : (r.moderated ? "Stängt, modererat · " : "") + esc(LEVEL_NAME[r.min_tier])) + "</small></button>";
    }).join("");
    $("rooms").querySelectorAll("[data-room]").forEach((b) => (b.onclick = () => openRoom(Number(b.dataset.room))));
  }

  async function openRoom(id) {
    stopPolling();
    roomId = id; lastId = 0;
    drawRooms();
    const r = rooms.find((x) => x.id === id);
    const msgs = $("msgs");
    if (!r) { $("room-name").textContent = "Inga rum ännu"; $("room-desc").textContent = ""; msgs.innerHTML = ""; $("composer").hidden = true; return; }
    $("room-name").textContent = r.name;
    $("room-desc").textContent = r.description || "";
    if (!canSee(r.min_tier)) {
      $("composer").hidden = true;
      msgs.innerHTML = '<div style="margin:auto;text-align:center;max-width:40ch"><p><strong>' + esc(r.name) + "</strong> ingår i " + esc(LEVEL_NAME[r.min_tier]) + '.</p><p class="muted">De stängda, nischade och modererade rummen är till för fördjupning i en trygg och hållen grupp.</p><a class="btn accent" href="#min-sida">Uppgradera</a></div>';
      return;
    }
    $("composer").hidden = !!r.read_only && !me.is_admin;
    msgs.innerHTML = '<p class="spinner">Hämtar…</p>';
    const rows = await rest("chat_messages?select=id,user_id,author_name,author_badge,body,created_at,hidden&room_id=eq." + id + "&order=id.desc&limit=150");
    msgs.innerHTML = rows.length ? "" : '<p class="muted" id="empty-room" style="margin:auto">Inga inlägg ännu. Skriv det första!</p>';
    rows.reverse().forEach(addMsg);
    msgs.scrollTop = msgs.scrollHeight;
    pollTimer = setInterval(poll, 5000);
  }

  function addMsg(m) {
    if (document.getElementById("m-" + m.id)) return;
    const empty = $("empty-room"); if (empty) empty.remove();
    const mine = session && m.user_id === session.uid;
    const div = document.createElement("div");
    div.className = "m" + (mine ? " me" : "");
    div.id = "m-" + m.id;
    div.innerHTML = '<span class="who">' + esc(m.author_name) + (m.author_badge ? ' <span class="badge">' + esc(m.author_badge) + "</span>" : "") + " · " + esc(fmtTime(m.created_at)) + (m.hidden ? " · <em>dolt</em>" : "") + "</span>" +
      '<div class="bubble">' + esc(m.body) + "</div>" +
      '<div class="acts">' + (mine || me.is_admin ? '<button type="button" data-del="' + m.id + '">Radera</button>' : "") + (!mine ? '<button type="button" data-rep="' + m.id + '">Anmäl</button>' : "") + "</div>";
    $("msgs").appendChild(div);
    lastId = Math.max(lastId, m.id);
    const d = div.querySelector("[data-del]"), rp = div.querySelector("[data-rep]");
    if (d) d.onclick = async () => {
      if (!confirm("Radera inlägget?")) return;
      try { await rest("chat_messages?id=eq." + m.id, { method: "DELETE" }); div.remove(); } catch (e) { toast(e.message); }
    };
    if (rp) rp.onclick = async () => {
      const reason = prompt("Vad är det som inte känns tryggt med inlägget? (valfritt)");
      if (reason === null) return;
      try { await rest("chat_reports", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ message_id: m.id, reason: reason.slice(0, 500) || null }) }); toast("Tack. En moderator tittar på inlägget."); }
      catch (e) { toast(e.message); }
    };
  }

  async function poll() {
    if (current !== "chatt" || document.hidden || !roomId) return;
    try {
      const msgs = $("msgs");
      const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
      const rows = await rest("chat_messages?select=id,user_id,author_name,author_badge,body,created_at,hidden&room_id=eq." + roomId + "&id=gt." + lastId + "&order=id.asc&limit=100");
      rows.forEach(addMsg);
      if (rows.length && atBottom) msgs.scrollTop = msgs.scrollHeight;
    } catch (e) { /* försök igen nästa gång */ }
  }

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = $("msg-input"), body = inp.value.trim();
    if (!body || !roomId) return;
    $("send-btn").disabled = true;
    try {
      const rows = await rest("chat_messages", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ room_id: roomId, body }) });
      inp.value = "";
      (rows || []).forEach(addMsg);
      $("msgs").scrollTop = $("msgs").scrollHeight;
    } catch (x) { toast(/row-level security/i.test(x.message) ? "Du kan inte skriva i det här rummet." : x.message); }
    finally { $("send-btn").disabled = false; inp.focus(); }
  });
  $("msg-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("composer").requestSubmit(); }
  });

  /* ---------------- Start ---------------- */
  async function init() {
    if (!CFG.url || !CFG.key) { toast("Webbplatsen saknar koppling till databasen."); return; }
    // Länkar från e-post (återställ lösenord) kommer med #access_token=…
    const h = location.hash.slice(1);
    if (/access_token=/.test(h)) {
      const p = new URLSearchParams(h);
      saveSession({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_in: Number(p.get("expires_in")) || 3600 });
      try {
        const u = await fetch(CFG.url + "/auth/v1/user", { headers: { apikey: CFG.key, Authorization: "Bearer " + session.access } }).then((r) => r.json());
        session.email = u.email || ""; session.uid = u.id || ""; localStorage.setItem(SKEY, JSON.stringify(session));
      } catch (e) {}
      history.replaceState(null, "", location.pathname + (p.get("type") === "recovery" ? "#nytt-losenord" : "#min-sida"));
    } else {
      try { session = JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (e) { session = null; }
    }
    updateNav();
    loadPlans();
    if (session) { try { await token(); await loadMe(); } catch (e) { /* utloggad */ } }
    addEventListener("hashchange", route);
    await route();
    handlePaymentReturn();
  }
  init();
})();
