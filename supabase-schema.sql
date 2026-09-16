-- Run this entire file once in Supabase > SQL Editor.

create table if not exists public.notebooks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  content jsonb not null default '{"settings":{},"weeks":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.share_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text unique not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.notebooks enable row level security;
alter table public.share_links enable row level security;

revoke all on public.notebooks from anon;
revoke all on public.share_links from anon;
grant select, insert, update, delete on public.notebooks to authenticated;
grant select, insert, update, delete on public.share_links to authenticated;

drop policy if exists "Owners manage their notebook" on public.notebooks;
create policy "Owners manage their notebook"
on public.notebooks for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Owners manage their share link" on public.share_links;
create policy "Owners manage their share link"
on public.share_links for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.get_shared_notebook(p_token text)
returns table(content jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select notebooks.content
  from public.share_links
  join public.notebooks on notebooks.user_id = share_links.user_id
  where share_links.token = p_token
    and share_links.enabled = true
  limit 1;
$$;

revoke all on function public.get_shared_notebook(text) from public;
grant execute on function public.get_shared_notebook(text) to anon, authenticated;
