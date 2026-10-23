-- Pacote 010: recebimentos e movimentos de caixa manuais, sem integração de pagamento.
begin;

create table public.finance_receipts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null, store_id uuid not null, sale_id uuid not null,
 actor_user_id uuid not null references public.profiles(id),
 amount_cents bigint not null check (amount_cents between 1 and 1000000000000),
 method text not null check (method in ('cash','pix','card','transfer','other')),
 note text not null default '' check (length(note)<=240),
 status text not null default 'posted' check (status in ('posted','reversed')),
 created_at timestamptz not null default clock_timestamp(),
 reversed_at timestamptz, reversal_reason text,
 unique(organization_id,store_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,store_id,sale_id) references public.sales(organization_id,store_id,id),
 check ((status='posted' and reversed_at is null and reversal_reason is null) or
        (status='reversed' and reversed_at is not null and length(reversal_reason) between 3 and 240))
);
create index finance_receipts_sale on public.finance_receipts(organization_id,store_id,sale_id,status);
create index finance_receipts_recent on public.finance_receipts(organization_id,store_id,created_at desc,id desc);
create index finance_cash_active on public.finance_receipts(organization_id,store_id) include(amount_cents)
 where method='cash' and status='posted';

create table public.finance_cash_entries (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, store_id uuid not null,
 actor_user_id uuid not null references public.profiles(id),
 direction text not null check(direction in ('in','out')),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
 note text not null check(length(note) between 3 and 240),
 created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,store_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id)
);
create index finance_cash_recent on public.finance_cash_entries(organization_id,store_id,created_at desc,id desc);

create table private.finance_attempts (
 actor_id uuid not null references auth.users(id), key uuid not null,
 organization_id uuid not null, store_id uuid not null,
 request jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,key),
 foreign key(organization_id,store_id) references public.stores(organization_id,id)
);

alter table public.finance_receipts enable row level security;
alter table public.finance_cash_entries enable row level security;
alter table private.finance_attempts enable row level security;
revoke all on public.finance_receipts,public.finance_cash_entries,private.finance_attempts from public,anon,authenticated,service_role;

create function private.finance_access(p_org uuid,p_store uuid,p_manager boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Finance access denied' using errcode='42501'; end if;
 perform 1 from public.memberships m
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.active and a.store_id=p_store and s.active
   and (m.role in ('owner','manager') or (not p_manager and m.role='cashier'))
 for share of m,a,s;
 if not found then raise exception 'Finance access denied' using errcode='42501'; end if;
end $$;

create function private.finance_replay(p_org uuid,p_store uuid,p_key uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_attempt private.finance_attempts%rowtype;
begin
 if p_key is null then raise exception 'Attempt key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-attempt:'||auth.uid()::text||':'||p_key::text,0));
 select * into v_attempt from private.finance_attempts where actor_id=auth.uid() and key=p_key;
 if found then
  if v_attempt.organization_id<>p_org or v_attempt.store_id<>p_store or v_attempt.request is distinct from p_request then
   raise exception 'Attempt conflict' using errcode='PT409';
  end if;
  return v_attempt.result;
 end if;
 return null;
end $$;

create function private.finance_cash_balance(p_org uuid,p_store uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce((select sum(r.amount_cents) from public.finance_receipts r where r.organization_id=p_org
   and r.store_id=p_store and r.method='cash' and r.status='posted'),0)
  +coalesce((select sum(case when e.direction='in' then e.amount_cents else -e.amount_cents end)
    from public.finance_cash_entries e where e.organization_id=p_org and e.store_id=p_store),0);
$$;

create function public.finance_read(p_org uuid,p_store uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform private.finance_access(p_org,p_store,false);
 select jsonb_build_object(
  'cashBalanceCents',private.finance_cash_balance(p_org,p_store)::text,
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,
    'totalCents',s.total_cents::text,'receivedCents',coalesce((select sum(r.amount_cents)
      from public.finance_receipts r where r.organization_id=p_org and r.store_id=p_store
      and r.sale_id=s.id and r.status='posted'),0)::text,'createdAt',s.created_at)
    order by s.created_at desc,s.id desc)
    from (select * from public.sales where organization_id=p_org and store_id=p_store
      order by created_at desc,id desc limit 50) s),'[]'::jsonb),
  'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'saleId',r.sale_id,
    'amountCents',r.amount_cents::text,'method',r.method,'note',r.note,'status',r.status,
    'createdAt',r.created_at,'reversalReason',r.reversal_reason) order by r.created_at desc,r.id desc)
    from (select * from public.finance_receipts where organization_id=p_org and store_id=p_store
      order by created_at desc,id desc limit 100) r),'[]'::jsonb),
  'cashEntries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'direction',e.direction,
    'amountCents',e.amount_cents::text,'note',e.note,'createdAt',e.created_at)
    order by e.created_at desc,e.id desc)
    from (select * from public.finance_cash_entries where organization_id=p_org and store_id=p_store
      order by created_at desc,id desc limit 100) e),'[]'::jsonb)) into v_result;
 return v_result;
end $$;

create function public.finance_record(p_org uuid,p_store uuid,p_sale uuid,p_amount bigint,
 p_method text,p_note text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_sale public.sales%rowtype; v_request jsonb; v_result jsonb; v_paid bigint; v_id uuid;
begin
 perform private.finance_access(p_org,p_store,false);
 p_note=trim(coalesce(p_note,''));
 if p_amount is null or p_amount<1 or p_method not in ('cash','pix','card','transfer','other')
  or length(p_note)>240 then raise exception 'Invalid receipt' using errcode='22023'; end if;
 v_request=jsonb_build_object('kind','record','saleId',p_sale,'amountCents',p_amount,
  'method',p_method,'note',p_note);
 v_result=private.finance_replay(p_org,p_store,p_key,v_request);
 if v_result is not null then return v_result; end if;
 select * into v_sale from public.sales where organization_id=p_org and store_id=p_store and id=p_sale for update;
 if not found or v_sale.status<>'confirmed' then raise exception 'Sale unavailable' using errcode='PT409'; end if;
 select coalesce(sum(amount_cents),0) into v_paid from public.finance_receipts
  where organization_id=p_org and store_id=p_store and sale_id=p_sale and status='posted';
 if p_amount>v_sale.total_cents-v_paid then raise exception 'Amount exceeds outstanding sale' using errcode='PT409'; end if;
 if p_method='cash' then perform pg_advisory_xact_lock(hashtextextended('finance-cash:'||p_org::text||':'||p_store::text,0)); end if;
 insert into public.finance_receipts(organization_id,store_id,sale_id,actor_user_id,amount_cents,method,note)
 values(p_org,p_store,p_sale,auth.uid(),p_amount,p_method,p_note) returning id into v_id;
 v_result=jsonb_build_object('id',v_id,'status','posted');
 insert into private.finance_attempts(actor_id,key,organization_id,store_id,request,result)
 values(auth.uid(),p_key,p_org,p_store,v_request,v_result);
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,new_value)
 values(p_org,p_store,auth.uid(),'record','finance_receipt',v_id,'database',
  jsonb_build_object('saleId',p_sale,'amountCents',p_amount,'method',p_method,'status','posted'));
 return v_result;
end $$;

create function public.finance_reverse(p_org uuid,p_store uuid,p_receipt uuid,p_reason text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_receipt public.finance_receipts%rowtype; v_request jsonb; v_result jsonb;
begin
 perform private.finance_access(p_org,p_store,true);
 p_reason=trim(coalesce(p_reason,''));
 if length(p_reason) not between 3 and 240 then raise exception 'Reason required' using errcode='22023'; end if;
 v_request=jsonb_build_object('kind','reverse','receiptId',p_receipt,'reason',p_reason);
 v_result=private.finance_replay(p_org,p_store,p_key,v_request);
 if v_result is not null then return v_result; end if;
 select * into v_receipt from public.finance_receipts where organization_id=p_org and store_id=p_store
  and id=p_receipt for update;
 if not found or v_receipt.status<>'posted' then raise exception 'Receipt unavailable' using errcode='PT409'; end if;
 if v_receipt.method='cash' then perform pg_advisory_xact_lock(hashtextextended('finance-cash:'||p_org::text||':'||p_store::text,0));
  if private.finance_cash_balance(p_org,p_store)<v_receipt.amount_cents then
   raise exception 'Cash balance insufficient; reconcile first' using errcode='PT409'; end if;
 end if;
 update public.finance_receipts set status='reversed',reversed_at=clock_timestamp(),reversal_reason=p_reason
  where id=p_receipt;
 v_result=jsonb_build_object('id',p_receipt,'status','reversed');
 insert into private.finance_attempts(actor_id,key,organization_id,store_id,request,result)
 values(auth.uid(),p_key,p_org,p_store,v_request,v_result);
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,old_value,new_value)
 values(p_org,p_store,auth.uid(),'reverse','finance_receipt',p_receipt,'database',
  jsonb_build_object('status','posted'),jsonb_build_object('status','reversed','reason',p_reason));
 return v_result;
end $$;

create function public.finance_cash(p_org uuid,p_store uuid,p_direction text,p_amount bigint,
 p_note text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_request jsonb; v_result jsonb; v_id uuid;
begin
 perform private.finance_access(p_org,p_store,true);
 p_note=trim(coalesce(p_note,''));
 if p_direction not in ('in','out') or p_amount is null or p_amount<1
  or length(p_note) not between 3 and 240 then raise exception 'Invalid cash entry' using errcode='22023'; end if;
 v_request=jsonb_build_object('kind','cash','direction',p_direction,'amountCents',p_amount,'note',p_note);
 v_result=private.finance_replay(p_org,p_store,p_key,v_request);
 if v_result is not null then return v_result; end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-cash:'||p_org::text||':'||p_store::text,0));
 if p_direction='out' and private.finance_cash_balance(p_org,p_store)<p_amount then
  raise exception 'Cash balance insufficient' using errcode='PT409'; end if;
 insert into public.finance_cash_entries(organization_id,store_id,actor_user_id,direction,amount_cents,note)
 values(p_org,p_store,auth.uid(),p_direction,p_amount,p_note) returning id into v_id;
 v_result=jsonb_build_object('id',v_id,'status','recorded');
 insert into private.finance_attempts(actor_id,key,organization_id,store_id,request,result)
 values(auth.uid(),p_key,p_org,p_store,v_request,v_result);
 insert into public.audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,new_value)
 values(p_org,p_store,auth.uid(),'record','finance_cash_entry',v_id,'database',
  jsonb_build_object('direction',p_direction,'amountCents',p_amount));
 return v_result;
end $$;

revoke all on function private.finance_access(uuid,uuid,boolean),
 private.finance_replay(uuid,uuid,uuid,jsonb),private.finance_cash_balance(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finance_read(uuid,uuid),
 public.finance_record(uuid,uuid,uuid,bigint,text,text,uuid),
 public.finance_reverse(uuid,uuid,uuid,text,uuid),
 public.finance_cash(uuid,uuid,text,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.finance_read(uuid,uuid),
 public.finance_record(uuid,uuid,uuid,bigint,text,text,uuid),
 public.finance_reverse(uuid,uuid,uuid,text,uuid),
 public.finance_cash(uuid,uuid,text,bigint,text,uuid) to authenticated;
commit;
