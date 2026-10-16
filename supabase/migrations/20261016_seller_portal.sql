-- Seller DD portal (Oct 2026)
-- Sellers answer every checklist item themselves through a tokenized link (/seller/<token>).
-- Each item gets one of three answers, like a mortgage application:
--   1. the answer or a file            -> status 'received' (to verify)
--   2. coming soon, with a date        -> status 'coming_soon' + expected_date
--   3. will not be provided, ever      -> status 'declined'
-- Scoring: verified/received = full credit, partial = 1/2, declined = 1/3, coming_soon = 0.

-- 1. New status + fields on checklist items
alter table route_dd_items drop constraint if exists route_dd_items_status_check;
alter table route_dd_items add constraint route_dd_items_status_check
  check (status = any (array['open','requested','partial','received','verified','declined','na','coming_soon']));
alter table route_dd_items add column if not exists expected_date date;
alter table route_dd_items add column if not exists seller_answered_at timestamptz;

-- 2. Seller link bookkeeping
alter table dd_seller_requests alter column expires_at set default (now() + interval '60 days');
alter table dd_seller_requests add column if not exists revoked_at timestamptz;
alter table dd_seller_requests add column if not exists last_seen_at timestamptz;
alter table dd_seller_requests add column if not exists answers_count integer not null default 0;
alter table dd_seller_requests add column if not exists last_reminder_at timestamptz;
alter table dd_seller_requests add column if not exists reminder_count integer not null default 0;
create index if not exists dd_seller_requests_route_idx on dd_seller_requests (route_id, created_at desc);

-- 3. Item view: pass coming_soon through, expose expected_date
create or replace view v_route_dd_items as
 SELECT r.id AS route_id,
    r.slug,
    r.title,
    r.status AS route_status,
    c.item_key,
    c.section,
    c.label,
    c.weight,
    c.required,
    c.sort_order,
    c.seller_question,
    i.status,
    i.answer_text,
    i.source_who,
    i.source_method,
    i.source_date,
    i.source_note,
    i.declined_at,
    i.declined_reason,
    i.flagged,
    i.flag_note,
    i.first_asked_at,
    i.closed_at,
        CASE
            WHEN i.status = ANY (ARRAY['verified'::text, 'received'::text, 'partial'::text, 'declined'::text, 'na'::text, 'coming_soon'::text]) THEN i.status
            WHEN (EXISTS ( SELECT 1
               FROM unnest(COALESCE(c.source_columns, '{}'::text[])) col(col)
              WHERE NULLIF(TRIM(BOTH FROM to_jsonb(r.*) ->> col.col), ''::text) IS NOT NULL AND ((to_jsonb(r.*) ->> col.col) <> ALL (ARRAY['[]'::text, '{}'::text])))) THEN 'filled_unsourced'::text
            WHEN i.status = 'requested'::text THEN 'requested'::text
            ELSE 'missing'::text
        END AS state,
    c.visibility,
    i.updated_by,
    i.updated_at,
    COALESCE(i.buyer_asks, 0) AS buyer_asks,
    i.last_buyer_ask_at,
    i.expected_date,
    i.seller_answered_at
   FROM atm_routes r
     JOIN dd_checklist_items c ON c.vertical_id = r.vertical_id
     LEFT JOIN route_dd_items i ON i.route_id = r.id AND i.item_key = c.item_key;

-- 4. Score view: declined = 1/3 credit, coming_soon = 0 (still a gap), plus seller-link status
create or replace view v_route_dd_score as
 WITH items AS (
         SELECT v.route_id,
            sum(v.weight) FILTER (WHERE v.required AND v.state <> 'na'::text) AS w_total,
            sum(v.weight::numeric *
                CASE
                    WHEN v.state = ANY (ARRAY['verified'::text, 'received'::text]) THEN 1::numeric
                    WHEN v.state = ANY (ARRAY['partial'::text, 'filled_unsourced'::text]) THEN 0.5
                    WHEN v.state = 'declined'::text THEN 1::numeric / 3::numeric
                    ELSE 0::numeric
                END) FILTER (WHERE v.required AND v.state <> 'na'::text) AS w_done,
            count(*) FILTER (WHERE v.required AND v.state <> 'na'::text) AS n_applicable,
            count(*) FILTER (WHERE v.required AND (v.state = ANY (ARRAY['verified'::text, 'declined'::text]))) AS n_closed,
            count(*) FILTER (WHERE v.required AND v.state = 'verified'::text) AS n_verified,
            count(*) FILTER (WHERE v.required AND (v.state = ANY (ARRAY['missing'::text, 'requested'::text, 'partial'::text, 'filled_unsourced'::text, 'coming_soon'::text]))) AS n_gaps,
            array_agg(v.item_key ORDER BY v.sort_order) FILTER (WHERE v.state = ANY (ARRAY['missing'::text, 'requested'::text])) AS missing_keys,
            array_agg(v.item_key ORDER BY v.sort_order) FILTER (WHERE v.state = ANY (ARRAY['partial'::text, 'filled_unsourced'::text])) AS partial_keys,
            array_agg(v.item_key ORDER BY v.sort_order) FILTER (WHERE v.state = 'received'::text) AS to_verify_keys,
            sum(v.buyer_asks) AS buyer_asks_total,
            sum(v.buyer_asks) FILTER (WHERE v.state = ANY (ARRAY['missing'::text, 'requested'::text, 'partial'::text, 'filled_unsourced'::text, 'coming_soon'::text])) AS buyer_asks_open,
            array_agg(v.item_key ORDER BY v.buyer_asks DESC) FILTER (WHERE v.buyer_asks > 0 AND (v.state = ANY (ARRAY['missing'::text, 'requested'::text, 'partial'::text, 'filled_unsourced'::text, 'coming_soon'::text]))) AS asked_open_keys,
            count(*) FILTER (WHERE v.required AND (v.state = ANY (ARRAY['verified'::text, 'received'::text]))) AS n_documented,
            sum(v.weight) FILTER (WHERE v.required AND v.state = 'verified'::text) AS w_verified,
            sum(v.weight) FILTER (WHERE v.required AND (v.state <> ALL (ARRAY['na'::text, 'declined'::text]))) AS w_verifiable,
            count(*) FILTER (WHERE v.state = 'coming_soon'::text) AS n_coming_soon,
            count(*) FILTER (WHERE v.state = 'coming_soon'::text AND v.expected_date < CURRENT_DATE) AS n_coming_overdue,
            count(*) FILTER (WHERE v.state = 'declined'::text) AS n_declined,
            max(v.seller_answered_at) AS last_seller_answer_at
           FROM v_route_dd_items v
          GROUP BY v.route_id
        ), touch AS (
         SELECT t_1.route_id,
            count(*) AS touches,
            max(t_1.sent_at) AS last_touch_at,
            max(t_1.replied_at) AS last_reply_at,
            count(*) FILTER (WHERE t_1.replied_at IS NULL AND t_1.sent_at > COALESCE(( SELECT max(t2.replied_at) AS max
                   FROM dd_touches t2
                  WHERE t2.route_id = t_1.route_id), '-infinity'::timestamp with time zone)) AS unanswered
           FROM dd_touches t_1
          GROUP BY t_1.route_id
        ), flags AS (
         SELECT route_dd_flags.route_id,
            count(*) FILTER (WHERE NOT route_dd_flags.resolved) AS open_flags
           FROM route_dd_flags
          GROUP BY route_dd_flags.route_id
        ), link AS (
         SELECT DISTINCT ON (q.route_id) q.route_id, q.created_at, q.opened_at, q.submitted_at, q.last_seen_at, q.expires_at
           FROM dd_seller_requests q
          WHERE q.revoked_at IS NULL
          ORDER BY q.route_id, q.created_at DESC
        )
 SELECT r.id AS route_id,
    r.slug,
    r.title,
    r.status,
    r.asking_price,
    r.nda_count,
    r.inquiry_count,
    round(100.0 * i.w_done / NULLIF(i.w_total, 0)::numeric) AS dd_score,
    i.n_applicable,
    i.n_closed,
    i.n_verified,
    i.n_gaps,
    i.missing_keys,
    i.partial_keys,
    i.to_verify_keys,
    i.n_closed = i.n_applicable AS file_complete,
    COALESCE(f.open_flags, 0::bigint) AS open_flags,
    COALESCE(t.touches, 0::bigint) AS touches,
    COALESCE(t.unanswered, 0::bigint) AS unanswered_touches,
    t.last_touch_at,
    t.last_reply_at,
        CASE COALESCE(t.unanswered, 0::bigint)
            WHEN 0 THEN NULL::timestamp with time zone
            WHEN 1 THEN add_business_days(t.last_touch_at, 3)
            WHEN 2 THEN add_business_days(t.last_touch_at, 4)
            WHEN 3 THEN add_business_days(t.last_touch_at, 5)
            ELSE NULL::timestamp with time zone
        END AS next_touch_due,
        CASE COALESCE(t.unanswered, 0::bigint)
            WHEN 2 THEN 'phone'::text
            WHEN 3 THEN 'final_email'::text
            ELSE 'email'::text
        END AS next_touch_channel,
    COALESCE(t.unanswered, 0::bigint) >= 3 AND COALESCE(r.asking_price, 0::numeric) > 500000::numeric AS escalate_to_john,
    COALESCE(r.monthly_net_max, r.monthly_net_min) > COALESCE(r.monthly_gross_max, r.monthly_gross_min) AS flag_net_gt_gross,
    round(r.asking_price / NULLIF(12::numeric * COALESCE(r.monthly_net_min, r.monthly_net_max), 0::numeric), 2) AS annual_net_multiple,
    COALESCE(r.asking_price, 0::numeric) * (1::numeric + COALESCE(r.nda_count, 0)::numeric * 0.25 + LEAST(COALESCE(i.buyer_asks_open, 0::bigint), 20::bigint)::numeric * 0.1) AS priority_score,
    COALESCE(i.buyer_asks_total, 0::bigint) AS buyer_asks_total,
    COALESCE(i.buyer_asks_open, 0::bigint) AS buyer_asks_open,
    i.asked_open_keys,
    i.n_documented,
    r.dd_badge_enabled,
    COALESCE(round(100.0 * COALESCE(i.w_verified, 0::bigint)::numeric / NULLIF(i.w_verifiable, 0)::numeric), 0::numeric) AS verified_score,
    round(100.0 * i.w_done / NULLIF(i.w_total, 0)::numeric) >= 70::numeric AS meets_floor,
    i.n_coming_soon,
    i.n_coming_overdue,
    i.n_declined,
    i.last_seller_answer_at,
    l.created_at AS seller_link_sent_at,
    l.opened_at AS seller_link_opened_at,
    l.last_seen_at AS seller_last_seen_at,
    l.submitted_at AS seller_submitted_at,
    l.expires_at AS seller_link_expires_at
   FROM atm_routes r
     JOIN items i ON i.route_id = r.id
     LEFT JOIN touch t ON t.route_id = r.id
     LEFT JOIN flags f ON f.route_id = r.id
     LEFT JOIN link l ON l.route_id = r.id;
