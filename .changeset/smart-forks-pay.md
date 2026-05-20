---
"openpond-code": patch
---

Remove managed database declarations from the sandbox template and sandbox create/fork request contracts. Templates should use durable volumes with SQLite or files for structured sandbox state.

Add `openpond sandbox-template start` so template authors can validate the current manifest, sync the local repo through OpenPond Git, create a sandbox with declared resources and volumes, upload declared file inputs, and run the selected start/action/service command with replay params.
