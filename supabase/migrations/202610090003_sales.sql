-- Pacote 005: confirmed sales and integral cancellation; incremental only.
begin;
create table public.sales (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 store_id uuid not null, actor_user_id uuid not null references public.profiles(id),
 status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
 revision bigint not null default 1 check(revision>0),
 item_count integer not null check(item_count between 1 and 50),
 total_cents bigint not null check(total_cents between 0 and 1000000000000),
 created_at timestamptz not null default clock_timestamp(), cancelled_at timestamptz, cancellation_reason text,
 unique(organization_id,store_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 check((status='confirmed' and cancelled_at is null and cancellation_reason is null) or
  (status='cancelled' and cancelled_at is not null and cancellation_reason is not null and
   char_length(cancellation_reason) between 3 and 240 and cancellation_reason=private.catalog_trim(cancellation_reason)))
);
create index sales_by_store on public.sales(organization_id,store_id,created_at desc,id desc);
create table public.sale_items (
 organization_id uuid not null, store_id uuid not null, sale_id uuid not null, variant_id uuid not null,
 product_name text not null, sku text not null, quantity integer not null check(quantity between 1 and 1000000),
 unit_price_cents bigint not null check(unit_price_cents between 0 and 999999999999),
 primary key(organization_id,store_id,sale_id,variant_id),
 foreign key(organization_id,store_id,sale_id) references public.sales(organization_id,store_id,id),
 foreign key(organization_id,variant_id) references public.product_variants(organization_id,id)
);
create table private.sales_requests (
 organization_id uuid not null, store_id uuid not null, actor_user_id uuid not null references public.profiles(id),
 idempotency_key uuid not null, operation text not null check(operation in ('confirm','cancel')),
 payload jsonb not null, result_id uuid not null, result_revision bigint not null check(result_revision>0),
 created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,store_id,actor_user_id,idempotency_key),
 foreign key(organization_id,store_id,result_id) references public.sales(organization_id,store_id,id)
);

create function private.can_read_sales(p_org uuid,p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active
 and m.role in ('owner','manager','cashier') and s.active and a.store_id=p_store);
$$;
create function private.sales_require_write(p_org uuid,p_store uuid,p_cancel boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sales access denied' using errcode='42501'; end if;
 perform m.id from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.active and s.active and a.store_id=p_store
 and (m.role in ('owner','manager') or (not p_cancel and m.role='cashier')) for share of m,a,s;
 if not found then raise exception 'Sales access denied' using errcode='42501'; end if;
end;
$$;
create function private.sales_replay(p_org uuid,p_store uuid,p_key uuid,p_operation text,p_payload jsonb)
returns table(result_id uuid,result_revision bigint)
language plpgsql security definer set search_path='' as $$
declare previous private.sales_requests%rowtype;
begin
 if p_key is null then raise exception 'Sales idempotency key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sales:'||p_org::text||':'||p_store::text||':'||auth.uid()::text||':'||p_key::text,0));
 select * into previous from private.sales_requests r where r.organization_id=p_org and r.store_id=p_store
  and r.actor_user_id=auth.uid() and r.idempotency_key=p_key;
 if found then
  if previous.operation<>p_operation or previous.payload is distinct from p_payload then
   raise exception 'Sales idempotency conflict' using errcode='PT409'; end if;
  return query select previous.result_id,previous.result_revision;
 end if;
end;
$$;
create function private.sales_result(p_org uuid,p_store uuid,p_key uuid,p_operation text,p_payload jsonb,p_id uuid,p_revision bigint)
returns void language sql security definer set search_path='' as $$
 insert into private.sales_requests(organization_id,store_id,actor_user_id,idempotency_key,operation,payload,result_id,result_revision)
 values(p_org,p_store,auth.uid(),p_key,p_operation,p_payload,p_id,p_revision);
$$;
create function private.sales_reject_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Sales history is immutable' using errcode='42501'; end;
$$;
create function private.sales_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status<>'confirmed' then raise exception 'Terminal sale is immutable' using errcode='42501'; end if;
 if (to_jsonb(new)-'status'-'revision'-'cancelled_at'-'cancellation_reason') is distinct from
  (to_jsonb(old)-'status'-'revision'-'cancelled_at'-'cancellation_reason') then
  raise exception 'Sale snapshots are immutable' using errcode='23514'; end if;
 if new.status<>'cancelled' or old.revision=9223372036854775807 or new.revision<>old.revision+1 then
  raise exception 'Sale transition conflict' using errcode='PT409'; end if;
 -- Cancellation RPC records its result only after restoring all lines. Common
 -- administrative UPDATE cannot skip that operation and silently corrupt stock.
 if not exists(select 1 from private.sales_requests r where r.organization_id=old.organization_id and r.store_id=old.store_id
  and r.result_id=old.id and r.operation='cancel' and r.result_revision=new.revision
  and r.actor_user_id=auth.uid() and r.payload=jsonb_build_object('sale_id',old.id,'expected_revision',old.revision,'reason',new.cancellation_reason)) then
  raise exception 'Cancellation operation required' using errcode='42501'; end if;
 return new;
end;
$$;
create function private.sales_check_total() returns trigger language plpgsql security definer set search_path='' as $$
declare target_id uuid; expected_count integer; expected_total bigint; actual_count bigint; actual_total numeric;
begin
 target_id=(to_jsonb(new)->>case when tg_table_name='sales' then 'id' else 'sale_id' end)::uuid;
 select s.item_count,s.total_cents into expected_count,expected_total from public.sales s
  where s.organization_id=new.organization_id and s.store_id=new.store_id and s.id=target_id;
 select count(*),coalesce(sum(i.quantity::numeric*i.unit_price_cents),0) into actual_count,actual_total
  from public.sale_items i where i.organization_id=new.organization_id and i.store_id=new.store_id and i.sale_id=target_id;
 if actual_count<>expected_count or actual_total<>expected_total then
  raise exception 'Sale lines or total mismatch' using errcode='23514'; end if;
 return null;
end;
$$;
create function private.sales_item_insert_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.sales s where s.organization_id=new.organization_id and s.store_id=new.store_id and s.id=new.sale_id
  and s.status='confirmed' and not exists(select 1 from private.sales_requests r where r.organization_id=s.organization_id
   and r.store_id=s.store_id and r.result_id=s.id)) then
  raise exception 'Sale snapshots already sealed' using errcode='42501'; end if;
 return new;
end;
$$;
create function private.sales_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,old_value,new_value)
 values(new.organization_id,new.store_id,auth.uid(),lower(tg_op),tg_table_name,
  (to_jsonb(new)->>case when tg_table_name='sales' then 'id' else 'sale_id' end)::uuid,'database',
  case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return null;
end;
$$;
create trigger sales_guard before update on public.sales for each row execute function private.sales_guard();
create trigger sales_no_delete before delete on public.sales for each row execute function private.sales_reject_change();
create trigger sales_no_truncate before truncate on public.sales for each statement execute function private.sales_reject_change();
create trigger sales_item_insert_guard before insert on public.sale_items for each row execute function private.sales_item_insert_guard();
create constraint trigger sale_total after insert or update on public.sales deferrable initially deferred
 for each row execute function private.sales_check_total();
create constraint trigger sale_item_total after insert on public.sale_items deferrable initially deferred
 for each row execute function private.sales_check_total();
do $$ declare tbl text; begin
 foreach tbl in array array['public.sale_items','private.sales_requests'] loop
  execute format('create trigger sales_immutable before update or delete on %s for each row execute function private.sales_reject_change()',tbl);
  execute format('create trigger sales_no_truncate before truncate on %s for each statement execute function private.sales_reject_change()',tbl);
 end loop;
 foreach tbl in array array['sales','sale_items'] loop
  execute format('create trigger sales_audit after insert or update on public.%I for each row execute function private.sales_audit()',tbl);
 end loop;
end $$;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table private.sales_requests enable row level security;
revoke all on public.sales,public.sale_items,private.sales_requests from public,anon,authenticated,service_role;
grant select on public.sales,public.sale_items to authenticated,service_role;
create policy sales_read on public.sales for select to authenticated using(private.can_read_sales(organization_id,store_id));
create policy sales_item_read on public.sale_items for select to authenticated using(private.can_read_sales(organization_id,store_id));
-- Restrictive addition preserves all earlier catalog/inventory/procurement rules.
create policy sales_audit_scope on public.audit_events as restrictive for select to authenticated using(
 entity_type not in ('sales','sale_items','sales_requests') or (store_id is not null and private.can_read_sales(organization_id,store_id)));

create function private.sales_lock_variants(p_org uuid,p_store uuid,p_variants uuid[],p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
declare matched bigint;
begin
 -- Catalog mutates parent BEFORE variant/price. Lock every sorted parent before
 -- every sorted variant and price, then every balance; never acquire parent
 -- after a balance. Parent lock also protects the absence of a store price.
 perform p.id from public.products p where p.organization_id=p_org and p.id in (
  select v.product_id from public.product_variants v where v.organization_id=p_org and v.id=any(p_variants)) order by p.id for share;
 perform v.id from public.product_variants v where v.organization_id=p_org and v.id=any(p_variants) order by v.id for share;
 get diagnostics matched=row_count;
 if matched<>cardinality(p_variants) then raise exception 'Sale variant access denied' using errcode='42501'; end if;
 if p_active and exists(select 1 from public.product_variants v join public.products p
  on p.organization_id=v.organization_id and p.id=v.product_id
  where v.organization_id=p_org and v.id=any(p_variants) and (not v.active or not p.active)) then
  raise exception 'Active sale product and variant required' using errcode='22023'; end if;
 perform pp.id from public.product_prices pp where pp.organization_id=p_org and pp.store_id=p_store
  and pp.variant_id=any(p_variants) order by pp.variant_id for share;
end;
$$;
create function private.sales_lock_balances(p_org uuid,p_store uuid,p_variants uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare variant uuid;
begin
 for variant in select unnest(p_variants) order by 1 loop
  insert into public.inventory_balances(organization_id,store_id,variant_id) values(p_org,p_store,variant) on conflict do nothing;
  perform b.variant_id from public.inventory_balances b where b.organization_id=p_org and b.store_id=p_store and b.variant_id=variant for update;
 end loop;
end;
$$;
create function private.sales_move(p_org uuid,p_store uuid,p_variant uuid,p_quantity integer,p_sale uuid,p_cancel boolean) returns void
language plpgsql security definer set search_path='' as $$
declare balance public.inventory_balances%rowtype; resulting bigint;
begin
 -- Internal helper has no external grants and independently checks sales rights.
 -- All catalog/price/balance locks have been acquired by its enclosing RPC.
 perform private.sales_require_write(p_org,p_store,p_cancel);
 select * into balance from public.inventory_balances b where b.organization_id=p_org and b.store_id=p_store and b.variant_id=p_variant for update;
 if not found or p_quantity is null or p_quantity not between 1 and 1000000 then raise exception 'Invalid sale movement' using errcode='22023'; end if;
 resulting=balance.quantity::bigint+case when p_cancel then p_quantity else -p_quantity end;
 if resulting<0 then raise exception 'Insufficient sale stock' using errcode='PT422'; end if;
 if resulting>2147483647 or balance.revision=9223372036854775807 then raise exception 'Sale stock exceeds limit' using errcode='22023'; end if;
 update public.inventory_balances b set quantity=resulting::integer,revision=b.revision+1,updated_at=clock_timestamp()
  where b.organization_id=p_org and b.store_id=p_store and b.variant_id=p_variant;
 insert into public.inventory_movements(organization_id,store_id,variant_id,actor_user_id,idempotency_key,kind,quantity,reason,expected_revision,revision_after,balance_after)
 values(p_org,p_store,p_variant,auth.uid(),gen_random_uuid(),case when p_cancel then 'entry' else 'exit' end,p_quantity,
  case when p_cancel then 'Cancelamento de venda ' else 'Venda ' end||p_sale::text,balance.revision,balance.revision+1,resulting::integer);
end;
$$;

create function public.sales_variants(p_organization_id uuid,p_store_id uuid,p_query text,p_limit integer,p_offset integer)
returns table(variant_id uuid,product_name text,sku text,color text,size text,unit_price_cents bigint,quantity integer,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare term text=coalesce(private.catalog_trim(p_query),'');
begin
 if not private.can_read_sales(p_organization_id,p_store_id) then raise exception 'Sales access denied' using errcode='42501'; end if;
 if char_length(term)>200 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'Invalid sales pagination' using errcode='22023'; end if;
 return query select v.id,p.name,v.sku,v.color,v.size,(pp.amount*100)::bigint,coalesce(b.quantity,0),count(*) over()
 from public.product_variants v join public.products p on p.organization_id=v.organization_id and p.id=v.product_id
 left join public.product_prices pp on pp.organization_id=v.organization_id and pp.store_id=p_store_id and pp.variant_id=v.id
 left join public.inventory_balances b on b.organization_id=v.organization_id and b.store_id=p_store_id and b.variant_id=v.id
 where v.organization_id=p_organization_id and v.active and p.active and
  (term='' or strpos(lower(p.name),lower(term))>0 or strpos(lower(v.sku),lower(term))>0 or strpos(lower(coalesce(v.barcode,'')),lower(term))>0)
 order by p.name,v.sku,v.id limit p_limit offset p_offset;
end;
$$;
create function public.sales_list(p_organization_id uuid,p_store_id uuid,p_query text,p_status text,p_limit integer,p_offset integer,p_sale_id uuid default null)
returns table(id uuid,status text,revision bigint,total_cents bigint,created_at timestamptz,cancelled_at timestamptz,cancellation_reason text,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare term text=coalesce(private.catalog_trim(p_query),'');
begin
 if not private.can_read_sales(p_organization_id,p_store_id) then raise exception 'Sales access denied' using errcode='42501'; end if;
 if char_length(term)>200 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 or p_status is null or p_status not in ('all','confirmed','cancelled') then
  raise exception 'Invalid sales pagination' using errcode='22023'; end if;
 return query select s.id,s.status,s.revision,s.total_cents,s.created_at,s.cancelled_at,s.cancellation_reason,count(*) over()
 from public.sales s where s.organization_id=p_organization_id and s.store_id=p_store_id and (p_sale_id is null or s.id=p_sale_id)
  and (p_status='all' or s.status=p_status) and (term='' or strpos(s.id::text,lower(term))>0 or exists(
   select 1 from public.sale_items i where i.organization_id=s.organization_id and i.store_id=s.store_id and i.sale_id=s.id
    and (strpos(lower(i.sku),lower(term))>0 or strpos(lower(i.product_name),lower(term))>0)))
 order by s.created_at desc,s.id desc limit p_limit offset p_offset;
end;
$$;
create function public.sales_items(p_organization_id uuid,p_store_id uuid,p_sale_id uuid)
returns table(variant_id uuid,product_name text,sku text,quantity integer,unit_price_cents bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_sales(p_organization_id,p_store_id) or not exists(select 1 from public.sales s
  where s.organization_id=p_organization_id and s.store_id=p_store_id and s.id=p_sale_id) then raise exception 'Sale access denied' using errcode='42501'; end if;
 return query select i.variant_id,i.product_name,i.sku,i.quantity,i.unit_price_cents from public.sale_items i
  where i.organization_id=p_organization_id and i.store_id=p_store_id and i.sale_id=p_sale_id order by i.variant_id;
end;
$$;
create function public.sales_confirm(p_organization_id uuid,p_store_id uuid,p_items jsonb,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare replay record; payload_doc jsonb; normalized_items jsonb='[]'; item jsonb; variant uuid;
 variants uuid[]='{}'; amount integer; price bigint; total numeric=0; actual_price bigint; created public.sales%rowtype;
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
 payload_doc=jsonb_build_object('items',normalized_items);
 select * into replay from private.sales_replay(p_organization_id,p_store_id,p_idempotency_key,'confirm',payload_doc);
 if found then return query select replay.result_id,replay.result_revision; return; end if;
 perform private.sales_lock_variants(p_organization_id,p_store_id,variants,true);
 for item in select value from jsonb_array_elements(normalized_items) loop
  select (pp.amount*100)::bigint into actual_price from public.product_prices pp where pp.organization_id=p_organization_id
   and pp.store_id=p_store_id and pp.variant_id=(item->>'variant_id')::uuid;
  if not found then raise exception 'Sale store price required' using errcode='22023'; end if;
  if actual_price<>(item->>'expected_unit_price_cents')::bigint then raise exception 'Sale price conflict' using errcode='PT409'; end if;
 end loop;
 perform private.sales_lock_balances(p_organization_id,p_store_id,variants);
 insert into public.sales(organization_id,store_id,actor_user_id,item_count,total_cents)
 values(p_organization_id,p_store_id,auth.uid(),cardinality(variants),total::bigint) returning * into created;
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
create function public.sales_cancel(p_organization_id uuid,p_store_id uuid,p_sale_id uuid,p_expected_revision bigint,p_reason text,p_idempotency_key uuid)
returns table(id uuid,revision bigint) language plpgsql security definer set search_path='' as $$
declare replay record; payload_doc jsonb; reason text=private.catalog_trim(p_reason); current_sale public.sales%rowtype;
 variants uuid[]; item public.sale_items%rowtype;
begin
 perform private.sales_require_write(p_organization_id,p_store_id,true);
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<1 or reason is null or char_length(reason) not between 3 and 240 then
  raise exception 'Invalid sale cancellation' using errcode='22023'; end if;
 payload_doc=jsonb_build_object('sale_id',p_sale_id,'expected_revision',p_expected_revision,'reason',reason);
 select * into replay from private.sales_replay(p_organization_id,p_store_id,p_idempotency_key,'cancel',payload_doc);
 if found then return query select replay.result_id,replay.result_revision; return; end if;
 select * into current_sale from public.sales s where s.organization_id=p_organization_id and s.store_id=p_store_id and s.id=p_sale_id for update;
 if not found then raise exception 'Sale access denied' using errcode='42501'; end if;
 if current_sale.status<>'confirmed' or current_sale.revision<>p_expected_revision then raise exception 'Sale transition conflict' using errcode='PT409'; end if;
 if current_sale.revision=9223372036854775807 then raise exception 'Sale revision exceeds limit' using errcode='22023'; end if;
 select array_agg(i.variant_id order by i.variant_id) into variants from public.sale_items i where i.organization_id=p_organization_id and i.store_id=p_store_id and i.sale_id=p_sale_id;
 perform private.sales_lock_variants(p_organization_id,p_store_id,variants,false);
 perform private.sales_lock_balances(p_organization_id,p_store_id,variants);
 for item in select * from public.sale_items i where i.organization_id=p_organization_id and i.store_id=p_store_id and i.sale_id=p_sale_id order by i.variant_id loop
  perform private.sales_move(p_organization_id,p_store_id,item.variant_id,item.quantity,p_sale_id,true);
 end loop;
 perform private.sales_result(p_organization_id,p_store_id,p_idempotency_key,'cancel',payload_doc,current_sale.id,current_sale.revision+1);
 update public.sales s set status='cancelled',revision=s.revision+1,cancelled_at=clock_timestamp(),cancellation_reason=reason
  where s.organization_id=p_organization_id and s.store_id=p_store_id and s.id=p_sale_id returning * into current_sale;
 return query select current_sale.id,current_sale.revision;
end;
$$;
revoke all on function private.can_read_sales(uuid,uuid),private.sales_require_write(uuid,uuid,boolean),
 private.sales_replay(uuid,uuid,uuid,text,jsonb),private.sales_result(uuid,uuid,uuid,text,jsonb,uuid,bigint),
 private.sales_reject_change(),private.sales_guard(),private.sales_check_total(),private.sales_item_insert_guard(),private.sales_audit(),
 private.sales_lock_variants(uuid,uuid,uuid[],boolean),private.sales_lock_balances(uuid,uuid,uuid[]),private.sales_move(uuid,uuid,uuid,integer,uuid,boolean)
 from public,anon,authenticated,service_role;
grant execute on function private.can_read_sales(uuid,uuid) to authenticated;
revoke all on function public.sales_variants(uuid,uuid,text,integer,integer),public.sales_list(uuid,uuid,text,text,integer,integer,uuid),
 public.sales_items(uuid,uuid,uuid),public.sales_confirm(uuid,uuid,jsonb,uuid),public.sales_cancel(uuid,uuid,uuid,bigint,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.sales_variants(uuid,uuid,text,integer,integer),public.sales_list(uuid,uuid,text,text,integer,integer,uuid),
 public.sales_items(uuid,uuid,uuid),public.sales_confirm(uuid,uuid,jsonb,uuid),public.sales_cancel(uuid,uuid,uuid,bigint,text,uuid) to authenticated;
commit;
