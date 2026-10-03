-- Pacote 002: HTTP 409 para conflitos de domínio do Catálogo.
-- PostgREST repete a transação inteira ao receber SQLSTATE 40001
-- (serialization_failure) de uma RPC, causando laço de retries e alto consumo;
-- conflito de revisão/idempotência não é falha de serialização nativa e deve
-- virar PT409, que o PostgREST traduz para HTTP 409 Conflict sem retry.
-- Redefine apenas as seis RPCs que geravam os sete raises artificiais 40001,
-- preservando argumentos, locks, CAS, RLS, grants, autoria, auditoria e
-- idempotência. Migração incremental; não reescreve o histórico.
begin;

create or replace function public.catalog_update_category(p_organization_id uuid,p_store_id uuid,p_category_id uuid,
 p_expected_revision bigint,p_name text,p_active boolean)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare current_row public.product_categories%rowtype; changed public.product_categories%rowtype;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 select * into current_row from public.product_categories c
 where c.organization_id=p_organization_id and c.id=p_category_id for update;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 if current_row.revision is distinct from p_expected_revision then
  raise exception 'Catalog revision conflict' using errcode='PT409'; end if;
 update public.product_categories c set name=p_name,active=p_active
 where c.organization_id=p_organization_id and c.id=p_category_id returning * into changed;
 return query select changed.id,changed.revision;
end; $$;

create or replace function public.catalog_create_product(p_organization_id uuid,p_store_id uuid,p_name text,
 p_description text,p_category_id uuid,p_sku text,p_color text,p_size text,p_barcode text,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare payload_doc jsonb; existing public.catalog_create_requests%rowtype;
 created public.products%rowtype; cat_active boolean;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 if p_idempotency_key is null then raise exception 'Idempotency key required' using errcode='22023'; end if;
 payload_doc=jsonb_build_object('name',private.catalog_trim(p_name),'description',private.catalog_optional(p_description),
  'category_id',p_category_id,'sku',lower(private.catalog_trim(p_sku)),'color',lower(private.catalog_optional(p_color)),
  'size',lower(private.catalog_optional(p_size)),'barcode',private.catalog_optional(p_barcode));
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||auth.uid()::text||':'||p_idempotency_key::text,0));
 select * into existing from public.catalog_create_requests r where r.organization_id=p_organization_id
  and r.actor_user_id=auth.uid() and r.idempotency_key=p_idempotency_key;
 if found then
  if existing.payload is distinct from payload_doc then
   raise exception 'Idempotency key reused with different content' using errcode='PT409';
  end if;
  return query select existing.product_id,existing.result_revision; return;
 end if;
 if p_category_id is not null then
  select c.active into cat_active from public.product_categories c
   where c.organization_id=p_organization_id and c.id=p_category_id for share;
  if not coalesce(cat_active,false) then raise exception 'Active category required' using errcode='23514'; end if;
 end if;
 insert into public.products(organization_id,category_id,name,description)
 values(p_organization_id,p_category_id,p_name,p_description) returning * into created;
 insert into public.product_variants(organization_id,product_id,sku,color,size,barcode)
 values(p_organization_id,created.id,p_sku,p_color,p_size,p_barcode);
 select * into created from public.products p where p.organization_id=p_organization_id and p.id=created.id;
 insert into public.catalog_create_requests(organization_id,actor_user_id,idempotency_key,payload,product_id,result_revision)
 values(p_organization_id,auth.uid(),p_idempotency_key,payload_doc,created.id,created.revision);
 return query select created.id,created.revision;
end; $$;

create or replace function public.catalog_update_product(p_organization_id uuid,p_store_id uuid,p_product_id uuid,
 p_expected_revision bigint,p_name text,p_description text,p_category_id uuid,p_active boolean)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare current_row public.products%rowtype; changed public.products%rowtype;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 select * into current_row from public.products p where p.organization_id=p_organization_id
 and p.id=p_product_id for update;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 if current_row.revision is distinct from p_expected_revision then
  raise exception 'Catalog revision conflict' using errcode='PT409'; end if;
 update public.products p set name=p_name,description=p_description,category_id=p_category_id,active=p_active
 where p.organization_id=p_organization_id and p.id=p_product_id returning * into changed;
 return query select changed.id,changed.revision;
end; $$;

create or replace function public.catalog_update_variant(p_organization_id uuid,p_store_id uuid,p_variant_id uuid,
 p_expected_revision bigint,p_sku text,p_color text,p_size text,p_barcode text,p_active boolean)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare parent_id uuid; parent public.products%rowtype;
 current_row public.product_variants%rowtype; changed public.product_variants%rowtype;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 select v.product_id into parent_id from public.product_variants v
  where v.organization_id=p_organization_id and v.id=p_variant_id;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 select * into parent from public.products p where p.organization_id=p_organization_id and p.id=parent_id for update;
 select * into current_row from public.product_variants v where v.organization_id=p_organization_id
  and v.id=p_variant_id for update;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 if current_row.revision is distinct from p_expected_revision then
  raise exception 'Catalog revision conflict' using errcode='PT409'; end if;
 update public.product_variants v set sku=p_sku,color=p_color,size=p_size,barcode=p_barcode,active=p_active
 where v.organization_id=p_organization_id and v.id=p_variant_id returning * into changed;
 return query select changed.id,changed.revision;
end; $$;

create or replace function public.catalog_set_price(p_organization_id uuid,p_store_id uuid,p_variant_id uuid,
 p_expected_revision bigint,p_amount text)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare parent_id uuid; parent public.products%rowtype; variant public.product_variants%rowtype;
 current_row public.product_prices%rowtype; changed public.product_prices%rowtype; value numeric;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 value=private.catalog_amount(p_amount);
 select v.product_id into parent_id from public.product_variants v
  where v.organization_id=p_organization_id and v.id=p_variant_id;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 select * into parent from public.products p where p.organization_id=p_organization_id and p.id=parent_id for update;
 select * into variant from public.product_variants v where v.organization_id=p_organization_id
  and v.id=p_variant_id for share;
 if not parent.active or not variant.active then
  raise exception 'Active product and variant required' using errcode='23514'; end if;
 select * into current_row from public.product_prices pp where pp.organization_id=p_organization_id
  and pp.store_id=p_store_id and pp.variant_id=p_variant_id for update;
 if found then
  if current_row.revision is distinct from p_expected_revision then
   raise exception 'Catalog revision conflict' using errcode='PT409'; end if;
  update public.product_prices pp set amount=value where pp.organization_id=p_organization_id
   and pp.id=current_row.id returning * into changed;
 else
  if p_expected_revision is not null then raise exception 'Catalog revision conflict' using errcode='PT409'; end if;
  insert into public.product_prices(organization_id,store_id,variant_id,amount)
  values(p_organization_id,p_store_id,p_variant_id,value) returning * into changed;
 end if;
 return query select changed.id,changed.revision;
end; $$;

create or replace function public.catalog_set_cover(p_organization_id uuid,p_store_id uuid,p_product_id uuid,
 p_expected_revision bigint,p_object_id uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare parent public.products%rowtype; current_cover public.product_images%rowtype;
 new_object public.catalog_image_objects%rowtype;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 select * into parent from public.products p where p.organization_id=p_organization_id
  and p.id=p_product_id for update;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 if parent.revision is distinct from p_expected_revision then
  raise exception 'Catalog revision conflict' using errcode='PT409'; end if;
 if p_object_id is not null and not parent.active then
  raise exception 'Active product required' using errcode='23514'; end if;
 select * into current_cover from public.product_images pi where pi.organization_id=p_organization_id
  and pi.product_id=p_product_id for update;
 if p_object_id is not null then
  select * into new_object from public.catalog_image_objects o where o.organization_id=p_organization_id
   and o.product_id=p_product_id and o.id=p_object_id for update;
  if not found or new_object.state<>'uploaded' or new_object.actor_user_id is distinct from auth.uid()
   or new_object.mime_type is null
   or new_object.byte_size is null or new_object.width is null or new_object.height is null then
   raise exception 'Validated image object required' using errcode='23514'; end if;
  update public.catalog_image_objects o set state='active' where o.organization_id=p_organization_id and o.id=p_object_id;
 end if;
 if current_cover.id is not null then
  if p_object_id is null then
   delete from public.product_images pi where pi.organization_id=p_organization_id and pi.id=current_cover.id;
  else
   update public.product_images pi set object_id=p_object_id
   where pi.organization_id=p_organization_id and pi.id=current_cover.id;
  end if;
 elsif p_object_id is not null then
  insert into public.product_images(organization_id,product_id,object_id)
  values(p_organization_id,p_product_id,p_object_id);
 end if;
 select * into parent from public.products p where p.organization_id=p_organization_id and p.id=p_product_id;
 return query select parent.id,parent.revision;
end; $$;

-- CREATE OR REPLACE preserva a propriedade e os grants das funções existentes.

commit;
