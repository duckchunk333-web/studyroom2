-- Chạy toàn bộ file này trong Supabase > SQL Editor > New query.
-- Backend dùng service role key nên tuyệt đối không đưa key đó vào frontend/GitHub.
create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  description text not null default '' check (char_length(description) <= 250),
  code text not null unique check (code ~ '^[A-F0-9]{8}$'),
  owner_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.room_files (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  original_name text not null,
  size_bytes bigint not null check (size_bytes > 0),
  mime_type text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_room_members_user on public.room_members(user_id);
create index if not exists idx_messages_room_created on public.messages(room_id, created_at);
create index if not exists idx_room_files_room_created on public.room_files(room_id, created_at desc);

-- Bảng chỉ được backend truy cập bằng service role. Không bật quyền public/anon.
alter table public.users enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;
alter table public.room_files enable row level security;

-- Không tạo policy cho anon/authenticated. API server xác thực thành viên trước khi đọc/ghi.
