# Realtime manual check

Run after deployments (or schema/hook changes) to confirm that a resident
realtime subscription on `issues` receives neither private/pending records nor
the exact coordinates. The realtime transport applies the same collection
rules and the same `OnRecordEnrich("issues")` hook as the REST API
(see enforceNewChannelPermissions / defaultEnrichRecords in PocketBase),
so this is a transport smoketest on top of the API tests.

Requirements: a running instance with the fixture data or test data that
includes a private issue (e.g. `issueoprv000001`) and a pending issue, plus a
resident account.

Using `wscat` (or websocat):

```
wscat -c "wss://<host>/api/realtime" -H "Authorization: <RESIDENT_TOKEN>"

# in the prompt:
{"id":"check","method":"GET","path":"/api/collections/issues/records?poller=1"}

# result: only community issues with status open/in_progress/resolved must
# be listed; the records must NOT contain "lat_exact" or "lng_exact".

# subscribe to create events issued by a beirat/superuser:
{"id":"sub","method":"POST","path":"/api/realtime","body":{"topic":"issues"}}

# create a private/pending issue as beirat... -> the resident must get a
# "Unsubscribed"/error or no event for records it cannot view; visible
# records must not contain lat_exact/lng_exact keys.
```

Pass criteria:

- resident receives only issues it could also list via REST
- no event payload contains `lat_exact`/`lng_exact`
- beirat subscription (same script with a beirat token) DOES contain
  `lat_exact`/`lng_exact`
