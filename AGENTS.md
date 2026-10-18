# ChildBEx — Agent contribution workflow

These instructions apply to **Claude, Codex, and any other coding agent** working in
`Rudchyk/childbex`. They govern Git branching, review, and release flow.
Read `CLAUDE.md` as well for ChildBEx's medical-data, security, architecture,
and code-quality constraints; those constraints apply regardless of which agent
is implementing an Issue.

An explicit user instruction can change a workflow step (for example, stop
before committing), but does not authorize unsafe handling of patient data,
secrets, production systems, or another agent's workspace.

## 1. Inspect before touching the repository

At the start of **every** task, inspect the assigned worktree and working
branch:

```sh
git status --short --branch
git branch --show-current
git worktree list
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
```

Read the Issue and relevant code, check for work already in progress, and
identify the base commit. Never assume the current branch is `main`, clean,
or already dedicated to the requested Issue.

- Each agent uses only its **assigned worktree**; do not edit the other
  agent's worktree. A worktree is a working directory, **not** an Issue branch.
- `agent/claude` and `agent/codex` are legacy agent workspace branches,
  **not** branches for implementing new Issues. Do not accumulate unrelated
  Issue commits on either.
- Do not implement Issue changes directly on `main` or `llm-service`.
- If the working tree contains existing edits, preserve them. Determine
  whether they belong to the current Issue before switching or branching.
  Do **not** reset, discard, auto-stash, cherry-pick, or relocate them blindly.
- If the current HEAD has unrelated commits or the correct base cannot be
  established safely, stop and report the situation before changing branches.

## 2. One Issue → one dedicated branch

Create or reuse **one branch per Issue**, from the latest appropriate
`origin/main` baseline, before editing task code.

Naming convention:

- `fix/<issue-number>-<short-slug>` — bug fix, e.g. `fix/36-breadcrumbs`
- `feat/<issue-number>-<short-slug>` — product feature
- `chore/<issue-number>-<short-slug>` — maintenance
- `docs/<issue-number>-<short-slug>` — documentation

For an explicitly requested change with no Issue, use a clearly scoped
descriptive branch such as `docs/agent-issue-workflow`. Do not invent an
Issue number.

For a clean worktree without work already in progress:

```sh
git switch -c fix/36-breadcrumbs origin/main
```

The command is illustrative: choose the branch prefix/number for the actual
task. Do not run it if the branch exists or it would strand changes.
If a task is already partly implemented on another branch, inspect HEAD,
`origin/main`, uncommitted changes, and other worktrees first; move the
existing work to the dedicated branch **without losing edits or importing
unrelated commits**. Ask for guidance if that cannot be done safely.

Do not rewrite shared branch history or force-push.

## 3. Implement and validate

- Keep the diff limited to the Issue's scope; do not mix unrelated fixes.
- Preserve source DICOM, physician review decisions, patient privacy, and
  existing authorization boundaries.
- Run relevant targeted tests, typecheck/lint/build as applicable; explain
  any unavailable or failing checks.
- Review **all** changed and new files (untracked files are not included in
  an ordinary `git diff`).
- Before committing, inspect `git status --short`, `git diff --stat`,
  and `git diff --check`. Stage only Issue-related paths.
- Never commit patient identifiers, patient images, credentials, tokens,
  production `.env` files, or local machine artifacts.

## 4. Commit and push for independent review

For a normally assigned implementation Issue, once the changes pass local
validation and the diff has been reviewed:

1. Commit only the Issue's files with a clear conventional commit message,
   e.g. `fix(gui): correct breadcrumbs for patient hierarchy`.
2. Push the dedicated branch to `origin`.
3. **Stop and request independent code review** against `origin/main`.
   Provide the branch name, commit SHA/link, summary, test results, and any
   risks or manual checks.

This is the default handoff; a raw patch file is **not** the default review
artifact. Use a patch only when specifically requested or when the branch
cannot be published, and explain why.

If the user explicitly requests **uncommitted review** or says not to push,
follow that instruction instead and stop at the requested boundary.
If the user explicitly requests a PR immediately, that overrides the
review-before-PR timing, **not** the requirement for a scoped branch,
validations, and human-controlled merge.

## 5. Review → PR → CI → merge

- Incorporate review feedback on the **same Issue branch**, run affected
  checks again, commit/push, and submit the new HEAD for review.
- After independent review approval (or an explicit instruction to open the
  PR), create a PR from the dedicated branch into `main`.
- Use the repository PR template: describe scope, related Issue, automated
  and manual validation, and operational impact. Use `Closes #N` only if
  merging the PR genuinely completes that Issue.
- A PR is **not** approval to merge. Check required CI, resolve review
  feedback, and record manual validation where necessary.
- **Never self-merge, auto-merge, deploy, or change production** without
  separate explicit authorization.
- Keep the worktree/branch intact until the reviewer or owner confirms the
  work is integrated and safe to clean up.

## Handoff checklist

When stopping, report:

- Issue URL (if any), worktree, branch, base commit, and HEAD SHA;
- changed files and a concise summary;
- validation commands/results, unresolved failures, and manual checks;
- `git status --short` and any unrelated working-tree changes;
- the remote branch/PR URL if created, and the next required approval.

**Default flow:** Issue → dedicated branch in the assigned worktree →
implementation/tests → commit + push → independent review →
PR → CI + required manual checks → authorized merge.
