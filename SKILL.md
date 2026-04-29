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

The user provides one of:
- A GitLab MR: `/tell !42`
- A GitHub PR: `/tell #42` (in a GitHub repo context)
- Nothing — detect the MR/PR for the current branch automatically

**Flags** (combinable):
- `--force` — bypass cache and regenerate
- `--learn` — add language idiom annotations to each hunk (auto-detects language from file extension)

Examples: `/tell !42 --learn`, `/tell !42 --learn --force`

If no number is given, run `glab mr list --state=opened --source-branch=$(git branch --show-current)` (or `gh pr list`) to find it. If still ambiguous, ask once.

## Process

### Step 1 — Detect source and fetch MR/PR

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

### Step 3 — Get the diff

**GitLab:**
```bash
glab mr diff <N>
```

**GitHub:**
```bash
gh pr diff <N>
```

Fallback (either):
```bash
git diff origin/<base>...origin/<head>
```

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
    "type": "GL MR",
    "label": "[GL MR]"
  },
  "title": "<MR/PR title>",
  "ref": "!<N>  ·  #<issue N>",
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
- `type`: `ctx` = unchanged context, `add` = added line, `del` = removed line
- `oldNum`: original line number for `ctx`/`del`; `null` for `add`
- `newNum`: new line number for `ctx`/`add`; `null` for `del`
- `text`: raw content — **strip the leading `+`, `-`, or space**

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
10. **Strip leading +/-/space from line.text.** The viewer renders its own prefix column.

## Installation

```
~/.config/ai-configs/tell/
├── SKILL.md
└── templates/
    └── tell-template.html
```

Symlink into your agent's skills directory — wherever your agent loads skills from. For example:

```bash
# Pi
ln -s ~/.config/ai-configs/tell ~/.pi/agent/skills/tell

# Claude Code (claude-work profile)
ln -s ~/.config/ai-configs/tell ~/.claude-work/skills/tell

# Any other agent — point it at ~/.config/ai-configs/tell/SKILL.md
```
