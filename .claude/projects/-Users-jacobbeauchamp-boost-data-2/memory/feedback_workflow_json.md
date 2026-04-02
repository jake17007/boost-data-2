---
name: Never delete workflow.json
description: workflow.json contains user's custom node positions and layout - never delete or overwrite wholesale
type: feedback
---

Never delete or fully overwrite .claude/workflow.json — it contains the user's manually arranged node positions and layout tweaks. Instead, inject new nodes/edges into the existing file.

**Why:** User was alarmed when I tried to delete it — would lose all their layout work.
**How to apply:** When adding new workflow nodes, read the existing JSON and append to it. Never use the file deletion or full-rewrite approach.
