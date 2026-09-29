begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.stores (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 120), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
-- Identity is global; business authorization lives in organization-scoped memberships.
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=120),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.memberships (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 user_id uuid not null references public.profiles(id),
 role text not null check(role in ('owner','manager','cashier','stockist','buyer','marketing','logistics','driver')),
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,user_id), unique(organization_id,id)
);
create table public.user_store_access (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, membership_id uuid not null, store_id uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(organization_id,membership_id) references public.memberships(organization_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 unique(organization_id,membership_id,store_id)
);
create table public.audit_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), store_id uuid,
 actor_user_id uuid, action text not null, entity_type text not null, entity_id uuid,
 origin text not null, old_value jsonb, new_value jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(organization_id,store_id) references public.stores(organization_id,id)
);
create index memberships_by_user on public.memberships(user_id,organization_id) where active;
create index store_access_by_store on public.user_store_access(organization_id,store_id);
create index audit_by_org_time on public.audit_events(organization_id,created_at desc);
create index audit_by_actor_time on public.audit_events(actor_user_id,created_at desc);

create function private.is_member(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active);
$$;
create function private.can_access_store(p_org uuid,p_store uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_store_access a
 join public.memberships m on m.id=a.membership_id and m.organization_id=a.organization_id
 join public.stores s on s.id=a.store_id and s.organization_id=a.organization_id
 where a.organization_id=p_org and a.store_id=p_store and m.user_id=(select auth.uid()) and m.active and s.active);
$$;
revoke all on function private.is_member(uuid),private.can_access_store(uuid,uuid) from public,anon;
grant execute on function private.is_member(uuid),private.can_access_store(uuid,uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.user_store_access enable row level security;
alter table public.audit_events enable row level security;
revoke all on public.organizations,public.stores,public.profiles,public.memberships,public.user_store_access,public.audit_events from public,anon,authenticated;
grant select on public.organizations,public.stores,public.profiles,public.memberships,public.user_store_access,public.audit_events to authenticated;
-- No direct application writes in Foundation. Administrative provisioning is out-of-band.
grant all on public.organizations,public.stores,public.profiles,public.memberships,public.user_store_access,public.audit_events to service_role;
create policy org_member_read on public.organizations for select to authenticated using(private.is_member(id));
create policy authorized_store_read on public.stores for select to authenticated using(private.can_access_store(organization_id,id));
create policy own_profile_read on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy own_membership_read on public.memberships for select to authenticated using(user_id=(select auth.uid()) and active);
create policy own_store_access_read on public.user_store_access for select to authenticated using(
 private.can_access_store(organization_id,store_id) and exists(select 1 from public.memberships m where m.id=membership_id and m.user_id=(select auth.uid()) and m.active)
);
create policy scoped_audit_read on public.audit_events for select to authenticated using(
 private.is_member(organization_id) and (store_id is null or private.can_access_store(organization_id,store_id))
 and (actor_user_id=(select auth.uid()) or exists(select 1 from public.memberships m where m.organization_id=audit_events.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','manager') and m.active))
);

create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=clock_timestamp(); return new; end; $$;
create function private.audit_foundation() returns trigger language plpgsql security definer set search_path='' as $$
declare doc jsonb; org uuid; unit uuid;
begin
 doc=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 org=case when tg_table_name='organizations' then (doc->>'id')::uuid else (doc->>'organization_id')::uuid end;
 unit=case when tg_table_name='stores' then (doc->>'id')::uuid when tg_table_name='user_store_access' then (doc->>'store_id')::uuid else null end;
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,old_value,new_value)
 values(org,unit,auth.uid(),lower(tg_op),tg_table_name,(doc->>'id')::uuid,'database',case when tg_op<>'INSERT' then to_jsonb(old) else null end,case when tg_op<>'DELETE' then to_jsonb(new) else null end);
 return null;
end; $$;
create function private.reject_audit_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Audit events are append-only' using errcode='42501'; end; $$;
create trigger audit_immutable before update or delete on public.audit_events for each row execute function private.reject_audit_change();
create trigger audit_no_truncate before truncate on public.audit_events for each statement execute function private.reject_audit_change();
do $$ declare tbl text; begin
 foreach tbl in array array['organizations','stores','profiles','memberships','user_store_access'] loop
 execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',tbl);
 end loop;
 foreach tbl in array array['organizations','stores','memberships','user_store_access'] loop
 execute format('create trigger foundation_audit after insert or update or delete on public.%I for each row execute function private.audit_foundation()',tbl);
 end loop;
end $$;
-- Fixed operation and server-derived actor; never accept arbitrary audit payloads.
create function public.set_active_store(p_organization_id uuid,p_store_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
 if not private.can_access_store(p_organization_id,p_store_id) then raise exception 'Store access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select new_value into previous from public.audit_events where actor_user_id=auth.uid() and action='context.selected' order by created_at desc,id desc limit 1;
 if previous=jsonb_build_object('organization_id',p_organization_id,'store_id',p_store_id) then return; end if;
 -- Never copy another organization's identifiers into this organization's audit stream.
 if previous->>'organization_id' is distinct from p_organization_id::text then previous=null; end if;
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,old_value,new_value)
 values(p_organization_id,p_store_id,auth.uid(),'context.selected','stores',p_store_id,'web',previous,jsonb_build_object('organization_id',p_organization_id,'store_id',p_store_id));
end; $$;
revoke all on function public.set_active_store(uuid,uuid) from public,anon;
grant execute on function public.set_active_store(uuid,uuid) to authenticated;
revoke all on function private.touch_updated_at(),private.audit_foundation(),private.reject_audit_change() from public,anon,authenticated;
commit;
