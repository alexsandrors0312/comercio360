-- Pacote 006: organization customers and optional sale snapshots. Incremental only.
begin;

create function private.customer_name_valid(p_name text) returns boolean
language sql immutable set search_path='' as $$
 select p_name is not null and char_length(p_name) between 2 and 120 and p_name=private.catalog_trim(p_name)
  and not exists(select 1 from generate_series(1,31) code where strpos(p_name,chr(code))>0)
  and not exists(select 1 from generate_series(127,159) code where strpos(p_name,chr(code))>0);
$$;
create table public.customers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(private.customer_name_valid(name)),
 phone text check(phone is null or phone ~ '^[0-9]{8,15}$'),
 email text check(email is null or (char_length(email) between 3 and 254 and email=lower(private.catalog_trim(email))
  and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 active boolean not null default true, revision bigint not null default 1 check(revision>0),
 actor_user_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,id)
);
create index customers_by_org_name on public.customers(organization_id,lower(name),id);
create index customers_by_org_phone on public.customers(organization_id,phone) where phone is not null;
create index customers_by_org_email on public.customers(organization_id,email) where email is not null;

create table private.customer_requests (
 organization_id uuid not null, store_id uuid not null, actor_user_id uuid not null references public.profiles(id),
 idempotency_key uuid not null, operation text not null check(operation in ('create','update')),
 payload jsonb not null, result_id uuid not null, result_revision bigint not null check(result_revision>0),
 created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,store_id,actor_user_id,idempotency_key),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,result_id) references public.customers(organization_id,id)
);

alter table public.sales add column customer_id uuid, add column customer_name_snapshot text;
alter table public.sales add constraint sale_customer_pair check((customer_id is null and customer_name_snapshot is null)
 or (customer_id is not null and customer_name_snapshot is not null and char_length(customer_name_snapshot) between 2 and 120));
alter table public.sales add constraint sale_customer_tenant foreign key(organization_id,customer_id)
 references public.customers(organization_id,id);
create index sales_by_customer_store on public.sales(organization_id,customer_id,store_id,created_at desc,id desc)
 where customer_id is not null;

create function private.can_read_customers(p_org uuid,p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active
  and m.role in ('owner','manager','cashier') and s.active and a.store_id=p_store);
$$;
create function private.can_read_customers_org(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active
  and m.role in ('owner','manager','cashier') and s.active);
$$;
create function private.customers_require_write(p_org uuid,p_store uuid,p_edit boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Customer access denied' using errcode='42501'; end if;
 perform m.id from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.active and s.active and a.store_id=p_store
  and (m.role in ('owner','manager') or (not p_edit and m.role='cashier')) for share of m,a,s;
 if not found then raise exception 'Customer access denied' using errcode='42501'; end if;
end;
$$;
create function private.customers_replay(p_org uuid,p_store uuid,p_key uuid,p_operation text,p_payload jsonb)
returns table(result_id uuid,result_revision bigint)
language plpgsql security definer set search_path='' as $$
declare previous private.customer_requests%rowtype;
begin
 if p_key is null then raise exception 'Customer idempotency key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customers:'||p_org::text||':'||p_store::text||':'||auth.uid()::text||':'||p_key::text,0));
 select * into previous from private.customer_requests r where r.organization_id=p_org and r.store_id=p_store
  and r.actor_user_id=auth.uid() and r.idempotency_key=p_key;
 if found then
  if previous.operation<>p_operation or previous.payload is distinct from p_payload then
   raise exception 'Customer idempotency conflict' using errcode='PT409'; end if;
  return query select previous.result_id,previous.result_revision;
 end if;
end;
$$;
create function private.customers_reject_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Customer request history is immutable' using errcode='42501'; end;
$$;
create function private.customers_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.id,new.organization_id,new.actor_user_id,new.created_at) is distinct from
  (old.id,old.organization_id,old.actor_user_id,old.created_at) then
  raise exception 'Customer structural keys are immutable' using errcode='23514'; end if;
 if old.revision=9223372036854775807 or new.revision<>old.revision+1 then
  raise exception 'Customer revision conflict' using errcode='PT409'; end if;
 if not exists(select 1 from private.customer_requests r where r.organization_id=old.organization_id
  and r.result_id=old.id and r.result_revision=new.revision and r.operation='update' and r.actor_user_id=auth.uid()
  and r.payload=jsonb_build_object('customer_id',old.id,'expected_revision',old.revision,
   'name',new.name,'phone',new.phone,'email',new.email,'active',new.active)) then
  raise exception 'Customer update operation required' using errcode='42501'; end if;
 new.updated_at=clock_timestamp(); return new;
end;
$$;
create function private.customers_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare origin_store uuid;
begin
 select r.store_id into origin_store from private.customer_requests r where r.organization_id=new.organization_id
  and r.result_id=new.id and r.result_revision=new.revision and r.actor_user_id=auth.uid()
 order by r.created_at desc limit 1;
 -- A creation request is inserted after the row; the selected store is carried
 -- by the transaction-local RPC context and is checked by customers_save.
 if origin_store is null then origin_store=nullif(current_setting('app.customer_store_id',true),'')::uuid; end if;
 if origin_store is null then raise exception 'Customer audit scope required' using errcode='42501'; end if;
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,old_value,new_value)
 values(new.organization_id,origin_store,auth.uid(),lower(tg_op),'customers',new.id,'database',
  case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return null;
end;
$$;
create trigger customers_guard before update on public.customers for each row execute function private.customers_guard();
create trigger customers_no_delete before delete on public.customers for each row execute function private.customers_reject_change();
create trigger customers_no_truncate before truncate on public.customers for each statement execute function private.customers_reject_change();
create trigger customers_audit after insert or update on public.customers for each row execute function private.customers_audit();
create trigger customers_requests_immutable before update or delete on private.customer_requests for each row execute function private.customers_reject_change();
create trigger customers_requests_no_truncate before truncate on private.customer_requests for each statement execute function private.customers_reject_change();
alter table public.customers enable row level security;
alter table private.customer_requests enable row level security;
revoke all on public.customers,private.customer_requests from public,anon,authenticated,service_role;
grant select on public.customers to authenticated,service_role;
create policy customers_read on public.customers for select to authenticated using(private.can_read_customers_org(organization_id));
-- Existing audit policies remain in force; customer events require customer role and store access.
create policy customers_audit_scope on public.audit_events as restrictive for select to authenticated using(
 entity_type<>'customers' or (store_id is not null and private.can_read_customers(organization_id,store_id)));

create function public.customers_list(p_organization_id uuid,p_store_id uuid,p_query text,p_status text,p_limit integer,p_offset integer,p_customer_id uuid default null)
returns table(id uuid,name text,phone text,email text,active boolean,revision bigint,created_at timestamptz,updated_at timestamptz,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare term text=coalesce(private.catalog_trim(p_query),'');
begin
 if not private.can_read_customers(p_organization_id,p_store_id) then raise exception 'Customer access denied' using errcode='42501'; end if;
 if char_length(term)>200 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0
  or p_status is null or p_status not in ('all','active','inactive') then
  raise exception 'Invalid customer pagination' using errcode='22023'; end if;
 return query select c.id,c.name,c.phone,c.email,c.active,c.revision,c.created_at,c.updated_at,count(*) over()
 from public.customers c where c.organization_id=p_organization_id and (p_customer_id is null or c.id=p_customer_id)
  and (p_status='all' or c.active=(p_status='active'))
  and (term='' or strpos(lower(c.name),lower(term))>0 or (nullif(regexp_replace(term,'[^0-9]','','g'),'') is not null
   and strpos(coalesce(c.phone,''),regexp_replace(term,'[^0-9]','','g'))>0)
   or strpos(coalesce(c.email,''),lower(term))>0)
 order by c.name,c.id limit p_limit offset p_offset;
end;
$$;
create function public.customers_save(p_organization_id uuid,p_store_id uuid,p_customer_id uuid,p_expected_revision bigint,
 p_name text,p_phone text,p_email text,p_active boolean,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare normalized_name text=private.catalog_trim(p_name); normalized_phone text;
 normalized_email text=lower(nullif(private.catalog_trim(p_email),'')); replay record;
 payload_doc jsonb; current_customer public.customers%rowtype; created public.customers%rowtype;
begin
 perform private.customers_require_write(p_organization_id,p_store_id,p_customer_id is not null);
 normalized_phone=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'');
 if not private.customer_name_valid(normalized_name)
  or (nullif(private.catalog_trim(p_phone),'') is not null and normalized_phone is null)
  or (normalized_phone is not null and normalized_phone !~ '^[0-9]{8,15}$')
  or (normalized_email is not null and (char_length(normalized_email)>254
   or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
  or p_active is null or (p_customer_id is null and (p_expected_revision is not null or not p_active))
  or (p_customer_id is not null and (p_expected_revision is null or p_expected_revision<1)) then
  raise exception 'Invalid customer data' using errcode='22023'; end if;
 payload_doc=jsonb_build_object('customer_id',p_customer_id,'expected_revision',p_expected_revision,
  'name',normalized_name,'phone',normalized_phone,'email',normalized_email,'active',p_active);
 select * into replay from private.customers_replay(p_organization_id,p_store_id,p_idempotency_key,
  case when p_customer_id is null then 'create' else 'update' end,payload_doc);
 if found then return query select replay.result_id,replay.result_revision; return; end if;
 perform set_config('app.customer_store_id',p_store_id::text,true);
 if p_customer_id is null then
  insert into public.customers(organization_id,name,phone,email,active,actor_user_id)
  values(p_organization_id,normalized_name,normalized_phone,normalized_email,true,auth.uid()) returning * into created;
  insert into private.customer_requests(organization_id,store_id,actor_user_id,idempotency_key,operation,payload,result_id,result_revision)
  values(p_organization_id,p_store_id,auth.uid(),p_idempotency_key,'create',payload_doc,created.id,created.revision);
  return query select created.id,created.revision; return;
 end if;
 select * into current_customer from public.customers c where c.organization_id=p_organization_id and c.id=p_customer_id for update;
 if not found then raise exception 'Customer access denied' using errcode='42501'; end if;
 if current_customer.revision<>p_expected_revision then raise exception 'Customer revision conflict' using errcode='PT409'; end if;
 if current_customer.revision=9223372036854775807 then raise exception 'Customer revision exceeds limit' using errcode='22023'; end if;
 insert into private.customer_requests(organization_id,store_id,actor_user_id,idempotency_key,operation,payload,result_id,result_revision)
 values(p_organization_id,p_store_id,auth.uid(),p_idempotency_key,'update',payload_doc,current_customer.id,current_customer.revision+1);
 update public.customers c set name=normalized_name,phone=normalized_phone,email=normalized_email,active=p_active,
  revision=c.revision+1 where c.organization_id=p_organization_id and c.id=p_customer_id returning * into current_customer;
 return query select current_customer.id,current_customer.revision;
end;
$$;
create function public.customers_sales(p_organization_id uuid,p_store_id uuid,p_customer_id uuid,p_limit integer,p_offset integer)
returns table(id uuid,status text,revision bigint,total_cents bigint,created_at timestamptz,cancelled_at timestamptz,customer_name_snapshot text,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_customers(p_organization_id,p_store_id) or not private.can_read_sales(p_organization_id,p_store_id)
  then raise exception 'Customer sale access denied' using errcode='42501'; end if;
 if p_customer_id is null or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0
  then raise exception 'Invalid customer sale pagination' using errcode='22023'; end if;
 if not exists(select 1 from public.customers c where c.organization_id=p_organization_id and c.id=p_customer_id)
  then raise exception 'Customer access denied' using errcode='42501'; end if;
 return query select s.id,s.status,s.revision,s.total_cents,s.created_at,s.cancelled_at,s.customer_name_snapshot,count(*) over()
 from public.sales s where s.organization_id=p_organization_id and s.store_id=p_store_id and s.customer_id=p_customer_id
 order by s.created_at desc,s.id desc limit p_limit offset p_offset;
end;
$$;
create function public.sales_customer(p_organization_id uuid,p_store_id uuid,p_sale_id uuid)
returns table(customer_id uuid,customer_name_snapshot text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_sales(p_organization_id,p_store_id) or not exists(select 1 from public.sales s
  where s.organization_id=p_organization_id and s.store_id=p_store_id and s.id=p_sale_id) then
  raise exception 'Sale access denied' using errcode='42501'; end if;
 return query select s.customer_id,s.customer_name_snapshot from public.sales s
  where s.organization_id=p_organization_id and s.store_id=p_store_id and s.id=p_sale_id;
end;
$$;

-- Sale confirmation shared core follows below.
create function private.sales_confirm_core(p_organization_id uuid,p_store_id uuid,p_items jsonb,p_customer_id uuid,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare replay record; payload_doc jsonb; normalized_items jsonb='[]'; item jsonb; variant uuid;
 variants uuid[]='{}'; amount integer; price bigint; total numeric=0; actual_price bigint; created public.sales%rowtype;
 customer_name text; customer_active boolean;
begin
 perform private.sales_require_write(p_organization_id,p_store_id,false);
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Invalid sale lines' using errcode='22023'; end if;
 if jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid sale line count' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid sale line' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(item))<>3 or jsonb_typeof(item->'variant_id') is distinct from 'string'
   or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'expected_unit_price_cents') is distinct from 'number'
   or (item->>'quantity') !~ '^[0-9]{1,7}$' or (item->>'expected_unit_price_cents') !~ '^[0-9]{1,12}$' then
   raise exception 'Invalid sale line' using errcode='22023'; end if;
  begin variant=(item->>'variant_id')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid sale variant' using errcode='22023'; end;
  amount=(item->>'quantity')::integer; price=(item->>'expected_unit_price_cents')::bigint;
  if amount not between 1 and 1000000 or price not between 0 and 999999999999 or variant=any(variants) then
   raise exception 'Invalid sale amount or duplicate variant' using errcode='22023'; end if;
  variants=array_append(variants,variant); total=total+amount::numeric*price;
  if total>1000000000000 then raise exception 'Sale total exceeds limit' using errcode='22023'; end if;
  normalized_items=normalized_items||jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',amount,'expected_unit_price_cents',price));
 end loop;
 select jsonb_agg(value order by (value->>'variant_id')::uuid) into normalized_items from jsonb_array_elements(normalized_items);
 payload_doc=case when p_customer_id is null then jsonb_build_object('items',normalized_items)
  else jsonb_build_object('items',normalized_items,'customer_id',p_customer_id) end;
 select * into replay from private.sales_replay(p_organization_id,p_store_id,p_idempotency_key,'confirm',payload_doc);
 if found then return query select replay.result_id,replay.result_revision; return; end if;
 if p_customer_id is not null then
  select c.name,c.active into customer_name,customer_active from public.customers c
   where c.organization_id=p_organization_id and c.id=p_customer_id for share;
  if not found or not customer_active then raise exception 'Active sale customer required' using errcode='22023'; end if;
 end if;
 perform private.sales_lock_variants(p_organization_id,p_store_id,variants,true);
 for item in select value from jsonb_array_elements(normalized_items) loop
  select (pp.amount*100)::bigint into actual_price from public.product_prices pp where pp.organization_id=p_organization_id
   and pp.store_id=p_store_id and pp.variant_id=(item->>'variant_id')::uuid;
  if not found then raise exception 'Sale store price required' using errcode='22023'; end if;
  if actual_price<>(item->>'expected_unit_price_cents')::bigint then raise exception 'Sale price conflict' using errcode='PT409'; end if;
 end loop;
 perform private.sales_lock_balances(p_organization_id,p_store_id,variants);
 insert into public.sales(organization_id,store_id,actor_user_id,item_count,total_cents,customer_id,customer_name_snapshot)
 values(p_organization_id,p_store_id,auth.uid(),cardinality(variants),total::bigint,p_customer_id,customer_name) returning * into created;
 insert into public.sale_items(organization_id,store_id,sale_id,variant_id,product_name,sku,quantity,unit_price_cents)
 select p_organization_id,p_store_id,created.id,v.id,p.name,v.sku,(x.value->>'quantity')::integer,(x.value->>'expected_unit_price_cents')::bigint
 from jsonb_array_elements(normalized_items) x join public.product_variants v on v.organization_id=p_organization_id and v.id=(x.value->>'variant_id')::uuid
 join public.products p on p.organization_id=v.organization_id and p.id=v.product_id order by v.id;
 for item in select value from jsonb_array_elements(normalized_items) loop
  perform private.sales_move(p_organization_id,p_store_id,(item->>'variant_id')::uuid,(item->>'quantity')::integer,created.id,false);
 end loop;
 perform private.sales_result(p_organization_id,p_store_id,p_idempotency_key,'confirm',payload_doc,created.id,created.revision);
 return query select created.id,created.revision;
end;
$$;
create or replace function public.sales_confirm(p_organization_id uuid,p_store_id uuid,p_items jsonb,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
begin
 return query select c.id,c.revision from private.sales_confirm_core(p_organization_id,p_store_id,p_items,null,p_idempotency_key) c;
end;
$$;
create function public.sales_confirm_v2(p_organization_id uuid,p_store_id uuid,p_items jsonb,p_customer_id uuid,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
begin
 return query select c.id,c.revision from private.sales_confirm_core(p_organization_id,p_store_id,p_items,p_customer_id,p_idempotency_key) c;
end;
$$;

revoke all on function private.customer_name_valid(text),private.can_read_customers(uuid,uuid),private.can_read_customers_org(uuid),
 private.customers_require_write(uuid,uuid,boolean),private.customers_replay(uuid,uuid,uuid,text,jsonb),
 private.customers_reject_change(),private.customers_guard(),private.customers_audit(),
 private.sales_confirm_core(uuid,uuid,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_read_customers(uuid,uuid),private.can_read_customers_org(uuid) to authenticated;
revoke all on function public.customers_list(uuid,uuid,text,text,integer,integer,uuid),
 public.customers_save(uuid,uuid,uuid,bigint,text,text,text,boolean,uuid),
 public.customers_sales(uuid,uuid,uuid,integer,integer),public.sales_customer(uuid,uuid,uuid),
 public.sales_confirm_v2(uuid,uuid,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.customers_list(uuid,uuid,text,text,integer,integer,uuid),
 public.customers_save(uuid,uuid,uuid,bigint,text,text,text,boolean,uuid),
 public.customers_sales(uuid,uuid,uuid,integer,integer),public.sales_customer(uuid,uuid,uuid),
 public.sales_confirm_v2(uuid,uuid,jsonb,uuid,uuid) to authenticated;
commit;
