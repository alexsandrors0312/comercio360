-- Pacote 002: Catálogo. Incremental over H1; no hosted execution here.
begin;

-- Match ECMAScript trim boundaries used by the domain (including NBSP and BOM).
create function private.catalog_whitespace() returns text
language sql immutable set search_path='' as $$
 select E' \t\n\r\f\v'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)
  ||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)
  ||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
$$;
create function private.catalog_trim(p_value text) returns text
language sql immutable set search_path='' as $$
 select btrim(p_value,private.catalog_whitespace());
$$;
create function private.catalog_spaces(p_value text) returns text
language sql immutable set search_path='' as $$
 select regexp_replace(translate(private.catalog_trim(p_value),private.catalog_whitespace(),
  repeat(' ',char_length(private.catalog_whitespace()))),' +',' ','g');
$$;
create function private.catalog_optional(p_value text) returns text
language sql immutable set search_path='' as $$
 select nullif(private.catalog_trim(p_value), '');
$$;
create function private.catalog_amount(p_value text) returns numeric
language plpgsql immutable set search_path='' as $$
declare normalized text;
begin
 normalized=private.catalog_trim(p_value);
 if normalized is null or normalized !~ '^[0-9]{1,10}([.,][0-9]{1,2})?$' then
  raise exception 'Invalid BRL amount' using errcode='22023';
 end if;
 if replace(normalized, ',', '.')::numeric > 9999999999.99 then
  raise exception 'BRL amount exceeds limit' using errcode='22023';
 end if;
 return replace(normalized, ',', '.')::numeric(12,2);
end; $$;
revoke all on function private.catalog_whitespace(),private.catalog_trim(text),private.catalog_spaces(text),
 private.catalog_optional(text),private.catalog_amount(text) from public,anon,authenticated;
grant execute on function private.catalog_whitespace(),private.catalog_trim(text) to authenticated;

create table public.product_categories (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null, active boolean not null default true, revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), check(char_length(name) between 1 and 120 and name=private.catalog_spaces(name))
);
create unique index product_categories_name_key on public.product_categories(organization_id,lower(name));

create table public.products (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 category_id uuid, name text not null, description text, active boolean not null default true,
 revision bigint not null default 1 check(revision>0), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(organization_id,id),
 foreign key(organization_id,category_id) references public.product_categories(organization_id,id),
 check(char_length(name) between 1 and 120 and name=private.catalog_trim(name)),
 check(description is null or (char_length(description)<=2000 and description=private.catalog_trim(description)))
);
create index products_search on public.products(organization_id,lower(name),id);
create index products_category_filter on public.products(organization_id,category_id,active,id);

create table public.product_variants (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 product_id uuid not null, sku text not null, color text, size text, unit text not null default 'UN',
 barcode text, active boolean not null default true, revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), foreign key(organization_id,product_id) references public.products(organization_id,id),
 check(char_length(sku) between 1 and 64 and sku=private.catalog_trim(sku)),
 check(color is null or (char_length(color) between 1 and 60 and color=private.catalog_trim(color))),
 check(size is null or (char_length(size) between 1 and 60 and size=private.catalog_trim(size))),
 check(barcode is null or (char_length(barcode) between 1 and 64 and barcode=private.catalog_trim(barcode))),
 check(unit='UN')
);
create unique index product_variants_sku_key on public.product_variants(organization_id,lower(sku));
create unique index product_variants_barcode_key on public.product_variants(organization_id,barcode) where barcode is not null;
create unique index product_variants_option_key on public.product_variants(organization_id,product_id,lower(coalesce(color,'')),lower(coalesce(size,'')));
create index product_variants_by_product on public.product_variants(organization_id,product_id,id);

create table public.product_prices (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 store_id uuid not null, variant_id uuid not null, amount numeric(12,2) not null check(amount>=0),
 currency text not null default 'BRL' check(currency='BRL'),
 revision bigint not null default 1 check(revision>0), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(organization_id,id),
 unique(organization_id,store_id,variant_id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,variant_id) references public.product_variants(organization_id,id)
);
create index product_prices_by_variant on public.product_prices(organization_id,variant_id,store_id);

create table public.catalog_image_objects (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 product_id uuid not null, actor_user_id uuid not null references auth.users(id),
 object_path text not null unique, state text not null default 'reserved'
  check(state in ('reserved','uploaded','active','cleanup_pending','deleting','deleted')),
 mime_type text, byte_size integer, width integer, height integer,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,product_id,id),
 foreign key(organization_id,product_id) references public.products(organization_id,id),
 check(object_path=organization_id::text||'/'||product_id::text||'/'||id::text),
 check(byte_size is null or byte_size between 1 and 5242880),
 check(width is null or width between 1 and 10000),
 check(height is null or height between 1 and 10000),
 check(mime_type is null or mime_type in ('image/jpeg','image/png','image/webp'))
);
create index catalog_image_cleanup on public.catalog_image_objects(state,updated_at)
 where state in ('cleanup_pending','deleting');

create table public.product_images (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 product_id uuid not null, object_id uuid not null, revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,product_id), unique(organization_id,object_id),
 foreign key(organization_id,product_id) references public.products(organization_id,id),
 foreign key(organization_id,product_id,object_id) references public.catalog_image_objects(organization_id,product_id,id)
);

create table public.catalog_create_requests (
 organization_id uuid not null references public.organizations(id), actor_user_id uuid not null references auth.users(id),
 idempotency_key uuid not null, payload jsonb not null, product_id uuid not null,
 result_revision bigint not null check(result_revision>0),
 created_at timestamptz not null default now(), primary key(organization_id,actor_user_id,idempotency_key),
 foreign key(organization_id,product_id) references public.products(organization_id,id)
);
create function private.catalog_request_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Catalog idempotency records are immutable' using errcode='42501';
end; $$;
create trigger catalog_request_no_update before update or delete on public.catalog_create_requests
 for each row execute function private.catalog_request_immutable();
create trigger catalog_request_no_truncate before truncate on public.catalog_create_requests
 for each statement execute function private.catalog_request_immutable();
revoke all on function private.catalog_request_immutable() from public,anon,authenticated,service_role;

-- Normalize common DML and ensure revisions advance even for administrative writes.
create function private.catalog_before_write() returns trigger language plpgsql set search_path='' as $$
declare parent_active boolean; category_active boolean;
begin
 if tg_table_name='product_categories' then new.name=private.catalog_spaces(new.name); end if;
 if tg_table_name='products' then
  new.name=private.catalog_trim(new.name); new.description=private.catalog_optional(new.description);
  if new.category_id is not null and (tg_op='INSERT' or new.category_id is distinct from old.category_id) then
   select active into category_active from public.product_categories
   where organization_id=new.organization_id and id=new.category_id for share;
   if not coalesce(category_active,false) then raise exception 'Active category required' using errcode='23514'; end if;
  end if;
 end if;
 if tg_table_name='product_variants' then
  new.sku=private.catalog_trim(new.sku); new.color=private.catalog_optional(new.color);
  new.size=private.catalog_optional(new.size); new.barcode=private.catalog_optional(new.barcode);
  if tg_op='INSERT' then
   select active into parent_active from public.products where organization_id=new.organization_id
    and id=new.product_id for share;
   if not coalesce(parent_active,false) then raise exception 'Active product required' using errcode='23514'; end if;
  end if;
 end if;
 if tg_table_name='product_images' then
  if not exists(select 1 from public.catalog_image_objects o where o.organization_id=new.organization_id
   and o.product_id=new.product_id and o.id=new.object_id and o.state='active') then
   raise exception 'Active validated cover object required' using errcode='23514';
  end if;
 end if;
 if tg_op='UPDATE' then
  new.revision=old.revision+1; new.updated_at=clock_timestamp();
 end if;
 return new;
end; $$;
create function private.catalog_image_object_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if (old.id,old.organization_id,old.product_id,old.actor_user_id,old.object_path)
   is distinct from (new.id,new.organization_id,new.product_id,new.actor_user_id,new.object_path) then
   raise exception 'Image object identity is immutable' using errcode='23514';
  end if;
  if (old.state,new.state) not in (('reserved','uploaded'),('reserved','cleanup_pending'),('reserved','deleting'),
   ('uploaded','active'),('uploaded','cleanup_pending'),('uploaded','deleting'),('active','cleanup_pending'),
   ('cleanup_pending','deleting'),('deleting','deleted'),('deleting','cleanup_pending'))
   and old.state is distinct from new.state then
   raise exception 'Invalid image object transition' using errcode='23514';
  end if;
  new.updated_at=clock_timestamp();
 end if;
 return new;
end; $$;
create trigger catalog_image_object_guard before update on public.catalog_image_objects
 for each row execute function private.catalog_image_object_guard();
create function private.catalog_guard_keys() returns trigger language plpgsql set search_path='' as $$
declare keys text[]; key text; before_doc jsonb; after_doc jsonb;
begin
 keys=case tg_table_name
  when 'product_categories' then array['id','organization_id']
  when 'products' then array['id','organization_id']
  when 'product_variants' then array['id','organization_id','product_id']
  when 'product_prices' then array['id','organization_id','store_id','variant_id']
  when 'product_images' then array['id','organization_id','product_id']
 end;
 before_doc=to_jsonb(old); after_doc=to_jsonb(new);
 foreach key in array keys loop
  if before_doc->key is distinct from after_doc->key then
   raise exception 'Catalog structural key is immutable' using errcode='23514';
  end if;
 end loop;
 return new;
end; $$;
create function private.can_read_catalog(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active
 and m.role in ('owner','manager','cashier','stockist','buyer') and s.active);
$$;
create function private.can_write_catalog(p_org uuid,p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active
 and m.role in ('owner','manager') and a.store_id=p_store and s.active);
$$;
create function private.catalog_can_upload_object(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.catalog_image_objects o
 join public.memberships m on m.organization_id=o.organization_id and m.user_id=(select auth.uid())
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where o.object_path=p_path and o.actor_user_id=(select auth.uid()) and o.state='reserved'
  and m.active and m.role in ('owner','manager') and s.active);
$$;
create function private.catalog_can_read_object(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.catalog_image_objects o where o.object_path=p_path
  and o.state='active' and private.can_read_catalog(o.organization_id)
  and exists(select 1 from public.product_images pi where pi.organization_id=o.organization_id
   and pi.product_id=o.product_id and pi.object_id=o.id));
$$;
revoke all on function private.catalog_guard_keys(),private.can_read_catalog(uuid),private.can_write_catalog(uuid,uuid)
 from public,anon,authenticated;
grant execute on function private.can_read_catalog(uuid),private.can_write_catalog(uuid,uuid) to authenticated;
revoke all on function private.catalog_can_upload_object(text),private.catalog_can_read_object(text)
 from public,anon,authenticated;
grant execute on function private.catalog_can_upload_object(text),private.catalog_can_read_object(text) to authenticated;

create function private.catalog_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare before_doc jsonb; after_doc jsonb; doc jsonb; org uuid; unit uuid; actor uuid;
begin
 before_doc=case when tg_op<>'INSERT' then to_jsonb(old) else null end;
 after_doc=case when tg_op<>'DELETE' then to_jsonb(new) else null end;
 if tg_table_name='catalog_image_objects' then
  before_doc=before_doc-'object_path'; after_doc=after_doc-'object_path';
 end if;
 -- Revision-only parent bumps are synchronization metadata, not a second business edit.
 if tg_op='UPDATE' and tg_table_name='products'
  and (before_doc-'revision'-'updated_at')=(after_doc-'revision'-'updated_at') then return null; end if;
 doc=coalesce(after_doc,before_doc);
 org=(doc->>'organization_id')::uuid;
 if tg_table_name='product_prices' then unit=(doc->>'store_id')::uuid;
 else unit=nullif(current_setting('app.catalog_store_id',true),'')::uuid; end if;
 if unit is not null and not exists(select 1 from public.stores s
  where s.organization_id=org and s.id=unit) then
  raise exception 'Catalog audit store mismatch' using errcode='23514';
 end if;
 actor=auth.uid();
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,old_value,new_value)
 values(org,unit,actor,lower(tg_op),tg_table_name,(doc->>'id')::uuid,'database',before_doc,after_doc);
 return null;
end; $$;
create function private.catalog_bump_product() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid; product uuid;
begin
 if tg_table_name='product_variants' or tg_table_name='product_images' then
  org=coalesce(new.organization_id,old.organization_id);
  product=coalesce(new.product_id,old.product_id);
 else
  org=coalesce(new.organization_id,old.organization_id);
  select v.product_id into product from public.product_variants v
   where v.organization_id=org and v.id=coalesce(new.variant_id,old.variant_id);
 end if;
 update public.products set updated_at=clock_timestamp() where organization_id=org and id=product;
 return null;
end; $$;
create function private.catalog_retire_cover_object() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or old.object_id is distinct from new.object_id then
  update public.catalog_image_objects o set state='cleanup_pending'
  where o.organization_id=old.organization_id and o.id=old.object_id and o.state='active';
 end if;
 return null;
end; $$;
do $$ declare tbl text; begin
 foreach tbl in array array['product_categories','products','product_variants','product_prices','product_images'] loop
  execute format('create trigger catalog_before_write before insert or update on public.%I for each row execute function private.catalog_before_write()',tbl);
  execute format('create trigger catalog_structural_keys before update on public.%I for each row execute function private.catalog_guard_keys()',tbl);
  execute format('create trigger catalog_audit after insert or update or delete on public.%I for each row execute function private.catalog_audit()',tbl);
 end loop;
end $$;



create function public.catalog_search_products(p_organization_id uuid,p_store_id uuid,p_query text,
 p_category_id uuid,p_active boolean,p_limit integer,p_offset integer)
returns table(product_id uuid,name text,description text,category_id uuid,active boolean,
 revision bigint,price text,total_count bigint)
language plpgsql stable security invoker set search_path='' as $$
declare term text;
begin
 if not private.can_read_catalog(p_organization_id)
  or not private.can_access_store(p_organization_id,p_store_id) then
  raise exception 'Catalog access denied' using errcode='42501';
 end if;
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then
  raise exception 'Invalid catalog page' using errcode='22023';
 end if;
 term=lower(private.catalog_trim(coalesce(p_query,'')));
 return query
 select p.id,p.name,p.description,p.category_id,p.active,p.revision,
  (select to_char(min(pp.amount),'FM9999999990.00') from public.product_variants v
   join public.product_prices pp on pp.organization_id=v.organization_id and pp.variant_id=v.id
   where v.organization_id=p.organization_id and v.product_id=p.id and v.active
    and pp.store_id=p_store_id),count(*) over()
 from public.products p where p.organization_id=p_organization_id
  and (p_category_id is null or p.category_id=p_category_id)
  and (p_active is null or p.active=p_active)
  and (term='' or position(term in lower(p.name))>0 or exists(
   select 1 from public.product_variants v where v.organization_id=p.organization_id
   and v.product_id=p.id and (position(term in lower(v.sku))>0
    or position(term in lower(coalesce(v.barcode,'')))>0)))
 order by lower(p.name),p.id limit p_limit offset p_offset;
end; $$;
revoke all on function public.catalog_search_products(uuid,uuid,text,uuid,boolean,integer,integer) from public,anon;
grant execute on function public.catalog_search_products(uuid,uuid,text,uuid,boolean,integer,integer) to authenticated;
create trigger catalog_image_object_audit after insert or update or delete on public.catalog_image_objects
 for each row execute function private.catalog_audit();
create trigger catalog_variant_bump after insert or update or delete on public.product_variants
 for each row execute function private.catalog_bump_product();
create trigger catalog_price_bump after insert or update or delete on public.product_prices
 for each row execute function private.catalog_bump_product();
create trigger catalog_cover_bump after insert or update or delete on public.product_images
 for each row execute function private.catalog_bump_product();
create trigger catalog_cover_retire after update or delete on public.product_images
 for each row execute function private.catalog_retire_cover_object();

alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_prices enable row level security;
alter table public.product_images enable row level security;
alter table public.catalog_image_objects enable row level security;
alter table public.catalog_create_requests enable row level security;
revoke all on public.product_categories,public.products,public.product_variants,public.product_prices,
 public.product_images,public.catalog_image_objects,public.catalog_create_requests from public,anon,authenticated;
grant select on public.product_categories,public.products,public.product_variants,public.product_prices,
 public.product_images to authenticated;
grant all on public.product_categories,public.products,public.product_variants,public.product_prices,
 public.product_images,public.catalog_image_objects,public.catalog_create_requests to service_role;
create policy catalog_category_read on public.product_categories for select to authenticated
 using(private.can_read_catalog(organization_id));
create policy catalog_product_read on public.products for select to authenticated
 using(private.can_read_catalog(organization_id));
create policy catalog_variant_read on public.product_variants for select to authenticated
 using(private.can_read_catalog(organization_id));
create policy catalog_price_read on public.product_prices for select to authenticated
 using(private.can_read_catalog(organization_id) and private.can_access_store(organization_id,store_id));
create policy catalog_cover_read on public.product_images for select to authenticated
 using(private.can_read_catalog(organization_id));

-- H1 events retain their original visibility. Catalog snapshots require the new role
-- and a live store grant even when the reader was the original actor.
drop policy scoped_audit_read on public.audit_events;
create policy scoped_audit_read on public.audit_events for select to authenticated using(
 private.is_member(organization_id)
 and (store_id is null or private.can_access_store(organization_id,store_id))
 and (actor_user_id=(select auth.uid()) or exists(select 1 from public.memberships m
   where m.organization_id=audit_events.organization_id and m.user_id=(select auth.uid())
   and m.role in ('owner','manager') and m.active))
 and (entity_type not in ('product_categories','products','product_variants','product_prices',
   'product_images','catalog_image_objects') or private.can_read_catalog(organization_id))
);

revoke all on function private.catalog_before_write(),private.catalog_image_object_guard(),
 private.catalog_audit(),private.catalog_bump_product(),private.catalog_retire_cover_object() from public,anon,authenticated;

create function private.catalog_require_write(p_org uuid,p_store uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.can_write_catalog(p_org,p_store) then
  raise exception 'Catalog access denied' using errcode='42501';
 end if;
 perform set_config('app.catalog_store_id',p_store::text,true);
end; $$;
revoke all on function private.catalog_require_write(uuid,uuid) from public,anon,authenticated;

create function public.catalog_create_category(p_organization_id uuid,p_store_id uuid,p_name text)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare created public.product_categories%rowtype;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 insert into public.product_categories(organization_id,name)
 values(p_organization_id,p_name) returning * into created;
 return query select created.id,created.revision;
end; $$;

create function public.catalog_update_category(p_organization_id uuid,p_store_id uuid,p_category_id uuid,
 p_expected_revision bigint,p_name text,p_active boolean)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare current_row public.product_categories%rowtype; changed public.product_categories%rowtype;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 select * into current_row from public.product_categories c
 where c.organization_id=p_organization_id and c.id=p_category_id for update;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 if current_row.revision is distinct from p_expected_revision then
  raise exception 'Catalog revision conflict' using errcode='40001'; end if;
 update public.product_categories c set name=p_name,active=p_active
 where c.organization_id=p_organization_id and c.id=p_category_id returning * into changed;
 return query select changed.id,changed.revision;
end; $$;

create function public.catalog_create_product(p_organization_id uuid,p_store_id uuid,p_name text,
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
   raise exception 'Idempotency key reused with different content' using errcode='40001';
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

create function public.catalog_update_product(p_organization_id uuid,p_store_id uuid,p_product_id uuid,
 p_expected_revision bigint,p_name text,p_description text,p_category_id uuid,p_active boolean)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare current_row public.products%rowtype; changed public.products%rowtype;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 select * into current_row from public.products p where p.organization_id=p_organization_id
 and p.id=p_product_id for update;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 if current_row.revision is distinct from p_expected_revision then
  raise exception 'Catalog revision conflict' using errcode='40001'; end if;
 update public.products p set name=p_name,description=p_description,category_id=p_category_id,active=p_active
 where p.organization_id=p_organization_id and p.id=p_product_id returning * into changed;
 return query select changed.id,changed.revision;
end; $$;

create function public.catalog_create_variant(p_organization_id uuid,p_store_id uuid,p_product_id uuid,
 p_sku text,p_color text,p_size text,p_barcode text)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare parent public.products%rowtype; created public.product_variants%rowtype;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 select * into parent from public.products p where p.organization_id=p_organization_id
  and p.id=p_product_id for update;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 if not parent.active then raise exception 'Active product required' using errcode='23514'; end if;
 insert into public.product_variants(organization_id,product_id,sku,color,size,barcode)
 values(p_organization_id,p_product_id,p_sku,p_color,p_size,p_barcode) returning * into created;
 return query select created.id,created.revision;
end; $$;

create function public.catalog_update_variant(p_organization_id uuid,p_store_id uuid,p_variant_id uuid,
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
  raise exception 'Catalog revision conflict' using errcode='40001'; end if;
 update public.product_variants v set sku=p_sku,color=p_color,size=p_size,barcode=p_barcode,active=p_active
 where v.organization_id=p_organization_id and v.id=p_variant_id returning * into changed;
 return query select changed.id,changed.revision;
end; $$;

create function public.catalog_set_price(p_organization_id uuid,p_store_id uuid,p_variant_id uuid,
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
   raise exception 'Catalog revision conflict' using errcode='40001'; end if;
  update public.product_prices pp set amount=value where pp.organization_id=p_organization_id
   and pp.id=current_row.id returning * into changed;
 else
  if p_expected_revision is not null then raise exception 'Catalog revision conflict' using errcode='40001'; end if;
  insert into public.product_prices(organization_id,store_id,variant_id,amount)
  values(p_organization_id,p_store_id,p_variant_id,value) returning * into changed;
 end if;
 return query select changed.id,changed.revision;
end; $$;

do $$ declare sig text; begin
 foreach sig in array array[
  'public.catalog_create_category(uuid,uuid,text)',
  'public.catalog_update_category(uuid,uuid,uuid,bigint,text,boolean)',
  'public.catalog_create_product(uuid,uuid,text,text,uuid,text,text,text,text,uuid)',
  'public.catalog_update_product(uuid,uuid,uuid,bigint,text,text,uuid,boolean)',
  'public.catalog_create_variant(uuid,uuid,uuid,text,text,text,text)',
  'public.catalog_update_variant(uuid,uuid,uuid,bigint,text,text,text,text,boolean)',
  'public.catalog_set_price(uuid,uuid,uuid,bigint,text)'] loop
  execute 'revoke all on function '||sig||' from public,anon';
  execute 'grant execute on function '||sig||' to authenticated';
 end loop;
end $$;

create function public.catalog_reserve_image(p_organization_id uuid,p_store_id uuid,p_product_id uuid)
returns table(object_id uuid,object_path text) language plpgsql security definer set search_path='' as $$
declare parent public.products%rowtype; new_id uuid; new_path text;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 select * into parent from public.products p where p.organization_id=p_organization_id
  and p.id=p_product_id for update;
 if not found then raise exception 'Catalog access denied' using errcode='42501'; end if;
 if not parent.active then raise exception 'Active product required' using errcode='23514'; end if;
 new_id=gen_random_uuid();
 new_path=p_organization_id::text||'/'||p_product_id::text||'/'||new_id::text;
 insert into public.catalog_image_objects(id,organization_id,product_id,actor_user_id,object_path)
 values(new_id,p_organization_id,p_product_id,auth.uid(),new_path);
 return query select new_id,new_path;
end; $$;

-- Restricted processing gate: authenticated sessions cannot assert bytes or dimensions.
-- The processing service must validate/re-encode the actual bytes before invoking this.
create function public.catalog_mark_image_uploaded(p_organization_id uuid,p_store_id uuid,p_object_id uuid,
 p_mime_type text,p_byte_size integer,p_width integer,p_height integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare image public.catalog_image_objects%rowtype;
begin
 select * into image from public.catalog_image_objects o where o.organization_id=p_organization_id
  and o.id=p_object_id for update;
 if not found or image.state<>'reserved' then raise exception 'Image object unavailable' using errcode='42501'; end if;
 if p_mime_type not in ('image/jpeg','image/png','image/webp') or p_byte_size not between 1 and 5242880
  or p_width not between 1 and 10000 or p_height not between 1 and 10000 then
  raise exception 'Invalid image metadata' using errcode='22023'; end if;
 update public.catalog_image_objects o set state='uploaded',mime_type=p_mime_type,
  byte_size=p_byte_size,width=p_width,height=p_height
 where o.organization_id=p_organization_id and o.id=p_object_id;
 return p_object_id;
end; $$;

create function public.catalog_set_cover(p_organization_id uuid,p_store_id uuid,p_product_id uuid,
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
  raise exception 'Catalog revision conflict' using errcode='40001'; end if;
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

create function public.catalog_get_cover_path(p_organization_id uuid,p_store_id uuid,p_product_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
 if not private.can_read_catalog(p_organization_id)
  or not private.can_access_store(p_organization_id,p_store_id) then
  raise exception 'Catalog access denied' using errcode='42501'; end if;
 select o.object_path into result from public.product_images pi
 join public.catalog_image_objects o on o.organization_id=pi.organization_id and o.id=pi.object_id
 where pi.organization_id=p_organization_id and pi.product_id=p_product_id and o.state='active';
 return result;
end; $$;

-- Only the out-of-band cleanup worker receives these; never grant to web roles.
create function public.catalog_claim_image_cleanup(p_before timestamptz,p_limit integer)
returns table(object_id uuid,object_path text) language plpgsql security definer set search_path='' as $$
declare cutoff timestamptz;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid cleanup page' using errcode='22023'; end if;
 if p_before is null then raise exception 'Cleanup cutoff required' using errcode='22023'; end if;
 cutoff=least(p_before,clock_timestamp()-interval '1 hour');
 return query
 with claimed as (select o.id from public.catalog_image_objects o
  where o.state in ('reserved','uploaded','cleanup_pending','deleting') and o.updated_at<cutoff
   and not exists(select 1 from public.product_images pi where pi.organization_id=o.organization_id
    and pi.object_id=o.id)
  order by o.updated_at,o.id for update skip locked limit p_limit)
 update public.catalog_image_objects o set state='deleting'
 from claimed where o.id=claimed.id returning o.id,o.object_path;
end; $$;
create function public.catalog_finish_image_cleanup(p_object_id uuid,p_deleted boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_deleted is null then raise exception 'Cleanup result required' using errcode='22023'; end if;
 update public.catalog_image_objects o set state=case when p_deleted then 'deleted' else 'cleanup_pending' end
 where o.id=p_object_id and o.state='deleting'
  and not exists(select 1 from public.product_images pi where pi.organization_id=o.organization_id
   and pi.object_id=o.id);
 if not found then raise exception 'Image cleanup unavailable' using errcode='42501'; end if;
end; $$;

do $$ declare sig text; begin
 foreach sig in array array[
  'public.catalog_reserve_image(uuid,uuid,uuid)',
  'public.catalog_set_cover(uuid,uuid,uuid,bigint,uuid)',
  'public.catalog_get_cover_path(uuid,uuid,uuid)'] loop
  execute 'revoke all on function '||sig||' from public,anon';
  execute 'grant execute on function '||sig||' to authenticated';
 end loop;
 foreach sig in array array[
  'public.catalog_mark_image_uploaded(uuid,uuid,uuid,text,integer,integer,integer)',
  'public.catalog_claim_image_cleanup(timestamptz,integer)',
  'public.catalog_finish_image_cleanup(uuid,boolean)'] loop
  execute 'revoke all on function '||sig||' from public,anon,authenticated';
  execute 'grant execute on function '||sig||' to service_role';
 end loop;
end $$;

commit;
