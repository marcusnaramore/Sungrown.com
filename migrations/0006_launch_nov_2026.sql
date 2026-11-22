-- Launch decisions, Nov 21 2026 (Marcus, CRO). The live deploy applies the same settings once via
-- POLICY_LAUNCH=2026-11-21 (returns/core.mjs launchPolicy), because live policy cannot be edited in the
-- staff workspace. Running this migration as well is harmless.
-- $200 or less per store over 30 days: trust tier, onsite destruction. Over $1,500: leadership approves with the rep.
-- No monthly dollar cap: the $1,500 leadership line is the control. Eligibility is fixed on the day a return is submitted.
UPDATE configuration SET data=json_set(data,'$.launchVersion','2026-11-21','$.pilotEnabled',json('true'),'$.destructionEnabled',json('true'),
 '$.quickLimit',20000,'$.approvalLimit',150000,'$.trustWindowDays',30,'$.submitDays',90,'$.completeDays',100,
 '$.exposureCapCents',NULL,'$.exposureCapPolicy','none','$.exposureCapApproved',json('true'),'$.exceptionPolicy','manual_review') WHERE key='policy';
UPDATE configuration SET data=json_set(data,'$.pilotStarted','2026-11-21') WHERE key='policy' AND json_extract(data,'$.pilotStarted') IS NULL;
