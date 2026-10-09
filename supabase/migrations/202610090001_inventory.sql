-- Pacote 003: manual inventory. Incremental; no hosted execution authorized.
begin;

create table public.inventory_balances (
 organization_id uuid not null references public.organizations(id),
 store_id uuid not null, variant_id uuid not null,
 quantity integer not null default 0 check(quantity>=0),
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default now(),
 primary key(organization_id,store_id,variant_id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,variant_id) references public.product_variants(organization_id,id)
);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 store_id uuid not null, variant_id uuid not null,
 actor_user_id uuid not null references public.profiles(id),
 idempotency_key uuid not null, kind text not null check(kind in ('entry','exit')),
 quantity integer not null check(quantity between 1 and 1000000),
 reason text not null check(char_length(reason) between 3 and 240 and reason=private.catalog_trim(reason)),
 expected_revision bigint not null check(expected_revision>=0),
 revision_after bigint not null check(revision_after>0),
 balance_after integer not null check(balance_after>=0),
 created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,store_id,actor_user_id,idempotency_key),
 foreign key(organization_id,store_id,variant_id)
  references public.inventory_balances(organization_id,store_id,variant_id),
 check(revision_after=expected_revision+1)
);
create index inventory_history_by_variant on public.inventory_movements
 (organization_id,store_id,variant_id,created_at desc,id desc);

create function private.can_read_inventory(p_org uuid,p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active
 and m.role in ('owner','manager','stockist','cashier','buyer') and a.store_id=p_store and s.active);
$$;
revoke all on function private.can_read_inventory(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_read_inventory(uuid,uuid) to authenticated;

-- Row locks make authorization/deactivation linearizable with each mutation:
-- revocation either precedes this check or waits until the transaction completes.
create function private.inventory_require_write(p_org uuid,p_store uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Inventory access denied' using errcode='42501'; end if;
 perform m.id from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.active
 and m.role in ('owner','manager','stockist') and a.store_id=p_store and s.active
 for share of m,a,s;
 if not found then raise exception 'Inventory access denied' using errcode='42501'; end if;
end;
$$;
revoke all on function private.inventory_require_write(uuid,uuid) from public,anon,authenticated,service_role;

create function private.inventory_balance_keys() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.organization_id,new.store_id,new.variant_id) is distinct from
  (old.organization_id,old.store_id,old.variant_id) then
  raise exception 'Inventory structural keys are immutable' using errcode='23514';
 end if;
 return new;
end;
$$;
create function private.inventory_reject_history_change() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Inventory movements are append-only' using errcode='42501';
end;
$$;
create function private.inventory_audit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,
  origin,old_value,new_value)
 values(new.organization_id,new.store_id,new.actor_user_id,'inventory.'||new.kind,
  'inventory_movements',new.id,'database',null,to_jsonb(new));
 return null;
end;
$$;
revoke all on function private.inventory_balance_keys(),private.inventory_reject_history_change(),
 private.inventory_audit() from public,anon,authenticated,service_role;
create trigger inventory_balance_keys before update on public.inventory_balances
 for each row execute function private.inventory_balance_keys();
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
 for each row execute function private.inventory_reject_history_change();
create trigger inventory_movements_no_truncate before truncate on public.inventory_movements
 for each statement execute function private.inventory_reject_history_change();
create trigger inventory_movement_audit after insert on public.inventory_movements
 for each row execute function private.inventory_audit();

alter table public.inventory_balances enable row level security;
alter table public.inventory_movements enable row level security;
-- Even service_role has no direct inventory DML. Only the scoped RPC mutates it.
revoke all on public.inventory_balances,public.inventory_movements from public,anon,authenticated,service_role;
grant select on public.inventory_balances,public.inventory_movements to authenticated,service_role;
create policy inventory_balance_read on public.inventory_balances for select to authenticated
 using(private.can_read_inventory(organization_id,store_id));
create policy inventory_movement_read on public.inventory_movements for select to authenticated
 using(private.can_read_inventory(organization_id,store_id));

-- Keep all existing Foundation/Catalog visibility rules. Inventory audit requires
-- its own live role and store grant, even for the actor of the historical event.
drop policy scoped_audit_read on public.audit_events;
create policy scoped_audit_read on public.audit_events for select to authenticated using(
 private.is_member(organization_id)
 and (store_id is null or private.can_access_store(organization_id,store_id))
 and (actor_user_id=(select auth.uid()) or exists(select 1 from public.memberships m
   where m.organization_id=audit_events.organization_id and m.user_id=(select auth.uid())
   and m.role in ('owner','manager') and m.active))
 and (entity_type not in ('product_categories','products','product_variants','product_prices',
   'product_images','catalog_image_objects') or private.can_read_catalog(organization_id))
 and (entity_type not in ('inventory_balances','inventory_movements')
   or private.can_read_inventory(organization_id,store_id))
);

create function public.inventory_stock(p_organization_id uuid,p_store_id uuid,p_query text,
 p_limit integer,p_offset integer,p_variant_id uuid default null)
returns table(variant_id uuid,product_name text,sku text,color text,size text,active boolean,
 quantity integer,revision bigint,total_count bigint)
language plpgsql stable security invoker set search_path='' as $$
declare term text;
begin
 if not private.can_read_inventory(p_organization_id,p_store_id) then
  raise exception 'Inventory access denied' using errcode='42501'; end if;
 term=coalesce(private.catalog_trim(p_query),'');
 if char_length(term)>200 or p_limit is null or p_limit not between 1 and 100
  or p_offset is null or p_offset<0 then
  raise exception 'Invalid inventory pagination' using errcode='22023'; end if;
 return query select v.id,p.name,v.sku,v.color,v.size,p.active and v.active,
  coalesce(b.quantity,0),coalesce(b.revision,0::bigint),count(*) over()
 from public.product_variants v join public.products p
  on p.organization_id=v.organization_id and p.id=v.product_id
 left join public.inventory_balances b on b.organization_id=v.organization_id
  and b.store_id=p_store_id and b.variant_id=v.id
 where v.organization_id=p_organization_id and (p_variant_id is null or v.id=p_variant_id)
 and (term='' or strpos(lower(p.name),lower(term))>0 or strpos(lower(v.sku),lower(term))>0)
 order by p.name,v.sku,v.id limit p_limit offset p_offset;
end;
$$;

create function public.inventory_history(p_organization_id uuid,p_store_id uuid,p_variant_id uuid,
 p_limit integer,p_offset integer)
returns table(id uuid,kind text,quantity integer,reason text,balance_after integer,
 created_at timestamptz,total_count bigint)
language plpgsql stable security invoker set search_path='' as $$
begin
 if not private.can_read_inventory(p_organization_id,p_store_id) then
  raise exception 'Inventory access denied' using errcode='42501'; end if;
 if p_variant_id is null or p_limit is null or p_limit not between 1 and 100
  or p_offset is null or p_offset<0 then
  raise exception 'Invalid inventory history pagination' using errcode='22023'; end if;
 if not exists(select 1 from public.product_variants v where v.organization_id=p_organization_id
  and v.id=p_variant_id) then
  raise exception 'Inventory variant access denied' using errcode='42501'; end if;
 return query select m.id,m.kind,m.quantity,m.reason,m.balance_after,m.created_at,count(*) over()
 from public.inventory_movements m where m.organization_id=p_organization_id
  and m.store_id=p_store_id and m.variant_id=p_variant_id
 order by m.created_at desc,m.id desc limit p_limit offset p_offset;
end;
$$;

create function public.inventory_move(p_organization_id uuid,p_store_id uuid,p_variant_id uuid,
 p_kind text,p_quantity integer,p_reason text,p_expected_revision bigint,p_idempotency_key uuid)
returns table(id uuid,revision bigint,quantity integer)
language plpgsql security definer set search_path='' as $$
declare normalized_reason text; original public.inventory_movements%rowtype;
 current_balance public.inventory_balances%rowtype; created public.inventory_movements%rowtype;
 parent_id uuid; product_active boolean; variant_active boolean; resulting_quantity bigint;
begin
 perform private.inventory_require_write(p_organization_id,p_store_id);
 normalized_reason=private.catalog_trim(p_reason);
 if p_variant_id is null or p_kind is null or p_kind not in ('entry','exit')
  or p_quantity is null or p_quantity not between 1 and 1000000
  or normalized_reason is null or char_length(normalized_reason) not between 3 and 240
  or p_expected_revision is null or p_expected_revision<0 or p_idempotency_key is null then
  raise exception 'Invalid inventory movement' using errcode='22023'; end if;

 -- Separate lock namespace from Catalog. Serializes one actor/key even when
 -- its conflicting payload points at a different variant (and balance lock).
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_organization_id::text||':'||
  p_store_id::text||':'||auth.uid()::text||':'||p_idempotency_key::text,0));
 select * into original from public.inventory_movements m
 where m.organization_id=p_organization_id and m.store_id=p_store_id
  and m.actor_user_id=auth.uid() and m.idempotency_key=p_idempotency_key;
 if found then
  if (original.variant_id,original.kind,original.quantity,original.reason,original.expected_revision)
   is distinct from (p_variant_id,p_kind,p_quantity,normalized_reason,p_expected_revision) then
   raise exception 'Inventory idempotency conflict' using errcode='PT409'; end if;
  return query select original.id,original.revision_after,original.balance_after; return;
 end if;

 select v.product_id into parent_id from public.product_variants v
 where v.organization_id=p_organization_id and v.id=p_variant_id;
 if not found then raise exception 'Inventory variant access denied' using errcode='42501'; end if;
 -- Catalog RPCs lock parent before variant; retain that order to avoid inversions.
 select p.active into product_active from public.products p
 where p.organization_id=p_organization_id and p.id=parent_id for share;
 select v.active into variant_active from public.product_variants v
 where v.organization_id=p_organization_id and v.product_id=parent_id and v.id=p_variant_id for share;
 if not found then raise exception 'Inventory variant access denied' using errcode='42501'; end if;
 if not coalesce(product_active,false) or not variant_active then
  raise exception 'Active inventory product and variant required' using errcode='22023'; end if;

 -- A missing balance must also serialize. ON CONFLICT waits for its concurrent
 -- first inserter, then FOR UPDATE reads the committed revision under READ COMMITTED.
 insert into public.inventory_balances(organization_id,store_id,variant_id)
 values(p_organization_id,p_store_id,p_variant_id) on conflict do nothing;
 select * into current_balance from public.inventory_balances b
 where b.organization_id=p_organization_id and b.store_id=p_store_id and b.variant_id=p_variant_id for update;
 if current_balance.revision is distinct from p_expected_revision then
  raise exception 'Inventory revision conflict' using errcode='PT409'; end if;
 resulting_quantity=current_balance.quantity::bigint+case when p_kind='entry' then p_quantity else -p_quantity end;
 if resulting_quantity<0 then raise exception 'Insufficient inventory balance' using errcode='PT422'; end if;
 if resulting_quantity>2147483647 or current_balance.revision=9223372036854775807 then
  raise exception 'Inventory balance or revision exceeds limit' using errcode='22023'; end if;
 update public.inventory_balances b set quantity=resulting_quantity::integer,
  revision=b.revision+1,updated_at=clock_timestamp()
 where b.organization_id=p_organization_id and b.store_id=p_store_id and b.variant_id=p_variant_id;
 insert into public.inventory_movements(organization_id,store_id,variant_id,actor_user_id,
  idempotency_key,kind,quantity,reason,expected_revision,revision_after,balance_after)
 values(p_organization_id,p_store_id,p_variant_id,auth.uid(),p_idempotency_key,p_kind,p_quantity,
  normalized_reason,p_expected_revision,current_balance.revision+1,resulting_quantity::integer)
 returning * into created;
 return query select created.id,created.revision_after,created.balance_after;
end;
$$;
revoke all on function public.inventory_stock(uuid,uuid,text,integer,integer,uuid),
 public.inventory_history(uuid,uuid,uuid,integer,integer),
 public.inventory_move(uuid,uuid,uuid,text,integer,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_stock(uuid,uuid,text,integer,integer,uuid),
 public.inventory_history(uuid,uuid,uuid,integer,integer),
 public.inventory_move(uuid,uuid,uuid,text,integer,text,bigint,uuid) to authenticated;
commit;
