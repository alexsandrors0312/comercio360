-- Package009: authorized administration. No Auth administration or direct web DML.
begin;
alter table public.organizations add column revision bigint not null default 1 check(revision>0);
alter table public.stores add column revision bigint not null default 1 check(revision>0);
alter table public.memberships add column revision bigint not null default 1 check(revision>0);

create table private.settings_attempts (
 actor_id uuid not null references auth.users(id), key uuid not null,
 organization_id uuid not null references public.organizations(id), request jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(actor_id,key)
);
create table private.settings_invitations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 email text not null, role text not null check(role in ('owner','manager','cashier','stockist','buyer','marketing','logistics','driver')),
 code_hash text not null unique, created_by uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','accepted','revoked')),
 accepted_by uuid references public.profiles(id), revision bigint not null default 1 check(revision>0),
 expires_at timestamptz not null default now()+interval '7 days', created_at timestamptz not null default now(),
 unique(organization_id,id)
);
create table private.settings_invitation_stores (
 organization_id uuid not null, invitation_id uuid not null, store_id uuid not null,
 primary key(organization_id,invitation_id,store_id),
 foreign key(organization_id,invitation_id) references private.settings_invitations(organization_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id)
);
alter table private.settings_attempts enable row level security;
alter table private.settings_invitations enable row level security;
alter table private.settings_invitation_stores enable row level security;
revoke all on private.settings_attempts,private.settings_invitations,private.settings_invitation_stores from public,anon,authenticated;

create function private.settings_identity() returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users u where u.id=auth.uid() and u.email is not null
  and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)) then
  raise exception 'Verified identity required' using errcode='42501';
 end if;
 return auth.uid();
end $$;
create function private.settings_name(p_name text) returns text language plpgsql set search_path='' as $$
begin
 if p_name is null or length(trim(p_name)) not between 1 and 120 or p_name ~ '[[:cntrl:]]' then
  raise exception 'Invalid name' using errcode='22023';
 end if; return trim(p_name);
end $$;
create function private.settings_owner(p_org uuid,p_store uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_member uuid;
begin
 select m.id into v_member from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.active and m.role='owner' and s.id=p_store and s.active
 for share of m,a,s;
 if v_member is null then raise exception 'Administration denied' using errcode='42501'; end if;
 return v_member;
end $$;
create function private.settings_replay(p_actor uuid,p_key uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_attempt private.settings_attempts;
begin
 if p_key is null then raise exception 'Key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('settings-key:'||p_actor::text||p_key::text,0));
 select * into v_attempt from private.settings_attempts where actor_id=p_actor and key=p_key;
 if found then
  if v_attempt.request is distinct from p_request then raise exception 'Attempt conflict' using errcode='PT409'; end if;
  return v_attempt.result;
 end if; return null;
end $$;
create function public.settings_onboard(p_name text,p_store_name text,p_display_name text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid; v_store uuid; v_member uuid; v_request jsonb; v_result jsonb;
begin
 v_actor=private.settings_identity();
 p_name=private.settings_name(p_name); p_store_name=private.settings_name(p_store_name); p_display_name=private.settings_name(p_display_name);
 perform pg_advisory_xact_lock(hashtextextended('settings-bootstrap:'||v_actor::text,0));
 v_request=jsonb_build_object('operation','onboard','name',p_name,'storeName',p_store_name,'displayName',p_display_name);
 v_result=private.settings_replay(v_actor,p_key,v_request);
 if v_result is not null then
  perform private.settings_owner((v_result->>'organizationId')::uuid,(v_result->>'storeId')::uuid); return v_result;
 end if;
 if (select count(*) from private.settings_attempts where actor_id=v_actor and request->>'operation'='onboard')>=5 then
  raise exception 'Organization limit' using errcode='22023'; end if;
 insert into public.profiles(id,display_name) values(v_actor,p_display_name) on conflict(id) do nothing;
 insert into public.organizations(name) values(p_name) returning id into v_org;
 insert into public.stores(organization_id,name) values(v_org,p_store_name) returning id into v_store;
 insert into public.memberships(organization_id,user_id,role) values(v_org,v_actor,'owner') returning id into v_member;
 insert into public.user_store_access(organization_id,membership_id,store_id) values(v_org,v_member,v_store);
 v_result=jsonb_build_object('organizationId',v_org,'storeId',v_store,'id',v_org,'revision','1');
 insert into private.settings_attempts values(v_actor,p_key,v_org,v_request,v_result,now()); return v_result;
end $$;

create function public.settings_read(p_org uuid,p_store uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform private.settings_owner(p_org,p_store);
 select jsonb_build_object('organization',jsonb_build_object('id',o.id,'name',o.name,'revision',o.revision::text),
  'stores',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'active',s.active,'revision',s.revision::text) order by s.created_at,s.id) from public.stores s where s.organization_id=p_org),'[]'::jsonb),
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'userId',m.user_id,'name',p.display_name,'role',m.role,'active',m.active,'revision',m.revision::text,
   'storeIds',coalesce((select jsonb_agg(a.store_id order by a.store_id) from public.user_store_access a where a.organization_id=p_org and a.membership_id=m.id),'[]'::jsonb)) order by m.created_at,m.id)
   from public.memberships m join public.profiles p on p.id=m.user_id where m.organization_id=p_org),'[]'::jsonb),
  'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'status',i.status,'revision',i.revision::text,'expiresAt',i.expires_at,
   'storeIds',coalesce((select jsonb_agg(a.store_id order by a.store_id) from private.settings_invitation_stores a where a.organization_id=p_org and a.invitation_id=i.id),'[]'::jsonb)) order by i.created_at desc,i.id)
   from (select * from private.settings_invitations where organization_id=p_org order by created_at desc,id limit 100) i),'[]'::jsonb)) into v_result
 from public.organizations o where o.id=p_org;
 return v_result;
end $$;

create function public.settings_mutate(p_org uuid,p_store uuid,p_operation text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid=auth.uid(); v_member uuid; v_id uuid; v_revision bigint; v_request jsonb; v_result jsonb;
 v_stores uuid[]; v_role text; v_active boolean; v_name text; v_code uuid; v_email text;
begin
 -- Serialize administration without blocking KEY SHARE taken by commercial FKs.
 perform 1 from public.organizations where id=p_org for no key update;
 v_member=private.settings_owner(p_org,p_store);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid payload' using errcode='22023'; end if;
 if p_operation='rename_organization' then
  if p_payload-array['name','revision']<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
 elsif p_operation='create_store' then
  if p_payload-array['name']<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
 elsif p_operation='update_store' then
  if p_payload-array['id','name','active','revision']<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
 elsif p_operation='update_member' then
  if p_payload-array['id','role','active','storeIds','revision']<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
 elsif p_operation='invite' then
  if p_payload-array['email','role','storeIds','code']<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
 elsif p_operation='revoke_invite' then
  if p_payload-array['id','revision']<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
 else raise exception 'Invalid operation' using errcode='22023'; end if;
 if p_operation in ('rename_organization','create_store','update_store') then
  v_name=private.settings_name(p_payload->>'name'); p_payload=jsonb_set(p_payload,'{name}',to_jsonb(v_name)); end if;
 if p_operation in ('update_member','invite') then
  v_role=p_payload->>'role';
  if v_role is null or v_role not in ('owner','manager','cashier','stockist','buyer','marketing','logistics','driver') or jsonb_typeof(p_payload->'storeIds') is distinct from 'array'
    or jsonb_array_length(p_payload->'storeIds')>100 then raise exception 'Invalid access' using errcode='22023'; end if;
  select coalesce(array_agg(distinct x::uuid order by x::uuid),'{}'::uuid[]) into v_stores from jsonb_array_elements_text(p_payload->'storeIds') x;
  p_payload=jsonb_set(p_payload,'{storeIds}',to_jsonb(v_stores));
 end if;
 if p_operation='invite' then
  v_email=lower(trim(p_payload->>'email')); v_code=(p_payload->>'code')::uuid;
  if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or v_code is null or cardinality(v_stores)=0 then
   raise exception 'Invalid invitation' using errcode='22023'; end if;
  p_payload=(p_payload-'code')||jsonb_build_object('email',v_email,'codeHash',encode(sha256(convert_to(v_code::text,'UTF8')),'hex'));
 end if;
 v_request=jsonb_build_object('operation',p_operation,'organizationId',p_org,'storeId',p_store,'payload',p_payload);
 v_result=private.settings_replay(v_actor,p_key,v_request); if v_result is not null then return v_result; end if;
 if p_operation in ('update_member','invite') and exists(select 1 from unnest(v_stores) x where not exists(select 1 from public.stores s where s.id=x and s.organization_id=p_org and s.active)) then
  raise exception 'Invalid stores' using errcode='22023'; end if;
 if p_operation in ('update_store','update_member','revoke_invite') then v_id=(p_payload->>'id')::uuid; end if;
 if p_operation in ('rename_organization','update_store','update_member','revoke_invite') then
  v_revision=(p_payload->>'revision')::bigint; if v_revision is null or v_revision<1 then raise exception 'Invalid revision' using errcode='22023'; end if; end if;
 if p_operation in ('update_store','update_member') then
  if jsonb_typeof(p_payload->'active') is distinct from 'boolean' then raise exception 'Invalid state' using errcode='22023'; end if;
  v_active=(p_payload->>'active')::boolean; end if;
 case p_operation
 when 'rename_organization' then
  update public.organizations set name=v_name,revision=revision+1 where id=p_org and revision=v_revision returning id,revision into v_id,v_revision;
 when 'create_store' then
  if (select count(*) from public.stores where organization_id=p_org)>=100 then raise exception 'Store limit' using errcode='22023'; end if;
  insert into public.stores(organization_id,name) values(p_org,v_name) returning id,revision into v_id,v_revision;
  insert into public.user_store_access(organization_id,membership_id,store_id) values(p_org,v_member,v_id);
  update public.memberships set revision=revision+1 where id=v_member;
 when 'update_store' then
  update public.stores set name=v_name,active=v_active,revision=revision+1 where id=v_id and organization_id=p_org and revision=v_revision returning revision into v_revision;
 when 'update_member' then
  if exists(select 1 from public.memberships where id=v_id and organization_id=p_org and user_id=v_actor) then
   raise exception 'Own membership cannot be changed' using errcode='42501'; end if;
  if v_active and cardinality(v_stores)=0 then raise exception 'Active member requires stores' using errcode='22023'; end if;
  update public.memberships set role=v_role,active=v_active,revision=revision+1 where id=v_id and organization_id=p_org and revision=v_revision returning revision into v_revision;
  if v_revision is not null then
   delete from public.user_store_access where organization_id=p_org and membership_id=v_id and not(store_id=any(v_stores));
   insert into public.user_store_access(organization_id,membership_id,store_id) select p_org,v_id,x from unnest(v_stores) x on conflict(organization_id,membership_id,store_id) do nothing;
  end if;
 when 'invite' then
  if (select count(*) from private.settings_invitations where organization_id=p_org and status='pending' and expires_at>now())>=100 then raise exception 'Invitation limit' using errcode='22023'; end if;
  insert into private.settings_invitations(organization_id,email,role,code_hash,created_by) values(p_org,v_email,v_role,p_payload->>'codeHash',v_actor) returning id,revision into v_id,v_revision;
  insert into private.settings_invitation_stores select p_org,v_id,x from unnest(v_stores) x;
 when 'revoke_invite' then
  update private.settings_invitations set status='revoked',revision=revision+1 where organization_id=p_org and id=v_id and revision=v_revision and status='pending' returning revision into v_revision;
 end case;
 if v_id is null or v_revision is null then raise exception 'Revision conflict' using errcode='PT409'; end if;
 if exists(select 1 from public.memberships m where m.organization_id=p_org and m.active and m.role='owner' and not exists(
  select 1 from public.user_store_access a join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
  where a.organization_id=p_org and a.membership_id=m.id and s.active)) then raise exception 'Owner requires active store' using errcode='PT409'; end if;
 if p_operation in ('invite','revoke_invite') then
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,origin,new_value)
  values(p_org,v_actor,'settings.'||p_operation,'settings_invitations',v_id,'web',jsonb_build_object('organization_id',p_org,'id',v_id,'revision',v_revision,'role',v_role,'store_ids',v_stores)); end if;
 v_result=jsonb_build_object('id',v_id,'revision',v_revision::text);
 insert into private.settings_attempts values(v_actor,p_key,p_org,v_request,v_result,now()); return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid input' using errcode='22023';
end $$;

create function public.settings_accept(p_code uuid,p_display_name text,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_email text; v_i private.settings_invitations; v_member uuid; v_store uuid; v_request jsonb; v_result jsonb;
begin
 v_actor=private.settings_identity(); p_display_name=private.settings_name(p_display_name);
 select lower(trim(email)) into v_email from auth.users where id=v_actor;
 select * into v_i from private.settings_invitations where code_hash=encode(sha256(convert_to(p_code::text,'UTF8')),'hex') and email=v_email;
 if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 perform 1 from public.organizations where id=v_i.organization_id for no key update;
 select * into v_i from private.settings_invitations where id=v_i.id for update;
 v_request=jsonb_build_object('operation','accept','invitationId',v_i.id,'displayName',p_display_name);
 if v_i.status='accepted' and v_i.accepted_by=v_actor then
  if not exists(select 1 from public.memberships m where m.organization_id=v_i.organization_id and m.user_id=v_actor and m.active
    and exists(select 1 from public.user_store_access a join public.stores s on s.id=a.store_id and s.organization_id=a.organization_id
     where a.organization_id=m.organization_id and a.membership_id=m.id and s.active)) then raise exception 'Access revoked' using errcode='42501'; end if;
  v_result=private.settings_replay(v_actor,p_key,v_request);
  if v_result is null then raise exception 'Invitation consumed' using errcode='PT409'; end if; return v_result;
 end if;
 if v_i.status<>'pending' or v_i.expires_at<=now() or not exists(select 1 from public.memberships m where m.organization_id=v_i.organization_id and m.user_id=v_i.created_by and m.active and m.role='owner'
  and exists(select 1 from public.user_store_access a join public.stores s on s.id=a.store_id and s.organization_id=a.organization_id where a.organization_id=m.organization_id and a.membership_id=m.id and s.active)) then
  raise exception 'Invitation unavailable' using errcode='42501'; end if;
 if exists(select 1 from private.settings_invitation_stores a join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id where a.invitation_id=v_i.id and not s.active) then
  raise exception 'Invitation unavailable' using errcode='42501'; end if;
 if exists(select 1 from public.memberships where organization_id=v_i.organization_id and user_id=v_actor) then raise exception 'Existing membership' using errcode='PT409'; end if;
 if (select count(*) from public.memberships where organization_id=v_i.organization_id)>=200 then raise exception 'Member limit' using errcode='22023'; end if;
 perform private.settings_replay(v_actor,p_key,v_request);
 insert into public.profiles(id,display_name) values(v_actor,p_display_name) on conflict(id) do nothing;
 insert into public.memberships(organization_id,user_id,role) values(v_i.organization_id,v_actor,v_i.role) returning id into v_member;
 insert into public.user_store_access(organization_id,membership_id,store_id) select organization_id,v_member,store_id from private.settings_invitation_stores where invitation_id=v_i.id;
 select store_id into v_store from private.settings_invitation_stores where invitation_id=v_i.id order by store_id limit 1;
 if v_store is null then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 update private.settings_invitations set status='accepted',accepted_by=v_actor,revision=revision+1 where id=v_i.id;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,origin,new_value)
 values(v_i.organization_id,v_actor,'settings.accept','settings_invitations',v_i.id,'web',jsonb_build_object('organization_id',v_i.organization_id,'id',v_i.id,'membership_id',v_member));
 v_result=jsonb_build_object('organizationId',v_i.organization_id,'storeId',v_store,'id',v_member,'revision','1');
 insert into private.settings_attempts values(v_actor,p_key,v_i.organization_id,v_request,v_result,now()); return v_result;
end $$;
revoke all on function private.settings_identity(),private.settings_name(text),private.settings_owner(uuid,uuid),private.settings_replay(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.settings_onboard(text,text,text,uuid),public.settings_read(uuid,uuid),public.settings_mutate(uuid,uuid,text,jsonb,uuid),public.settings_accept(uuid,text,uuid) from public,anon;
grant execute on function public.settings_onboard(text,text,text,uuid),public.settings_read(uuid,uuid),public.settings_mutate(uuid,uuid,text,jsonb,uuid),public.settings_accept(uuid,text,uuid) to authenticated;
commit;
