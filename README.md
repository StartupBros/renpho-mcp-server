# Renpho MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that provides access to body composition data from Renpho smart scales. Query your weight, body fat, muscle mass, and other health metrics directly from Claude, Cursor, or any MCP-compatible client.

## Features

- **Body Composition Data**: Weight, BMI, body fat %, muscle mass, water %, bone mass, visceral fat, metabolic age, BMR, and more
- **Weight Trends**: Track changes over customizable time periods (7-365 days)
- **Health Classifications**: Automatic BMI, body fat, and visceral fat category assessments
- **Measurement History**: Access historical measurements with date filtering
- **Multi-table discovery**: Scans all linked Renpho scale tables instead of assuming the first discovered scale-user ID is always correct
- **Sync diagnostics**: Inspect linked scale-user IDs, hidden measurements, and likely delayed Wi-Fi sync situations
- **Secure**: Credentials stored as environment variables, never logged

## Requirements

- Node.js 18+
- A [Renpho Health](https://renpho.com) account with connected smart scale
- **Important**: This works with the **Renpho Health** app (blue icon), not the legacy Renpho app

## Installation

```bash
git clone https://github.com/StartupBros/renpho-mcp-server.git
cd renpho-mcp-server
npm install
npm run build
```

## Configuration

Create a `.env` file (or set environment variables):

```bash
RENPHO_EMAIL=your-email@example.com
RENPHO_PASSWORD=your-password
```

### Claude Code

Add to your MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "renpho": {
      "command": "node",
      "args": ["/path/to/renpho-mcp-server/dist/index.js"],
      "env": {
        "RENPHO_EMAIL": "your-email@example.com",
        "RENPHO_PASSWORD": "your-password"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "renpho": {
      "command": "node",
      "args": ["/path/to/renpho-mcp-server/dist/index.js"],
      "env": {
        "RENPHO_EMAIL": "your-email@example.com",
        "RENPHO_PASSWORD": "your-password"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `get_latest_measurement` | Most recent body composition reading selected for the current user |
| `get_body_composition` | Detailed composition with health classifications |
| `get_weight_trend` | Weight change analysis over N days |
| `get_measurements` | Historical measurements with date filtering |
| `get_current_user` | User profile information |
| `get_scale_users` | Linked scale-user IDs and Renpho table mappings |
| `get_sync_diagnostics` | Debug hidden/delayed measurements across linked scale users |
| `refresh_data` | Clear caches and force a fresh Renpho session |
| `health_check` | Verify API connection status |

## Example Usage

Once configured, ask Claude:

- "What's my current weight and body composition?"
- "Show my weight trend over the last 90 days"
- "How has my body fat percentage changed this year?"
- "Get my last 10 measurements"
- "Show my Renpho scale user IDs"
- "Run sync diagnostics for the last 7 days"
- "Refresh Renpho data and re-check my latest measurement"

## Technical Notes

- Uses the Renpho Health API (`cloud.renpho.com`), not the legacy API
- Implements AES-128-ECB encryption for API communication
- Handles JavaScript BigInt precision for large user IDs
- Scans all discovered Renpho scale tables and scale-user IDs before selecting measurements for the current user
- Includes a sync diagnostics tool to surface measurements associated with linked scale users but not currently selected for the logged-in user
- Caches authentication tokens (50 min) and measurements (5 min) to reduce API calls

## Known Wi-Fi Scale Sync Caveat

Some Wi-Fi scales appear to upload measurements that are not immediately bound to the expected Renpho user until the mobile app performs additional sync logic. This server now helps debug that state with `get_scale_users`, `get_sync_diagnostics`, and `refresh_data`, but the exact server-side binding call used by the app is still being investigated.

## Privacy

- Credentials are only used to authenticate with Renpho's API
- No data is stored permanently or sent to third parties
- All communication uses HTTPS

## Credits

API reverse engineering based on [RenphoGarminSync-CLI](https://github.com/forkerer/RenphoGarminSync-CLI) by forkerer.

## License

MIT
