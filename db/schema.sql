-- katazuku データ基盤(spec08 / DB中心)の初期スキーマ  ※Postgres想定(Vercel Marketplace Neon 等)
-- 正(source of truth)= このDB。アプリ/カレンダー/Sheet は "見る窓"。書き手は agent 1つ。
-- 適用: DBプロビジョニング後に `psql "$DATABASE_URL" -f db/schema.sql`(または Neon SQL Editor に貼付)。
-- 「合格/不合格/辞退は上書きしない」という旧sheet.tsの苦肉の策はここでは採らない。
-- status は遷移規則(アプリ/agent側)で正しく更新し、updated_at / updated_by で最終更新を追える。

create table if not exists company (
  id          bigint generated always as identity primary key,
  name        text not null,
  -- 名寄せキー: NFKC正規化+小文字+空白除去した正規化名(sameCompang相当)。重複検出・照合に使う
  name_key    text not null,
  industry    text,
  position    text,          -- ポジション/職種(例: ビジネス職(新卒710万プログラム))
  priority    text,          -- 志望度
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists company_name_key_uk on company (name_key);

-- 選考(1企業に複数トラック可: 例 GMOのビジネス職/技術職)
create table if not exists selection (
  id           bigint generated always as identity primary key,
  company_id   bigint not null references company(id) on delete cascade,
  season       text,                     -- 夏 / 冬 / 本選考 / 長期 / 春
  status       text not null default '', -- 自由記述ステータス(例: 参加確定 8/24-29 / 不合格 / 辞退)
  next_action  text,
  next_date    date,
  source_note  text,                     -- 根拠メモ(どのメール/議事録からか)
  updated_at   timestamptz not null default now(),
  updated_by   text not null default 'agent'  -- agent / user(アプリ操作)
);
create index if not exists selection_company_idx on selection (company_id);

-- 面接ノート(spec06/08。議事録の構造化。配列は text[] で保持)
create table if not exists interview_note (
  id               bigint generated always as identity primary key,
  company_id       bigint not null references company(id) on delete cascade,
  held_on          date,
  kind             text,        -- カジュアル面談 / 一次 / 二次 / 最終 / 人事 等
  interviewer      text,
  asked            text[] not null default '{}',  -- 聞かれたこと
  highlights       text[] not null default '{}',  -- 話したこと・自己分析素材
  first_party_info text[] not null default '{}',  -- 相手が話した一次情報
  concerns         text[] not null default '{}',  -- 懸念フラグ
  next_actions     text[] not null default '{}',
  source           text,        -- logs/interviews/<...>.txt への参照
  created_at       timestamptz not null default now()
);
create index if not exists interview_note_company_idx on interview_note (company_id);

-- 人脈(spec07)。最小構成。企業と緩く紐付く
create table if not exists person (
  id           bigint generated always as identity primary key,
  name         text not null,
  company_id   bigint references company(id) on delete set null,
  role         text,
  met_on       date,
  context      text,        -- どこで会ったか/顔メモ等
  created_at   timestamptz not null default now()
);

-- ES素材 / 個人マスタ(ガクチカ・自己分析・志望動機の部品)
create table if not exists es_snippet (
  id           bigint generated always as identity primary key,
  category     text,        -- ガクチカ / 自己PR / 志望動機 / 研究 / 性格 等
  title        text,
  body         text not null,
  used_at      text[] not null default '{}',  -- その部品を使った企業名/選考
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
