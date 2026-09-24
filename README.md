# Moody Blues

Personal Streaming Server Project.

## Development Setup

This repository strictly adheres to a Pragmatic SDD (Software Design Document) workflow. All architectural and functional modifications must be planned and applied using [OpenSpec](https://github.com/Fission-AI/OpenSpec).

### Requirements

To work on this project, you must install OpenSpec:

```bash
npm install -g @fission-ai/openspec@latest
```

### Workflow

1. Initialize a new change to plan your work:
   ```bash
   openspec new change "your-change-name"
   ```
2. Review and edit the generated planning artifacts (`proposal.md`, `design.md`, `tasks.md`).
3. Apply the tasks and commit your work.
4. Archive the change once everything is merged.
