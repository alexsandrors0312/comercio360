-- Pacote 002: trusted image attestation. Requires a 32-byte key provisioned
-- into private.catalog_image_attestation_key and the matching app runtime env.
-- The migration itself never contains a secret.
begin;

create table private.catalog_image_attestation_key (
 singleton boolean primary key default true check(singleton),
 secret bytea not null check(octet_length(secret)=32),
 created_at timestamptz not null default now()
);
revoke all on private.catalog_image_attestation_key from public,anon,authenticated;
alter table private.catalog_image_attestation_key enable row level security;

alter table public.catalog_image_objects
 add column content_sha256 text check(content_sha256 ~ '^[0-9a-f]{64}$');

-- HMAC-SHA256 using PostgreSQL's built-in sha256; PGlite can verify this
-- implementation against standard Node crypto vectors without pgcrypto.
create function private.catalog_hmac_sha256(p_payload bytea,p_key bytea)
returns bytea language plpgsql immutable set search_path='' as $$
declare inner_pad bytea=decode(repeat('00',64),'hex');
 outer_pad bytea=decode(repeat('00',64),'hex');
 index_value integer; value integer;
begin
 if octet_length(p_key)<>32 then
  raise exception 'Image attestation key unavailable' using errcode='42501';
 end if;
 for index_value in 0..63 loop
  value=case when index_value<32 then get_byte(p_key,index_value) else 0 end;
  inner_pad=set_byte(inner_pad,index_value,value # 54);
  outer_pad=set_byte(outer_pad,index_value,value # 92);
 end loop;
 return sha256(outer_pad || sha256(inner_pad || p_payload));
end; $$;

create function private.catalog_equal_mac(p_left bytea,p_right bytea)
returns boolean language plpgsql immutable set search_path='' as $$
declare difference integer=0; index_value integer;
begin
 if octet_length(p_left)<>32 or octet_length(p_right)<>32 then return false; end if;
 for index_value in 0..31 loop
  difference=difference | (get_byte(p_left,index_value) # get_byte(p_right,index_value));
 end loop;
 return difference=0;
end; $$;

create function public.catalog_mark_image_attested(
 p_organization_id uuid,p_store_id uuid,p_object_id uuid,
 p_mime_type text,p_byte_size integer,p_width integer,p_height integer,
 p_sha256_hex text,p_expires_unix bigint,p_mac_hex text
) returns uuid language plpgsql security definer set search_path='' as $$
declare image public.catalog_image_objects%rowtype; key_bytes bytea;
 payload text; expected bytea; actual bytea; now_unix bigint;
begin
 perform private.catalog_require_write(p_organization_id,p_store_id);
 select * into image from public.catalog_image_objects o
 where o.organization_id=p_organization_id and o.id=p_object_id for update;
 if not found or image.state<>'reserved' or image.actor_user_id is distinct from auth.uid() then
  raise exception 'Image object unavailable' using errcode='42501';
 end if;
 if p_mime_type not in ('image/jpeg','image/png','image/webp')
  or p_byte_size not between 1 and 5242880
  or p_width not between 1 and 10000 or p_height not between 1 and 10000
  or p_width::bigint*p_height::bigint>25000000
  or p_sha256_hex is null or p_sha256_hex !~ '^[0-9a-f]{64}$'
  or p_mac_hex is null or p_mac_hex !~ '^[0-9a-f]{64}$' then
  raise exception 'Invalid image attestation' using errcode='22023';
 end if;
 now_unix=floor(extract(epoch from clock_timestamp()))::bigint;
 if p_expires_unix is null or p_expires_unix<now_unix or p_expires_unix>now_unix+300 then
  raise exception 'Expired image attestation' using errcode='42501';
 end if;
 select k.secret into key_bytes from private.catalog_image_attestation_key k where k.singleton=true;
 if key_bytes is null then
  raise exception 'Image attestation not configured' using errcode='42501';
 end if;
 if not exists(select 1 from storage.objects s
  where s.bucket_id='catalog-private' and s.name=image.object_path) then
  raise exception 'Image object unavailable' using errcode='42501';
 end if;
 payload=concat_ws('|','catalog-image-v1',p_organization_id::text,p_store_id::text,
  image.product_id::text,p_object_id::text,image.actor_user_id::text,p_mime_type,
  p_byte_size::text,p_width::text,p_height::text,p_sha256_hex,p_expires_unix::text);
 expected=private.catalog_hmac_sha256(convert_to(payload,'UTF8'),key_bytes);
 actual=decode(p_mac_hex,'hex');
 if not private.catalog_equal_mac(expected,actual) then
  raise exception 'Invalid image attestation' using errcode='42501';
 end if;
 update public.catalog_image_objects o set state='uploaded',mime_type=p_mime_type,
  byte_size=p_byte_size,width=p_width,height=p_height,content_sha256=p_sha256_hex
 where o.organization_id=p_organization_id and o.id=p_object_id;
 return p_object_id;
end; $$;

revoke all on function private.catalog_hmac_sha256(bytea,bytea),
 private.catalog_equal_mac(bytea,bytea) from public,anon,authenticated;
revoke all on function public.catalog_mark_image_attested(
 uuid,uuid,uuid,text,integer,integer,integer,text,bigint,text) from public,anon;
grant execute on function public.catalog_mark_image_attested(
 uuid,uuid,uuid,text,integer,integer,integer,text,bigint,text) to authenticated;
commit;
