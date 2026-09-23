# ChildBEx — Codex Instructions

## Project purpose

ChildBEx is a medical web application for reviewing DICOM medical imaging studies and supporting development of an ML pipeline for image anomaly detection.

The current ML goal is intentionally narrow:

- process DICOM images;
- prepare image data for TensorFlow;
- train/evaluate an EfficientNet-based classifier;
- classify individual slices as `normal` or `abnormal`;
- help a physician find potentially abnormal slices in large studies;
- the model must not be presented as making a medical diagnosis.

The physician remains responsible for interpretation and diagnosis.

## Repository rules

Work only in the current Codex worktree and branch:

`agent/codex`

Do not work directly on:

- `main`
- `llm-service`
- `agent/claude`

Do not merge branches unless explicitly asked.

Do not rewrite Git history.

Do not use destructive Git commands such as `git push --force`, `git reset --hard`, or `git clean -fd` unless explicitly instructed.

Before making significant changes, inspect the existing implementation and preserve the current architecture where reasonable.

Prefer small, reviewable changes over large rewrites.

## Before editing code

Before implementing a task:

1. Inspect relevant files.
2. Understand the existing implementation.
3. Identify dependencies and affected components.
4. Avoid changing unrelated code.
5. Ask before making architectural or destructive changes.

Do not invent project requirements when they are unclear.

## Technology

The project may contain:

### Web / API

- Node.js
- JavaScript / TypeScript
- React / Next.js
- REST APIs
- PostgreSQL

### ML service

- Python
- TensorFlow
- EfficientNet / EfficientNetV2
- DICOM processing
- NumPy
- image preprocessing
- model training and inference

Use the versions already defined by the repository unless explicitly asked to upgrade them.

Do not upgrade major dependencies as part of an unrelated task.

## Medical imaging

Preserve original DICOM data whenever possible.

Do not assume that raw DICOM pixel values are equivalent to PNG/JPEG pixel values.

For CT data, account for:

- Rescale Slope
- Rescale Intercept
- Hounsfield Units
- Window Center
- Window Width

when applicable.

Do not discard clinically relevant DICOM metadata without understanding why it is being removed.

Keep preprocessing used during inference consistent with preprocessing used during model training.

## Dataset rules

Prevent data leakage.

Train, validation, and test datasets must be split at the patient level, not randomly by individual image slices.

Images from the same patient must not appear across different dataset partitions.

Do not silently change labels supplied by physicians.

Preserve provenance between:

`patient → study → series → instance/image → annotation`

where available.

## Medical data and privacy

Treat all medical data as sensitive.

Never commit:

- real patient identifiers;
- DICOM files containing identifiable patient information;
- passwords;
- access tokens;
- API keys;
- private certificates;
- database dumps containing patient information.

Use synthetic or de-identified examples in tests and documentation.

Do not log patient-identifying information unnecessarily.

## ML behavior

Do not claim that model output is a diagnosis.

Model output should be treated as decision support, for example:

- normal probability;
- abnormal probability;
- confidence or score;
- potentially suspicious image.

Evaluation should use appropriate metrics such as:

- sensitivity / recall;
- specificity;
- precision;
- ROC-AUC;
- confusion matrix;

when relevant to the task.

Accuracy alone should not be treated as sufficient for medical model evaluation.

## Code quality

Follow the existing project style.

Prefer readable code over clever abstractions.

Reuse existing utilities before creating duplicates.

Add or update tests when behavior changes.

Run relevant linting and tests before considering a task complete.

Do not suppress errors simply to make tests pass.

## Configuration and secrets

Use environment variables for secrets.

Never hardcode credentials.

Do not modify production credentials or infrastructure configuration unless explicitly requested.

Do not commit `.env` files containing secrets.

When adding a new environment variable, document its purpose.

## Database

Do not delete or modify production data.

Do not run destructive migrations without explicit approval.

Review migrations before executing them.

Prefer backward-compatible schema changes when possible.

## Git workflow

Before starting substantial work, check:

`git status`

and:

`git branch --show-current`

The expected branch is:

`agent/codex`

Commit only changes related to the current task.

Use clear commit messages.

Do not push or create a pull request unless explicitly requested.

## Working with Claude

Claude works independently in:

`agent/claude`

Do not modify Claude's worktree.

Do not assume Claude's unmerged changes are available locally.

Shared changes must be integrated through Git deliberately.

## Communication

When a task is ambiguous, ask instead of guessing.

When proposing a substantial architectural change, explain:

- what will change;
- why;
- affected components;
- risks;
- migration impact.

For small implementation tasks, avoid unnecessary redesign.