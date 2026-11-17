# pi-latest-models

A [pi](https://pi.dev) package that trims the `/model` list to the **newest model of each family** and
sorts it by **most used** or **name**.

```
→ ✓ gpt-5.6-sol [openai-codex] · default
    claude-fable-5-2 [anthropic]
    claude-haiku-5-5 [anthropic]
    claude-opus-5-5 [anthropic]
    claude-sonnet-5-5 [anthropic]
    gemini-3.8-flash [antigravity-acp]
    gpt-6.1-sol [openai-codex]
    ...
  17 older versions hidden · alt+v show all · sort: most used · alt+s change
```

Instead of `claude-sonnet-4-5`, `claude-sonnet-4-5-20250929`, `claude-sonnet-4-6`, `claude-sonnet-5`, and
`claude-sonnet-5-5`, you see only `claude-sonnet-5-5`. It works automatically, with no list to maintain,
and new releases show up as soon as pi's model catalog has them.

## Install

```bash
pi install git:github.com/hwisu/pi-latest-models
```

Try it for one run without installing:

```bash
pi -e git:github.com/hwisu/pi-latest-models
```

## How it works

- Models are grouped by **provider and family**. The family is the model ID without version numbers,
  dates, and release tags: `claude-3-5-sonnet-20241022`, `claude-sonnet-4-5@20250929`, and `claude-sonnet-5-5`
  are all `claude-sonnet`. `gpt-5.6-sol` and `gpt-6.1-sol` are both `gpt-sol`, and `gemini-2.5-flash-lite` is
  `gemini-flash-lite`, a separate family from `gemini-flash`.
- Within a family the highest version wins. At the same version, stable beats preview/experimental, and an
  undated alias (`claude-haiku-4-5`, `*-latest`) beats dated snapshots. Otherwise the newest snapshot wins.
- Your **current** and **default** models always stay in the list.
- **Search** still works. If nothing among the newest models matches (for example `sonnet-4-5`), the
  search falls back to every version.
- Press **`alt+v`** inside `/model` to switch between "latest only" and "all versions".
- The **scoped** tab (from `enabledModels` or `--models`) is your explicit choice and is not trimmed or re-sorted.
- `Ctrl+P` model cycling, `--model`, and `--list-models` are unchanged. Only the picker list is changed.

## Sort order

Choose the default order of the list with `sort`, or press **`alt+s`** inside `/model` to switch it
(the choice is saved as the new default):

| `sort` | Order |
|---|---|
| `usage` (default) | Most used first. Models nobody used yet follow in name order. |
| `name` | By model ID, A→Z, with natural number order (`5-9` before `5-10`). |
| `pi` | pi's built-in order (by provider). |

Your current and default models stay on top in every order, as in plain pi.

**Usage** is the number of assistant responses per model in your saved sessions (failed and aborted
responses are skipped). It is counted in the background when a session starts, and only new or changed
session files are read again (cache: `~/.pi/agent/cache/latest-models-usage.json`). Responses in the
running session count right away. Versions of a family share one count, so a new release inherits the
rank of the versions you used before.

## Command

| Command | What it does |
|---|---|
| `/latest-models` | Show the settings, most used models, and which families have hidden versions |
| `/latest-models sort <usage\|name\|pi>` | Set the default order |
| `/latest-models on` / `off` | Turn trimming on or off |
| `/latest-models per-family <n>` | Keep the newest `n` models of each family |
| `/latest-models keep <pattern>` | Always list models matching `provider/id`, an ID, or a glob (`gpt-5.*`) |
| `/latest-models unkeep <pattern>` | Remove a keep pattern |

Settings are stored in `~/.pi/agent/latest-models.json`:

```json
{
  "enabled": true,
  "perFamily": 1,
  "keep": ["openai-codex/gpt-5.6-sol"],
  "toggleKey": "alt+v",
  "sort": "usage",
  "sortKey": "alt+s"
}
```

`toggleKey` and `sortKey` use pi's key format (`alt+v`, `ctrl+shift+l`, …).

## Compatibility

pi runs its built-in `/model` command before extension commands, so the command itself cannot be
replaced. Instead this package wraps internal methods of pi's exported `ModelSelectorComponent`
(`sortModels`, `filterModels`, `updateList`, `handleInput`). Tested with pi 1.5.2. If a future pi release
changes those methods, the package shows a warning and pi's normal list is used. Nothing breaks.

Works alongside [pi-model-release-sort](https://github.com/ernsahin/pi-model-release-sort), which wraps the
same methods.

Family detection is a heuristic over model IDs. If a family is grouped wrongly, use `keep` and
please open an issue with the model IDs.

## Development

```bash
npm install
npm run check   # typecheck + tests
pi -e .         # run pi with the local checkout
```

## License

[MIT](LICENSE)
