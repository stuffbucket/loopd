// loopd-figma-detect checks if Figma desktop and MCP server are ready
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/charmbracelet/lipgloss"
)

const (
	appName    = "loopd-figma-detect"
	appVersion = "1.0.0"
	mcpPort    = 3845
	mcpPath    = "/mcp"
)

var (
	flagHuman    = flag.Bool("human", false, "Output human-readable format instead of JSON")
	flagExitCode = flag.Bool("exit-code", false, "Use exit codes (0=ready, 1=not ready)")
	flagVersion  = flag.Bool("version", false, "Show version and exit")
)

func init() {
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, `%s v%s - Detect Figma desktop and MCP server readiness

Checks whether:
1. Figma desktop application is running
2. MCP server is listening on port %d

USAGE:
    %s [OPTIONS]

OPTIONS:
    --human       Output human-readable status instead of JSON
    --exit-code   Use meaningful exit codes (0=ready, 1=not ready)
    --version     Show version and exit
    --help        Show this help

EXIT CODES:
    0  Figma running and port %d bound to Figma process
    1  Figma or port not ready
    2  Error during detection

OUTPUT FORMAT (default JSON):
    {
      "figma_running": bool,
      "port_bound": bool,
      "both_ready": bool,
      "status": "string",
      "timestamp": "RFC3339",
      "process_pid": int (optional),
      "recommendations": [string] (optional)
    }

EXAMPLES:
    %s                    # JSON output to stdout
    %s --human            # Human-readable output
    %s --exit-code && echo "Ready" || echo "Not ready"

`, appName, appVersion, mcpPort, appName, mcpPort, appName, appName, appName)
	}
}

func main() {
	flag.Parse()

	if *flagVersion {
		fmt.Printf("%s v%s\n", appName, appVersion)
		os.Exit(0)
	}

	// Perform detection
	result := Detect()

	// Output based on flags
	if *flagHuman {
		printHumanOutput(result)
	} else {
		printJSONOutput(result)
	}

	// Handle exit codes
	if *flagExitCode {
		if result.BothReady {
			os.Exit(0)
		} else if result.Error != "" {
			os.Exit(2)
		} else {
			os.Exit(1)
		}
	}
}

func printJSONOutput(result *DetectionResult) {
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error encoding JSON: %v\n", err)
		os.Exit(2)
	}
	fmt.Println(string(data))
}

func printHumanOutput(result *DetectionResult) {
	// Color definitions
	headerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#3B82F6")).Bold(true)
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#9CA3AF"))
	valueStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#E5E7EB"))
	successStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981")).Bold(true)
	errorStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444")).Bold(true)
	warnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))

	// Box characters
	fmt.Printf("%s %s\n", headerStyle.Render("╭─"), headerStyle.Render(fmt.Sprintf("%s v%s", appName, appVersion)))
	fmt.Printf("%s %s %s\n", dimStyle.Render("├─"), labelStyle.Render("Timestamp:"), valueStyle.Render(result.Timestamp))
	
	// Figma running status
	figmaStatus := errorStyle.Render("false")
	if result.FigmaRunning {
		figmaStatus = successStyle.Render("true")
	}
	fmt.Printf("%s %s %s\n", dimStyle.Render("├─"), labelStyle.Render("Figma Running:"), figmaStatus)
	if result.ProcessPID > 0 {
		fmt.Printf("%s %s %s\n", dimStyle.Render("│  └─"), labelStyle.Render("PID:"), valueStyle.Render(fmt.Sprintf("%d", result.ProcessPID)))
	}
	
	// Port status
	portStatus := errorStyle.Render("false")
	if result.PortBound {
		portStatus = successStyle.Render("true")
	}
	fmt.Printf("%s %s %s\n", dimStyle.Render("├─"), labelStyle.Render(fmt.Sprintf("Port %d Bound:", mcpPort)), portStatus)
	fmt.Printf("%s %s %s\n", dimStyle.Render("├─"), labelStyle.Render("Status:"), valueStyle.Render(result.Status))
	
	// Final status
	if result.BothReady {
		fmt.Printf("%s %s\n", dimStyle.Render("╰─"), successStyle.Render("✓ Ready for integration"))
	} else {
		fmt.Printf("%s %s\n", dimStyle.Render("╰─"), errorStyle.Render("✗ Not ready"))
		if len(result.Recommendations) > 0 {
			fmt.Printf("\n%s\n", warnStyle.Render("Recommendations:"))
			for i, rec := range result.Recommendations {
				fmt.Printf("  %s %s\n", warnStyle.Render(fmt.Sprintf("%d.", i+1)), valueStyle.Render(rec))
			}
		}
	}
}
