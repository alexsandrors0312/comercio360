-- Pacote 004: suppliers and full purchase receiving. Incremental migration.
begin;

create table public.procurement_suppliers (
 id uuid primary key, organization_id uuid not null references public.organizations(id),
 name text not null check(char_length(name) between 3 and 120 and name=private.catalog_trim(name)),
 contact text check(contact is null or (char_length(contact)<=160 and contact=private.catalog_trim(contact))),
 active boolean not null default true, revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,id)
);
create unique index procurement_supplier_name on public.procurement_suppliers(organization_id,lower(name));
create table public.purchase_orders (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 store_id uuid not null, supplier_id uuid not null,
 supplier_name text not null, supplier_contact text,
 actor_user_id uuid not null references public.profiles(id),
 status text not null default 'open' check(status in ('open','received','cancelled')),
 revision bigint not null default 1 check(revision>0),
 item_count integer not null check(item_count between 1 and 50),
 total_cents bigint not null check(total_cents between 1 and 100000000000),
 created_at timestamptz not null default clock_timestamp(), received_at timestamptz,
 cancellation_reason text,
 unique(organization_id,id), unique(organization_id,store_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,supplier_id) references public.procurement_suppliers(organization_id,id),
 check((status='open' and received_at is null and cancellation_reason is null)
  or (status='received' and received_at is not null and cancellation_reason is null)
  or (status='cancelled' and received_at is null and cancellation_reason is not null
   and char_length(cancellation_reason) between 3 and 240 and cancellation_reason=private.catalog_trim(cancellation_reason)))
);
create index purchase_orders_by_store on public.purchase_orders(organization_id,store_id,created_at desc,id desc);
create table public.purchase_order_items (
 organization_id uuid not null, store_id uuid not null, order_id uuid not null, variant_id uuid not null,
 product_name text not null, sku text not null,
 quantity integer not null check(quantity between 1 and 1000000),
 unit_cost_cents integer not null check(unit_cost_cents between 1 and 100000000),
 inventory_idempotency_key uuid not null default gen_random_uuid() unique,
 primary key(organization_id,order_id,variant_id),
 foreign key(organization_id,store_id,order_id) references public.purchase_orders(organization_id,store_id,id),
 foreign key(organization_id,variant_id) references public.product_variants(organization_id,id)
);
create table public.procurement_requests (
 organization_id uuid not null, store_id uuid not null,
 actor_user_id uuid not null references public.profiles(id), idempotency_key uuid not null,
 operation text not null check(operation in ('save_supplier','create_order','receive_order','cancel_order')),
 payload jsonb not null, result_id uuid not null, result_revision bigint not null check(result_revision>0),
 created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,store_id,actor_user_id,idempotency_key),
 foreign key(organization_id,store_id) references public.stores(organization_id,id)
);

create function private.can_read_procurement(p_org uuid,p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active
 and m.role in ('owner','manager','buyer','stockist') and s.active and a.store_id=p_store);
$$;
create function private.can_read_procurement_org(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active
 and m.role in ('owner','manager','buyer','stockist') and s.active);
$$;
create function private.procurement_require_write(p_org uuid,p_store uuid,p_receiving boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Procurement access denied' using errcode='42501'; end if;
 perform m.id from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.active and s.active and a.store_id=p_store
 and (m.role in ('owner','manager') or (p_receiving and m.role='stockist') or (not p_receiving and m.role='buyer'))
 for share of m,a,s;
 if not found then raise exception 'Procurement access denied' using errcode='42501'; end if;
 perform set_config('app.procurement_store_id',p_store::text,true);
end;
$$;

-- Normalized payload and operation share a single key namespace. An identical
-- replay returns the original result, even after subsequent successful changes.
create function private.procurement_replay(p_org uuid,p_store uuid,p_key uuid,p_operation text,p_payload jsonb)
returns table(result_id uuid,result_revision bigint)
language plpgsql security definer set search_path='' as $$
declare previous public.procurement_requests%rowtype;
begin
 if p_key is null then raise exception 'Procurement idempotency key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('procurement:'||p_org::text||':'||p_store::text||':'||auth.uid()::text||':'||p_key::text,0));
 select * into previous from public.procurement_requests r where r.organization_id=p_org
  and r.store_id=p_store and r.actor_user_id=auth.uid() and r.idempotency_key=p_key;
 if found then
  if previous.operation<>p_operation or previous.payload is distinct from p_payload then
   raise exception 'Procurement idempotency conflict' using errcode='PT409'; end if;
  return query select previous.result_id,previous.result_revision;
 end if;
end;
$$;
create function private.procurement_result(p_org uuid,p_store uuid,p_key uuid,p_operation text,p_payload jsonb,p_id uuid,p_revision bigint)
returns void language sql security definer set search_path='' as $$
 insert into public.procurement_requests(organization_id,store_id,actor_user_id,idempotency_key,operation,payload,result_id,result_revision)
 values(p_org,p_store,auth.uid(),p_key,p_operation,p_payload,p_id,p_revision);
$$;

create function private.procurement_reject_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Procurement history is immutable' using errcode='42501'; end;
$$;
create function private.procurement_supplier_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.organization_id,new.created_at) is distinct from (old.id,old.organization_id,old.created_at) then
  raise exception 'Supplier structural keys are immutable' using errcode='23514'; end if;
 if old.revision=9223372036854775807 or new.revision<>old.revision+1 then
  raise exception 'Supplier revision conflict' using errcode='PT409'; end if;
 new.updated_at=clock_timestamp(); return new;
end;
$$;
create function private.procurement_order_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status<>'open' then raise exception 'Terminal purchase order is immutable' using errcode='42501'; end if;
 if (to_jsonb(new)-'status'-'revision'-'received_at'-'cancellation_reason') is distinct from
  (to_jsonb(old)-'status'-'revision'-'received_at'-'cancellation_reason') then
  raise exception 'Purchase order snapshots are immutable' using errcode='23514'; end if;
 if new.status not in ('received','cancelled') or old.revision=9223372036854775807 or new.revision<>old.revision+1 then
  raise exception 'Purchase order transition conflict' using errcode='PT409'; end if;
 return new;
end;
$$;
create function private.procurement_item_insert_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.purchase_orders o where o.organization_id=new.organization_id
  and o.store_id=new.store_id and o.id=new.order_id and o.status='open') then
  raise exception 'Open purchase order required' using errcode='23514'; end if;
 return new;
end;
$$;
-- Deferred checks enforce the bank-calculated total/count after the header and
-- all lines have been inserted in one transaction, without allowing later edits.
create function private.procurement_check_total() returns trigger language plpgsql security definer set search_path='' as $$
declare target_id uuid; target_org uuid; expected_count integer; expected_total bigint; actual_count bigint; actual_total bigint;
begin
 target_id=(to_jsonb(new)->>case when tg_table_name='purchase_orders' then 'id' else 'order_id' end)::uuid;
 target_org=new.organization_id;
 select o.item_count,o.total_cents into expected_count,expected_total from public.purchase_orders o
  where o.organization_id=target_org and o.id=target_id;
 select count(*),coalesce(sum(i.quantity::bigint*i.unit_cost_cents),0) into actual_count,actual_total
  from public.purchase_order_items i where i.organization_id=target_org and i.order_id=target_id;
 if actual_count<>expected_count or actual_total<>expected_total then
  raise exception 'Purchase order lines or total mismatch' using errcode='23514'; end if;
 return null;
end;
$$;
create function private.procurement_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare before_doc jsonb; after_doc jsonb; unit uuid; entity uuid;
begin
 before_doc=case when tg_op='UPDATE' then to_jsonb(old) else null end;
 after_doc=to_jsonb(new);
 if tg_table_name='procurement_suppliers' then
  unit=nullif(current_setting('app.procurement_store_id',true),'')::uuid; entity=new.id;
 else unit=new.store_id; entity=(to_jsonb(new)->>case when tg_table_name='purchase_orders' then 'id' else 'order_id' end)::uuid; end if;
 if unit is not null and not exists(select 1 from public.stores s where s.organization_id=new.organization_id and s.id=unit) then
  raise exception 'Procurement audit store mismatch' using errcode='23514'; end if;
 -- Internal stock idempotency tokens never become audit payloads.
 after_doc=after_doc-'inventory_idempotency_key'; before_doc=before_doc-'inventory_idempotency_key';
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,old_value,new_value)
 values(new.organization_id,unit,auth.uid(),lower(tg_op),tg_table_name,entity,'database',before_doc,after_doc);
 return null;
end;
$$;

create trigger supplier_guard before update on public.procurement_suppliers for each row execute function private.procurement_supplier_guard();
create trigger supplier_no_delete before delete on public.procurement_suppliers for each row execute function private.procurement_reject_change();
create trigger supplier_no_truncate before truncate on public.procurement_suppliers for each statement execute function private.procurement_reject_change();
create trigger order_guard before update on public.purchase_orders for each row execute function private.procurement_order_guard();
create trigger order_no_delete before delete on public.purchase_orders for each row execute function private.procurement_reject_change();
create trigger order_no_truncate before truncate on public.purchase_orders for each statement execute function private.procurement_reject_change();
create trigger purchase_item_insert_guard before insert on public.purchase_order_items for each row execute function private.procurement_item_insert_guard();
create constraint trigger purchase_order_total after insert or update on public.purchase_orders deferrable initially deferred
 for each row execute function private.procurement_check_total();
create constraint trigger purchase_item_total after insert on public.purchase_order_items deferrable initially deferred
 for each row execute function private.procurement_check_total();
do $$ declare tbl text; begin
 foreach tbl in array array['purchase_order_items','procurement_requests'] loop
  execute format('create trigger procurement_immutable before update or delete on public.%I for each row execute function private.procurement_reject_change()',tbl);
  execute format('create trigger procurement_no_truncate before truncate on public.%I for each statement execute function private.procurement_reject_change()',tbl);
 end loop;
 foreach tbl in array array['procurement_suppliers','purchase_orders','purchase_order_items'] loop
  execute format('create trigger procurement_audit after insert or update on public.%I for each row execute function private.procurement_audit()',tbl);
 end loop;
end $$;

alter table public.procurement_suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.procurement_requests enable row level security;
revoke all on public.procurement_suppliers,public.purchase_orders,public.purchase_order_items,public.procurement_requests
 from public,anon,authenticated,service_role;
grant select on public.procurement_suppliers,public.purchase_orders,public.purchase_order_items to authenticated,service_role;
create policy procurement_suppliers_read on public.procurement_suppliers for select to authenticated
 using(private.can_read_procurement_org(organization_id));
create policy purchase_order_read on public.purchase_orders for select to authenticated
 using(private.can_read_procurement(organization_id,store_id));
create policy purchase_item_read on public.purchase_order_items for select to authenticated
 using(private.can_read_procurement(organization_id,store_id));
create policy procurement_audit_scope on public.audit_events as restrictive for select to authenticated using(
 entity_type not in ('procurement_suppliers','purchase_orders','purchase_order_items','procurement_requests')
 or (store_id is not null and private.can_read_procurement(organization_id,store_id)));

create function private.procurement_lock_variants(p_org uuid,p_variants uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare matched bigint;
begin
 -- Same parent-before-variant order as Catalog and Inventory; sort each set.
 perform p.id from public.products p where p.organization_id=p_org and p.id in (
  select v.product_id from public.product_variants v where v.organization_id=p_org and v.id=any(p_variants))
 order by p.id for share;
 perform v.id from public.product_variants v where v.organization_id=p_org and v.id=any(p_variants)
 order by v.id for share;
 get diagnostics matched=row_count;
 if matched<>cardinality(p_variants) then raise exception 'Purchase variant access denied' using errcode='42501'; end if;
 if exists(select 1 from public.product_variants v join public.products p
  on p.organization_id=v.organization_id and p.id=v.product_id
  where v.organization_id=p_org and v.id=any(p_variants) and (not v.active or not p.active)) then
  raise exception 'Active purchase product and variant required' using errcode='22023'; end if;
end;
$$;

create function public.procurement_suppliers(p_organization_id uuid,p_store_id uuid,p_query text,p_limit integer,p_offset integer,p_supplier_id uuid default null)
returns table(id uuid,name text,contact text,active boolean,revision bigint,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare term text=coalesce(private.catalog_trim(p_query),'');
begin
 if not private.can_read_procurement(p_organization_id,p_store_id) then raise exception 'Procurement access denied' using errcode='42501'; end if;
 if char_length(term)>200 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then
  raise exception 'Invalid supplier pagination' using errcode='22023'; end if;
 return query select s.id,s.name,s.contact,s.active,s.revision,count(*) over()
 from public.procurement_suppliers s where s.organization_id=p_organization_id
  and (p_supplier_id is null or s.id=p_supplier_id) and (term='' or strpos(lower(s.name),lower(term))>0)
 order by s.name,s.id limit p_limit offset p_offset;
end;
$$;
create function public.procurement_orders(p_organization_id uuid,p_store_id uuid,p_query text,p_status text,p_limit integer,p_offset integer,p_order_id uuid default null)
returns table(id uuid,supplier_id uuid,supplier_name text,status text,revision bigint,total_cents bigint,created_at timestamptz,
 received_at timestamptz,cancellation_reason text,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare term text=coalesce(private.catalog_trim(p_query),'');
begin
 if not private.can_read_procurement(p_organization_id,p_store_id) then raise exception 'Procurement access denied' using errcode='42501'; end if;
 if char_length(term)>200 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0
  or p_status is null or p_status not in ('all','open','received','cancelled') then
  raise exception 'Invalid purchase pagination' using errcode='22023'; end if;
 return query select o.id,o.supplier_id,o.supplier_name,o.status,o.revision,o.total_cents,o.created_at,
  o.received_at,o.cancellation_reason,count(*) over()
 from public.purchase_orders o where o.organization_id=p_organization_id and o.store_id=p_store_id
  and (p_order_id is null or o.id=p_order_id) and (p_status='all' or o.status=p_status)
  and (term='' or strpos(lower(o.supplier_name),lower(term))>0 or strpos(o.id::text,lower(term))>0)
 order by o.created_at desc,o.id desc limit p_limit offset p_offset;
end;
$$;
create function public.procurement_order_items(p_organization_id uuid,p_store_id uuid,p_order_id uuid)
returns table(variant_id uuid,product_name text,sku text,quantity integer,unit_cost_cents integer)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_procurement(p_organization_id,p_store_id) or not exists(select 1 from public.purchase_orders o
  where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=p_order_id) then
  raise exception 'Purchase order access denied' using errcode='42501'; end if;
 return query select i.variant_id,i.product_name,i.sku,i.quantity,i.unit_cost_cents from public.purchase_order_items i
 where i.organization_id=p_organization_id and i.store_id=p_store_id and i.order_id=p_order_id order by i.variant_id;
end;
$$;

create function public.procurement_save_supplier(p_organization_id uuid,p_store_id uuid,p_supplier_id uuid,p_name text,p_contact text,
 p_active boolean,p_expected_revision bigint,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare supplier public.procurement_suppliers%rowtype; replay record; payload_doc jsonb;
 normalized_name text=private.catalog_trim(p_name); normalized_contact text=nullif(private.catalog_trim(p_contact),'');
begin
 perform private.procurement_require_write(p_organization_id,p_store_id,false);
 if p_supplier_id is null or normalized_name is null or char_length(normalized_name) not between 3 and 120
  or char_length(normalized_contact)>160 or p_active is null or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'Invalid supplier' using errcode='22023'; end if;
 payload_doc=jsonb_build_object('supplier_id',p_supplier_id,'name',normalized_name,'contact',normalized_contact,'active',p_active,'expected_revision',p_expected_revision);
 select * into replay from private.procurement_replay(p_organization_id,p_store_id,p_idempotency_key,'save_supplier',payload_doc);
 if found then return query select replay.result_id,replay.result_revision; return; end if;
 -- A new UUID has no row to lock yet. Serialize its first insertion as well
 -- so two creation intents using that UUID resolve via CAS, not a PK race.
 perform pg_advisory_xact_lock(hashtextextended('procurement-supplier:'||p_supplier_id::text,0));
 select * into supplier from public.procurement_suppliers s where s.organization_id=p_organization_id and s.id=p_supplier_id for update;
 if found then
  if supplier.revision<>p_expected_revision then raise exception 'Supplier revision conflict' using errcode='PT409'; end if;
  if supplier.revision=9223372036854775807 then raise exception 'Supplier revision exceeds limit' using errcode='22023'; end if;
  update public.procurement_suppliers s set name=normalized_name,contact=normalized_contact,active=p_active,revision=s.revision+1
   where s.organization_id=p_organization_id and s.id=p_supplier_id returning * into supplier;
 else
  if p_expected_revision<>0 or exists(select 1 from public.procurement_suppliers s where s.id=p_supplier_id) then
   raise exception 'Supplier access denied' using errcode='42501'; end if;
  insert into public.procurement_suppliers(id,organization_id,name,contact,active)
   values(p_supplier_id,p_organization_id,normalized_name,normalized_contact,p_active) returning * into supplier;
 end if;
 perform private.procurement_result(p_organization_id,p_store_id,p_idempotency_key,'save_supplier',payload_doc,supplier.id,supplier.revision);
 return query select supplier.id,supplier.revision;
end;
$$;

create function public.procurement_create_order(p_organization_id uuid,p_store_id uuid,p_supplier_id uuid,p_items jsonb,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare supplier public.procurement_suppliers%rowtype; created public.purchase_orders%rowtype;
 replay record; payload_doc jsonb; normalized_items jsonb='[]'; item jsonb; variant uuid;
 variants uuid[]='{}'; amount integer; cost integer; total bigint=0;
begin
 perform private.procurement_require_write(p_organization_id,p_store_id,false);
 if p_supplier_id is null or p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Invalid purchase lines' using errcode='22023'; end if;
 if jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid purchase line count' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid purchase line' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(item))<>3
   or jsonb_typeof(item->'variant_id') is distinct from 'string'
   or jsonb_typeof(item->'quantity') is distinct from 'number'
   or jsonb_typeof(item->'unit_cost_cents') is distinct from 'number'
   or (item->>'quantity') !~ '^[0-9]{1,7}$' or (item->>'unit_cost_cents') !~ '^[0-9]{1,9}$' then
   raise exception 'Invalid purchase line' using errcode='22023'; end if;
  begin variant=(item->>'variant_id')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid purchase variant' using errcode='22023'; end;
  amount=(item->>'quantity')::integer; cost=(item->>'unit_cost_cents')::integer;
  if amount not between 1 and 1000000 or cost not between 1 and 100000000 or variant=any(variants) then
   raise exception 'Invalid purchase amount or duplicate variant' using errcode='22023'; end if;
  variants=array_append(variants,variant); total=total+amount::bigint*cost;
  if total>100000000000 then raise exception 'Purchase total exceeds limit' using errcode='22023'; end if;
  normalized_items=normalized_items||jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',amount,'unit_cost_cents',cost));
 end loop;
 select jsonb_agg(value order by (value->>'variant_id')::uuid) into normalized_items from jsonb_array_elements(normalized_items);
 payload_doc=jsonb_build_object('supplier_id',p_supplier_id,'items',normalized_items);
 select * into replay from private.procurement_replay(p_organization_id,p_store_id,p_idempotency_key,'create_order',payload_doc);
 if found then return query select replay.result_id,replay.result_revision; return; end if;
 select * into supplier from public.procurement_suppliers s where s.organization_id=p_organization_id and s.id=p_supplier_id for share;
 if not found then raise exception 'Supplier access denied' using errcode='42501'; end if;
 if not supplier.active then raise exception 'Active supplier required' using errcode='22023'; end if;
 perform private.procurement_lock_variants(p_organization_id,variants);
 insert into public.purchase_orders(organization_id,store_id,supplier_id,supplier_name,supplier_contact,actor_user_id,item_count,total_cents)
 values(p_organization_id,p_store_id,supplier.id,supplier.name,supplier.contact,auth.uid(),cardinality(variants),total) returning * into created;
 insert into public.purchase_order_items(organization_id,store_id,order_id,variant_id,product_name,sku,quantity,unit_cost_cents)
 select p_organization_id,p_store_id,created.id,v.id,p.name,v.sku,(x.value->>'quantity')::integer,(x.value->>'unit_cost_cents')::integer
 from jsonb_array_elements(normalized_items) x join public.product_variants v
  on v.organization_id=p_organization_id and v.id=(x.value->>'variant_id')::uuid
 join public.products p on p.organization_id=v.organization_id and p.id=v.product_id order by v.id;
 perform private.procurement_result(p_organization_id,p_store_id,p_idempotency_key,'create_order',payload_doc,created.id,created.revision);
 return query select created.id,created.revision;
end;
$$;

create function public.procurement_receive_order(p_organization_id uuid,p_store_id uuid,p_order_id uuid,p_expected_revision bigint,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare current_order public.purchase_orders%rowtype; item public.purchase_order_items%rowtype;
 replay record; payload_doc jsonb; variants uuid[]; current_revision bigint;
begin
 perform private.procurement_require_write(p_organization_id,p_store_id,true);
 if p_order_id is null or p_expected_revision is null or p_expected_revision<1 then raise exception 'Invalid purchase transition' using errcode='22023'; end if;
 payload_doc=jsonb_build_object('order_id',p_order_id,'expected_revision',p_expected_revision);
 select * into replay from private.procurement_replay(p_organization_id,p_store_id,p_idempotency_key,'receive_order',payload_doc);
 if found then return query select replay.result_id,replay.result_revision; return; end if;
 select * into current_order from public.purchase_orders o where o.organization_id=p_organization_id
  and o.store_id=p_store_id and o.id=p_order_id for update;
 if not found then raise exception 'Purchase order access denied' using errcode='42501'; end if;
 if current_order.status<>'open' or current_order.revision<>p_expected_revision then raise exception 'Purchase order transition conflict' using errcode='PT409'; end if;
 if current_order.revision=9223372036854775807 then raise exception 'Purchase revision exceeds limit' using errcode='22023'; end if;
 select array_agg(i.variant_id order by i.variant_id) into variants from public.purchase_order_items i
  where i.organization_id=p_organization_id and i.store_id=p_store_id and i.order_id=p_order_id;
 -- Acquire the same inventory idempotency locks before balance locks. This
 -- keeps a manual RPC using a line's UUID from inverting balance/key lock order.
 for item in select * from public.purchase_order_items i where i.organization_id=p_organization_id
  and i.store_id=p_store_id and i.order_id=p_order_id order by i.variant_id loop
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_organization_id::text||':'||p_store_id::text||':'||
   auth.uid()::text||':'||item.inventory_idempotency_key::text,0));
 end loop;
 perform private.procurement_lock_variants(p_organization_id,variants);
 for item in select * from public.purchase_order_items i where i.organization_id=p_organization_id
  and i.store_id=p_store_id and i.order_id=p_order_id order by i.variant_id loop
  insert into public.inventory_balances(organization_id,store_id,variant_id)
   values(p_organization_id,p_store_id,item.variant_id) on conflict do nothing;
  perform b.variant_id from public.inventory_balances b where b.organization_id=p_organization_id
   and b.store_id=p_store_id and b.variant_id=item.variant_id for update;
 end loop;
 for item in select * from public.purchase_order_items i where i.organization_id=p_organization_id
  and i.store_id=p_store_id and i.order_id=p_order_id order by i.variant_id loop
  select b.revision into current_revision from public.inventory_balances b where b.organization_id=p_organization_id
   and b.store_id=p_store_id and b.variant_id=item.variant_id;
  perform public.inventory_move(p_organization_id,p_store_id,item.variant_id,'entry',item.quantity,
   'Recebimento de compra '||p_order_id::text,current_revision,item.inventory_idempotency_key);
 end loop;
 update public.purchase_orders o set status='received',revision=o.revision+1,received_at=clock_timestamp()
  where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=p_order_id returning * into current_order;
 perform private.procurement_result(p_organization_id,p_store_id,p_idempotency_key,'receive_order',payload_doc,current_order.id,current_order.revision);
 return query select current_order.id,current_order.revision;
end;
$$;

create function public.procurement_cancel_order(p_organization_id uuid,p_store_id uuid,p_order_id uuid,p_expected_revision bigint,p_reason text,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare current_order public.purchase_orders%rowtype; replay record; payload_doc jsonb; reason text=private.catalog_trim(p_reason);
begin
 perform private.procurement_require_write(p_organization_id,p_store_id,false);
 if p_order_id is null or p_expected_revision is null or p_expected_revision<1 or reason is null or char_length(reason) not between 3 and 240 then
  raise exception 'Invalid purchase cancellation' using errcode='22023'; end if;
 payload_doc=jsonb_build_object('order_id',p_order_id,'expected_revision',p_expected_revision,'reason',reason);
 select * into replay from private.procurement_replay(p_organization_id,p_store_id,p_idempotency_key,'cancel_order',payload_doc);
 if found then return query select replay.result_id,replay.result_revision; return; end if;
 select * into current_order from public.purchase_orders o where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=p_order_id for update;
 if not found then raise exception 'Purchase order access denied' using errcode='42501'; end if;
 if current_order.status<>'open' or current_order.revision<>p_expected_revision then raise exception 'Purchase order transition conflict' using errcode='PT409'; end if;
 if current_order.revision=9223372036854775807 then raise exception 'Purchase revision exceeds limit' using errcode='22023'; end if;
 update public.purchase_orders o set status='cancelled',revision=o.revision+1,cancellation_reason=reason
  where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=p_order_id returning * into current_order;
 perform private.procurement_result(p_organization_id,p_store_id,p_idempotency_key,'cancel_order',payload_doc,current_order.id,current_order.revision);
 return query select current_order.id,current_order.revision;
end;
$$;

revoke all on function private.can_read_procurement(uuid,uuid),private.can_read_procurement_org(uuid),
 private.procurement_require_write(uuid,uuid,boolean),private.procurement_replay(uuid,uuid,uuid,text,jsonb),
 private.procurement_result(uuid,uuid,uuid,text,jsonb,uuid,bigint),private.procurement_reject_change(),
 private.procurement_supplier_guard(),private.procurement_order_guard(),private.procurement_item_insert_guard(),
 private.procurement_check_total(),private.procurement_audit(),private.procurement_lock_variants(uuid,uuid[])
 from public,anon,authenticated,service_role;
grant execute on function private.can_read_procurement(uuid,uuid),private.can_read_procurement_org(uuid) to authenticated;
revoke all on function public.procurement_suppliers(uuid,uuid,text,integer,integer,uuid),
 public.procurement_orders(uuid,uuid,text,text,integer,integer,uuid),public.procurement_order_items(uuid,uuid,uuid),
 public.procurement_save_supplier(uuid,uuid,uuid,text,text,boolean,bigint,uuid),
 public.procurement_create_order(uuid,uuid,uuid,jsonb,uuid),public.procurement_receive_order(uuid,uuid,uuid,bigint,uuid),
 public.procurement_cancel_order(uuid,uuid,uuid,bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.procurement_suppliers(uuid,uuid,text,integer,integer,uuid),
 public.procurement_orders(uuid,uuid,text,text,integer,integer,uuid),public.procurement_order_items(uuid,uuid,uuid),
 public.procurement_save_supplier(uuid,uuid,uuid,text,text,boolean,bigint,uuid),
 public.procurement_create_order(uuid,uuid,uuid,jsonb,uuid),public.procurement_receive_order(uuid,uuid,uuid,bigint,uuid),
 public.procurement_cancel_order(uuid,uuid,uuid,bigint,text,uuid) to authenticated;
commit;
