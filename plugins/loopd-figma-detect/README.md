# loopd-figma-detect

Figma desktop and MCP server detection tool, integrated with loopd.

## Overview

This plugin checks whether Figma desktop application is running and if the MCP (Model Context Protocol) server is properly bound to port 3845. This is essential for Figma integration workflows.

## Usage

### Web Interface

When loopd is running, access the detector at:

```
http://localhost:8080/plugins/loopd-figma-detect/index.html
```

The interface provides:
- Real-time Figma desktop status
- MCP server port binding check (port 3845)
- Process ID of running Figma instance
- Recommendations when setup is incomplete
- Auto-refresh every 5 seconds

### API Endpoint

Get detection results as JSON:

```bash
curl http://localhost:8080/api/figma-detect
```

Response format:

```json
{
  "figma_running": true,
  "port_bound": true,
  "both_ready": true,
  "status": "Ready for Figma integration",
  "timestamp": "2026-01-28T21:25:00Z",
  "process_pid": 12345,
  "recommendations": []
}
```

### Standalone CLI

The plugin can also be run as a standalone command-line tool:

```bash
cd plugins/loopd-figma-detect
go build
./loopd-figma-detect --help
```

Options:
- `--human`: Human-readable output
- `--exit-code`: Use exit codes (0=ready, 1=not ready, 2=error)
- `--version`: Show version

## Integration

The detection logic is integrated into loopd's HTTP server via the `/api/figma-detect` endpoint. The web interface uses this API to provide a real-time status dashboard.

## Detection Logic

1. **Figma Process**: Uses `pgrep` on Unix-like systems or `tasklist` on Windows to detect if Figma is running
2. **Port Binding**: Uses `lsof` on macOS/Linux or `netstat` on Windows to check if port 3845 is bound
3. **Recommendations**: Provides actionable steps when components are missing

## Platform Support

- **macOS**: Full support with `pgrep` and `lsof`
- **Linux**: Full support with `pgrep` and `lsof`
- **Windows**: Basic support with `tasklist` and `netstat`

## Dependencies

No external Go dependencies. Uses standard library and system commands.
