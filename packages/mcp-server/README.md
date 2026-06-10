# @backendkit-labs/mcp-server

**Status: stable** — works and is maintained; will not be expanded during the pilot phase.

MCP server for the BackendKit agent framework — exposes skills, code intelligence, and agent context via the Model Context Protocol.

## Usage with Claude Desktop / Cursor / VS Code

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "bk-agent": {
      "command": "npx",
      "args": ["-y", "@backendkit-labs/mcp-server"],
      "env": {
        "BK_APP_NAME": "my-app",
        "BK_CWD": "/path/to/your/project"
      }
    }
  }
}
```

## Available tools

| Tool | Description |
|------|-------------|
| `skills_search` | Search loaded skills by keyword |
| `skills_install` | Install a skill pack from GitHub or local path |
| `skills_list` | List all loaded skills |
| `code_search` | Full-text search across the project codebase |
| `code_context` | Get code context around a symbol or file |
| `code_index` | Trigger a full re-index of the project |
| `stack_detect` | Detect the project's technology stack |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BK_APP_NAME` | `deepseek-code` | App name for `~/.{appName}/` data directory |
| `BK_CWD` | `process.cwd()` | Project directory to index and serve |

## Run directly

```bash
# stdio mode (for MCP clients)
npx @backendkit-labs/mcp-server

# HTTP mode (port 3100 by default)
BK_MCP_PORT=3100 npx @backendkit-labs/mcp-server --http
```

## License

MIT © [BackendKit Labs](https://github.com/BackendKit-labs)
