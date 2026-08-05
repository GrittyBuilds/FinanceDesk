-- Finance Desk — Supabase setup
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- It creates the tables, locks them with Row-Level Security, and exposes a small
-- set of SECURITY DEFINER functions the app calls (so all access is mediated and
-- users only ever touch workspaces they belong to).

-- ---------- Tables ----------
create table if not exists public.fd_workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'shared',            -- 'personal' | 'shared'
  owner      uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.fd_members (
  workspace_id uuid references public.fd_workspaces(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  role         text not null default 'member',          -- 'owner' | 'member'
  primary key (workspace_id, user_id)
);

create table if not exists public.fd_data (
  workspace_id uuid primary key references public.fd_workspaces(id) on delete cascade,
  version      bigint not null default 0,
  data         jsonb  not null default '{}'::jsonb,      -- plaintext dataset OR E2E envelope
  updated_at   timestamptz not null default now()
);

create table if not exists public.fd_invites (
  code         text primary key,
  workspace_id uuid references public.fd_workspaces(id) on delete cascade,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- ---------- Lock the tables (no direct table access; only the functions below) ----------
alter table public.fd_workspaces enable row level security;
alter table public.fd_members    enable row level security;
alter table public.fd_data       enable row level security;
alter table public.fd_invites    enable row level security;
-- No policies are created, so the `anon`/`authenticated` roles cannot read or
-- write these tables directly. The SECURITY DEFINER functions run as the table
-- owner and enforce membership via auth.uid().

-- ---------- Helper: is the current user a member of a workspace? ----------
create or replace function public.fd_is_member(ws uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from fd_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;

-- ---------- List my workspaces (auto-creating a Personal one on first use) ----------
create or replace function public.fd_list()
returns json language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from fd_members where user_id = auth.uid()) then
    insert into fd_workspaces(name, kind, owner) values ('Personal', 'personal', auth.uid()) returning id into pid;
    insert into fd_members(workspace_id, user_id, role) values (pid, auth.uid(), 'owner');
    insert into fd_data(workspace_id) values (pid);
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', w.id, 'name', w.name, 'kind', w.kind, 'role', m.role,
             'version', d.version, 'updatedAt', d.updated_at) order by w.created_at)
    from fd_members m
    join fd_workspaces w on w.id = m.workspace_id
    left join fd_data d on d.workspace_id = w.id
    where m.user_id = auth.uid()
  ), '[]'::json);
end; $$;

-- ---------- Create a shared workspace ----------
create or replace function public.fd_create_ws(p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare wid uuid; nm text := coalesce(nullif(trim(p_name), ''), 'Shared');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into fd_workspaces(name, kind, owner) values (nm, 'shared', auth.uid()) returning id into wid;
  insert into fd_members(workspace_id, user_id, role) values (wid, auth.uid(), 'owner');
  insert into fd_data(workspace_id) values (wid);
  return json_build_object('id', wid, 'name', nm, 'kind', 'shared', 'role', 'owner', 'version', 0);
end; $$;

-- ---------- Create an invite code for a shared workspace ----------
create or replace function public.fd_invite(p_ws uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not fd_is_member(p_ws) then raise exception 'not a member'; end if;
  if (select kind from fd_workspaces where id = p_ws) <> 'shared' then raise exception 'only shared workspaces can be invited to'; end if;
  c := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  insert into fd_invites(code, workspace_id, created_by) values (c, p_ws, auth.uid());
  return json_build_object('code', c);
end; $$;

-- ---------- Join a workspace with an invite code ----------
create or replace function public.fd_join(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare wid uuid; w record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select workspace_id into wid from fd_invites where code = upper(trim(p_code));
  if wid is null then raise exception 'invalid invite code'; end if;
  insert into fd_members(workspace_id, user_id, role) values (wid, auth.uid(), 'member')
    on conflict (workspace_id, user_id) do nothing;
  select w2.id, w2.name, w2.kind, d.version into w
    from fd_workspaces w2 left join fd_data d on d.workspace_id = w2.id where w2.id = wid;
  return json_build_object('id', w.id, 'name', w.name, 'kind', w.kind, 'role', 'member', 'version', coalesce(w.version, 0));
end; $$;

-- ---------- Pull a workspace's data ----------
create or replace function public.fd_pull(p_ws uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not fd_is_member(p_ws) then raise exception 'not a member'; end if;
  return (select json_build_object('version', version, 'data', data, 'updatedAt', updated_at)
          from fd_data where workspace_id = p_ws);
end; $$;

-- ---------- Push data with optimistic concurrency (compare-and-set on version) ----------
create or replace function public.fd_push(p_ws uuid, p_base bigint, p_data jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not fd_is_member(p_ws) then raise exception 'not a member'; end if;
  update fd_data set data = p_data, version = version + 1, updated_at = now()
    where workspace_id = p_ws and version = p_base
    returning version into v;
  if v is null then
    return json_build_object('ok', false, 'version', (select version from fd_data where workspace_id = p_ws));
  end if;
  return json_build_object('ok', true, 'version', v, 'updatedAt', now());
end; $$;

-- ---------- Allow logged-in users to call the functions ----------
grant execute on function public.fd_list()                       to authenticated;
grant execute on function public.fd_create_ws(text)              to authenticated;
grant execute on function public.fd_invite(uuid)                 to authenticated;
grant execute on function public.fd_join(text)                   to authenticated;
grant execute on function public.fd_pull(uuid)                   to authenticated;
grant execute on function public.fd_push(uuid, bigint, jsonb)    to authenticated;
