# Live-shape fixtures

Frozen copies of the KV record shapes behind the production `/r/<id>` subscription:
a `local-sync` base record (`subscription:<16>`) and a direct residential record
(`rola:chain:<32>`) with one additional exit and a VPS node referenced by name.

All addresses, accounts and keys are fake (RFC 5737 / `example`). Do not regenerate
these files from code: they exist to catch changes that would stop the stored
production records from loading or rendering. Update them only when a deliberate
migration rewrites the stored records.
