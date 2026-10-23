-- Pacote 011: acompanhamento interno de retirada/entrega vinculada a uma venda.
begin;
create table public.deliveries (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, store_id uuid not null,
 sale_id uuid not null, actor_user_id uuid not null references public.profiles(id),
 mode text not null check(mode in ('pickup','local_delivery')),
 status text not null default 'queued' check(status in ('queued','ready','out_for_delivery','completed','cancelled')),
 due_at timestamptz, assigned_label text not null default '' check(length(assigned_label)<=120),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,store_id,id), unique(organization_id,store_id,sale_id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,store_id,sale_id) references public.sales(organization_id,store_id,id),
 check(mode='local_delivery' or status<>'out_for_delivery')
);
create index deliveries_recent on public.deliveries(organization_id,store_id,created_at desc,id desc);
create table private.delivery_attempts (
 actor_id uuid not null references auth.users(id), key uuid not null,
 organization_id uuid not null, store_id uuid not null,
 request jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,key), foreign key(organization_id,store_id) references public.stores(organization_id,id)
);
alter table public.deliveries enable row level security;
alter table private.delivery_attempts enable row level security;
revoke all on public.deliveries,private.delivery_attempts from public,anon,authenticated,service_role;

create function private.delivery_access(p_org uuid,p_store uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Delivery access denied' using errcode='42501'; end if;
 perform 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.active and a.store_id=p_store and s.active
  and m.role in ('owner','manager','logistics') for share of m,a,s;
 if not found then raise exception 'Delivery access denied' using errcode='42501'; end if;
end $$;
create function private.delivery_replay(p_org uuid,p_store uuid,p_key uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_attempt private.delivery_attempts%rowtype;
begin
 if p_key is null then raise exception 'Attempt key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('delivery-attempt:'||auth.uid()::text||':'||p_key::text,0));
 select * into v_attempt from private.delivery_attempts where actor_id=auth.uid() and key=p_key;
 if found then
  if v_attempt.organization_id<>p_org or v_attempt.store_id<>p_store or v_attempt.request is distinct from p_request then
   raise exception 'Attempt conflict' using errcode='PT409'; end if;
  return v_attempt.result;
 end if;
 return null;
end $$;

create function public.deliveries_read(p_org uuid,p_store uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform private.delivery_access(p_org,p_store);
 select jsonb_build_object(
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'createdAt',s.created_at,
   'totalCents',s.total_cents::text) order by s.created_at desc,s.id desc)
   from (select * from public.sales where organization_id=p_org and store_id=p_store and status='confirmed'
    and not exists(select 1 from public.deliveries d where d.organization_id=p_org and d.store_id=p_store and d.sale_id=sales.id)
    order by created_at desc,id desc limit 50) s),'[]'::jsonb),
  'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'saleId',d.sale_id,
   'mode',d.mode,'status',d.status,'dueAt',d.due_at,'assignedLabel',d.assigned_label,
   'revision',d.revision::text,'createdAt',d.created_at,'updatedAt',d.updated_at)
   order by d.created_at desc,d.id desc)
   from (select * from public.deliveries where organization_id=p_org and store_id=p_store
    order by created_at desc,id desc limit 100) d),'[]'::jsonb)) into v_result;
 return v_result;
end $$;

create function public.deliveries_mutate(p_org uuid,p_store uuid,p_operation text,p_payload jsonb,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request jsonb; v_result jsonb; v_id uuid; v_sale public.sales%rowtype;
 v_delivery public.deliveries%rowtype; v_mode text; v_status text; v_label text; v_due timestamptz; v_revision bigint;
begin
 perform private.delivery_access(p_org,p_store);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid payload' using errcode='22023'; end if;
 if p_operation='create' then
  if p_payload-array['saleId','mode','dueAt','assignedLabel']<>'{}'::jsonb then
   raise exception 'Invalid fields' using errcode='22023'; end if;
  if p_payload->>'saleId' is null or p_payload->>'mode' not in ('pickup','local_delivery') then
   raise exception 'Invalid delivery' using errcode='22023'; end if;
  v_mode=p_payload->>'mode'; v_label=trim(coalesce(p_payload->>'assignedLabel',''));
  if length(v_label)>120 or v_label ~ '[[:cntrl:]]' then raise exception 'Invalid assignment' using errcode='22023'; end if;
  if p_payload->>'dueAt' is not null and p_payload->>'dueAt'<>'' then
   begin v_due=(p_payload->>'dueAt')::timestamptz;
   exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid date' using errcode='22023'; end;
  end if;
  v_request=jsonb_build_object('operation','create','saleId',(p_payload->>'saleId')::uuid,
   'mode',v_mode,'dueAt',v_due,'assignedLabel',v_label);
 elsif p_operation='transition' then
  if p_payload-array['id','revision','status']<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
  if p_payload->>'status' not in ('ready','out_for_delivery','completed','cancelled') then
   raise exception 'Invalid status' using errcode='22023'; end if;
  v_status=p_payload->>'status';
  begin v_id=(p_payload->>'id')::uuid; v_revision=(p_payload->>'revision')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid revision or id' using errcode='22023'; end;
  v_request=jsonb_build_object('operation','transition','id',v_id,'revision',v_revision,'status',v_status);
 else raise exception 'Invalid operation' using errcode='22023'; end if;
 v_result=private.delivery_replay(p_org,p_store,p_key,v_request);
 if v_result is not null then return v_result; end if;
 if p_operation='create' then
  select * into v_sale from public.sales where organization_id=p_org and store_id=p_store
   and id=(v_request->>'saleId')::uuid for share;
  if not found or v_sale.status<>'confirmed' then raise exception 'Sale unavailable' using errcode='PT409'; end if;
  if exists(select 1 from public.deliveries where organization_id=p_org and store_id=p_store and sale_id=v_sale.id) then
   raise exception 'Delivery already exists' using errcode='PT409'; end if;
  insert into public.deliveries(organization_id,store_id,sale_id,actor_user_id,mode,due_at,assigned_label)
  values(p_org,p_store,v_sale.id,auth.uid(),v_mode,v_due,v_label) returning id into v_id;
  v_revision=1; v_status='queued';
 else
  select * into v_delivery from public.deliveries where organization_id=p_org and store_id=p_store and id=v_id for update;
  if not found or v_delivery.revision<>v_revision or v_delivery.status in ('completed','cancelled') or
   not ((v_delivery.status='queued' and v_status in ('ready','cancelled')) or
        (v_delivery.status='ready' and v_status in ('out_for_delivery','completed','cancelled')) or
        (v_delivery.status='out_for_delivery' and v_status in ('completed','cancelled'))) or
   (v_delivery.mode='pickup' and v_status='out_for_delivery') then
   raise exception 'Delivery transition conflict' using errcode='PT409'; end if;
  update public.deliveries set status=v_status,revision=revision+1,updated_at=clock_timestamp() where id=v_id;
  v_revision=v_revision+1;
 end if;
 v_result=jsonb_build_object('id',v_id,'revision',v_revision::text,'status',v_status);
 insert into private.delivery_attempts(actor_id,key,organization_id,store_id,request,result)
 values(auth.uid(),p_key,p_org,p_store,v_request,v_result);
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,new_value)
 values(p_org,p_store,auth.uid(),p_operation,'delivery',v_id,'database',
  jsonb_build_object('status',v_status,'revision',v_revision,'saleId',case when p_operation='create' then v_sale.id else v_delivery.sale_id end));
 return v_result;
end $$;

revoke all on function private.delivery_access(uuid,uuid),private.delivery_replay(uuid,uuid,uuid,jsonb)
 from public,anon,authenticated;
revoke all on function public.deliveries_read(uuid,uuid),public.deliveries_mutate(uuid,uuid,text,jsonb,uuid)
 from public,anon,authenticated;
grant execute on function public.deliveries_read(uuid,uuid),public.deliveries_mutate(uuid,uuid,text,jsonb,uuid)
 to authenticated;
commit;
