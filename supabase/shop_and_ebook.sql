-- Kassa, Ordrar, Produkter samt E-bokslicenser & Bokläsare
create table if not exists public.shop_products (
  id text primary key,
  title text not null,
  subtitle text,
  category text not null check (category in ('ebook', 'physical', 'course')),
  price_sek integer not null check (price_sek >= 0),
  shipping_sek integer not null default 0,
  requires_shipping boolean not null default false,
  grants_ebook boolean not null default false,
  allows_pdf_download boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0
);

alter table public.shop_products enable row level security;
create policy "alla ser aktiva produkter" on public.shop_products for select to anon, authenticated using (active = true or public.is_survey_admin());
create policy "admins hanterar produkter" on public.shop_products for all to authenticated using (public.is_survey_admin()) with check (public.is_survey_admin());

grant select on public.shop_products to anon, authenticated;
grant insert, update, delete on public.shop_products to authenticated;

create table if not exists public.shop_orders (
  id bigint generated always as identity primary key,
  order_number text not null unique,
  created_at timestamptz not null default now(),
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  shipping_address jsonb,
  items jsonb not null default '[]'::jsonb,
  subtotal_sek integer not null default 0,
  shipping_sek integer not null default 0,
  total_sek integer not null default 0,
  payment_method text not null default 'stripe_card',
  payment_status text not null default 'paid',
  stripe_session_id text,
  license_code text
);

create index if not exists shop_orders_email_idx on public.shop_orders (lower(customer_email));
alter table public.shop_orders enable row level security;
create policy "admins hanterar ordrar" on public.shop_orders for all to authenticated using (public.is_survey_admin()) with check (public.is_survey_admin());

revoke all on public.shop_orders from anon;
grant select, insert, update, delete on public.shop_orders to authenticated;

create table if not exists public.ebook_licenses (
  id bigint generated always as identity primary key,
  email text not null,
  customer_name text,
  license_code text not null unique,
  tier text not null default 'read' check (tier in ('read', 'pdf')),
  active boolean not null default true,
  order_id bigint references public.shop_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  login_count integer not null default 0
);

create index if not exists ebook_licenses_lookup_idx on public.ebook_licenses (lower(email), upper(license_code));
alter table public.ebook_licenses enable row level security;
create policy "admins hanterar licenser" on public.ebook_licenses for all to authenticated using (public.is_survey_admin()) with check (public.is_survey_admin());

revoke all on public.ebook_licenses from anon;
grant select, insert, update, delete on public.ebook_licenses to authenticated;

create table if not exists public.ebook_content (
  id smallint primary key default 1 check (id = 1),
  title text not null default 'Myndighetsinducerat trauma – från subjekt till objekt',
  subtitle text not null default 'En systemisk studie av rättsosäkerhet, maktförhållanden och psykologiska konsekvenser i svensk barnavård',
  authors text not null default 'Billy Ljungberg & Jeanette Johansson (2025)',
  chapters jsonb not null default '[]'::jsonb,
  pdf_data_url text,
  pdf_filename text,
  updated_at timestamptz not null default now()
);

alter table public.ebook_content enable row level security;
create policy "admins hanterar bokinnehall" on public.ebook_content for all to authenticated using (public.is_survey_admin()) with check (public.is_survey_admin());

revoke all on public.ebook_content from anon;
grant select, insert, update on public.ebook_content to authenticated;
