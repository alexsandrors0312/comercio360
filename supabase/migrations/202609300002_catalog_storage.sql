-- Catálogo-only Storage policies. Supabase Storage must already be installed.
-- INSERT permits a reserved opaque path; SELECT only exposes an active cover.
-- SQL cover activation remains blocked
-- until the trusted processor attests the actual bytes in a later change.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('catalog-private','catalog-private',false,5242880,
 array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,
 allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create policy catalog_reserved_object_insert on storage.objects
 for insert to authenticated
 with check(bucket_id='catalog-private' and private.catalog_can_upload_object(name));

create policy catalog_authorized_object_read on storage.objects
 for select to authenticated
 using(bucket_id='catalog-private' and private.catalog_can_read_object(name));

-- No authenticated UPDATE or DELETE policy. Cleanup uses a restricted worker.
commit;
