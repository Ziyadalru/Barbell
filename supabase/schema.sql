-- Barbell Supabase schema
-- Run this in Supabase SQL Editor after creating the project.

create extension if not exists pgcrypto;

create type public.food_source_type as enum (
  'official',
  'label_verified',
  'owner_provided',
  'user_submitted',
  'estimated'
);

create type public.submission_status as enum (
  'pending',
  'approved',
  'rejected'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  name text not null,
  brand text,
  restaurant text,
  serving text not null default '100g',
  serving_grams numeric,
  serving_ml numeric,
  calories numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  fiber numeric not null default 0,
  sugar numeric not null default 0,
  saturated_fat numeric not null default 0,
  sodium numeric not null default 0,
  source_type public.food_source_type not null default 'user_submitted',
  source_url text,
  verified boolean not null default false,
  public_visible boolean not null default false,
  country_code text not null default 'SA',
  search_text text generated always as (
    lower(coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(restaurant, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.food_barcodes (
  barcode text primary key,
  food_id uuid not null references public.foods(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  source_type public.food_source_type not null default 'user_submitted',
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.food_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  barcode text,
  name text not null,
  brand text,
  restaurant text,
  serving text not null default '100g',
  serving_grams numeric,
  serving_ml numeric,
  calories numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  fiber numeric not null default 0,
  sugar numeric not null default 0,
  saturated_fat numeric not null default 0,
  sodium numeric not null default 0,
  image_url text,
  notes text,
  status public.submission_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_food_id uuid references public.foods(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index foods_public_search_idx on public.foods using gin (to_tsvector('simple', search_text));
create index foods_owner_idx on public.foods(owner_id);
create index foods_restaurant_idx on public.foods(restaurant) where restaurant is not null;
create index food_submissions_user_idx on public.food_submissions(submitted_by);
create index food_submissions_status_idx on public.food_submissions(status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger foods_set_updated_at
before update on public.foods
for each row execute function public.set_updated_at();

create trigger food_submissions_set_updated_at
before update on public.food_submissions
for each row execute function public.set_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger auth_user_created_create_profile
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.foods enable row level security;
alter table public.food_barcodes enable row level security;
alter table public.food_submissions enable row level security;

create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "Anyone can read public foods"
on public.foods for select
to anon, authenticated
using (public_visible = true or owner_id = auth.uid());

create policy "Users can create their own private foods"
on public.foods for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public_visible = false
  and verified = false
);

create policy "Users can update their own private foods"
on public.foods for update
to authenticated
using (owner_id = auth.uid() and verified = false)
with check (owner_id = auth.uid() and verified = false);

create policy "Users can delete their own private foods"
on public.foods for delete
to authenticated
using (owner_id = auth.uid() and verified = false);

create policy "Anyone can read verified barcodes"
on public.food_barcodes for select
to anon, authenticated
using (
  verified = true
  or created_by = auth.uid()
  or exists (
    select 1
    from public.foods f
    where f.id = food_barcodes.food_id
      and (f.public_visible = true or f.owner_id = auth.uid())
  )
);

create policy "Users can create barcodes for their own foods"
on public.food_barcodes for insert
to authenticated
with check (
  created_by = auth.uid()
  and verified = false
  and exists (
    select 1
    from public.foods f
    where f.id = food_barcodes.food_id
      and f.owner_id = auth.uid()
  )
);

create policy "Users can read their own submissions"
on public.food_submissions for select
to authenticated
using (submitted_by = auth.uid());

create policy "Users can create submissions"
on public.food_submissions for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
);

create policy "Users can update pending submissions"
on public.food_submissions for update
to authenticated
using (submitted_by = auth.uid() and status = 'pending')
with check (submitted_by = auth.uid() and status = 'pending');

insert into public.foods (
  name, brand, restaurant, serving, serving_grams,
  calories, protein, carbs, fat, fiber, sugar, saturated_fat, sodium,
  source_type, source_url, verified, public_visible
) values
  ('Big Mac', 'McDonald''s', 'McDonald''s Riyadh', '225g', 225, 603, 23, 53, 31, 4, 10, 12, 944, 'official', 'https://www.mcdonalds.com/sa/en-sa/riyadh/product/big-mac.html', true, true),
  ('McChicken', 'McDonald''s', 'McDonald''s Riyadh', '181g', 181, 453, 17, 49, 21, 3, 6, 4, 745, 'official', 'https://www.mcdonalds.com/sa/en-sa/riyadh/product/mcchicken.html', true, true),
  ('Quarter Pounder', 'McDonald''s', 'McDonald''s Riyadh', '195g', 195, 523, 32, 42, 25, 2, 9, 14, 1228, 'official', 'https://www.mcdonalds.com/sa/ar-sa/riyadh/product/quarter-pounder.html', true, true),
  ('Big Tasty', 'McDonald''s', 'McDonald''s Riyadh', '343g', 343, 870, 45, 61, 50, 4, 13, 22, 1677, 'official', 'https://www.mcdonalds.com/sa/en-sa/riyadh/product/big-tasty.html', true, true),
  ('Filet-O-Fish', 'McDonald''s', 'McDonald''s Riyadh', '139g', 139, 346, 14, 41, 14, 2, 5, 5, 640, 'official', 'https://www.mcdonalds.com/sa/en-sa/riyadh/product/filet-o-fish.html', true, true),
  ('9 Pcs Chicken McNuggets Meal', 'McDonald''s', 'McDonald''s Riyadh', '835g', 835, 737, 30, 70, 38, 8, 1, 5, 1177, 'official', 'https://www.mcdonalds.com/sa/en-sa/riyadh/meal/9pcs-chicken-mcnuggets-meal.html', true, true),
  ('Big Tasty Meal', 'McDonald''s', 'McDonald''s Riyadh', '1029g', 1029, 1252, 52, 108, 69, 10, 14, 24, 2178, 'official', 'https://www.mcdonalds.com/sa/en-sa/riyadh/meal/big-tasty-meal.html', true, true);
