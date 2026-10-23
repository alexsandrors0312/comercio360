-- Pacote 012: calendário interno. Nenhum envio, lista de contatos ou publicação automática.
begin;
create table public.marketing_campaigns (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, store_id uuid not null,
 actor_user_id uuid not null references public.profiles(id),
 title text not null check(length(title) between 3 and 120),
 channel text not null check(channel in ('store','whatsapp','instagram','other')),
 planned_at timestamptz not null,
 status text not null default 'draft' check(status in ('draft','scheduled','completed','cancelled')),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,store_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id)
);
create index marketing_campaigns_calendar on public.marketing_campaigns(organization_id,store_id,planned_at,id);
create table private.marketing_attempts (
 actor_id uuid not null references auth.users(id), key uuid not null,
 organization_id uuid not null, store_id uuid not null,
 request jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,key), foreign key(organization_id,store_id) references public.stores(organization_id,id)
);
alter table public.marketing_campaigns enable row level security;
alter table private.marketing_attempts enable row level security;
revoke all on public.marketing_campaigns,private.marketing_attempts from public,anon,authenticated,service_role;

create function private.marketing_access(p_org uuid,p_store uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Marketing access denied' using errcode='42501'; end if;
 perform 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.active and a.store_id=p_store and s.active
  and m.role in ('owner','manager','marketing') for share of m,a,s;
 if not found then raise exception 'Marketing access denied' using errcode='42501'; end if;
end $$;
create function private.marketing_replay(p_org uuid,p_store uuid,p_key uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_attempt private.marketing_attempts%rowtype;
begin
 if p_key is null then raise exception 'Attempt key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('marketing-attempt:'||auth.uid()::text||':'||p_key::text,0));
 select * into v_attempt from private.marketing_attempts where actor_id=auth.uid() and key=p_key;
 if found then
  if v_attempt.organization_id<>p_org or v_attempt.store_id<>p_store or v_attempt.request is distinct from p_request then
   raise exception 'Attempt conflict' using errcode='PT409'; end if;
  return v_attempt.result;
 end if;
 return null;
end $$;

create function public.marketing_read(p_org uuid,p_store uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform private.marketing_access(p_org,p_store);
 select jsonb_build_object('campaigns',coalesce(jsonb_agg(jsonb_build_object(
  'id',c.id,'title',c.title,'channel',c.channel,'plannedAt',c.planned_at,
  'status',c.status,'revision',c.revision::text,'createdAt',c.created_at)
  order by c.planned_at,c.id),'[]'::jsonb)) into v_result
 from (select * from public.marketing_campaigns where organization_id=p_org and store_id=p_store
  order by planned_at,id limit 200) c;
 return v_result;
end $$;

create function public.marketing_mutate(p_org uuid,p_store uuid,p_operation text,p_payload jsonb,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request jsonb; v_result jsonb; v_campaign public.marketing_campaigns%rowtype;
 v_id uuid; v_revision bigint; v_title text; v_channel text; v_planned timestamptz; v_status text;
begin
 perform private.marketing_access(p_org,p_store);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid payload' using errcode='22023'; end if;
 if p_operation in ('create','update') then
  if (p_operation='create' and p_payload-array['title','channel','plannedAt']<>'{}'::jsonb) or
   (p_operation='update' and p_payload-array['id','revision','title','channel','plannedAt']<>'{}'::jsonb) then
   raise exception 'Invalid fields' using errcode='22023'; end if;
  v_title=trim(coalesce(p_payload->>'title','')); v_channel=p_payload->>'channel';
  if length(v_title) not between 3 and 120 or v_title ~ '[[:cntrl:]]' or
   v_channel not in ('store','whatsapp','instagram','other') then
   raise exception 'Invalid campaign' using errcode='22023'; end if;
  begin v_planned=(p_payload->>'plannedAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid date' using errcode='22023'; end;
  if v_planned is null then raise exception 'Planned date required' using errcode='22023'; end if;
  if p_operation='update' then
   begin v_id=(p_payload->>'id')::uuid; v_revision=(p_payload->>'revision')::bigint;
   exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid revision or id' using errcode='22023'; end;
  end if;
  v_request=jsonb_build_object('operation',p_operation,'id',v_id,'revision',v_revision,
   'title',v_title,'channel',v_channel,'plannedAt',v_planned);
 elsif p_operation='transition' then
  if p_payload-array['id','revision','status']<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
  v_status=p_payload->>'status';
  if v_status not in ('scheduled','completed','cancelled') then raise exception 'Invalid status' using errcode='22023'; end if;
  begin v_id=(p_payload->>'id')::uuid; v_revision=(p_payload->>'revision')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid revision or id' using errcode='22023'; end;
  v_request=jsonb_build_object('operation','transition','id',v_id,'revision',v_revision,'status',v_status);
 else raise exception 'Invalid operation' using errcode='22023'; end if;
 v_result=private.marketing_replay(p_org,p_store,p_key,v_request);
 if v_result is not null then return v_result; end if;
 if p_operation='create' then
  insert into public.marketing_campaigns(organization_id,store_id,actor_user_id,title,channel,planned_at)
   values(p_org,p_store,auth.uid(),v_title,v_channel,v_planned) returning id into v_id;
  v_revision=1; v_status='draft';
 else
  select * into v_campaign from public.marketing_campaigns where organization_id=p_org and store_id=p_store
   and id=v_id for update;
  if not found or v_campaign.revision<>v_revision or v_campaign.status in ('completed','cancelled') then
   raise exception 'Campaign conflict' using errcode='PT409'; end if;
  if p_operation='update' then
   update public.marketing_campaigns set title=v_title,channel=v_channel,planned_at=v_planned,
    revision=revision+1,updated_at=clock_timestamp() where id=v_id;
   v_status=v_campaign.status;
  else
   if not ((v_campaign.status='draft' and v_status in ('scheduled','cancelled')) or
    (v_campaign.status='scheduled' and v_status in ('completed','cancelled'))) then
    raise exception 'Campaign transition conflict' using errcode='PT409'; end if;
   update public.marketing_campaigns set status=v_status,revision=revision+1,
    updated_at=clock_timestamp() where id=v_id;
  end if;
  v_revision=v_revision+1;
 end if;
 v_result=jsonb_build_object('id',v_id,'revision',v_revision::text,'status',v_status);
 insert into private.marketing_attempts(actor_id,key,organization_id,store_id,request,result)
 values(auth.uid(),p_key,p_org,p_store,v_request,v_result);
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,new_value)
 values(p_org,p_store,auth.uid(),p_operation,'marketing_campaign',v_id,'database',
  jsonb_build_object('status',v_status,'revision',v_revision,'channel',
   case when p_operation='transition' then v_campaign.channel else v_channel end));
 return v_result;
end $$;

revoke all on function private.marketing_access(uuid,uuid),private.marketing_replay(uuid,uuid,uuid,jsonb)
 from public,anon,authenticated;
revoke all on function public.marketing_read(uuid,uuid),public.marketing_mutate(uuid,uuid,text,jsonb,uuid)
 from public,anon,authenticated;
grant execute on function public.marketing_read(uuid,uuid),public.marketing_mutate(uuid,uuid,text,jsonb,uuid)
 to authenticated;
commit;
