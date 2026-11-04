-- Product taxonomy, product media metadata, and admin-only media uploads.
begin;

create table if not exists public.ah_product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ah_product_categories_slug_format check (slug ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  constraint ah_product_categories_sort_nonnegative check (sort_order >= 0)
);

create index if not exists ah_product_categories_active_sort_idx
  on public.ah_product_categories (is_active, sort_order, name);

alter table public.ah_products
  add column if not exists category_id uuid references public.ah_product_categories(id) on delete set null,
  add column if not exists image_path text;

insert into public.ah_product_categories (slug, name, description, sort_order, is_active)
values
  ('linux_vps', 'Linux VPS', 'Virtual private servers running Linux distributions.', 10, true),
  ('dedicated_server', 'Dedicated Server', 'Bare-metal dedicated server products.', 20, true),
  ('windows_rdp', 'Windows RDP', 'Windows remote desktop server products.', 30, true),
  ('gpu', 'GPU Compute', 'GPU accelerated compute products.', 40, true),
  ('domain', 'Domains', 'Domain registration products; keep unpublished until registrar integration is complete.', 50, false)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order;

update public.ah_products p
set category_id = c.id
from public.ah_product_categories c
where p.category = c.slug and p.category_id is null;

create or replace function public.ah_product_categories_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ah_product_categories_set_updated_at on public.ah_product_categories;
create trigger ah_product_categories_set_updated_at
before update on public.ah_product_categories
for each row execute function public.ah_product_categories_set_updated_at();

alter table public.ah_product_categories enable row level security;

drop policy if exists ah_product_categories_public_active_read on public.ah_product_categories;
create policy ah_product_categories_public_active_read
on public.ah_product_categories for select to anon
using (is_active);

drop policy if exists ah_product_categories_authenticated_read on public.ah_product_categories;
create policy ah_product_categories_authenticated_read
on public.ah_product_categories for select to authenticated
using (is_active or public.ah_is_admin());

drop policy if exists ah_product_categories_admin_write on public.ah_product_categories;
create policy ah_product_categories_admin_write
on public.ah_product_categories for all to authenticated
using (public.ah_is_admin())
with check (public.ah_is_admin());

grant select on public.ah_product_categories to anon, authenticated;
grant insert, update, delete on public.ah_product_categories to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'];

drop policy if exists ah_product_images_admin_insert on storage.objects;
create policy ah_product_images_admin_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and public.ah_is_admin());

drop policy if exists ah_product_images_admin_update on storage.objects;
create policy ah_product_images_admin_update
on storage.objects for update to authenticated
using (bucket_id = 'product-images' and public.ah_is_admin())
with check (bucket_id = 'product-images' and public.ah_is_admin());

drop policy if exists ah_product_images_admin_delete on storage.objects;
create policy ah_product_images_admin_delete
on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and public.ah_is_admin());

commit;