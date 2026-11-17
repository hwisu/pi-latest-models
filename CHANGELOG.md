# Changelog

## [0.2.0] - 2026-11-17

- Sort the `/model` list by most used (default), by name, or in pi's order. Set it with
  `/latest-models sort <usage|name|pi>` or press `alt+s` in `/model`.
- Usage is counted from saved sessions (cached per file) plus live responses; versions of a family share
  their count.
- `/reload` after an update re-installs the selector patch instead of keeping the old one.

## [0.1.0] - 2026-11-17

- First release: `/model` lists only the newest model of each provider/family, with current and default
  models pinned, `alt+v` to show all versions, search fallback, and the `/latest-models` command.
