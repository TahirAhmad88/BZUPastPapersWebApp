-- ============================================================
-- BZU Past Papers — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. papers table
-- ------------------------------------------------------------
create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  subject text not null,                          -- stored lowercase for case-insensitive search
  session text not null,                           -- "2024" or "2024-2028"
  semester int not null check (semester between 1 and 8),
  teacher text,
  term text,                                        -- "Mid" | "Final" | null
  keywords text,
  file_name text not null,
  file_url text not null,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  download_count int not null default 0,
  uploaded_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz
);

create index if not exists papers_status_idx on public.papers (status);
create index if not exists papers_subject_idx on public.papers (subject);

alter table public.papers enable row level security;

-- Public visitors only ever see approved papers. Anyone signed in
-- (i.e. an admin — this app has no other authenticated role) can
-- also see pending/rejected papers, for the review queue.
create policy "read approved papers, admins read all"
  on public.papers for select
  using (status = 'approved' or auth.uid() is not null);

-- Anyone (including signed-out visitors) can submit a new paper.
-- It always lands as 'pending' with a zero download count — an
-- upload can never insert itself as pre-approved.
create policy "anyone can submit a paper"
  on public.papers for insert
  with check (
    status = 'pending'
    and download_count = 0
    and semester between 1 and 8
    and session ~ '^[0-9]{4}(-[0-9]{4})?$'
  );

-- Only a signed-in admin can update a paper (approve/reject/edit).
-- (The public "download +1" path does NOT go through this — see
-- the increment_download_count() function below, which is scoped
-- to just that one counter on approved papers.)
create policy "admins can update papers"
  on public.papers for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "admins can delete papers"
  on public.papers for delete
  using (auth.uid() is not null);

-- ------------------------------------------------------------
-- Duplicate check: signed-out visitors can only SELECT approved rows
-- (see the policy above), so a plain query from the browser can't see
-- a matching paper that's still sitting in the pending queue — two
-- different students could both submit the same paper before either
-- one is reviewed. This function checks across ALL statuses (bypassing
-- RLS via SECURITY DEFINER) but returns only a true/false match, never
-- the pending paper's actual data, so nothing not-yet-approved leaks.
-- ------------------------------------------------------------
create or replace function public.check_duplicate_paper(
  p_subject text, p_session text, p_semester int
) returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.papers
    where subject = p_subject
      and session = p_session
      and semester = p_semester
      and status in ('pending', 'approved')
  );
$$;

grant execute on function public.check_duplicate_paper(text, text, int) to anon, authenticated;

-- ------------------------------------------------------------
-- Download counter: a SECURITY DEFINER function lets a signed-out
-- visitor bump download_count by exactly 1 on an approved paper,
-- without granting them general UPDATE rights on the table.
-- ------------------------------------------------------------
create or replace function public.increment_download_count(paper_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.papers
  set download_count = download_count + 1
  where id = paper_id and status = 'approved';
end;
$$;

grant execute on function public.increment_download_count(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 2. admins table — directory of who's allowed to sign in as admin
-- ------------------------------------------------------------
create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  email text not null unique,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

create policy "admins can view the admin list"
  on public.admins for select
  using (auth.uid() is not null);

-- Only the primary admin (matched on their auth token's email — no
-- server needed) can add a new admin record.
create policy "only primary admin can add admins"
  on public.admins for insert
  with check ((auth.jwt() ->> 'email') = 'tahir@admin.com');

-- No update/delete policy is defined for admins, so both are
-- denied by default under RLS.

-- ------------------------------------------------------------
-- 3. Storage bucket for paper files
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('papers', 'papers', true)
on conflict (id) do nothing;

-- Anyone can read a file if they have its path (bucket is public).
create policy "public read of paper files"
  on storage.objects for select
  using (bucket_id = 'papers');

-- Anyone (including signed-out visitors) can upload a new file.
create policy "anyone can upload a paper file"
  on storage.objects for insert
  with check (bucket_id = 'papers');

-- Files are immutable once uploaded — re-upload as a new file instead.
create policy "no overwriting existing files"
  on storage.objects for update
  using (false);

-- Only a signed-in admin can delete a file (used when rejecting a
-- pending paper, or deleting an approved one).
create policy "admins can delete paper files"
  on storage.objects for delete
  using (bucket_id = 'papers' and auth.uid() is not null);

-- ============================================================
-- After running this: go to Authentication → Users → Add user
-- to create tahir@admin.com with a password of your choice.
-- See README.md for the full walkthrough.
-- ============================================================
