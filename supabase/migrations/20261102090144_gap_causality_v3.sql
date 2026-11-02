-- Upgrade the append-only event envelope in place while preserving every
-- existing learning fact. Legacy V2 events receive empty causal links; no
-- historical ordering is retroactively invented.
begin;

drop trigger if exists normalize_learning_event_envelope on public.learning_events;
alter table public.learning_events
  drop constraint if exists learning_events_schema_version_check;

create or replace function private.normalize_learning_event_envelope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_schema_text text;
  v_causation jsonb;
  v_targets jsonb;
  v_gap_observation jsonb;
begin
  if jsonb_typeof(NEW.event_payload) <> 'object' then
    raise exception 'invalid_learning_event_payload' using errcode = '22023';
  end if;

  v_schema_text := coalesce(nullif(NEW.event_payload ->> 'eventSchemaVersion', ''), '3');
  if v_schema_text <> '3' then
    raise exception 'unsupported_event_schema_version' using errcode = '22023';
  end if;

  v_causation := NEW.event_payload -> 'causationEventIds';
  if v_causation is null or jsonb_typeof(v_causation) <> 'array' then
    v_causation := '[]'::jsonb;
  end if;
  if jsonb_array_length(v_causation) > 20 or exists (
    select 1
    from jsonb_array_elements(v_causation) as item(value)
    where jsonb_typeof(item.value) <> 'string'
      or char_length(item.value #>> '{}') not between 1 and 240
  ) then
    raise exception 'invalid_causation_event_ids' using errcode = '22023';
  end if;

  v_targets := NEW.event_payload -> 'targetGapEventIds';
  if v_targets is null or jsonb_typeof(v_targets) <> 'array' then
    v_targets := '[]'::jsonb;
  end if;
  if jsonb_array_length(v_targets) > 20 or exists (
    select 1
    from jsonb_array_elements(v_targets) as item(value)
    where jsonb_typeof(item.value) <> 'string'
      or char_length(item.value #>> '{}') not between 1 and 240
  ) then
    raise exception 'invalid_target_gap_event_ids' using errcode = '22023';
  end if;

  v_gap_observation := NEW.event_payload -> 'gapObservationId';
  if v_gap_observation is null or jsonb_typeof(v_gap_observation) = 'null' then
    if NEW.event_payload ->> 'type' = 'attempt'
      and NEW.event_payload ->> 'correct' = 'false'
      and nullif(NEW.event_payload ->> 'gapId', '') is not null then
      v_gap_observation := to_jsonb(NEW.event_id);
    else
      v_gap_observation := 'null'::jsonb;
    end if;
  elsif jsonb_typeof(v_gap_observation) <> 'string'
    or char_length(v_gap_observation #>> '{}') not between 1 and 240 then
    raise exception 'invalid_gap_observation_id' using errcode = '22023';
  end if;

  NEW.event_payload := NEW.event_payload || jsonb_build_object(
    'eventSchemaVersion', 3,
    'causationEventIds', v_causation,
    'targetGapEventIds', v_targets,
    'gapObservationId', v_gap_observation
  );
  NEW.schema_version := 3;
  NEW.causation_event_ids := v_causation;
  NEW.received_at := coalesce(NEW.received_at, now());
  return NEW;
end;
$$;

revoke all on function private.normalize_learning_event_envelope() from public, anon, authenticated;

with migrated as (
  select
    user_id,
    event_id,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            event_payload,
            '{eventSchemaVersion}',
            '3'::jsonb,
            true
          ),
          '{causationEventIds}',
          case
            when jsonb_typeof(event_payload -> 'causationEventIds') = 'array'
              then event_payload -> 'causationEventIds'
            else '[]'::jsonb
          end,
          true
        ),
        '{targetGapEventIds}',
        case
          when jsonb_typeof(event_payload -> 'targetGapEventIds') = 'array'
            then event_payload -> 'targetGapEventIds'
          else '[]'::jsonb
        end,
        true
      ),
      '{gapObservationId}',
      case
        when jsonb_typeof(event_payload -> 'gapObservationId') = 'string'
          then event_payload -> 'gapObservationId'
        when event_payload ->> 'type' = 'attempt'
          and event_payload ->> 'correct' = 'false'
          and nullif(event_payload ->> 'gapId', '') is not null
          then to_jsonb(event_id)
        else 'null'::jsonb
      end,
      true
    ) as payload
  from public.learning_events
)
update public.learning_events as target
set event_payload = migrated.payload,
    schema_version = 3,
    causation_event_ids = migrated.payload -> 'causationEventIds',
    payload_hash = encode(
      extensions.digest(convert_to(migrated.payload::text, 'UTF8'), 'sha256'),
      'hex'
    )
from migrated
where target.user_id = migrated.user_id
  and target.event_id = migrated.event_id;

alter table public.learning_events
  alter column schema_version set default 3,
  add constraint learning_events_schema_version_check check (schema_version = 3);

create trigger normalize_learning_event_envelope
before insert or update of event_payload on public.learning_events
for each row execute function private.normalize_learning_event_envelope();

comment on column public.learning_events.causation_event_ids is
  'V3 explicit causal parents. Never infer event causality from client wall-clock timestamps or arrival order.';
comment on table public.learning_events is
  'Append-only personal learning facts with V3 causal references. Mastery, confidence, gap state and plans are derived by the versioned client reducer.';

commit;
