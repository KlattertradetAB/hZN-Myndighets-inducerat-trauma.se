-- Horizonten Gemenskap – medlemsregister, medlemsnivåer, betalningar, medlemschatt, bibliotek och event
-- Körs en gång i Supabase (projektet "Myndighetsinducerat trauma"). Bygger på kraftsamling.sql och shop_and_ebook.sql.

-- ---------------------------------------------------------------
-- Admins: konton som skapats via medlemsregistreringen blir aldrig admin automatiskt,
-- även om e-postadressen senare läggs in i survey_admins. (Ta bort flaggan hz_source i
-- auth.users.raw_app_meta_data om en medlem verkligen ska bli admin.)
-- ---------------------------------------------------------------
create or replace function public.is_survey_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.survey_admins a
    join auth.users u on lower(u.email) = a.email
    where u.id = auth.uid()
      and coalesce(u.raw_app_meta_data->>'hz_source', '') <> 'member_signup'
  );
$$;

-- ---------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------
create table if not exists public.membership_plans (
  id text primary key,
  title text not null,
  tier text not null check (tier in ('stod', 'premium')),
  billing text not null check (billing in ('ar', 'manad')),
  price_sek integer not null check (price_sek > 0),
  description text,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_no bigint generated always as identity unique,
  email text not null unique,
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text check (phone is null or char_length(phone) <= 40),
  org_name text check (org_name is null or char_length(org_name) <= 160),
  member_type text not null default 'ordinarie'
    check (member_type in ('ordinarie', 'ungdom_familj', 'stod_samverkan', 'heders')),
  tier text not null default 'gratis' check (tier in ('gratis', 'stod', 'premium')),
  billing text check (billing in ('ar', 'manad')),
  paid_until timestamptz,
  status text not null default 'aktiv' check (status in ('aktiv', 'uttradd', 'avstangd')),
  newsletter boolean not null default false,
  kulturbarare boolean not null default false,
  kulturbarare_requested_at timestamptz,
  chat_rules_accepted_at timestamptz,
  terms_version text not null,
  terms_accepted_at timestamptz not null default now(),
  stripe_customer_id text,
  stripe_subscription_id text,
  admin_note text,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists members_email_idx on public.members (lower(email));

create table if not exists public.member_payments (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  full_name text,
  plan_id text not null,
  tier text not null,
  billing text not null,
  amount_sek integer not null,
  method text not null default 'stripe',
  stripe_session_id text unique,
  stripe_subscription_id text,
  period_start timestamptz,
  period_end timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists member_payments_user_idx on public.member_payments (user_id);

create table if not exists public.chat_rooms (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  description text,
  min_tier text not null default 'gratis' check (min_tier in ('gratis', 'stod', 'premium')),
  moderated boolean not null default false,
  read_only boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.chat_rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  author_name text not null,
  author_badge text,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on public.chat_messages (room_id, id);
create index if not exists chat_messages_user_idx on public.chat_messages (user_id, created_at);

create table if not exists public.chat_reports (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  reporter uuid default auth.uid() references auth.users(id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 500),
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.library_items (
  id bigint generated always as identity primary key,
  title text not null,
  summary text,
  body text not null default '',
  kind text not null default 'arbetsblad' check (kind in ('arbetsblad', 'ovning', 'text', 'film')),
  min_tier text not null default 'gratis' check (min_tier in ('gratis', 'stod', 'premium')),
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_events (
  id bigint generated always as identity primary key,
  title text not null,
  description text,
  starts_at timestamptz not null,
  location text,
  link text,
  min_tier text not null default 'premium' check (min_tier in ('gratis', 'stod', 'premium')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Hjälpfunktioner för nivåer
-- ---------------------------------------------------------------
create or replace function public.hz_tier_rank(t text)
returns integer language sql immutable set search_path = '' as $$
  select case t when 'premium' then 2 when 'stod' then 1 when 'gratis' then 0 else -1 end;
$$;

-- Den inloggades faktiska nivå just nu: null = ingen medlem/avstängd, annars gratis/stod/premium
create or replace function public.member_level()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when m.user_id is null or m.status = 'avstangd' then null
    when m.member_type = 'heders' and m.status = 'aktiv' then 'premium'
    when m.status = 'aktiv' and m.tier in ('stod', 'premium') and m.paid_until > now() then m.tier
    else 'gratis'
  end
  from (select 1) x
  left join public.members m on m.user_id = auth.uid();
$$;

create or replace function public.hz_can_access(min_tier text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_survey_admin()
      or coalesce(public.hz_tier_rank(public.member_level()) >= public.hz_tier_rank(min_tier), false);
$$;

create or replace function public.hz_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists members_touch on public.members;
create trigger members_touch before update on public.members for each row execute function public.hz_touch_updated_at();
drop trigger if exists library_touch on public.library_items;
create trigger library_touch before update on public.library_items for each row execute function public.hz_touch_updated_at();

-- ---------------------------------------------------------------
-- Säkerhetsregler (RLS)
-- ---------------------------------------------------------------
alter table public.membership_plans enable row level security;
alter table public.members enable row level security;
alter table public.member_payments enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reports enable row level security;
alter table public.library_items enable row level security;
alter table public.member_events enable row level security;

revoke all on public.membership_plans, public.members, public.member_payments, public.chat_rooms,
  public.chat_messages, public.chat_reports, public.library_items, public.member_events from anon, authenticated;

-- Prisplaner: alla ser aktiva, admins ändrar
drop policy if exists "alla ser aktiva planer" on public.membership_plans;
create policy "alla ser aktiva planer" on public.membership_plans for select to anon, authenticated
  using (active or public.is_survey_admin());
drop policy if exists "admins hanterar planer" on public.membership_plans;
create policy "admins hanterar planer" on public.membership_plans for all to authenticated
  using (public.is_survey_admin()) with check (public.is_survey_admin());
grant select on public.membership_plans to anon, authenticated;
grant insert, update, delete on public.membership_plans to authenticated;

-- Medlemmar: man ser sin egen rad, admins ser alla. Ändringar sker bara via funktionerna nedan.
drop policy if exists "medlem ser sig själv" on public.members;
create policy "medlem ser sig själv" on public.members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_survey_admin());
grant select on public.members to authenticated;

-- Betalningar: egna eller admin
drop policy if exists "medlem ser egna betalningar" on public.member_payments;
create policy "medlem ser egna betalningar" on public.member_payments for select to authenticated
  using (user_id = (select auth.uid()) or public.is_survey_admin());
grant select on public.member_payments to authenticated;

-- Chattrum: inloggade ser listan (låsta rum visas med lås), admins hanterar
drop policy if exists "inloggade ser rum" on public.chat_rooms;
create policy "inloggade ser rum" on public.chat_rooms for select to authenticated
  using (active or public.is_survey_admin());
drop policy if exists "admins hanterar rum" on public.chat_rooms;
create policy "admins hanterar rum" on public.chat_rooms for all to authenticated
  using (public.is_survey_admin()) with check (public.is_survey_admin());
grant select, insert, update, delete on public.chat_rooms to authenticated;

-- Chattmeddelanden
create or replace function public.hz_room_open(p_room bigint, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_survey_admin() or exists (
    select 1 from public.chat_rooms r
    where r.id = p_room and r.active and (not p_write or not r.read_only)
      and public.member_level() is not null
      and public.hz_can_access(r.min_tier)
      and (not p_write or exists (
        select 1 from public.members m
        where m.user_id = auth.uid() and m.chat_rules_accepted_at is not null and m.status <> 'avstangd'))
  );
$$;

drop policy if exists "läsa chatt" on public.chat_messages;
create policy "läsa chatt" on public.chat_messages for select to authenticated
  using ((not hidden and public.hz_room_open(room_id, false)) or public.is_survey_admin());
drop policy if exists "skriva chatt" on public.chat_messages;
create policy "skriva chatt" on public.chat_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hz_room_open(room_id, true));
drop policy if exists "radera eget eller moderera" on public.chat_messages;
create policy "radera eget eller moderera" on public.chat_messages for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_survey_admin());
drop policy if exists "admins döljer" on public.chat_messages;
create policy "admins döljer" on public.chat_messages for update to authenticated
  using (public.is_survey_admin()) with check (public.is_survey_admin());
grant select, delete on public.chat_messages to authenticated;
grant insert (room_id, body) on public.chat_messages to authenticated;
grant update (hidden) on public.chat_messages to authenticated;

-- Namn och märkning sätts av servern, inte av webbläsaren. Max 8 inlägg per minut.
create or replace function public.hz_chat_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.members; adm boolean := public.is_survey_admin();
begin
  select * into m from public.members where user_id = auth.uid();
  if not adm and (select count(*) from public.chat_messages c
                  where c.user_id = auth.uid() and c.created_at > now() - interval '1 minute') >= 8 then
    raise exception 'Du skriver väldigt snabbt. Vänta en stund innan du skriver igen.';
  end if;
  new.user_id := auth.uid();
  new.body := btrim(new.body);
  new.hidden := false;
  new.created_at := now();
  new.author_name := coalesce(nullif(split_part(m.full_name, ' ', 1), ''), 'Horizonten');
  new.author_badge := case when adm then 'Moderator' when m.kulturbarare then 'Kulturbärare' else null end;
  return new;
end;
$$;
drop trigger if exists chat_before_insert on public.chat_messages;
create trigger chat_before_insert before insert on public.chat_messages
  for each row execute function public.hz_chat_before_insert();

-- Anmälningar av inlägg
drop policy if exists "medlem anmäler" on public.chat_reports;
create policy "medlem anmäler" on public.chat_reports for insert to authenticated
  with check (reporter = (select auth.uid()));
drop policy if exists "admins hanterar anmälningar" on public.chat_reports;
create policy "admins hanterar anmälningar" on public.chat_reports for all to authenticated
  using (public.is_survey_admin()) with check (public.is_survey_admin());
grant insert (message_id, reason) on public.chat_reports to authenticated;
grant select, update, delete on public.chat_reports to authenticated;

-- Bibliotek
drop policy if exists "läsa bibliotek" on public.library_items;
create policy "läsa bibliotek" on public.library_items for select to authenticated
  using ((published and public.member_level() is not null and public.hz_can_access(min_tier)) or public.is_survey_admin());
drop policy if exists "admins hanterar bibliotek" on public.library_items;
create policy "admins hanterar bibliotek" on public.library_items for all to authenticated
  using (public.is_survey_admin()) with check (public.is_survey_admin());
grant select, insert, update, delete on public.library_items to authenticated;

-- Event och webbinarier
drop policy if exists "läsa event" on public.member_events;
create policy "läsa event" on public.member_events for select to authenticated
  using ((active and public.member_level() is not null and public.hz_can_access(min_tier)) or public.is_survey_admin());
drop policy if exists "admins hanterar event" on public.member_events;
create policy "admins hanterar event" on public.member_events for all to authenticated
  using (public.is_survey_admin()) with check (public.is_survey_admin());
grant select, insert, update, delete on public.member_events to authenticated;

-- ---------------------------------------------------------------
-- Kataloger (visar även låst innehåll, men utan själva innehållet)
-- ---------------------------------------------------------------
create or replace function public.library_catalog()
returns table (id bigint, title text, summary text, kind text, min_tier text, unlocked boolean)
language sql stable security definer set search_path = '' as $$
  select l.id, l.title, l.summary, l.kind, l.min_tier,
         (public.member_level() is not null and public.hz_can_access(l.min_tier))
  from public.library_items l
  where l.published
  order by public.hz_tier_rank(l.min_tier), l.sort_order, l.id;
$$;

create or replace function public.events_catalog()
returns table (id bigint, title text, description text, starts_at timestamptz, min_tier text, unlocked boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, e.title, e.description, e.starts_at, e.min_tier,
         (public.member_level() is not null and public.hz_can_access(e.min_tier))
  from public.member_events e
  where e.active and e.starts_at > now() - interval '3 hours'
  order by e.starts_at;
$$;

-- ---------------------------------------------------------------
-- Medlemmens egna funktioner
-- ---------------------------------------------------------------
create or replace function public.member_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when m.user_id is null then null else
    to_jsonb(m) - 'admin_note' - 'stripe_customer_id'
      || jsonb_build_object('level', public.member_level(), 'is_admin', public.is_survey_admin())
  end
  from (select 1) x left join public.members m on m.user_id = auth.uid();
$$;

create or replace function public.member_update_profile(p_full_name text, p_phone text, p_org_name text, p_newsletter boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_full_name, ''))) < 2 then raise exception 'Ange ditt namn.'; end if;
  update public.members set
    full_name = btrim(p_full_name),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    org_name = nullif(btrim(coalesce(p_org_name, '')), ''),
    newsletter = coalesce(p_newsletter, false)
  where user_id = auth.uid();
end;
$$;

create or replace function public.member_accept_chat_rules()
returns void language sql security definer set search_path = '' as $$
  update public.members set chat_rules_accepted_at = coalesce(chat_rules_accepted_at, now()) where user_id = auth.uid();
$$;

create or replace function public.member_request_kulturbarare()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.member_level() not in ('stod', 'premium') then
    raise exception 'Kulturbärare är för betalande medlemmar.';
  end if;
  update public.members set kulturbarare_requested_at = coalesce(kulturbarare_requested_at, now())
  where user_id = auth.uid() and not kulturbarare;
end;
$$;

-- Utträde enligt stadgarna § 2.4: upphör omedelbart, avgifter återbetalas inte. Kontot finns kvar som registrerad användare.
create or replace function public.member_leave()
returns void language sql security definer set search_path = '' as $$
  update public.members set status = 'uttradd', left_at = now(), kulturbarare = false
  where user_id = auth.uid() and status = 'aktiv';
$$;

create or replace function public.member_rejoin()
returns void language sql security definer set search_path = '' as $$
  update public.members set status = 'aktiv', left_at = null where user_id = auth.uid() and status = 'uttradd';
$$;

-- ---------------------------------------------------------------
-- Betalningar (körs av servern efter verifierad Stripe-betalning, eller av admin vid Swish/kontant)
-- ---------------------------------------------------------------
create or replace function public.member_apply_payment(
  p_user uuid, p_plan text, p_amount integer, p_method text, p_session text,
  p_subscription text, p_customer text, p_period_end timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.members; pl public.membership_plans; v_start timestamptz; v_end timestamptz;
begin
  select * into m from public.members where user_id = p_user for update;
  if not found then raise exception 'Medlemmen finns inte.'; end if;
  select * into pl from public.membership_plans where id = p_plan;
  if not found then raise exception 'Okänd medlemsplan.'; end if;
  if p_session is not null and exists (select 1 from public.member_payments where stripe_session_id = p_session) then
    return jsonb_build_object('already', true, 'tier', m.tier, 'paid_until', m.paid_until);
  end if;

  if pl.billing = 'manad' then
    v_start := now();
    v_end := greatest(coalesce(p_period_end, now() + interval '1 month'),
                      case when m.paid_until > now() then m.paid_until else now() end);
  else
    v_start := case when m.tier = pl.tier and m.paid_until > now() then m.paid_until else now() end;
    v_end := v_start + interval '12 months';
  end if;

  insert into public.member_payments (user_id, email, full_name, plan_id, tier, billing, amount_sek, method,
    stripe_session_id, stripe_subscription_id, period_start, period_end, note)
  values (p_user, m.email, m.full_name, pl.id, pl.tier, pl.billing, p_amount, coalesce(p_method, 'stripe'),
    p_session, p_subscription, v_start, v_end, p_note);

  update public.members set
    tier = pl.tier, billing = pl.billing, paid_until = v_end, status = 'aktiv', left_at = null,
    stripe_subscription_id = coalesce(p_subscription, stripe_subscription_id),
    stripe_customer_id = coalesce(p_customer, stripe_customer_id)
  where user_id = p_user;

  return jsonb_build_object('already', false, 'tier', pl.tier, 'paid_until', v_end);
end;
$$;

create or replace function public.member_sync_subscription(p_user uuid, p_subscription text, p_period_end timestamptz, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_active then
    update public.members set tier = 'premium', billing = 'manad',
      paid_until = greatest(coalesce(paid_until, now()), p_period_end), stripe_subscription_id = p_subscription
    where user_id = p_user;
  else
    update public.members set stripe_subscription_id = null
    where user_id = p_user and stripe_subscription_id = p_subscription;
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- Adminfunktioner
-- ---------------------------------------------------------------
create or replace function public.admin_update_member(p_user uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_survey_admin() then raise exception 'Behörighet saknas.'; end if;
  update public.members set
    full_name   = case when p ? 'full_name'   then p->>'full_name' else full_name end,
    phone       = case when p ? 'phone'       then nullif(p->>'phone', '') else phone end,
    org_name    = case when p ? 'org_name'    then nullif(p->>'org_name', '') else org_name end,
    member_type = case when p ? 'member_type' then p->>'member_type' else member_type end,
    tier        = case when p ? 'tier'        then p->>'tier' else tier end,
    billing     = case when p ? 'billing'     then nullif(p->>'billing', '') else billing end,
    paid_until  = case when p ? 'paid_until'  then nullif(p->>'paid_until', '')::timestamptz else paid_until end,
    status      = case when p ? 'status'      then p->>'status' else status end,
    left_at     = case when p ? 'status' and p->>'status' = 'uttradd' then coalesce(left_at, now())
                       when p ? 'status' and p->>'status' = 'aktiv' then null else left_at end,
    newsletter  = case when p ? 'newsletter'  then (p->>'newsletter')::boolean else newsletter end,
    kulturbarare = case when p ? 'kulturbarare' then (p->>'kulturbarare')::boolean else kulturbarare end,
    kulturbarare_requested_at = case when p ? 'kulturbarare' then null else kulturbarare_requested_at end,
    admin_note  = case when p ? 'admin_note'  then nullif(p->>'admin_note', '') else admin_note end
  where user_id = p_user;
end;
$$;

create or replace function public.admin_register_payment(p_user uuid, p_plan text, p_amount integer, p_method text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_survey_admin() then raise exception 'Behörighet saknas.'; end if;
  return public.member_apply_payment(p_user, p_plan, p_amount, coalesce(nullif(p_method, ''), 'manuell'),
    null, null, null, null, p_note);
end;
$$;

-- ---------------------------------------------------------------
-- Rättigheter för funktionerna
-- ---------------------------------------------------------------
revoke execute on function public.member_level(), public.hz_can_access(text), public.hz_room_open(bigint, boolean),
  public.library_catalog(), public.events_catalog(), public.member_me(),
  public.member_update_profile(text, text, text, boolean), public.member_accept_chat_rules(),
  public.member_request_kulturbarare(), public.member_leave(), public.member_rejoin(),
  public.member_apply_payment(uuid, text, integer, text, text, text, text, timestamptz, text),
  public.member_sync_subscription(uuid, text, timestamptz, boolean),
  public.admin_update_member(uuid, jsonb), public.admin_register_payment(uuid, text, integer, text, text),
  public.hz_chat_before_insert()
  from public, anon, authenticated;

grant execute on function public.hz_tier_rank(text) to anon, authenticated;
grant execute on function public.library_catalog(), public.events_catalog() to anon, authenticated;
grant execute on function public.member_level(), public.hz_can_access(text) to authenticated;
grant execute on function public.hz_room_open(bigint, boolean), public.member_me(),
  public.member_update_profile(text, text, text, boolean), public.member_accept_chat_rules(),
  public.member_request_kulturbarare(), public.member_leave(), public.member_rejoin(),
  public.admin_update_member(uuid, jsonb), public.admin_register_payment(uuid, text, integer, text, text)
  to authenticated;
grant execute on function public.member_apply_payment(uuid, text, integer, text, text, text, text, timestamptz, text),
  public.member_sync_subscription(uuid, text, timestamptz, boolean) to service_role;

-- ---------------------------------------------------------------
-- Startdata
-- ---------------------------------------------------------------
insert into public.membership_plans (id, title, tier, billing, price_sek, description, sort_order) values
  ('stod-ar', 'Horizonten Stöd', 'stod', 'ar', 295, 'Bron: en stabiliserande resurs i vardagen med rabatter, communitytillhörighet och övningsstöd.', 1),
  ('premium-ar', 'Gemenskap Premium', 'premium', 'ar', 950, 'Fördjupningen: full tillgång till fördjupningsuppgifter, alla bilagor, stängda modererade rum och Q&A.', 2),
  ('premium-manad', 'Gemenskap Premium – per månad', 'premium', 'manad', 95, 'Samma som Gemenskap Premium, betalas månadsvis och kan avslutas när du vill.', 3)
on conflict (id) do nothing;

insert into public.chat_rooms (slug, name, description, min_tier, moderated, sort_order) values
  ('oppen', 'Öppna medlemschatten', 'Här möts alla medlemmar. Presentera dig gärna – trygghetsvärdarna hälsar dig välkommen.', 'gratis', false, 1),
  ('neurobiologi', 'Neurobiologi & trauma', 'Stängt, modererat rum där vi går på djupet i nervsystemet, stress och trauma.', 'premium', true, 2),
  ('traumaterapi', 'Traumaterapi', 'Stängt, modererat rum för fördjupning i traumaterapi och bemötande.', 'premium', true, 3),
  ('self-care', 'Self-care-modellen', 'Stängt, modererat rum för arbete med Self-care-modellen, grundsår och de fem stegen.', 'premium', true, 4),
  ('qa', 'Q&A', 'Frågor och svar inför och efter våra live-webbinarier.', 'premium', true, 5)
on conflict (slug) do nothing;
