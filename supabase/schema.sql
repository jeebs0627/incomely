-- Run once in the Supabase SQL editor. No service key is used by the app.
create table if not exists public.farms (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"entries":[],"goal":0}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint farm_shape check (jsonb_typeof(data->'entries') = 'array' and jsonb_typeof(data->'goal') = 'number'),
  constraint farm_size check (octet_length(data::text) <= 10000000)
);
alter table public.farms enable row level security;
revoke all on public.farms from anon;
grant select, insert, update on public.farms to authenticated;
drop policy if exists "Own farm" on public.farms;
create policy "Own farm" on public.farms for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Atomic compare-and-swap: a stale client can never overwrite newer data.
create or replace function public.save_farm(expected_revision bigint, next_data jsonb)
returns setof public.farms language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.farms (user_id) values (auth.uid()) on conflict do nothing;
  return query update public.farms set data = next_data, revision = revision + 1, updated_at = now()
    where user_id = auth.uid() and revision = expected_revision returning *;
end;
$$;
revoke all on function public.save_farm(bigint, jsonb) from public, anon;
grant execute on function public.save_farm(bigint, jsonb) to authenticated;
