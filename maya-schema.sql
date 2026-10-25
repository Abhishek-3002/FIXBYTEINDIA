-- Run in the FIXBYTE-specific Supabase project SQL Editor. Do NOT use the CMADD2 project.
create extension if not exists pgcrypto;
create table if not exists public.maya_conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  user_message text not null,
  assistant_message text not null,
  page_path text not null default '/',
  created_at timestamptz not null default now()
);
create index if not exists maya_conversations_created_at_idx on public.maya_conversations (created_at desc);
create table if not exists public.maya_leads (
  id uuid primary key default gen_random_uuid(),
  meeting_id text unique,
  full_name text not null,
  phone text not null,
  email text,
  business_name text,
  plan text,
  budget text,
  website_type text,
  features text,
  timeline text,
  meeting_type text,
  meeting_date date,
  meeting_time text,
  requirements text,
  source text not null default 'maya_chat',
  status text not null default 'new' check (status in ('new','contacted','qualified','meeting_requested','converted','closed')),
  created_at timestamptz not null default now()
);
create index if not exists maya_leads_created_at_idx on public.maya_leads (created_at desc);
create index if not exists maya_leads_status_idx on public.maya_leads (status);
alter table public.maya_conversations enable row level security;
alter table public.maya_leads enable row level security;
-- No public/anon policies: all writes must go through the Vercel serverless endpoint using server-only service-role credentials.
revoke all on public.maya_conversations from anon, authenticated;
revoke all on public.maya_leads from anon, authenticated;
