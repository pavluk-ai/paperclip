# Fork README

This repository is a customized fork of Paperclip.

We keep our own improvements here, push our day-to-day changes to this fork, and periodically merge upstream Paperclip changes back in. The goal is to keep local improvements moving without losing an easy path to stay current with the open source project.

As of March 14, 2026, the upstream default branch is `master`.

## Fork Docs

Fork-specific project docs are stored under `doc/pavluk-ai/`.

## Remote Model

- `origin` = `git@github.com:pavluk-ai/paperclip.git`
- `upstream` = `https://github.com/paperclipai/paperclip.git`

Check it with:

```sh
git remote -v
```

## Branch Model

- local `master` is the working branch for this fork
- local `master` tracks `origin/master`
- upstream updates are merged from `upstream/master` into local `master`

Check it with:

```sh
git branch -vv
```

## Normal Local Work

Make changes on local `master`, then commit and push them to the fork:

```sh
git add <files>
git commit -m "your message"
git push origin master
```

## Sync From Upstream

Use this workflow to merge the latest open source Paperclip changes into this fork:

```sh
git checkout master
git status
git fetch upstream
git merge upstream/master
git push origin master
```

This fork uses `merge` as the default sync strategy, not `rebase`.

## Conflict Resolution

If `git merge upstream/master` reports conflicts:

```sh
git status
git add <resolved-files>
git commit
git push origin master
```

Resolve the conflicted files on local `master`, stage the resolved files, finish the merge commit, and then push the result to `origin/master`.

## Repo-Local Shortcut

This clone can use a repo-local Git alias:

```sh
git sync-upstream
```

It expands to:

```sh
git checkout master
git status
git fetch upstream
git merge upstream/master
git push origin master
```

Install it for this clone only with:

```sh
git config --local alias.sync-upstream '!git checkout master && git status && git fetch upstream && git merge upstream/master && git push origin master'
```

Notes:

- this alias is repo-local to the current clone
- it lives in `.git/config`, not global `~/.gitconfig`
- it is not committed to the repo, so each clone must install it once
