-- Run only against the confirmed comercio360-dev project with Supabase CLI.
-- All catalog rows and audit events created here are rolled back.
begin;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where email = 'gerente.aurora@example.test'),
  true
);
set local role authenticated;

create temporary table hosted_catalog_probe (
  category_id uuid, product_id uuid, variant_id uuid, price_id uuid,
  object_id uuid, object_path text
) on commit drop;
insert into pg_temp.hosted_catalog_probe(category_id)
select id from public.catalog_create_category(
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000011'::uuid,
    'Teste hospedado 002'
  );
update pg_temp.hosted_catalog_probe probe set product_id = (
  select id from public.catalog_create_product(
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000011'::uuid,
    'Camiseta teste hospedado', null::text, probe.category_id,
    'HOSTED-002', 'Azul', 'P', null::text,
    '260fc5e6-af34-484e-a005-3c2f2eb57567'::uuid
  ) p
);
update pg_temp.hosted_catalog_probe probe set variant_id = (
  select v.id from public.product_variants v where v.product_id = probe.product_id
);
update pg_temp.hosted_catalog_probe probe set price_id = (
  select id from public.catalog_set_price(
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000011'::uuid,
    probe.variant_id, null::bigint, '79,90'
  )
);
update pg_temp.hosted_catalog_probe probe
set (object_id, object_path) = (
  select reserved.object_id, reserved.object_path
  from public.catalog_reserve_image(
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000011'::uuid,
    probe.product_id
  ) reserved
);
insert into storage.objects(bucket_id, name)
select 'catalog-private', object_path from pg_temp.hosted_catalog_probe;

do $$
begin
  begin
    insert into storage.objects(bucket_id, name)
    values ('catalog-private', 'unreserved/object');
    raise exception 'Unreserved Storage path accepted';
  exception when insufficient_privilege then
    null;
  end;
end $$;

select
  (select count(*) = 1 from pg_temp.hosted_catalog_probe
    where category_id is not null and product_id is not null
      and variant_id is not null and price_id is not null) as product_and_price_created,
  (select count(*) = 1 from pg_temp.hosted_catalog_probe probe
    join public.product_prices pp on pp.id = probe.price_id
    where pp.amount = 79.90) as price_normalized,
  (select count(*) = 1 from pg_temp.hosted_catalog_probe probe
    join public.products visible on visible.id = probe.product_id) as product_visible,
  (select count(*) = 1 from pg_temp.hosted_catalog_probe probe
    where exists(select 1 from public.audit_events a
      where a.entity_type = 'products' and a.entity_id = probe.product_id)) as audit_written,
  (select count(*) = 1 from pg_temp.hosted_catalog_probe probe
    where exists(select 1 from public.catalog_search_products(
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000011'::uuid,
      'Camiseta teste hospedado', null::uuid, true, 20, 0
    ) result where result.product_id = probe.product_id)) as search_found,
  (select count(*) = 1 from pg_temp.hosted_catalog_probe probe
    where probe.object_id is not null and probe.object_path is not null
      and private.catalog_can_upload_object(probe.object_path)) as reserved_upload_allowed,
  (select count(*) = 1 from pg_temp.hosted_catalog_probe probe
    where not private.catalog_can_read_object(probe.object_path)
      and not exists(select 1 from storage.objects s
        where s.bucket_id = 'catalog-private' and s.name = probe.object_path))
    as reserved_object_unreadable;

rollback;
