/* Admin: Medlemmar – medlemsregister, röstlängd, betalningar, moderering av chatten,
   bibliotek, chattrum, event och prisplaner. Bygger på window.HZADMIN från admin.html. */
(function () {
  "use strict";
  const A = window.HZADMIN;
  if (!A) return;
  const { rest, esc, CFG } = A;
  const toast = (t) => A.toast(t);
  const root = document.getElementById("tab-members");

  const LEVEL = { gratis: "Gratis", stod: "Stöd", premium: "Premium" };
  const LEVEL_LONG = { gratis: "Gratis Medlem", stod: "Horizonten Stöd", premium: "Gemenskap Premium" };
  const TYPE = { ordinarie: "Ordinarie", ungdom_familj: "Ungdom/familj", stod_samverkan: "Stöd/samverkan", heders: "Heders" };
  const STATUS = { aktiv: "Aktiv", uttradd: "Utträdd", avstangd: "Avstängd" };
  const memberNo = (n) => "HZ-" + String(n || 0).padStart(6, "0");
  const fmtD = (d) => (d ? new Date(d).toLocaleDateString("sv-SE") : "");
  const fmtDT = (d) => (d ? new Date(d).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : "");
  const kr = (n) => Number(n || 0).toLocaleString("sv-SE") + " kr";
  const rpc = (n, a) => rest("rpc/" + n, { method: "POST", body: JSON.stringify(a || {}) });
  async function fn(name, body) {
    const r = await fetch(CFG.url + "/functions/v1/" + name, {
      method: "POST",
      headers: { apikey: CFG.key, Authorization: "Bearer " + (await A.token()), "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || "Fel " + r.status);
    return j;
  }
  // Faktisk nivå just nu (samma regel som i databasen)
  function effLevel(m) {
    if (m.status === "avstangd") return null;
    if (m.member_type === "heders" && m.status === "aktiv") return "premium";
    if (m.status === "aktiv" && (m.tier === "stod" || m.tier === "premium") && m.paid_until && new Date(m.paid_until) > new Date()) return m.tier;
    return "gratis";
  }
  // Föreningsmedlem enligt stadgarna § 2.2: medlemsavgift erlagd (eller hedersmedlem)
  const isAssocMember = (m) => m.status === "aktiv" && (m.member_type === "heders" || effLevel(m) === "stod" || effLevel(m) === "premium");
  const canVote = (m) => isAssocMember(m) && ["ordinarie", "ungdom_familj", "heders"].includes(m.member_type);

  const css = document.createElement("style");
  css.textContent = `
  #tab-members .sub{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 14px}
  #tab-members .mgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
  #tab-members .mtile{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
  #tab-members .mtile b{display:block;font-size:24px;font-family:var(--display)}
  #tab-members .mtile span{color:var(--muted);font-size:13px}
  #tab-members .tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
  #tab-members .tools input,#tab-members .tools select,#tab-members .ed input,#tab-members .ed select,#tab-members .ed textarea{min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);padding:0 12px;font:inherit}
  #tab-members .ed textarea{padding:10px 12px;min-height:220px;width:100%;font-family:ui-monospace,Menlo,monospace;font-size:14px}
  #tab-members .ed{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px;margin:12px 0}
  #tab-members .ed .full{grid-column:1/-1}
  #tab-members .ed label{display:flex;flex-direction:column;gap:5px;font-size:13.5px;font-weight:500}
  #tab-members .ed label.cb{flex-direction:row;align-items:center;gap:8px}
  #tab-members .ed .acts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px}
  #tab-members tr.click{cursor:pointer}
  #tab-members tr.click:hover td{background:var(--bg)}
  #tab-members .tag{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--bar-soft)}
  #tab-members .tag.p{background:var(--accent-soft);color:var(--accent)}
  #tab-members .tag.w{background:#f6d7d4;color:#8a1c14}
  #tab-members .btn.danger{background:transparent;color:var(--err);box-shadow:inset 0 0 0 1px var(--err)}
  #tab-members .msgrow{white-space:pre-wrap;max-width:520px}
  `;
  document.head.appendChild(css);

  let sub = "register", members = [], payments = [], editing = null, q = "", fLevel = "all", fStatus = "all";
  const SUBS = [["register", "Medlemsregister"], ["payments", "Betalningar"], ["mod", "Moderering"], ["library", "Bibliotek"], ["rooms", "Chattrum"], ["events", "Event & webbinarier"], ["plans", "Prisplaner"]];

  function frame(inner) {
    root.innerHTML = '<div class="sub">' + SUBS.map(([k, l]) => '<button class="chip-btn' + (k === sub ? " active" : "") + '" data-sub="' + k + '" type="button">' + l + "</button>").join("") + "</div>" + inner;
    root.querySelectorAll("[data-sub]").forEach((b) => (b.onclick = () => { sub = b.dataset.sub; editing = null; show(); }));
  }

  async function show() {
    frame('<p class="muted">Hämtar…</p>');
    try {
      if (sub === "register") await showRegister();
      else if (sub === "payments") await showPayments();
      else if (sub === "mod") await showMod();
      else if (sub === "library") await crud(LIB);
      else if (sub === "rooms") await crud(ROOMS);
      else if (sub === "events") await crud(EVENTS);
      else if (sub === "plans") await crud(PLANS);
    } catch (e) {
      frame('<div class="note">Kunde inte hämta: ' + esc(e.message) + "<br>Har databasdelen <code>supabase/medlemskap.sql</code> körts?</div>");
    }
  }

  /* ---------------- Medlemsregister ---------------- */
  async function showRegister() {
    members = await rest("members?select=*&order=member_no.asc");
    const plans = await rest("membership_plans?select=*&order=sort_order.asc");
    const cnt = (f) => members.filter(f).length;
    const now = new Date(), soon = new Date(Date.now() + 30 * 864e5);
    const tiles = [
      ["Konton", members.length],
      ["Föreningsmedlemmar", cnt(isAssocMember)],
      ["Röstberättigade", cnt(canVote)],
      ["Horizonten Stöd", cnt((m) => effLevel(m) === "stod")],
      ["Gemenskap Premium", cnt((m) => effLevel(m) === "premium")],
      ["Går ut inom 30 dagar", cnt((m) => m.paid_until && new Date(m.paid_until) > now && new Date(m.paid_until) < soon && m.billing !== "manad")],
      ["Vill bli Kulturbärare", cnt((m) => m.kulturbarare_requested_at && !m.kulturbarare)],
    ];
    const list = members.filter((m) => {
      const lv = effLevel(m);
      if (fLevel === "kultur" && !(m.kulturbarare_requested_at && !m.kulturbarare)) return false;
      if (fLevel === "kulturbarare" && !m.kulturbarare) return false;
      if (["gratis", "stod", "premium"].includes(fLevel) && lv !== fLevel) return false;
      if (fLevel === "newsletter" && !m.newsletter) return false;
      if (fStatus !== "all" && m.status !== fStatus) return false;
      if (q) { const s = (m.full_name + " " + m.email + " " + (m.phone || "") + " " + (m.org_name || "") + " " + memberNo(m.member_no)).toLowerCase(); if (!s.includes(q.toLowerCase())) return false; }
      return true;
    });
    let html = '<div class="mgrid">' + tiles.map(([l, n]) => '<div class="mtile"><b>' + n + "</b><span>" + l + "</span></div>").join("") + "</div>";
    html += '<div class="tools"><input id="m-q" type="search" placeholder="Sök namn, e-post, nr…" value="' + esc(q) + '">' +
      '<select id="m-lv"><option value="all">Alla nivåer</option><option value="gratis">Gratis</option><option value="stod">Stöd</option><option value="premium">Premium</option><option value="kultur">Vill bli Kulturbärare</option><option value="kulturbarare">Kulturbärare</option><option value="newsletter">Vill ha nyhetsbrev</option></select>' +
      '<select id="m-st"><option value="all">Alla statusar</option><option value="aktiv">Aktiva</option><option value="uttradd">Utträdda</option><option value="avstangd">Avstängda</option></select>' +
      '<button class="btn small ghost" id="m-csv" type="button">Exportera register</button>' +
      '<button class="btn small ghost" id="m-vote" type="button">Röstlängd (CSV)</button>' +
      '<button class="btn small ghost" id="m-news" type="button">Kopiera e-post för nyhetsbrev</button></div>';
    if (editing) html += editForm(members.find((m) => m.user_id === editing), plans);
    html += '<div class="tbl"><table><thead><tr><th>Nr</th><th>Namn</th><th>E-post</th><th>Form</th><th>Nivå nu</th><th>Giltig t.o.m.</th><th>Status</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map((m) => {
        const lv = effLevel(m);
        const tags = [];
        if (m.kulturbarare) tags.push('<span class="tag p">Kulturbärare</span>');
        else if (m.kulturbarare_requested_at) tags.push('<span class="tag w">Vill bli Kulturbärare</span>');
        if (m.newsletter) tags.push('<span class="tag">Nyhetsbrev</span>');
        return '<tr class="click" data-edit="' + m.user_id + '"><td>' + memberNo(m.member_no) + "</td><td>" + esc(m.full_name) + (m.org_name ? "<br><small>" + esc(m.org_name) + "</small>" : "") + "</td><td>" + esc(m.email) + "</td><td>" + esc(TYPE[m.member_type]) + "</td><td>" +
          (lv ? '<span class="tag' + (lv === "premium" ? " p" : "") + '">' + LEVEL[lv] + "</span>" : "–") + (m.billing === "manad" && m.stripe_subscription_id ? " <small>månad</small>" : "") + "</td><td>" + fmtD(m.paid_until) + "</td><td>" + STATUS[m.status] + "</td><td>" + tags.join(" ") + "</td></tr>";
      }).join("") : '<tr><td colspan="8" class="muted">Inga medlemmar matchar.</td></tr>') + "</tbody></table></div>";
    frame(html);
    const qi = document.getElementById("m-q");
    qi.oninput = () => { q = qi.value; clearTimeout(qi.t); qi.t = setTimeout(() => { showRegister().then(() => { const n = document.getElementById("m-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 250); };
    const lvSel = document.getElementById("m-lv"); lvSel.value = fLevel; lvSel.onchange = () => { fLevel = lvSel.value; showRegister(); };
    const stSel = document.getElementById("m-st"); stSel.value = fStatus; stSel.onchange = () => { fStatus = stSel.value; showRegister(); };
    root.querySelectorAll("[data-edit]").forEach((tr) => (tr.onclick = () => { editing = tr.dataset.edit; showRegister().then(() => root.querySelector(".ed")?.scrollIntoView({ behavior: "smooth", block: "start" })); }));
    document.getElementById("m-csv").onclick = () => csv("medlemsregister", ["Medlemsnr", "Namn", "E-post", "Telefon", "Organisation", "Medlemsform", "Nivå nu", "Betald nivå", "Betalning", "Giltig till", "Status", "Föreningsmedlem", "Rösträtt", "Kulturbärare", "Nyhetsbrev", "Villkor godkända", "Registrerad"],
      members.map((m) => [memberNo(m.member_no), m.full_name, m.email, m.phone, m.org_name, TYPE[m.member_type], LEVEL_LONG[effLevel(m)] || "–", LEVEL_LONG[m.tier], m.billing === "manad" ? "Månad" : m.billing === "ar" ? "År" : "", fmtD(m.paid_until), STATUS[m.status], isAssocMember(m) ? "Ja" : "Nej", canVote(m) ? "Ja" : "Nej", m.kulturbarare ? "Ja" : "Nej", m.newsletter ? "Ja" : "Nej", fmtD(m.terms_accepted_at) + " (v. " + m.terms_version + ")", fmtD(m.created_at)]));
    document.getElementById("m-vote").onclick = () => csv("rostlangd", ["Medlemsnr", "Namn", "E-post", "Medlemsform", "Betalt till", "Anmärkning"],
      members.filter(canVote).map((m) => [memberNo(m.member_no), m.full_name, m.email, TYPE[m.member_type], m.member_type === "heders" ? "Hedersmedlem" : fmtD(m.paid_until), m.member_type === "ungdom_familj" ? "Rösträtt från det år medlemmen fyller 15 – kontrollera" : ""]));
    document.getElementById("m-news").onclick = async () => {
      const list = members.filter((m) => m.newsletter && m.status !== "avstangd").map((m) => m.email).join(", ");
      try { await navigator.clipboard.writeText(list); toast(list ? "E-postadresserna är kopierade" : "Ingen har valt nyhetsbrev ännu"); } catch (e) { prompt("Kopiera adresserna:", list); }
    };
    if (editing) wireEdit(members.find((m) => m.user_id === editing));
  }

  function editForm(m, plans) {
    if (!m) return "";
    const opt = (map, v) => Object.entries(map).map(([k, l]) => '<option value="' + k + '"' + (k === v ? " selected" : "") + ">" + l + "</option>").join("");
    return '<form class="ed" id="m-ed"><h3 class="full" style="margin:0">' + esc(m.full_name) + " · " + memberNo(m.member_no) + ' <small class="muted" style="font-weight:400">registrerad ' + fmtD(m.created_at) + (m.kulturbarare_requested_at && !m.kulturbarare ? " · vill bli Kulturbärare sedan " + fmtD(m.kulturbarare_requested_at) : "") + "</small></h3>" +
      '<label>Namn<input name="full_name" value="' + esc(m.full_name) + '"></label>' +
      '<label>Telefon<input name="phone" value="' + esc(m.phone || "") + '"></label>' +
      '<label>Organisation<input name="org_name" value="' + esc(m.org_name || "") + '"></label>' +
      '<label>Medlemsform<select name="member_type">' + opt({ ordinarie: "Ordinarie medlem", ungdom_familj: "Ungdoms- och familjemedlem", stod_samverkan: "Stöd-/samverkansmedlem", heders: "Hedersmedlem (utses av årsmötet)" }, m.member_type) + "</select></label>" +
      '<label>Betald nivå<select name="tier">' + opt(LEVEL_LONG, m.tier) + "</select></label>" +
      '<label>Giltig till och med<input name="paid_until" type="date" value="' + (m.paid_until ? new Date(m.paid_until).toISOString().slice(0, 10) : "") + '"></label>' +
      '<label>Status<select name="status">' + opt({ aktiv: "Aktiv", uttradd: "Utträdd", avstangd: "Avstängd (chatt och innehåll låst)" }, m.status) + "</select></label>" +
      '<label class="cb"><input type="checkbox" name="kulturbarare"' + (m.kulturbarare ? " checked" : "") + "> Kulturbärare</label>" +
      '<label class="cb"><input type="checkbox" name="newsletter"' + (m.newsletter ? " checked" : "") + "> Nyhetsbrev</label>" +
      '<label class="full">Intern anteckning (syns inte för medlemmen)<input name="admin_note" value="' + esc(m.admin_note || "") + '"></label>' +
      '<div class="acts"><button class="btn small" type="submit">Spara</button><button class="btn small ghost" type="button" id="m-close">Stäng</button>' +
      (m.kulturbarare_requested_at && !m.kulturbarare ? '<button class="btn small" type="button" id="m-kultur">Bekräfta som Kulturbärare</button>' : "") + "</div>" +
      '<h3 class="full" style="margin:10px 0 0;font-size:15px">Registrera betalning (Swish, faktura, kontant)</h3>' +
      '<label>Plan<select id="mp-plan">' + plans.map((p) => '<option value="' + p.id + '" data-price="' + p.price_sek + '">' + esc(p.title) + " – " + kr(p.price_sek) + (p.billing === "manad" ? "/mån" : "/år") + "</option>").join("") + "</select></label>" +
      '<label>Belopp (kr)<input id="mp-amount" type="number" min="0" value="' + (plans[0] ? plans[0].price_sek : "") + '"></label>' +
      '<label>Sätt<select id="mp-method"><option value="swish">Swish</option><option value="faktura">Faktura</option><option value="kontant">Kontant</option><option value="annat">Annat</option></select></label>' +
      '<label>Notering<input id="mp-note" placeholder="t.ex. Swish-referens"></label>' +
      '<div class="acts"><button class="btn small" type="button" id="mp-save">Registrera betalning och förläng</button></div>' +
      '<h3 class="full" style="margin:10px 0 0;font-size:15px">Konto</h3>' +
      '<div class="acts"><button class="btn small ghost" type="button" id="m-pw">Sätt tillfälligt lösenord</button><button class="btn small danger" type="button" id="m-del">Radera medlemmen</button></div>' +
      '<p class="full muted small" id="m-out" style="margin:0"></p></form>';
  }

  function wireEdit(m) {
    if (!m) return;
    const f = document.getElementById("m-ed");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const patch = { full_name: d.full_name, phone: d.phone, org_name: d.org_name, member_type: d.member_type, tier: d.tier, status: d.status,
        paid_until: d.paid_until ? d.paid_until + "T23:59:59" : "", kulturbarare: !!f.kulturbarare.checked, newsletter: !!f.newsletter.checked, admin_note: d.admin_note };
      if (!patch.kulturbarare && !m.kulturbarare) delete patch.kulturbarare; // behåll ev. ansökan
      try { await rpc("admin_update_member", { p_user: m.user_id, p: patch }); toast("Sparat"); await showRegister(); } catch (x) { toast(x.message); }
    };
    document.getElementById("m-close").onclick = () => { editing = null; showRegister(); };
    const k = document.getElementById("m-kultur");
    if (k) k.onclick = async () => { try { await rpc("admin_update_member", { p_user: m.user_id, p: { kulturbarare: true } }); toast("Bekräftad som Kulturbärare"); await showRegister(); } catch (x) { toast(x.message); } };
    const ps = document.getElementById("mp-plan");
    ps.onchange = () => (document.getElementById("mp-amount").value = ps.selectedOptions[0].dataset.price);
    document.getElementById("mp-save").onclick = async () => {
      const amount = parseInt(document.getElementById("mp-amount").value, 10);
      if (!(amount >= 0)) return toast("Ange belopp");
      if (!confirm("Registrera " + kr(amount) + " för " + m.full_name + "?")) return;
      try {
        const r = await rpc("admin_register_payment", { p_user: m.user_id, p_plan: ps.value, p_amount: amount, p_method: document.getElementById("mp-method").value, p_note: document.getElementById("mp-note").value });
        toast("Registrerat – giltigt till " + fmtD(r.paid_until)); await showRegister();
      } catch (x) { toast(x.message); }
    };
    document.getElementById("m-pw").onclick = async () => {
      if (!confirm("Sätta ett nytt tillfälligt lösenord för " + m.full_name + "? Det gamla slutar fungera.")) return;
      try { const r = await fn("member-account", { action: "admin_reset_password", user_id: m.user_id }); document.getElementById("m-out").innerHTML = "Tillfälligt lösenord: <strong style='font-family:ui-monospace,monospace'>" + esc(r.password) + "</strong> – ge det till medlemmen och be hen byta det på sin medlemssida."; }
      catch (x) { toast(x.message); }
    };
    document.getElementById("m-del").onclick = async () => {
      const a = prompt("Radera " + m.full_name + " (" + m.email + ") för alltid? Profil och chattinlägg tas bort, betalningar sparas för bokföringen. Skriv RADERA för att bekräfta.");
      if (!a || a.trim().toUpperCase() !== "RADERA") return;
      try { await fn("member-account", { action: "admin_delete", user_id: m.user_id }); editing = null; toast("Medlemmen är raderad"); await showRegister(); } catch (x) { toast(x.message); }
    };
  }

  function csv(name, head, rows) {
    const cell = (v) => { v = v == null ? "" : String(v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const blob = new Blob(["﻿" + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------------- Betalningar ---------------- */
  async function showPayments() {
    payments = await rest("member_payments?select=*&order=created_at.desc&limit=1000");
    const year = new Date().getFullYear();
    const sumYear = payments.filter((p) => new Date(p.created_at).getFullYear() === year).reduce((s, p) => s + (p.amount_sek || 0), 0);
    frame('<div class="mgrid"><div class="mtile"><b>' + payments.length + '</b><span>Betalningar totalt</span></div><div class="mtile"><b>' + kr(sumYear) + "</b><span>Medlemsavgifter " + year + "</span></div></div>" +
      '<div class="tools"><button class="btn small ghost" id="p-csv" type="button">Exportera för bokföringen</button><span class="muted small">Månadsdragningar för Premium per månad finns i Stripe.</span></div>' +
      '<div class="tbl"><table><thead><tr><th>Datum</th><th>Namn</th><th>E-post</th><th>Plan</th><th>Belopp</th><th>Sätt</th><th>Period</th><th>Notering</th></tr></thead><tbody>' +
      (payments.length ? payments.map((p) => "<tr><td>" + fmtD(p.created_at) + "</td><td>" + esc(p.full_name || "") + (p.user_id ? "" : " <small>(raderat konto)</small>") + "</td><td>" + esc(p.email) + "</td><td>" + esc(LEVEL_LONG[p.tier]) + (p.billing === "manad" ? " · månad" : " · år") + "</td><td>" + kr(p.amount_sek) + "</td><td>" + esc(p.method) + "</td><td>" + fmtD(p.period_start) + " – " + fmtD(p.period_end) + "</td><td>" + esc(p.note || "") + "</td></tr>").join("") : '<tr><td colspan="8" class="muted">Inga betalningar ännu.</td></tr>') + "</tbody></table></div>");
    document.getElementById("p-csv").onclick = () => csv("medlemsavgifter", ["Datum", "Namn", "E-post", "Plan", "Belopp", "Sätt", "Från", "Till", "Stripe-session", "Notering"],
      payments.map((p) => [fmtD(p.created_at), p.full_name, p.email, p.plan_id, p.amount_sek, p.method, fmtD(p.period_start), fmtD(p.period_end), p.stripe_session_id, p.note]));
  }

  /* ---------------- Moderering ---------------- */
  async function showMod() {
    const [reports, recent, rooms] = await Promise.all([
      rest("chat_reports?select=*,chat_messages(id,body,author_name,room_id,hidden,user_id,created_at)&handled=eq.false&order=created_at.desc"),
      rest("chat_messages?select=id,body,author_name,author_badge,room_id,hidden,user_id,created_at&order=id.desc&limit=60"),
      rest("chat_rooms?select=id,name"),
    ]);
    const roomName = (id) => (rooms.find((r) => r.id === id) || {}).name || "";
    const msgRow = (m, extra) => "<tr><td>" + fmtDT(m.created_at) + "</td><td>" + esc(roomName(m.room_id)) + "</td><td>" + esc(m.author_name) + (m.author_badge ? " <small>" + esc(m.author_badge) + "</small>" : "") + '</td><td class="msgrow">' + esc(m.body) + (m.hidden ? " <em>(dolt)</em>" : "") + "</td><td>" +
      '<button class="btn small ghost" data-hide="' + m.id + '" data-v="' + (!m.hidden) + '" type="button">' + (m.hidden ? "Visa" : "Dölj") + '</button> <button class="btn small danger" data-delm="' + m.id + '" type="button">Radera</button>' +
      (m.user_id ? ' <button class="btn small ghost" data-ban="' + m.user_id + '" type="button">Stäng av</button>' : "") + (extra || "") + "</td></tr>";
    frame("<h3>Anmälda inlägg (" + reports.length + ")</h3>" +
      '<div class="tbl" style="margin:8px 0 22px"><table><thead><tr><th>Tid</th><th>Rum</th><th>Av</th><th>Inlägg / anledning</th><th></th></tr></thead><tbody>' +
      (reports.length ? reports.map((r) => r.chat_messages ? msgRow({ ...r.chat_messages, body: r.chat_messages.body + (r.reason ? "\n\nAnmälan: " + r.reason : "") }, ' <button class="btn small" data-handled="' + r.id + '" type="button">Hanterad</button>') : "").join("") : '<tr><td colspan="5" class="muted">Inga öppna anmälningar.</td></tr>') + "</tbody></table></div>" +
      "<h3>Senaste inläggen</h3>" +
      '<div class="tbl" style="margin-top:8px"><table><thead><tr><th>Tid</th><th>Rum</th><th>Av</th><th>Inlägg</th><th></th></tr></thead><tbody>' +
      (recent.length ? recent.map((m) => msgRow(m)).join("") : '<tr><td colspan="5" class="muted">Inga inlägg ännu.</td></tr>') + "</tbody></table></div>");
    root.querySelectorAll("[data-hide]").forEach((b) => (b.onclick = async () => { try { await rest("chat_messages?id=eq." + b.dataset.hide, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ hidden: b.dataset.v === "true" }) }); showMod(); } catch (e) { toast(e.message); } }));
    root.querySelectorAll("[data-delm]").forEach((b) => (b.onclick = async () => { if (!confirm("Radera inlägget för alla?")) return; try { await rest("chat_messages?id=eq." + b.dataset.delm, { method: "DELETE" }); showMod(); } catch (e) { toast(e.message); } }));
    root.querySelectorAll("[data-handled]").forEach((b) => (b.onclick = async () => { try { await rest("chat_reports?id=eq." + b.dataset.handled, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ handled: true }) }); showMod(); } catch (e) { toast(e.message); } }));
    root.querySelectorAll("[data-ban]").forEach((b) => (b.onclick = async () => { if (!confirm("Stänga av medlemmen? Hen kan då inte använda chatten eller det låsta innehållet. Uteslutning ur föreningen beslutas av styrelsen (stadgarna § 2.5).")) return; try { await rpc("admin_update_member", { p_user: b.dataset.ban, p: { status: "avstangd" } }); toast("Avstängd"); } catch (e) { toast(e.message); } }));
  }

  /* ---------------- Generell redigering (bibliotek, rum, event, planer) ---------------- */
  const TIERS = { gratis: "Alla medlemmar (Bas)", stod: "Horizonten Stöd och uppåt", premium: "Gemenskap Premium" };
  const LIB = {
    table: "library_items", order: "min_tier.asc,sort_order.asc,id.asc", title: "Bibliotek", key: "id",
    note: "Formatering: <code>## Rubrik</code>, <code>- punkt</code>, <code>**fet**</code>, tomrad = nytt stycke. Bara publicerat material syns för medlemmarna.",
    cols: [["Titel", (r) => esc(r.title)], ["Typ", (r) => esc(r.kind)], ["Nivå", (r) => esc(TIERS[r.min_tier])], ["Publicerad", (r) => (r.published ? "Ja" : "<em>Utkast</em>")]],
    fields: [["title", "Titel", "text"], ["summary", "Kort beskrivning", "text", "full"], ["kind", "Typ", { arbetsblad: "Arbetsblad", ovning: "Övning", text: "Text", film: "Film" }], ["min_tier", "Vem får läsa", TIERS], ["sort_order", "Ordning", "number"], ["published", "Publicerad", "checkbox"], ["body", "Innehåll", "textarea", "full"]],
    blank: { title: "", summary: "", kind: "arbetsblad", min_tier: "gratis", sort_order: 0, published: false, body: "" },
  };
  const ROOMS = {
    table: "chat_rooms", order: "sort_order.asc", title: "Chattrum", key: "id",
    note: "Stängda, nischade och modererade rum ingår i Gemenskap Premium enligt förmånsmatrisen.",
    cols: [["Namn", (r) => esc(r.name)], ["Vem", (r) => esc(TIERS[r.min_tier])], ["Modererat", (r) => (r.moderated ? "Ja" : "")], ["Aktivt", (r) => (r.active ? "Ja" : "Nej")]],
    fields: [["name", "Namn", "text"], ["slug", "Kortnamn (unikt, utan mellanslag)", "text"], ["description", "Beskrivning", "text", "full"], ["min_tier", "Vem får gå in", TIERS], ["sort_order", "Ordning", "number"], ["moderated", "Modererat", "checkbox"], ["read_only", "Bara moderatorer kan skriva", "checkbox"], ["active", "Aktivt", "checkbox"]],
    blank: { name: "", slug: "", description: "", min_tier: "premium", sort_order: 10, moderated: true, read_only: false, active: true },
  };
  const EVENTS = {
    table: "member_events", order: "starts_at.desc", title: "Event & webbinarier", key: "id",
    note: "Länken (t.ex. Zoom/Teams) visas bara för medlemmar på rätt nivå. Exklusiva live-webbinarier och Q&A ingår i Gemenskap Premium.",
    cols: [["När", (r) => fmtDT(r.starts_at)], ["Titel", (r) => esc(r.title)], ["Vem", (r) => esc(TIERS[r.min_tier])], ["Aktivt", (r) => (r.active ? "Ja" : "Nej")]],
    fields: [["title", "Titel", "text"], ["starts_at", "Start", "datetime"], ["location", "Plats", "text"], ["link", "Länk till mötet", "text"], ["min_tier", "Vem får delta", TIERS], ["active", "Visas", "checkbox"], ["description", "Beskrivning", "text", "full"]],
    blank: { title: "", starts_at: "", location: "Digitalt", link: "", min_tier: "premium", active: true, description: "" },
  };
  const PLANS = {
    table: "membership_plans", order: "sort_order.asc", title: "Prisplaner", key: "id", noCreate: true, noDelete: true,
    note: "Medlemsavgifterna fastställs av årsmötet (stadgarna § 2.3 och § 5.5 punkt 11). Ändrat pris gäller nya betalningar; pågående månadsprenumerationer behåller sitt pris.",
    cols: [["Plan", (r) => esc(r.title)], ["Pris", (r) => kr(r.price_sek) + (r.billing === "manad" ? " / mån" : " / år")], ["Aktiv", (r) => (r.active ? "Ja" : "Nej")]],
    fields: [["title", "Namn", "text"], ["price_sek", "Pris (kr, inkl. moms)", "number"], ["active", "Kan köpas", "checkbox"], ["description", "Beskrivning", "text", "full"]],
  };

  async function crud(cfg) {
    const rows = await rest(cfg.table + "?select=*&order=" + cfg.order);
    const cur = editing === "new" ? { ...cfg.blank } : rows.find((r) => String(r[cfg.key]) === String(editing));
    let html = '<div class="tools"><h3 style="margin:0 auto 0 0">' + cfg.title + "</h3>" + (cfg.noCreate ? "" : '<button class="btn small" id="c-new" type="button">Lägg till</button>') + "</div>" + (cfg.note ? '<p class="muted small">' + cfg.note + "</p>" : "");
    if (cur) {
      html += '<form class="ed" id="c-ed">' + cfg.fields.map(([k, label, type, cls]) => {
        const v = cur[k];
        const c = cls === "full" || type === "textarea" ? ' class="full"' : "";
        if (type === "checkbox") return '<label class="cb"><input type="checkbox" name="' + k + '"' + (v ? " checked" : "") + "> " + label + "</label>";
        if (type === "textarea") return "<label" + c + ">" + label + '<textarea name="' + k + '">' + esc(v || "") + "</textarea></label>";
        if (type === "number") return "<label" + c + ">" + label + '<input type="number" name="' + k + '" value="' + esc(v == null ? "" : v) + '"></label>';
        if (type === "datetime") { const dv = v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""; return "<label" + c + ">" + label + '<input type="datetime-local" name="' + k + '" value="' + dv + '"></label>'; }
        if (typeof type === "object") return "<label" + c + ">" + label + '<select name="' + k + '">' + Object.entries(type).map(([o, l]) => '<option value="' + o + '"' + (o === v ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select></label>";
        return "<label" + c + ">" + label + '<input name="' + k + '" value="' + esc(v || "") + '"></label>';
      }).join("") + '<div class="acts"><button class="btn small" type="submit">Spara</button><button class="btn small ghost" type="button" id="c-close">Stäng</button>' +
        (editing !== "new" && !cfg.noDelete ? '<button class="btn small danger" type="button" id="c-del">Radera</button>' : "") + "</div></form>";
    }
    html += '<div class="tbl"><table><thead><tr>' + cfg.cols.map((c) => "<th>" + c[0] + "</th>").join("") + "</tr></thead><tbody>" +
      (rows.length ? rows.map((r) => '<tr class="click" data-row="' + esc(r[cfg.key]) + '">' + cfg.cols.map((c) => "<td>" + c[1](r) + "</td>").join("") + "</tr>").join("") : '<tr><td colspan="' + cfg.cols.length + '" class="muted">Inget ännu.</td></tr>') + "</tbody></table></div>";
    frame(html);
    const nb = document.getElementById("c-new");
    if (nb) nb.onclick = () => { editing = "new"; crud(cfg); };
    root.querySelectorAll("[data-row]").forEach((tr) => (tr.onclick = () => { editing = tr.dataset.row; crud(cfg).then(() => root.querySelector(".ed")?.scrollIntoView({ behavior: "smooth", block: "start" })); }));
    const f = document.getElementById("c-ed");
    if (!f) return;
    document.getElementById("c-close").onclick = () => { editing = null; crud(cfg); };
    const del = document.getElementById("c-del");
    if (del) del.onclick = async () => { if (!confirm("Radera för alltid?")) return; try { await rest(cfg.table + "?" + cfg.key + "=eq." + encodeURIComponent(editing), { method: "DELETE" }); editing = null; toast("Raderat"); crud(cfg); } catch (e) { toast(e.message); } };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const data = {};
      cfg.fields.forEach(([k, , type]) => {
        const el = f.elements[k];
        if (type === "checkbox") data[k] = el.checked;
        else if (type === "number") data[k] = el.value === "" ? null : Number(el.value);
        else if (type === "datetime") data[k] = el.value ? new Date(el.value).toISOString() : null;
        else data[k] = el.value.trim() === "" && k !== "body" ? null : el.value;
      });
      if (cfg === ROOMS && data.slug) data.slug = data.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      try {
        if (editing === "new") await rest(cfg.table, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(data) });
        else await rest(cfg.table + "?" + cfg.key + "=eq." + encodeURIComponent(editing), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(data) });
        editing = null; toast("Sparat"); crud(cfg);
      } catch (x) { toast(x.message); }
    };
  }

  window.HZMembers = { show };
})();
