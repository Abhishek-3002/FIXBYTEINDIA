-- FIXBYTE INDIA | CMADD Connected Medical Partner Verification
-- Run once in Supabase SQL Editor. Keep the service-role key server-side only.

create extension if not exists pgcrypto;

create table if not exists public.medical_stores (
  id uuid primary key default gen_random_uuid(),
  store_code text not null unique,
  store_name text not null,
  owner_name text not null,
  mobile text not null,
  email text,
  address text,
  gstin text,
  connection_status text not null default 'active' check (connection_status in ('active','inactive')),
  connection_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eligibility_cycles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.medical_stores(id),
  period_start date not null,
  period_end date not null,
  qualified_on date,
  total_amount numeric(12,2) not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress','qualified','expired','review_required')),
  created_at timestamptz not null default now(),
  unique(store_id, period_start)
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.medical_stores(id),
  cycle_id uuid references public.eligibility_cycles(id),
  bill_number text not null,
  bill_date date not null,
  bill_type text not null default 'sale' check (bill_type in ('sale','return')),
  related_bill_id uuid references public.bills(id),
  amount numeric(12,2) not null check (amount > 0),
  payment_status text not null default 'paid' check (payment_status in ('paid','credit','partial')),
  status text not null default 'valid' check (status in ('valid','cancelled')),
  note text,
  entered_by text not null default 'FIXBYTE Admin',
  created_at timestamptz not null default now(),
  unique(store_id, bill_number)
);

create table if not exists public.partner_cards (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.medical_stores(id),
  card_code text not null unique,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  issued_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_rewards (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.medical_stores(id),
  cycle_id uuid not null unique references public.eligibility_cycles(id),
  reward_code text not null unique,
  offer_amount numeric(8,2) not null default 99,
  status text not null default 'available' check (status in ('available','ordered','delivered','review_required','void')),
  earned_at timestamptz not null default now()
);

create table if not exists public.website_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.medical_stores(id),
  reward_id uuid not null unique references public.partner_rewards(id),
  amount numeric(8,2) not null default 99,
  status text not null default 'requested' check (status in ('requested','confirmed','in_progress','delivered','cancelled')),
  website_type text not null default 'static',
  domain_preference text,
  requirements text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.verification_logs (
  id bigint generated always as identity primary key,
  card_id uuid references public.partner_cards(id),
  result text not null,
  checked_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor text not null default 'FIXBYTE Admin',
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bills_store_date_idx on public.bills(store_id, bill_date);
create index if not exists rewards_store_idx on public.partner_rewards(store_id, earned_at desc);
create index if not exists verification_logs_card_idx on public.verification_logs(card_id, checked_at desc);

-- Process each newly entered bill. Paid, credit and partial bills all count.
-- Returns subtract from the cycle total; cancelled bills do not count.
create or replace function public.process_partner_bill(p_bill_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bills%rowtype;
  latest public.eligibility_cycles%rowtype;
  chosen_cycle uuid;
  running_total numeric(12,2);
  cycle_state text;
  reward_id uuid;
  reward_code text;
begin
  select * into b from public.bills where id = p_bill_id;
  if not found then raise exception 'Bill not found'; end if;

  if b.bill_type = 'sale' and exists (
    select 1 from public.bills
    where store_id = b.store_id and id <> b.id and bill_date > b.bill_date and bill_type = 'sale'
  ) then
    raise exception 'Backdated bill blocked: enter bills in date order for this store';
  end if;

  if b.bill_type = 'return' then
    if b.related_bill_id is null then
      raise exception 'Select the original purchase bill for this return';
    end if;
    select cycle_id into chosen_cycle
    from public.bills
    where id = b.related_bill_id and store_id = b.store_id and bill_type = 'sale';
    if chosen_cycle is null then
      raise exception 'Original bill not found or not assigned to an eligibility cycle';
    end if;
  else
    select * into latest
    from public.eligibility_cycles
    where store_id = b.store_id
    order by period_start desc
    limit 1;

    if latest.id is null then
      insert into public.eligibility_cycles(store_id, period_start, period_end)
      values (b.store_id, b.bill_date, b.bill_date + 3)
      returning id into chosen_cycle;
    elsif latest.status in ('qualified','review_required') and b.bill_date = latest.qualified_on then
      chosen_cycle := latest.id;
    elsif latest.status = 'in_progress' and b.bill_date <= latest.period_end then
      chosen_cycle := latest.id;
    elsif b.bill_date > coalesce(latest.qualified_on, latest.period_end) then
      if latest.status = 'in_progress' then
        update public.eligibility_cycles set status = 'expired' where id = latest.id;
      end if;
      insert into public.eligibility_cycles(store_id, period_start, period_end)
      values (b.store_id, b.bill_date, b.bill_date + 3)
      returning id into chosen_cycle;
    else
      raise exception 'Bill date does not fit the current four-day purchase cycle';
    end if;
  end if;

  update public.bills set cycle_id = chosen_cycle where id = b.id;

  select coalesce(sum(
    case when bill_type = 'return' then -amount else amount end
  ),0)
  into running_total
  from public.bills
  where cycle_id = chosen_cycle and status = 'valid';

  select status into cycle_state from public.eligibility_cycles where id = chosen_cycle;

  if running_total >= 12000 and cycle_state = 'in_progress' then
    update public.eligibility_cycles
      set total_amount = running_total, status = 'qualified', qualified_on = b.bill_date
      where id = chosen_cycle;
    reward_code := 'FB99-' || upper(substr(encode(gen_random_bytes(5),'hex'),1,10));
    insert into public.partner_rewards(store_id, cycle_id, reward_code)
      values (b.store_id, chosen_cycle, reward_code)
      on conflict (cycle_id) do nothing
      returning id into reward_id;
  elsif cycle_state = 'qualified' and running_total < 12000 then
    update public.eligibility_cycles set total_amount = running_total, status = 'review_required' where id = chosen_cycle;
    update public.partner_rewards set status = 'review_required' where cycle_id = chosen_cycle and status = 'available';
  elsif cycle_state = 'review_required' and running_total >= 12000 then
    update public.eligibility_cycles set total_amount = running_total, status = 'qualified' where id = chosen_cycle;
    update public.partner_rewards set status = 'available' where cycle_id = chosen_cycle and status = 'review_required';
  else
    update public.eligibility_cycles set total_amount = running_total where id = chosen_cycle;
  end if;

  return jsonb_build_object(
    'cycle_id', chosen_cycle,
    'total_amount', running_total,
    'threshold', 12000,
    'cycle_status', (select status from public.eligibility_cycles where id = chosen_cycle),
    'reward_created', reward_id is not null
  );
end;
$$;

 
create or replace function public.recalculate_partner_cycle(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  running_total numeric(12,2);
  cycle_row public.eligibility_cycles%rowtype;
begin
  select * into cycle_row from public.eligibility_cycles where id = p_cycle_id;
  if not found then raise exception 'Eligibility cycle not found'; end if;
  select coalesce(sum(case when bill_type='return' then -amount else amount end),0)
    into running_total
    from public.bills where cycle_id=p_cycle_id and status='valid';
  if cycle_row.status in ('qualified','review_required') and running_total < 12000 then
    update public.eligibility_cycles set total_amount=running_total,status='review_required' where id=p_cycle_id;
    update public.partner_rewards set status='review_required' where cycle_id=p_cycle_id and status in ('available','review_required');
  elsif cycle_row.status='review_required' and running_total >= 12000 then
    update public.eligibility_cycles set total_amount=running_total,status='qualified' where id=p_cycle_id;
    update public.partner_rewards set status='available' where cycle_id=p_cycle_id and status='review_required';
  else
    update public.eligibility_cycles set total_amount=running_total where id=p_cycle_id;
  end if;
  return jsonb_build_object('cycle_id',p_cycle_id,'total_amount',running_total,'cycle_status',(select status from public.eligibility_cycles where id=p_cycle_id));
end;
$;

grant execute on function public.recalculate_partner_cycle(uuid) to service_role;

-- Lock direct browser access. API functions use the Supabase service-role key.
alter table public.medical_stores enable row level security;
alter table public.bills enable row level security;
alter table public.eligibility_cycles enable row level security;
alter table public.partner_cards enable row level security;
alter table public.partner_rewards enable row level security;
alter table public.website_orders enable row level security;
alter table public.verification_logs enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.medical_stores, public.bills, public.eligibility_cycles,
  public.partner_cards, public.partner_rewards, public.website_orders,
  public.verification_logs, public.audit_logs from anon, authenticated;
grant all on public.medical_stores, public.bills, public.eligibility_cycles,
  public.partner_cards, public.partner_rewards, public.website_orders,
  public.verification_logs, public.audit_logs to service_role;
grant execute on function public.process_partner_bill(uuid) to service_role;
