-- Pacote 007: manual counter/WhatsApp orders, fulfilled through the existing sale core.
begin;

create table public.orders (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 store_id uuid not null, actor_user_id uuid not null references public.profiles(id),
 channel text not null check(channel in ('counter','whatsapp')),
 customer_id uuid, customer_name_snapshot text,
 status text not null default 'open' check(status in ('open','fulfilled','cancelled')),
 revision bigint not null default 1 check(revision>0),
 item_count integer not null check(item_count between 1 and 50),
 total_cents bigint not null check(total_cents between 0 and 1000000000000),
 sale_id uuid unique, created_at timestamptz not null default clock_timestamp(),
 fulfilled_at timestamptz, cancelled_at timestamptz, cancellation_reason text,
 unique(organization_id,store_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,customer_id) references public.customers(organization_id,id),
 foreign key(organization_id,store_id,sale_id) references public.sales(organization_id,store_id,id),
 check((customer_id is null and customer_name_snapshot is null and channel='counter') or
  (customer_id is not null and customer_name_snapshot is not null and
   char_length(customer_name_snapshot) between 2 and 120)),
 check((status='open' and sale_id is null and fulfilled_at is null and cancelled_at is null and cancellation_reason is null)
  or (status='fulfilled' and sale_id is not null and fulfilled_at is not null and cancelled_at is null and cancellation_reason is null)
  or (status='cancelled' and sale_id is null and fulfilled_at is null and cancelled_at is not null and
   cancellation_reason is not null and char_length(cancellation_reason) between 3 and 240 and
   cancellation_reason=private.catalog_trim(cancellation_reason)))
);
create index orders_by_store on public.orders(organization_id,store_id,created_at desc,id desc);
create table public.order_items (
 organization_id uuid not null, store_id uuid not null, order_id uuid not null, variant_id uuid not null,
 product_name text not null, sku text not null,
 quantity integer not null check(quantity between 1 and 1000000),
 unit_price_cents bigint not null check(unit_price_cents between 0 and 999999999999),
 primary key(organization_id,store_id,order_id,variant_id),
 foreign key(organization_id,store_id,order_id) references public.orders(organization_id,store_id,id),
 foreign key(organization_id,variant_id) references public.product_variants(organization_id,id)
);
create table private.orders_requests (
 organization_id uuid not null, store_id uuid not null, actor_user_id uuid not null references public.profiles(id),
 idempotency_key uuid not null, operation text not null check(operation in ('create','cancel','fulfill')),
 payload jsonb not null, result_id uuid not null, result_revision bigint not null check(result_revision>0),
 result_sale_id uuid, created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,store_id,actor_user_id,idempotency_key),
 foreign key(organization_id,store_id,result_id) references public.orders(organization_id,store_id,id),
 foreign key(organization_id,store_id,result_sale_id) references public.sales(organization_id,store_id,id),
 check((operation='fulfill' and result_sale_id is not null) or (operation<>'fulfill' and result_sale_id is null))
);

create function private.can_read_orders(p_org uuid,p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.can_read_sales(p_org,p_store);
$$;
create function private.orders_require_write(p_org uuid,p_store uuid,p_cancel boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.sales_require_write(p_org,p_store,p_cancel);
end;
$$;
create function private.orders_replay(p_org uuid,p_store uuid,p_key uuid,p_operation text,p_payload jsonb)
returns table(result_id uuid,result_revision bigint,result_sale_id uuid)
language plpgsql security definer set search_path='' as $$
declare previous private.orders_requests%rowtype;
begin
 if p_key is null then raise exception 'Order idempotency key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('orders:'||p_org::text||':'||p_store::text||':'||auth.uid()::text||':'||p_key::text,0));
 select * into previous from private.orders_requests r where r.organization_id=p_org and r.store_id=p_store
  and r.actor_user_id=auth.uid() and r.idempotency_key=p_key;
 if found then
  if previous.operation<>p_operation or previous.payload is distinct from p_payload then
   raise exception 'Order idempotency conflict' using errcode='PT409'; end if;
  return query select previous.result_id,previous.result_revision,previous.result_sale_id;
 end if;
end;
$$;
create function private.orders_result(p_org uuid,p_store uuid,p_key uuid,p_operation text,p_payload jsonb,
 p_id uuid,p_revision bigint,p_sale_id uuid) returns void
language sql security definer set search_path='' as $$
 insert into private.orders_requests(organization_id,store_id,actor_user_id,idempotency_key,operation,payload,
  result_id,result_revision,result_sale_id)
 values(p_org,p_store,auth.uid(),p_key,p_operation,p_payload,p_id,p_revision,p_sale_id);
$$;
create function private.orders_reject_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Order history is immutable' using errcode='42501'; end;
$$;
create function private.orders_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare transition_operation text; expected_payload jsonb;
begin
 if old.status<>'open' then raise exception 'Terminal order is immutable' using errcode='42501'; end if;
 if (to_jsonb(new)-'status'-'revision'-'sale_id'-'fulfilled_at'-'cancelled_at'-'cancellation_reason') is distinct from
  (to_jsonb(old)-'status'-'revision'-'sale_id'-'fulfilled_at'-'cancelled_at'-'cancellation_reason') then
  raise exception 'Order snapshots are immutable' using errcode='23514'; end if;
 if old.revision=9223372036854775807 or new.revision<>old.revision+1 or new.status not in ('cancelled','fulfilled') then
  raise exception 'Order transition conflict' using errcode='PT409'; end if;
 transition_operation=case when new.status='fulfilled' then 'fulfill' else 'cancel' end;
 expected_payload=case when transition_operation='fulfill' then
  jsonb_build_object('order_id',old.id,'expected_revision',old.revision)
  else jsonb_build_object('order_id',old.id,'expected_revision',old.revision,'reason',new.cancellation_reason) end;
 if not exists(select 1 from private.orders_requests r where r.organization_id=old.organization_id and r.store_id=old.store_id
  and r.result_id=old.id and r.operation=transition_operation and r.result_revision=new.revision
  and r.result_sale_id is not distinct from new.sale_id and r.actor_user_id=auth.uid() and r.payload=expected_payload) then
  raise exception 'Order transition operation required' using errcode='42501'; end if;
 return new;
end;
$$;
create function private.orders_item_insert_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.orders o where o.organization_id=new.organization_id and o.store_id=new.store_id
  and o.id=new.order_id and o.status='open' and not exists(select 1 from private.orders_requests r
   where r.organization_id=o.organization_id and r.store_id=o.store_id and r.result_id=o.id)) then
  raise exception 'Order snapshots already sealed' using errcode='42501'; end if;
 return new;
end;
$$;
create function private.orders_check_total() returns trigger language plpgsql security definer set search_path='' as $$
declare target_id uuid; expected_count integer; expected_total bigint; actual_count bigint; actual_total numeric;
begin
 target_id=(to_jsonb(new)->>case when tg_table_name='orders' then 'id' else 'order_id' end)::uuid;
 select o.item_count,o.total_cents into expected_count,expected_total from public.orders o
  where o.organization_id=new.organization_id and o.store_id=new.store_id and o.id=target_id;
 select count(*),coalesce(sum(i.quantity::numeric*i.unit_price_cents),0) into actual_count,actual_total
  from public.order_items i where i.organization_id=new.organization_id and i.store_id=new.store_id and i.order_id=target_id;
 if actual_count<>expected_count or actual_total<>expected_total then
  raise exception 'Order lines or total mismatch' using errcode='23514'; end if;
 return null;
end;
$$;
create function private.orders_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,old_value,new_value)
 values(new.organization_id,new.store_id,auth.uid(),lower(tg_op),tg_table_name,
  (to_jsonb(new)->>case when tg_table_name='orders' then 'id' else 'order_id' end)::uuid,'database',
  case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return null;
end;
$$;
create trigger orders_guard before update on public.orders for each row execute function private.orders_guard();
create trigger orders_no_delete before delete on public.orders for each row execute function private.orders_reject_change();
create trigger orders_no_truncate before truncate on public.orders for each statement execute function private.orders_reject_change();
create trigger order_item_insert_guard before insert on public.order_items for each row execute function private.orders_item_insert_guard();
create constraint trigger order_total after insert or update on public.orders deferrable initially deferred
 for each row execute function private.orders_check_total();
create constraint trigger order_item_total after insert on public.order_items deferrable initially deferred
 for each row execute function private.orders_check_total();
do $$ declare tbl text; begin
 foreach tbl in array array['public.order_items','private.orders_requests'] loop
  execute format('create trigger orders_immutable before update or delete on %s for each row execute function private.orders_reject_change()',tbl);
  execute format('create trigger orders_no_truncate before truncate on %s for each statement execute function private.orders_reject_change()',tbl);
 end loop;
 foreach tbl in array array['orders','order_items'] loop
  execute format('create trigger orders_audit after insert or update on public.%I for each row execute function private.orders_audit()',tbl);
 end loop;
end $$;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table private.orders_requests enable row level security;
revoke all on public.orders,public.order_items,private.orders_requests from public,anon,authenticated,service_role;
grant select on public.orders,public.order_items to authenticated,service_role;
create policy orders_read on public.orders for select to authenticated using(private.can_read_orders(organization_id,store_id));
create policy order_items_read on public.order_items for select to authenticated using(private.can_read_orders(organization_id,store_id));
create policy orders_audit_scope on public.audit_events as restrictive for select to authenticated using(
 entity_type not in ('orders','order_items','orders_requests') or
 (store_id is not null and private.can_read_orders(organization_id,store_id)));

create function public.orders_list(p_organization_id uuid,p_store_id uuid,p_status text,p_limit integer,p_offset integer,
 p_order_id uuid default null)
returns table(id uuid,channel text,status text,revision bigint,customer_id uuid,customer_name_snapshot text,
 item_count integer,total_cents bigint,created_at timestamptz,fulfilled_at timestamptz,cancelled_at timestamptz,
 cancellation_reason text,sale_id uuid,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_orders(p_organization_id,p_store_id) then raise exception 'Order access denied' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 or
  p_status is null or p_status not in ('all','open','fulfilled','cancelled') then
  raise exception 'Invalid order pagination' using errcode='22023'; end if;
 return query select o.id,o.channel,o.status,o.revision,o.customer_id,o.customer_name_snapshot,o.item_count,
  o.total_cents,o.created_at,o.fulfilled_at,o.cancelled_at,o.cancellation_reason,o.sale_id,count(*) over()
 from public.orders o where o.organization_id=p_organization_id and o.store_id=p_store_id
  and (p_order_id is null or o.id=p_order_id) and (p_status='all' or o.status=p_status)
 order by o.created_at desc,o.id desc limit p_limit offset p_offset;
end;
$$;
create function public.orders_items(p_organization_id uuid,p_store_id uuid,p_order_id uuid)
returns table(variant_id uuid,product_name text,sku text,quantity integer,unit_price_cents bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_orders(p_organization_id,p_store_id) or not exists(select 1 from public.orders o
  where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=p_order_id) then
  raise exception 'Order access denied' using errcode='42501'; end if;
 return query select i.variant_id,i.product_name,i.sku,i.quantity,i.unit_price_cents from public.order_items i
  where i.organization_id=p_organization_id and i.store_id=p_store_id and i.order_id=p_order_id order by i.variant_id;
end;
$$;
create function public.orders_create(p_organization_id uuid,p_store_id uuid,p_channel text,p_customer_id uuid,
 p_items jsonb,p_idempotency_key uuid)
returns table(id uuid,revision bigint,sale_id uuid) language plpgsql security definer set search_path='' as $$
declare replay record; payload_doc jsonb; normalized_items jsonb='[]'; item jsonb; variant uuid;
 variants uuid[]='{}'; amount integer; price bigint; total numeric=0; actual_price bigint;
 customer_name text; customer_phone text; customer_active boolean; created public.orders%rowtype;
begin
 perform private.orders_require_write(p_organization_id,p_store_id,false);
 if p_channel is null or p_channel not in ('counter','whatsapp') or
  (p_channel='whatsapp' and p_customer_id is null) then
  raise exception 'Invalid order channel or customer' using errcode='22023'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then
  raise exception 'Invalid order lines' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>3 or
   jsonb_typeof(item->'variant_id') is distinct from 'string' or
   jsonb_typeof(item->'quantity') is distinct from 'number' or
   jsonb_typeof(item->'expected_unit_price_cents') is distinct from 'number' or
   (item->>'quantity') !~ '^[0-9]{1,7}$' or
   (item->>'expected_unit_price_cents') !~ '^[0-9]{1,12}$' then
   raise exception 'Invalid order line' using errcode='22023'; end if;
  begin variant=(item->>'variant_id')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid order variant' using errcode='22023'; end;
  amount=(item->>'quantity')::integer; price=(item->>'expected_unit_price_cents')::bigint;
  if amount not between 1 and 1000000 or price not between 0 and 999999999999 or variant=any(variants) then
   raise exception 'Invalid order quantity, price or duplicate variant' using errcode='22023'; end if;
  variants=array_append(variants,variant); total=total+amount::numeric*price;
  if total>1000000000000 then raise exception 'Order total exceeds limit' using errcode='22023'; end if;
  normalized_items=normalized_items||jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',amount,
   'expected_unit_price_cents',price));
 end loop;
 select jsonb_agg(value order by (value->>'variant_id')::uuid) into normalized_items from jsonb_array_elements(normalized_items);
 payload_doc=jsonb_build_object('channel',p_channel,'customer_id',p_customer_id,'items',normalized_items);
 select * into replay from private.orders_replay(p_organization_id,p_store_id,p_idempotency_key,'create',payload_doc);
 if found then return query select replay.result_id,replay.result_revision,replay.result_sale_id; return; end if;
 if p_customer_id is not null then
  select c.name,c.phone,c.active into customer_name,customer_phone,customer_active from public.customers c
   where c.organization_id=p_organization_id and c.id=p_customer_id for share;
  if not found or not customer_active or (p_channel='whatsapp' and customer_phone is null) then
   raise exception 'Active order customer with phone required for WhatsApp' using errcode='22023'; end if;
 end if;
 perform private.sales_lock_variants(p_organization_id,p_store_id,variants,true);
 for item in select value from jsonb_array_elements(normalized_items) loop
  select (pp.amount*100)::bigint into actual_price from public.product_prices pp where pp.organization_id=p_organization_id
   and pp.store_id=p_store_id and pp.variant_id=(item->>'variant_id')::uuid;
  if not found then raise exception 'Order store price required' using errcode='22023'; end if;
  if actual_price<>(item->>'expected_unit_price_cents')::bigint then
   raise exception 'Order price conflict' using errcode='PT409'; end if;
 end loop;
 insert into public.orders(organization_id,store_id,actor_user_id,channel,customer_id,customer_name_snapshot,item_count,total_cents)
 values(p_organization_id,p_store_id,auth.uid(),p_channel,p_customer_id,customer_name,cardinality(variants),total::bigint)
 returning * into created;
 insert into public.order_items(organization_id,store_id,order_id,variant_id,product_name,sku,quantity,unit_price_cents)
 select p_organization_id,p_store_id,created.id,v.id,p.name,v.sku,(x.value->>'quantity')::integer,
  (x.value->>'expected_unit_price_cents')::bigint from jsonb_array_elements(normalized_items) x
 join public.product_variants v on v.organization_id=p_organization_id and v.id=(x.value->>'variant_id')::uuid
 join public.products p on p.organization_id=v.organization_id and p.id=v.product_id order by v.id;
 perform private.orders_result(p_organization_id,p_store_id,p_idempotency_key,'create',payload_doc,created.id,created.revision,null);
 return query select created.id,created.revision,created.sale_id;
end;
$$;
create function public.orders_cancel(p_organization_id uuid,p_store_id uuid,p_order_id uuid,
 p_expected_revision bigint,p_reason text,p_idempotency_key uuid)
returns table(id uuid,revision bigint,sale_id uuid) language plpgsql security definer set search_path='' as $$
declare replay record; payload_doc jsonb; reason text=private.catalog_trim(p_reason); current_order public.orders%rowtype;
begin
 perform private.orders_require_write(p_organization_id,p_store_id,true);
 if p_order_id is null or p_expected_revision is null or p_expected_revision<1 or
  reason is null or char_length(reason) not between 3 and 240 then
  raise exception 'Invalid order cancellation' using errcode='22023'; end if;
 payload_doc=jsonb_build_object('order_id',p_order_id,'expected_revision',p_expected_revision,'reason',reason);
 select * into replay from private.orders_replay(p_organization_id,p_store_id,p_idempotency_key,'cancel',payload_doc);
 if found then return query select replay.result_id,replay.result_revision,replay.result_sale_id; return; end if;
 select * into current_order from public.orders o where o.organization_id=p_organization_id and o.store_id=p_store_id
  and o.id=p_order_id for update;
 if not found then raise exception 'Order access denied' using errcode='42501'; end if;
 if current_order.status<>'open' or current_order.revision<>p_expected_revision then
  raise exception 'Order transition conflict' using errcode='PT409'; end if;
 if current_order.revision=9223372036854775807 then raise exception 'Order revision exceeds limit' using errcode='22023'; end if;
 perform private.orders_result(p_organization_id,p_store_id,p_idempotency_key,'cancel',payload_doc,
  current_order.id,current_order.revision+1,null);
 update public.orders o set status='cancelled',revision=o.revision+1,cancelled_at=clock_timestamp(),cancellation_reason=reason
  where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=p_order_id returning * into current_order;
 return query select current_order.id,current_order.revision,current_order.sale_id;
end;
$$;
create function public.orders_fulfill(p_organization_id uuid,p_store_id uuid,p_order_id uuid,
 p_expected_revision bigint,p_idempotency_key uuid)
returns table(id uuid,revision bigint,sale_id uuid) language plpgsql security definer set search_path='' as $$
declare replay record; payload_doc jsonb; sale_lines jsonb; customer_active boolean;
 current_order public.orders%rowtype; created_sale record;
begin
 perform private.orders_require_write(p_organization_id,p_store_id,false);
 if p_order_id is null or p_expected_revision is null or p_expected_revision<1 then
  raise exception 'Invalid order fulfillment' using errcode='22023'; end if;
 payload_doc=jsonb_build_object('order_id',p_order_id,'expected_revision',p_expected_revision);
 select * into replay from private.orders_replay(p_organization_id,p_store_id,p_idempotency_key,'fulfill',payload_doc);
 if found then return query select replay.result_id,replay.result_revision,replay.result_sale_id; return; end if;
 -- This lock precedes customer, catalog/price and balance locks acquired by sales_confirm_core.
 select * into current_order from public.orders o where o.organization_id=p_organization_id and o.store_id=p_store_id
  and o.id=p_order_id for update;
 if not found then raise exception 'Order access denied' using errcode='42501'; end if;
 if current_order.status<>'open' or current_order.revision<>p_expected_revision then
  raise exception 'Order transition conflict' using errcode='PT409'; end if;
 if current_order.revision=9223372036854775807 then raise exception 'Order revision exceeds limit' using errcode='22023'; end if;
 if current_order.customer_id is not null then
  select c.active into customer_active from public.customers c
   where c.organization_id=p_organization_id and c.id=current_order.customer_id for share;
  if not found or not customer_active then raise exception 'Active order customer required' using errcode='22023'; end if;
 end if;
 select jsonb_agg(jsonb_build_object('variant_id',i.variant_id,'quantity',i.quantity,
  'expected_unit_price_cents',i.unit_price_cents) order by i.variant_id) into sale_lines
 from public.order_items i where i.organization_id=p_organization_id and i.store_id=p_store_id and i.order_id=p_order_id;
 -- An internal sale key avoids binding this order to a pre-existing direct sale
 -- when an operator reuses the same external attempt UUID across workflows.
 select * into created_sale from private.sales_confirm_core(p_organization_id,p_store_id,sale_lines,
  current_order.customer_id,gen_random_uuid());
 perform private.orders_result(p_organization_id,p_store_id,p_idempotency_key,'fulfill',payload_doc,
  current_order.id,current_order.revision+1,created_sale.id);
 update public.orders o set status='fulfilled',revision=o.revision+1,sale_id=created_sale.id,fulfilled_at=clock_timestamp()
  where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=p_order_id returning * into current_order;
 return query select current_order.id,current_order.revision,current_order.sale_id;
end;
$$;

revoke all on function private.can_read_orders(uuid,uuid),private.orders_require_write(uuid,uuid,boolean),
 private.orders_replay(uuid,uuid,uuid,text,jsonb),private.orders_result(uuid,uuid,uuid,text,jsonb,uuid,bigint,uuid),
 private.orders_reject_change(),private.orders_guard(),private.orders_item_insert_guard(),private.orders_check_total(),
 private.orders_audit() from public,anon,authenticated,service_role;
grant execute on function private.can_read_orders(uuid,uuid) to authenticated;
revoke all on function public.orders_list(uuid,uuid,text,integer,integer,uuid),public.orders_items(uuid,uuid,uuid),
 public.orders_create(uuid,uuid,text,uuid,jsonb,uuid),public.orders_cancel(uuid,uuid,uuid,bigint,text,uuid),
 public.orders_fulfill(uuid,uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.orders_list(uuid,uuid,text,integer,integer,uuid),public.orders_items(uuid,uuid,uuid),
 public.orders_create(uuid,uuid,text,uuid,jsonb,uuid),public.orders_cancel(uuid,uuid,uuid,bigint,text,uuid),
 public.orders_fulfill(uuid,uuid,uuid,bigint,uuid) to authenticated;
commit;
