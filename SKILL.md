---
name: tell
description: Explains an MR's diff line by line in relation to what the MR says and its linked issue. Use when the user says "explain this MR", "walk me through this diff", "tell me about !N", "what does this MR do", or wants to understand how code changes satisfy an issue's requirements.
version: 1.0.0
---

# Tell

Produces a line-by-line explanation of a merge request's diff, anchored to the MR description and the requirements in the linked issue. Every changed line is explained in terms of *why it exists* — not just what it does syntactically.

After generating the explanation, renders the result as an interactive HTML report using the Tell viewer and opens it in the browser automatically.

## When to Use

- Reviewing what an MR actually does vs. what it says it does
- Onboarding to a change after the fact
- Verifying an MR fully addresses its linked issue
- Understanding a colleague's (or your own) change before marking it reviewed

## Inputs

Tell operates in two modes depending on what you pass:

### MR/PR mode
- A GitLab MR: `/tell !42`
- A GitHub PR: `/tell #42` (in a GitHub repo context)
- Nothing — detect the MR/PR for the current branch automatically

Requirements come from the MR/PR description and linked issue. Diff comes from `git diff origin/<base>...origin/<head>`.

If no number is given, run `glab mr list --state=opened --source-branch=$(git branch --show-current)` (or `gh pr list`) to find it. If still ambiguous, ask once.

### Spec mode
- A single file: `/tell SPEC.md`
- A directory of planning docs: `/tell /prd`

Requirements come from the file(s) you point at. Diff comes from local changes (`git diff HEAD`). If there are no local changes, fall back to `git diff origin/main...HEAD` (or `origin/master...HEAD`).

Use this before a PR exists — to validate that your local work satisfies a spec or PRD — or to check a group of planning documents against a branch.

**Flags** (combinable, both modes):
- `--force` — bypass cache and regenerate
- `--learn` — add language idiom annotations to each hunk (auto-detects language from file extension)

Examples: `/tell !42 --learn`, `/tell SPEC.md --force`, `/tell /prd --learn`

## Process

---

**The two modes diverge here. Follow the branch that matches the input.**

---

## MR/PR mode

### Step 1 — Fetch MR/PR metadata

**GitLab:**
```bash
glab mr view <N> --output json
```

**GitHub:**
```bash
gh pr view <N> --json number,title,body,headRefName,baseRefName,author
```

Extract: title, description, source branch, target branch, number. Parse any `Closes #N` or `Refs #N` references from the description to find linked issue(s).

### Step 2 — Fetch linked issue

**GitLab:**
```bash
glab issue view <N> --output json
```

**GitHub:**
```bash
gh issue view <N> --json number,title,body
```

Extract: title, description, acceptance criteria. Summarize requirements in 3–5 bullet points. Give each a short id: `req-1`, `req-2`, etc.

### Step 3 — Get the diff via git + parser script

The parser script (`tell-parse.ts`, located in `SKILL_DIR`) owns all line number computation. The model must never compute `oldNum`, `newNum`, `additions`, or `deletions` manually — it copies them verbatim from parser output.

**Step 3a — Ensure origin is current**

```bash
git fetch origin
```

If `git fetch origin` fails, stop immediately and report the error to the user:

> "`git fetch origin` failed: [error output]. Cannot get an accurate diff without reaching the remote. Check your network connection or VPN and retry."

Do not proceed to Step 3b.

**Step 3b — Run the full diff through the parser**

```bash
git diff origin/<base>...origin/<head> | ts-node <SKILL_DIR>/tell-parse.ts
```

This outputs a `DiffFile[]` JSON array. Each element contains:
- `name`, `oldName`, `status`, `additions`, `deletions`
- `hunks[]` — each with `header`, `hunkStartOld`, `hunkStartNew`, `hunkLinesOld`, `hunkLinesNew`, `lines[]`
- Each line: `{ type, oldNum, newNum, text }` — **text has no leading `+`/`-`/space**

Copy this output directly into the `files[]` section of the Tell JSON. Do not recompute or adjust any field. The only thing the model adds is `explanation` for each hunk.

---

## Spec mode

### Step 1 — Read requirements from the spec file(s)

**Single file:**
Read the file directly. Extract requirements, acceptance criteria, goals, or constraints. Summarize in 3–5 bullet points. Give each a short id: `req-1`, `req-2`, etc.

**Directory (`/tell /prd`):**
```bash
ls <dir>
```
Read each file in turn. Merge all requirements into a single flat list, noting which file each came from (e.g. `req-1 [prd/auth.md]`).

Set `source.type` to `"spec"` and `source.label` to `"[SPEC]"` in the output JSON. Set `ref` to the file path(s). Set `issue` to `{ "number": null, "title": "<filename or dir>" }`.

### Step 2 — Get the diff via git + parser script

**Step 2a — Pre-flight: check for uncommitted changes**

```bash
git status --short
```

If there are uncommitted changes, warn the user:

> "You have uncommitted changes. The diff will reflect committed changes only — local edits won't appear. Continue? (y/n)"

Stop and wait for confirmation. If they say no, end the skill.

**Step 2b — Check for local changes**

```bash
git diff HEAD --stat
```

If there are changes, use them:
```bash
git diff HEAD | ts-node <SKILL_DIR>/tell-parse.ts
```

If there are no local changes (clean working tree and index), fall back to branch changes vs main:
```bash
git diff origin/main...HEAD | ts-node <SKILL_DIR>/tell-parse.ts
```
Try `origin/master` if `origin/main` doesn't exist.

If `git fetch origin` is needed first, run it — and if it fails, report the error and stop (same rule as MR mode).

**Step 2c — Copy parser output into `files[]`**

Same as MR mode Step 3b — copy verbatim, add `explanation` per hunk.

---

## Both modes continue here

### Step 4 — Build the explanation

For each file changed:

1. State the file path and change type (new file, modified, deleted, renamed).
2. For each hunk:
   - Write 1–3 sentences explaining *why* this change was made in terms of the MR/issue — intent and consequence, not syntax.
   - If it satisfies a requirement, record which ones.
   - If unrelated to the MR/issue goal, flag as `tangential`.
   - If pure refactor/formatting with no behavioral impact, flag as `non-behavioral`.

### Step 4b — Learn annotations (only when `--learn` is passed)

Detect the language for each file from its extension:
- `.ex`, `.exs` → Elixir
- `.tsx`, `.ts` → TypeScript/React
- `.jsx`, `.js` → JavaScript/React
- `.css`, `.scss` → CSS
- Other → note the language if known, skip learn block if not

For each hunk, add a `learn` block:
- `language`: detected language string
- `idiom`: the specific language concept this hunk demonstrates (e.g. "pattern matching", "pipe operator", "`with` for multi-step fallible ops", "React hook dependency array", "component composition")
- `idiomatic`: `true` if the code follows the language's preferred style, `false` if not
- `learn_detail`: 1–2 sentences explaining the concept in plain language — *why this pattern exists in this language*, not just what it does
- `preferred`: only present when `idiomatic: false` — a short snippet or description of the more idiomatic alternative

Focus on concepts that are non-obvious to someone coming from another language. Skip trivial hunks (single-line deletions, comment changes, formatting). If a hunk has no meaningful language concept to teach, set `learn` to `null`.

### Step 5 — Coverage check

After all files:
- List each requirement: `covered` | `partial` | `missing`
- List any changes with no corresponding requirement as unanchored: `harmless` or `creep`

### Step 6 — Generate Tell HTML report and open in browser

#### 6a — Build the JSON

```json
{
  "source": {
    "type": "GL MR | GH PR | spec",
    "label": "[GL MR] | [GH PR] | [SPEC]"
  },
  "title": "<MR/PR title, or spec filename/dir>",
  "ref": "!<N>  ·  #<issue N>  (MR/PR) | <filepath>  (spec)",
  "issue": {
    "number": 0,
    "title": "<issue title>"
  },
  "flags": {
    "learn": false
  },
  "files": [
    {
      "name": "<full file path>",
      "status": "<M|A|D>",
      "additions": 0,
      "deletions": 0,
      "hunks": [
        {
          "header": "<@@ -X,Y +A,B @@>",
          "hunkStartOld": 0,
          "hunkStartNew": 0,
          "hunkLinesOld": 0,
          "hunkLinesNew": 0,
          "lines": [
            {
              "type": "<ctx|add|del>",
              "oldNum": null,
              "newNum": null,
              "text": "<line content — NO leading +/-/space prefix>"
            }
          ],
          "explanation": {
            "summary": "<5–8 word summary>",
            "detail": "<1–3 sentences. Use **bold** and `backtick code`.>",
            "satisfies": ["req-1"],
            "flag": null,
            "learn": null
          }
        }
      ]
    }
  ],
  "coverage": [
    {
      "requirement": "<requirement text>",
      "status": "<covered|partial|missing>",
      "note": "<where/how it is or isn't addressed>"
    }
  ],
  "unanchored": [
    {
      "location": "<file:line>",
      "description": "<what the change does>",
      "severity": "<harmless|creep>"
    }
  ]
}
```

**`learn` field schema** (when `--learn` is active and hunk has a teachable concept):
```json
"learn": {
  "language": "Elixir",
  "idiom": "pipe operator",
  "idiomatic": true,
  "learn_detail": "The `|>` operator passes the result of each expression as the first argument to the next, making data transformation pipelines read top-to-bottom instead of inside-out.",
  "preferred": null
}
```

When `idiomatic: false`, `preferred` contains a short code snippet or description of what the idiomatic version looks like.

**Line rules:**
- `lines[]` comes entirely from parser output — copy it verbatim. Do not recompute, adjust, or supplement.
- `type`: `ctx` = unchanged context, `add` = added line, `del` = removed line
- `oldNum` / `newNum`: set by the parser. The model never touches these.
- `text`: already stripped of leading `+`/`-`/space by the parser.
- If a hunk is too large to include in full (e.g. a 500-line new file), insert a single placeholder where the omitted lines would be: `{ "type": "ctx", "oldNum": null, "newNum": null, "text": "... N lines omitted" }` — never fabricate code.

#### 6b — Inject and open

No external script needed — use the agent's built-in file tools directly.

**Determine paths:**
- `SKILL_DIR` = the directory this `SKILL.md` was loaded from (same location as `templates/`)
- `TEMPLATE` = `<SKILL_DIR>/templates/tell-template.html`
- `OUT` = `/tmp/tell-<N>.html` (or `/tmp/tell-<N>-learn.html` when `--learn`)

**Cache check — if `OUT` already exists and `--force` was not passed:**

Open the cached file and stop:
- Mac/Linux: `open "$OUT"` or `xdg-open "$OUT"`
- Windows: `start "$OUT"`

Tell the user: "Opened cached report. Run with `--force` to regenerate." Then stay in conversation — load the cached JSON so follow-up questions are grounded in the report.

**Otherwise — inject and open:**

1. Read `TEMPLATE` using the Read tool
2. Replace the literal string `__TELL_DATA_PLACEHOLDER__` with the full JSON string
3. Write the result to `OUT` using the Write tool
4. Open `OUT` in the browser:
   - Mac: `open "<OUT>"`
   - Linux: `xdg-open "<OUT>"`
   - Windows: `start "<OUT>"`

After opening the report, print the terminal summary (below) and then **stay in conversation**. Do not end the skill. The full diff, issue context, and all hunk explanations remain loaded — the user can ask follow-up questions about any hunk, file, requirement, or concept directly in the terminal.

Respond naturally to follow-ups. Examples of what the user might ask:
- "why does hunk 3 use X instead of Y?"
- "what's the risk if that pattern is misused?"
- "show me what the idiomatic version of file 2 hunk 1 would look like"
- "which files are most likely to cause a regression?"

Stay in this conversational mode until the user explicitly ends the session or moves to a new task.

**Cache hit follow-up:** Even when serving a cached report, still stay in conversation — reload the cached JSON context so follow-up questions are grounded.

## Terminal summary (print after opening report)

```
## !N — [title]
Issue: #M — [issue title]

### path/to/file.ex (M)
  hunk 1  [hunk summary]
          [1-2 sentence explanation]
  hunk 2  [hunk summary]
          [1-2 sentence explanation]

### path/to/other.tsx (A)
  hunk 3  [hunk summary]
          ...

## Requirements Coverage
| req   | status  | note |
|-------|---------|------|
| req-1 | covered | ...  |
| req-2 | partial | ...  |

Unanchored: ...

---
Tell report: /tmp/tell-N.html  (open in browser)
Tab · h/l files · j/k scroll · c coverage

Ask me anything — reference hunks by number, e.g. "explain hunk 7 further"
```

## Rules

1. **Every hunk gets an explanation.** No hunk is skipped.
2. **Hunk numbers are global, not per-file.** Count continuously across all files so the user can reference any hunk by a single number without specifying the file.
3. **Explain intent, not syntax.**
4. **Anchor to the issue.** Every hunk references a requirement or is flagged unanchored.
5. **Flag mismatches.** If the MR says X but the diff does Y, say so.
6. **Flag gaps.** Missing requirements go in coverage as `missing`.
7. **Don't invent requirements.** Only use what's in the issue and MR description.
8. **Keep explanations short.** 1–3 sentences per hunk.
9. **Use CLI tools.** `glab` for GitLab, `gh` for GitHub. No curl, no raw API calls.
10. **`lines[]` comes from the parser, not the model.** Run `tell-parse.ts` on the raw git diff and copy its output. Never compute `oldNum`, `newNum`, `additions`, `deletions`, or line text yourself — the parser is the single source of truth for all mechanical diff data.
11. **Never fabricate diff lines.** If the parser output is unavailable (e.g. ts-node missing), stop and tell the user rather than reconstructing from memory. Fabricated lines mislead reviewers and are worse than omitted lines. When a hunk is genuinely too large, use a placeholder: `{ "type": "ctx", "oldNum": null, "newNum": null, "text": "... N lines omitted" }`.

## Installation

```
~/.config/ai-configs/tell/
├── SKILL.md
├── tell-parse.ts
└── templates/
    └── tell-template.html
```

`tell-parse.ts` requires `ts-node` on PATH. Install globally if not present:
```bash
npm install -g ts-node typescript
```

Symlink into your agent's skills directory — wherever your agent loads skills from. For example:

```bash
# Pi
ln -s ~/.config/ai-configs/tell ~/.pi/agent/skills/tell

# Claude Code (claude-work profile)
ln -s ~/.config/ai-configs/tell ~/.claude-work/skills/tell

# Any other agent — point it at ~/.config/ai-configs/tell/SKILL.md
```
