# Arena Repository Instructions

This file is a temporary working instruction for Arena. It must be treated as a
mandatory project-level rule for all subsequent tasks in this repository during
this workflow.

## Language Rule

Everything that is added or changed inside the repository must be written in
English. This includes, without exception:

- Source-code comments
- Documentation
- README files
- Commit messages
- Pull request titles
- Pull request descriptions
- Test descriptions and test names
- Error messages introduced by Arena
- Migration comments
- CI/workflow comments
- Changelog entries
- Technical notes
- TODOs and FIXMEs
- Any other repository-facing text

The application's existing user-facing translations/content are not part of this
rule unless a task explicitly asks to change them.

Do not translate existing German application content merely because of this rule.

## Workflow Rule

Before every future task:

1. Read `docs/arena-instructions.md`.
2. Treat it as mandatory project instructions.
3. Keep all repository changes consistent with it.
4. Keep commit messages and PR content in English.
5. Do not create German repository documentation unless explicitly requested.
6. If you are unsure whether something is repository-facing, use English.

## Git / PR Rules

- Commit messages must always be in English.
- PR titles must always be in English.
- PR descriptions must always be in English.
- Branch names should preferably be in English.
- Do not create unnecessary commits.
- Keep logically separate changes in separate commits where appropriate.
- Never force-push unless explicitly instructed.
- Never rewrite or discard existing work without first investigating its origin.
- If unexpected changes appear, stop and investigate before modifying them.
- Keep the working tree clean at the end of a completed task whenever possible.

## Documentation Rule

Repository documentation must be concise, technical, and written in English.

Do not create redundant documentation merely to document an implementation step.

## Temporary-File Rule

`docs/arena-instructions.md` exists only as a workflow instruction file.

Do not include it in feature commits or PRs unless explicitly requested.

Do not modify or delete it during normal feature work.

At the beginning of every future task, explicitly verify that the file exists and
read it before making changes.

## Important

These rules do not change the project's architecture, security model, product
requirements, or technical decisions. They only establish the language and
repository workflow conventions described above.
