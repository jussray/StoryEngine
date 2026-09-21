# StoryEngine video workflows

Place founder-controlled ComfyUI API-format workflow JSON files in this directory or another repository-local path and point `LEEVIZE_COMFYUI_WORKFLOW_PATH` at the chosen file.

The workflow remains renderer implementation detail. StoryEngine owns the canonical shot specification, continuity cookie, proof receipt and release gates.

Use the tokens documented in `../../docs/LEEVIZE_OPEN_RENDERER.md` so the same workflow can receive per-shot prompt, seed, dimensions, frame count and continuity state without hard-coding one film into the graph.

Do not commit model weights, credentials, private runtime URLs, `.env` files or generated footage here.
