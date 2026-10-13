lmstudio:google/gemma-4-e4b
lmstudio:google/gemma-4-12b-qat
lmstudio:google/gemma-4-26b-a4b-qat
lmstudio:qwen/qwen3.8-27b

## CLI

Run workflows from the terminal, without the dev server:

```
pnpm anygen list                          # saved workflows
pnpm anygen nodes                         # available node types
pnpm anygen validate <file.json>          # check a workflow file
pnpm anygen run <file.json | workflowId> [options]
```

Run options:

- `--asset <node>.<param>=<path>` uploads a file into an asset param (e.g. `page.file=./page.jpg`)
- `--param <node>.<param>=<value>` overrides a node param
- `--target <nodeId>` runs only that node and its dependencies (repeatable)
- `--out <dir>` writes Save JSON / Save File outputs to a directory
- `--json` prints events as JSON lines
- `--data-dir <path>` uses another data directory (default: `ANYGEN_DATA_DIR` or `./data`)

Example:

```
pnpm anygen run workflows/book-page-to-quiz.json --asset page.file=./page.jpg --out out/
```

The CLI shares `data/` with the editor, so saved workflows and stored API keys are available. API keys can also come from env vars such as `ANTHROPIC_API_KEY`. Exit code: 0 done, 1 error, 130 cancelled.
