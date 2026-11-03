-- Phase M hardening: service-role writes must pass through the audited RPCs.
-- The RPCs are SECURITY DEFINER and insert as their trusted owner; browser and
-- service-role clients do not need direct table INSERT privileges.
revoke insert on table public.practice_candidate_quality_records from service_role;
