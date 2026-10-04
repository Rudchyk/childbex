
## Загальний принцип

У ChildBEx використовуємо:

- `worktree` для фізичної ізоляції різних агентів і паралельних задач;
    
- окрему Git-гілку для кожної задачі;
    
- `llm-service` як основну інтеграційну робочу гілку;
    
- звичайний `merge` завершених task-гілок у `llm-service`;
    
- `cherry-pick` лише як винятковий інструмент, а не як стандартний workflow.
    

Основна схема:

```
llm-service
├── feature/<task>
├── fix/<task>
├── refactor/<task>
├── audit/<task>
└── chore/<task>
```

Codex, Claude та ручна розробка можуть працювати паралельно у різних worktree, але кожен worktree повинен бути прив'язаний до своєї task-гілки.

---

## 1. Роль `llm-service`

`llm-service` — основна робоча та інтеграційна гілка поточного етапу ChildBEx.

Безпосередньо в `llm-service` нову функціональність не розробляємо.

Перед початком нової задачі:

```
git switch llm-service
git fetch origin
git pull --ff-only origin llm-service
```

Перевірити:

```
git status --short --branch
```

Гілка повинна бути чистою та синхронізованою з `origin/llm-service`.

---

## 2. Одна задача — одна гілка

Для кожної окремої задачі створюється нова task-гілка від актуального `llm-service`.

Приклади:

```
feature/review-voting
fix/migration-runner
refactor/dicom-model
audit/dicom-model
chore/deployment-checks
```

Створення:

```
git switch llm-service
git pull --ff-only origin llm-service
git switch -c feature/<task-name>
```

Не використовувати одну постійну `agent/codex` гілку для всіх наступних задач.

Гілка повинна описувати саме конкретну роботу, а не інструмент або агента, який її виконує.

---

## 3. Worktree — це ізоляція середовища

Для паралельної роботи використовуємо Git worktree.

Приклад:

```
C:/playground/childbex
C:/playground/childbex-codex
C:/playground/childbex-claude
```

Worktree не визначає Git workflow сам по собі.

Його задача — дозволити різним агентам або розробнику одночасно працювати з одним repository без перемикання файлів і гілок в одному каталозі.

Приклад:

```
childbex
└── llm-service

childbex-codex
└── feature/review-voting

childbex-claude
└── audit/dicom-model
```

Кожен worktree у конкретний момент повинен працювати тільки зі своєю гілкою.

---

## 4. Початок роботи Codex

Перед передачею задачі Codex перевірити:

```
git status --short --branch
git log -1 --oneline
git remote -v
```

Переконатися, що:

- обрана правильна task-гілка;
    
- робоче дерево чисте;
    
- task-гілка створена від актуального `llm-service`;
    
- немає чужих незакомічених змін.
    

Після цього можна передавати задачу Codex.

---

## 5. Коміти всередині task-гілки

Codex може створювати один або декілька логічних комітів.

Наприклад:

```
feat(review): add reviewer vote persistence
test(review): cover vote state transitions
docs(review): document review completion semantics
```

Не потрібно штучно зводити всю роботу до одного коміту лише заради подальшого `cherry-pick`.

Перед комітом:

```
git status
git diff
```

Після коміту:

```
git log --oneline -5
```

---

## 6. Push task-гілки

Після завершення логічного етапу:

```
git push -u origin <task-branch>
```

Наприклад:

```
git push -u origin feature/review-voting
```

Подальші push:

```
git push
```

Task-гілка повинна існувати на GitHub до її інтеграції в `llm-service`.

---

## 7. Перевірка перед merge

Перед інтеграцією task-гілки потрібно перевірити:

```
git status
git diff llm-service...HEAD
```

Запустити релевантні:

```
npm run lint
npm run typecheck
npm test
```

а також спеціалізовані integration/e2e/migration перевірки, якщо вони стосуються задачі.

Перевіряємо:

- чи виконана початкова задача;
    
- чи немає випадкових змін;
    
- чи немає секретів або локальних файлів;
    
- чи немає небажаних generated-файлів;
    
- чи не змінена архітектура поза погодженим scope;
    
- чи проходять потрібні тести.
    

---

## 8. Синхронізація task-гілки перед merge

Якщо за час роботи `llm-service` змінився:

```
git fetch origin
```

Перевірити:

```
git log --oneline --left-right HEAD...origin/llm-service
```

Перед merge бажано інтегрувати актуальний `llm-service` у task-гілку.

Стандартний варіант:

```
git merge origin/llm-service
```

Після вирішення можливих конфліктів повторно запустити необхідні тести.

Не переписувати вже опубліковану історію task-гілки без потреби.

---

## 9. Merge у `llm-service`

Після схвалення task-гілки:

```
git switch llm-service
git fetch origin
git pull --ff-only origin llm-service
git merge --no-ff <task-branch>
```

Наприклад:

```
git merge --no-ff feature/review-voting
```

Після merge:

```
git status
git log --oneline --graph -10
```

Потім:

```
git push origin llm-service
```

`--no-ff` дозволяє зберегти task-гілку як окремий логічний блок в історії.

---

## 10. Merge через Pull Request

Якщо задача значна, бажаний варіант:

```
task branch
    ↓
Pull Request
    ↓
review / tests
    ↓
llm-service
```

PR особливо корисний для:

- великих feature;
    
- DICOM/model змін;
    
- database migrations;
    
- authentication/authorization;
    
- deployment;
    
- архітектурних refactor;
    
- задач, які виконувалися окремим агентом.
    

---

## 11. Після успішного merge

Після того як task-гілка вже знаходиться в `llm-service`, її можна видалити.

Локально:

```
git branch -d <task-branch>
```

На GitHub:

```
git push origin --delete <task-branch>
```

Якщо branch використовується активним worktree, спочатку треба завершити або перепризначити цей worktree.

---

## 12. Worktree після завершення задачі

Переглянути worktree:

```
git worktree list
```

Якщо worktree більше не потрібний:

```
git worktree remove <path>
```

Або його можна залишити й перевести на нову task-гілку після завершення попередньої роботи.

Не використовувати один worktree одночасно для двох паралельних задач.

---

## 13. Cherry-pick

`cherry-pick` більше не є стандартним способом інтеграції Codex-змін.

Використовувати його лише у спеціальних випадках, наприклад:

- потрібно перенести один hotfix;
    
- один конкретний коміт потрібен у двох незалежних гілках;
    
- випадково зроблено коміт не в тій гілці;
    
- потрібно забрати окрему виправлену зміну без решти task-гілки.
    

Приклад:

```
git cherry-pick <commit>
```

Але нормальний workflow:

```
task branch
    ↓
review
    ↓
merge
    ↓
llm-service
```

---

## 14. Заборонені практики

Не робити:

```
git push --force origin llm-service
```

Не розробляти нові задачі безпосередньо в `llm-service`.

Не використовувати одну нескінченну `agent/codex` гілку для всіх задач.

Не переносити вручну кожен Codex-коміт через `cherry-pick`, якщо вся task-гілка є цілісною роботою.

Не змішувати дві незалежні задачі в одній task-гілці.

Не мерджити гілку без перегляду diff і релевантних тестів.

---

## 15. Рекомендована схема роботи

```
                    llm-service
                        │
          ┌─────────────┼─────────────┐
          │             │             │
          ▼             ▼             ▼
 feature/task-a    fix/task-b    audit/task-c
   Codex             manual         Claude
          │             │             │
          ▼             ▼             ▼
       commits       commits       commits
          │             │             │
          ▼             ▼             ▼
        tests          tests          tests
          │             │             │
          └──────┬──────┴──────┬──────┘
                 │             │
                 ▼             ▼
               review / PR / merge
                       │
                       ▼
                   llm-service
```

---

## 16. Короткий workflow для Codex

Перед задачею:

```
git switch llm-service
git pull --ff-only origin llm-service
git switch -c feature/<task>
```

Робота:

```
# Codex implements task

git status
git diff
git add <files>
git commit -m "<message>"
git push -u origin feature/<task>
```

Перевірка:

```
git diff llm-service...HEAD
npm run lint
npm run typecheck
npm test
```

Інтеграція:

```
git switch llm-service
git pull --ff-only origin llm-service
git merge --no-ff feature/<task>
git push origin llm-service
```

Після цього task-гілку можна видалити.

---

## 17. Основні правила

1. `llm-service` — інтеграційна гілка.
    
2. Одна задача — одна task-гілка.
    
3. Worktree використовується для ізоляції робочих середовищ.
    
4. Назва гілки описує задачу, а не агента.
    
5. Codex і Claude можуть працювати паралельно у різних worktree.
    
6. Завершена task-гілка інтегрується через merge або PR.
    
7. `cherry-pick` — виняток, а не стандарт.
    
8. Перед merge обов'язково переглянути `git diff`.
    
9. Перед merge запустити релевантні тести.
    
10. Не використовувати `--force` для `llm-service`.
    
11. Не починати нову задачу зі старої task-гілки.
    
12. Нова task-гілка повинна створюватися від актуального `llm-service`.