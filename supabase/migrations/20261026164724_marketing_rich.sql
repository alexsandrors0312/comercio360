-- Pacote 013: campanha com conteúdo e variantes da loja; sem ofertas ou disparos.
begin;

create table public.marketing_campaign_details (
 organization_id uuid not null, store_id uuid not null, campaign_id uuid not null,
 objective text not null check(objective in ('promotion','new_arrival','clearance','institutional')),
 content_body text not null check(char_length(content_body)<=2000),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,store_id,campaign_id),
 foreign key(organization_id,store_id,campaign_id)
  references public.marketing_campaigns(organization_id,store_id,id)
);

create table public.marketing_campaign_products (
 organization_id uuid not null, store_id uuid not null, campaign_id uuid not null,
 variant_id uuid not null, position smallint not null check(position between 1 and 6),
 primary key(organization_id,store_id,campaign_id,variant_id),
 unique(organization_id,store_id,campaign_id,position),
 foreign key(organization_id,store_id,campaign_id)
  references public.marketing_campaigns(organization_id,store_id,id),
 foreign key(organization_id,variant_id)
  references public.product_variants(organization_id,id)
);
create index marketing_campaign_products_variant
 on public.marketing_campaign_products(organization_id,variant_id);

create table private.marketing_rich_attempts (
 actor_id uuid not null references auth.users(id), key uuid not null,
 organization_id uuid not null, store_id uuid not null, campaign_id uuid not null,
 request jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,key),
 foreign key(organization_id,store_id,campaign_id)
  references public.marketing_campaigns(organization_id,store_id,id)
);

alter table public.marketing_campaign_details enable row level security;
alter table public.marketing_campaign_products enable row level security;
alter table private.marketing_rich_attempts enable row level security;
revoke all on public.marketing_campaign_details,public.marketing_campaign_products,
 private.marketing_rich_attempts from public,anon,authenticated,service_role;

-- Storage grants a currently linked active cover only when an accessible store
-- has an active variant of that product with a price. The selected store is
-- checked again by marketing_cover_path before its caller downloads it.
create function private.marketing_can_read_cover_object(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.catalog_image_objects o
 join public.product_images pi on pi.organization_id=o.organization_id
  and pi.product_id=o.product_id and pi.object_id=o.id
 join public.products p on p.organization_id=o.organization_id and p.id=o.product_id and p.active
 join public.memberships m on m.organization_id=o.organization_id
  and m.user_id=(select auth.uid()) and m.active
 join public.user_store_access a on a.organization_id=m.organization_id and a.membership_id=m.id
 join public.stores s on s.organization_id=a.organization_id and s.id=a.store_id and s.active
 where o.object_path=p_path and o.state='active'
  and m.role in ('owner','manager','marketing')
  and exists(select 1 from public.product_variants v
   join public.product_prices pp on pp.organization_id=v.organization_id
    and pp.variant_id=v.id and pp.store_id=s.id
   where v.organization_id=o.organization_id and v.product_id=o.product_id and v.active));
$$;
revoke all on function private.marketing_can_read_cover_object(text) from public,anon,authenticated;
grant execute on function private.marketing_can_read_cover_object(text) to authenticated;
create policy marketing_authorized_cover_read on storage.objects
 for select to authenticated
 using(bucket_id='catalog-private' and private.marketing_can_read_cover_object(name));

create function public.marketing_cover_path(p_org uuid,p_store uuid,p_product uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare v_path text;
begin
 perform private.marketing_access(p_org,p_store);
 select o.object_path into v_path from public.product_images pi
 join public.catalog_image_objects o on o.organization_id=pi.organization_id and o.id=pi.object_id
 join public.products p on p.organization_id=pi.organization_id and p.id=pi.product_id and p.active
 where pi.organization_id=p_org and pi.product_id=p_product and o.state='active'
  and exists(select 1 from public.product_variants v
   join public.product_prices pp on pp.organization_id=v.organization_id
    and pp.variant_id=v.id and pp.store_id=p_store
   where v.organization_id=p_org and v.product_id=p_product and v.active);
 return v_path;
end $$;

-- Shared product projection for candidate and campaign views. Its body is duplicated
-- in bounded reads so no privileged general catalog function becomes public.
create function public.marketing_product_search(p_org uuid,p_store uuid,p_query text,p_limit integer,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_query text=trim(coalesce(p_query,'')); v_items jsonb; v_total integer;
begin
 perform private.marketing_access(p_org,p_store);
 if char_length(v_query)>120 or p_limit is null or p_limit not between 1 and 50
  or p_offset is null or p_offset<0 or p_offset>10000 then
  raise exception 'Invalid catalog page' using errcode='22023'; end if;
 select count(*)::integer into v_total from public.product_variants v
 join public.products p on p.organization_id=v.organization_id and p.id=v.product_id
 join public.product_prices pp on pp.organization_id=v.organization_id and pp.store_id=p_store
  and pp.variant_id=v.id
 where v.organization_id=p_org and v.active and p.active
  and (v_query='' or p.name ilike '%'||v_query||'%' or v.sku ilike '%'||v_query||'%');
 select coalesce(jsonb_agg(jsonb_build_object(
  'variantId',x.id,'productId',x.product_id,'name',x.name,'sku',x.sku,
  'color',x.color,'size',x.size,'priceCents',x.price_cents,
  'quantity',x.quantity,'hasCover',x.has_cover)
  order by x.name,x.sku,x.id),'[]'::jsonb) into v_items
 from (select v.id,v.product_id,p.name,v.sku,v.color,v.size,
  ((pp.amount*100)::bigint)::text as price_cents,
  coalesce(b.quantity,0) as quantity,
  exists(select 1 from public.product_images pi
   join public.catalog_image_objects o on o.organization_id=pi.organization_id and o.id=pi.object_id
   where pi.organization_id=p_org and pi.product_id=p.id and o.state='active') as has_cover
  from public.product_variants v
  join public.products p on p.organization_id=v.organization_id and p.id=v.product_id
  join public.product_prices pp on pp.organization_id=v.organization_id and pp.store_id=p_store
   and pp.variant_id=v.id
  left join public.inventory_balances b on b.organization_id=v.organization_id
   and b.store_id=p_store and b.variant_id=v.id
  where v.organization_id=p_org and v.active and p.active
   and (v_query='' or p.name ilike '%'||v_query||'%' or v.sku ilike '%'||v_query||'%')
  order by p.name,v.sku,v.id limit p_limit offset p_offset) x;
 return jsonb_build_object('items',v_items,'total',v_total);
end $$;

create function public.marketing_rich_read(p_org uuid,p_store uuid,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_campaigns jsonb; v_more boolean;
begin
 perform private.marketing_access(p_org,p_store);
 if p_from is null or p_until is null or p_until<=p_from
  or p_until-p_from>interval '62 days' then
  raise exception 'Invalid calendar interval' using errcode='22023'; end if;
 select exists(select 1 from public.marketing_campaigns c
  where c.organization_id=p_org and c.store_id=p_store
   and c.planned_at>=p_from and c.planned_at<p_until
  order by c.planned_at,c.id offset 200 limit 1) into v_more;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',c.id,'title',c.title,'channel',c.channel,'plannedAt',c.planned_at,
  'status',c.status,'revision',c.revision::text,'createdAt',c.created_at,
  'objective',coalesce(d.objective,'institutional'),
  'contentBody',coalesce(d.content_body,''),
  'products',coalesce((select jsonb_agg(jsonb_build_object(
   'variantId',v.id,'productId',p.id,'name',p.name,'sku',v.sku,
   'color',v.color,'size',v.size,
   'priceCents',case when not p.active or not v.active or pp.amount is null then null
    else ((pp.amount*100)::bigint)::text end,
   'quantity',coalesce(b.quantity,0),
   'hasCover',p.active and v.active and pp.amount is not null and exists(select 1 from public.product_images pi
    join public.catalog_image_objects o on o.organization_id=pi.organization_id and o.id=pi.object_id
    where pi.organization_id=p_org and pi.product_id=p.id and o.state='active'))
   order by cp.position) from public.marketing_campaign_products cp
   join public.product_variants v on v.organization_id=cp.organization_id and v.id=cp.variant_id
   join public.products p on p.organization_id=v.organization_id and p.id=v.product_id
   left join public.product_prices pp on pp.organization_id=cp.organization_id
    and pp.store_id=cp.store_id and pp.variant_id=v.id
   left join public.inventory_balances b on b.organization_id=cp.organization_id
    and b.store_id=cp.store_id and b.variant_id=v.id
   where cp.organization_id=p_org and cp.store_id=p_store and cp.campaign_id=c.id),'[]'::jsonb))
  order by c.planned_at,c.id),'[]'::jsonb) into v_campaigns
 from (select * from public.marketing_campaigns
  where organization_id=p_org and store_id=p_store and planned_at>=p_from and planned_at<p_until
  order by planned_at,id limit 200) c
 left join public.marketing_campaign_details d on d.organization_id=c.organization_id
  and d.store_id=c.store_id and d.campaign_id=c.id;
 return jsonb_build_object('campaigns',v_campaigns,'hasMore',v_more);
end $$;

create function public.marketing_rich_save(
 p_org uuid,p_store uuid,p_campaign uuid,p_expected_revision bigint,
 p_objective text,p_content text,p_variants uuid[],p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_campaign public.marketing_campaigns%rowtype;
 v_variants uuid[]=coalesce(p_variants,'{}'::uuid[]);
 v_request jsonb; v_previous private.marketing_rich_attempts%rowtype; v_result jsonb;
 v_count integer; v_revision bigint;
begin
 perform private.marketing_access(p_org,p_store);
 if p_campaign is null or p_expected_revision is null or p_expected_revision<1 or p_key is null
  or p_objective is null or p_objective not in ('promotion','new_arrival','clearance','institutional')
  or p_content is null or char_length(p_content)>2000 or cardinality(v_variants)>6
  or array_position(v_variants,null) is not null then
  raise exception 'Invalid campaign content' using errcode='22023'; end if;
 select count(distinct x)::integer into v_count from unnest(v_variants) x;
 if v_count<>cardinality(v_variants) then
  raise exception 'Duplicate campaign product' using errcode='22023'; end if;
 v_request=jsonb_build_object('campaign',p_campaign,'revision',p_expected_revision,
  'objective',p_objective,'content',p_content,'variants',to_jsonb(v_variants));
 perform pg_advisory_xact_lock(hashtextextended('marketing-rich:'||auth.uid()::text||':'||p_key::text,0));
 select * into v_previous from private.marketing_rich_attempts
  where actor_id=auth.uid() and key=p_key;
 if found then
  if v_previous.organization_id<>p_org or v_previous.store_id<>p_store
   or v_previous.campaign_id<>p_campaign or v_previous.request is distinct from v_request then
   raise exception 'Attempt conflict' using errcode='PT409'; end if;
  return v_previous.result;
 end if;
 select * into v_campaign from public.marketing_campaigns
  where organization_id=p_org and store_id=p_store and id=p_campaign for update;
 if not found or v_campaign.revision<>p_expected_revision
  or v_campaign.status in ('completed','cancelled') then
  raise exception 'Campaign conflict' using errcode='PT409'; end if;

 -- Match Catalog/PDV parent -> variant -> price lock order. Prevent disabling a
 -- selected SKU or changing/removing its store price during the validation.
 perform p.id from public.products p
  where p.organization_id=p_org and p.id in
   (select v.product_id from public.product_variants v
    where v.organization_id=p_org and v.id=any(v_variants))
  order by p.id for share;
 perform v.id from public.product_variants v
  where v.organization_id=p_org and v.id=any(v_variants)
  order by v.id for share;
 perform pp.variant_id from public.product_prices pp
  where pp.organization_id=p_org and pp.store_id=p_store
   and pp.variant_id=any(v_variants)
  order by pp.variant_id for share;
 select count(*)::integer into v_count from public.product_variants v
 join public.products p on p.organization_id=v.organization_id and p.id=v.product_id
 join public.product_prices pp on pp.organization_id=v.organization_id and pp.store_id=p_store
  and pp.variant_id=v.id
 where v.organization_id=p_org and v.id=any(v_variants) and v.active and p.active;
 if v_count<>cardinality(v_variants) then
  raise exception 'Campaign product unavailable' using errcode='22023'; end if;

 insert into public.marketing_campaign_details
  (organization_id,store_id,campaign_id,objective,content_body)
 values(p_org,p_store,p_campaign,p_objective,p_content)
 on conflict(organization_id,store_id,campaign_id) do update
  set objective=excluded.objective,content_body=excluded.content_body,updated_at=clock_timestamp();
 delete from public.marketing_campaign_products cp
  where cp.organization_id=p_org and cp.store_id=p_store and cp.campaign_id=p_campaign;
 insert into public.marketing_campaign_products
  (organization_id,store_id,campaign_id,variant_id,position)
 select p_org,p_store,p_campaign,u.variant_id,u.position::smallint
  from unnest(v_variants) with ordinality as u(variant_id,position);
 update public.marketing_campaigns c set revision=revision+1,updated_at=clock_timestamp()
  where c.organization_id=p_org and c.store_id=p_store and c.id=p_campaign
  returning c.revision into v_revision;
 v_result=jsonb_build_object('id',p_campaign,'status',v_campaign.status,'revision',v_revision::text);
 insert into private.marketing_rich_attempts
  (actor_id,key,organization_id,store_id,campaign_id,request,result)
 values(auth.uid(),p_key,p_org,p_store,p_campaign,v_request,v_result);
 insert into public.audit_events
  (organization_id,store_id,actor_user_id,action,entity_type,entity_id,origin,new_value)
 values(p_org,p_store,auth.uid(),'marketing.content','marketing_campaign',p_campaign,'database',
  jsonb_build_object('revision',v_revision,'objective',p_objective,
   'variantCount',cardinality(v_variants)));
 return v_result;
end $$;

revoke all on function public.marketing_cover_path(uuid,uuid,uuid),
 public.marketing_product_search(uuid,uuid,text,integer,integer),
 public.marketing_rich_read(uuid,uuid,timestamptz,timestamptz),
 public.marketing_rich_save(uuid,uuid,uuid,bigint,text,text,uuid[],uuid)
 from public,anon,authenticated;
grant execute on function public.marketing_cover_path(uuid,uuid,uuid),
 public.marketing_product_search(uuid,uuid,text,integer,integer),
 public.marketing_rich_read(uuid,uuid,timestamptz,timestamptz),
 public.marketing_rich_save(uuid,uuid,uuid,bigint,text,text,uuid[],uuid)
 to authenticated;
commit;
