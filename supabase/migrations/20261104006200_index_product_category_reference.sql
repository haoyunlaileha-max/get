-- Cover the new product-category foreign key for category joins and deletes.
create index if not exists ah_products_category_id_idx
  on public.ah_products (category_id);