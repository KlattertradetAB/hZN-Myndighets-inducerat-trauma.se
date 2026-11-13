-- Kraftsamling för Barnens Bästa: enkätsvar, kontakter och admin-åtkomst
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Hemlig nyckel för att hasha referenskoder (läses bara av funktionerna nedan)
create table private.settings (key text primary key, value text not null);
insert into private.settings values ('ref_pepper', encode(extensions.gen_random_bytes(32), 'hex'));

-- Vilka som får se svaren
create table public.survey_admins (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table public.survey_admins enable row level security;
insert into public.survey_admins (email) values ('billy@klattertradet.com');

create or replace function public.is_survey_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.survey_admins a
    join auth.users u on lower(u.email) = a.email
    where u.id = auth.uid()
  );
$$;
revoke all on function public.is_survey_admin() from public, anon;
grant execute on function public.is_survey_admin() to authenticated;

create policy "admins ser admins" on public.survey_admins for select to authenticated using (public.is_survey_admin());

-- Svaren (inga personuppgifter, ingen IP, bara datum)
create table public.survey_responses (
  id bigint generated always as identity primary key,
  survey_version smallint not null default 1,
  submitted_on date not null default current_date,
  health_consent boolean not null default false,
  f1 text not null check (f1 in ('Ja','Nej')),
  answers jsonb not null default '{}'::jsonb,
  ref_hash text not null unique
);
alter table public.survey_responses enable row level security;
create policy "admins läser svar" on public.survey_responses for select to authenticated using (public.is_survey_admin());
create policy "admins raderar svar" on public.survey_responses for delete to authenticated using (public.is_survey_admin());

-- Kontaktuppgifter, separat och utan koppling till svaren
create table public.survey_contacts (
  id bigint generated always as identity primary key,
  purpose text not null check (purpose in ('uppfoljning','resultat')),
  name text, email text, phone text,
  submitted_on date not null default current_date,
  ref_hash text not null
);
create index on public.survey_contacts (ref_hash);
alter table public.survey_contacts enable row level security;
create policy "admins läser kontakter" on public.survey_contacts for select to authenticated using (public.is_survey_admin());
create policy "admins raderar kontakter" on public.survey_contacts for delete to authenticated using (public.is_survey_admin());

revoke all on public.survey_responses, public.survey_contacts, public.survey_admins from anon;
revoke insert, update on public.survey_responses, public.survey_contacts, public.survey_admins from authenticated;

create or replace function private.ref_hash(scope text, code text)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(scope || ':' || upper(code), (select value from private.settings where key = 'ref_pepper'), 'sha256'), 'hex');
$$;

-- Ta emot ett svar. Enda vägen in för besökare.
create or replace function public.submit_survey(payload jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  allowed text[] := array['f1','f2','f3_annat','f4a','f4a_kan_inte','f4b','alder','barn_alder','antal_barn','kommun','ar','civil',
    'kontakter','tid','rattigheter','motstridiga','varnad','beslut','overklaga','foralder','upprepade','ombud','ekonomi','historia',
    'kontakt_barn','barn_forandrat','vard','arbete','suicid','skala','ord','ovrigt','stod','dokumentation',
    'f3_0_0','f3_0_1','f3_0_2','f3_1_0','f3_1_1','f3_1_2','f3_2_0','f3_2_1','f3_2_2','f3_3_0','f3_3_1'];
  health text[] := array['vard','arbete','suicid','f3_3_1'];
  a jsonb := coalesce(payload->'answers','{}'::jsonb);
  clean jsonb := '{}'::jsonb;
  hc boolean := coalesce((payload->>'health_consent')::boolean, false);
  k text; v jsonb; code text; c jsonb; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if coalesce((payload->>'consent')::boolean, false) is not true then raise exception 'Samtycke krävs för att skicka in.'; end if;
  if coalesce(payload->>'website','') <> '' then raise exception 'Ogiltig inskickning.'; end if;
  if jsonb_typeof(a) <> 'object' or (a->>'f1') is null or (a->>'f1') not in ('Ja','Nej') then raise exception 'Fråga 1 måste besvaras.'; end if;
  if length(payload::text) > 100000 then raise exception 'För stor inskickning.'; end if;

  for k, v in select * from jsonb_each(a) loop
    continue when not (k = any(allowed));
    continue when (not hc) and k = any(health);
    continue when jsonb_typeof(v) not in ('string','number','boolean');
    continue when v in ('""'::jsonb, 'false'::jsonb, 'null'::jsonb);
    if jsonb_typeof(v) = 'string' and length(v #>> '{}') > 10000 then raise exception 'Ett svar är för långt.'; end if;
    if k = 'skala' and not ((v #>> '{}') ~ '^(10|[1-9])$') then continue; end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;

  code := 'KR-';
  for i in 1..4 loop code := code || substr(alphabet, 1 + floor(random()*32)::int, 1); end loop;
  code := code || '-';
  for i in 1..4 loop code := code || substr(alphabet, 1 + floor(random()*32)::int, 1); end loop;

  insert into public.survey_responses (health_consent, f1, answers, ref_hash)
  values (hc, clean->>'f1', clean, private.ref_hash('svar', code));

  c := payload->'contact';
  if jsonb_typeof(c) = 'object' and (coalesce(c->>'namn','') <> '' or coalesce(c->>'epost','') <> '' or coalesce(c->>'telefon','') <> '') then
    insert into public.survey_contacts (purpose, name, email, phone, ref_hash)
    values ('uppfoljning', left(nullif(c->>'namn',''),200), left(nullif(c->>'epost',''),254), left(nullif(c->>'telefon',''),40), private.ref_hash('kontakt', code));
  end if;
  if coalesce(payload->>'results_email','') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    insert into public.survey_contacts (purpose, email, ref_hash)
    values ('resultat', left(payload->>'results_email',254), private.ref_hash('kontakt', code));
  end if;

  return code;
end;
$$;
revoke all on function public.submit_survey(jsonb) from public;
grant execute on function public.submit_survey(jsonb) to anon, authenticated;

-- Rätten att få sina svar raderade med referenskoden
create or replace function public.delete_survey(code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if code !~* '^KR-[A-Z0-9]{4}-[A-Z0-9]{4}$' then return; end if;
  delete from public.survey_responses where ref_hash = private.ref_hash('svar', code);
  delete from public.survey_contacts where ref_hash = private.ref_hash('kontakt', code);
end;
$$;
revoke all on function public.delete_survey(text) from public;
grant execute on function public.delete_survey(text) to anon, authenticated;

revoke all on function private.ref_hash(text, text) from public, anon, authenticated;
