-- Marketing 013 reads reuse marketing_access, which takes FOR SHARE locks.
-- PostgREST must run these RPCs in a read-write transaction even though
-- they do not alter application data. Keep the lock used by writes.
begin;
alter function public.marketing_product_search(uuid,uuid,text,integer,integer) volatile;
alter function public.marketing_rich_read(uuid,uuid,timestamptz,timestamptz) volatile;
alter function public.marketing_cover_path(uuid,uuid,uuid) volatile;
commit;
notify pgrst, 'reload schema';
