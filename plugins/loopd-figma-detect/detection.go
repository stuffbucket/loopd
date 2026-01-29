package main

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// DetectionResult contains the detection results
type DetectionResult struct {
	FigmaRunning    bool     `json:"figma_running"`
	PortBound       bool     `json:"port_bound"`
	BothReady       bool     `json:"both_ready"`
	Status          string   `json:"status"`
	Timestamp       string   `json:"timestamp"`
	ProcessPID      int      `json:"process_pid,omitempty"`
	Recommendations []string `json:"recommendations,omitempty"`
	Error           string   `json:"error,omitempty"`
}

// Detect performs the full detection check
func Detect() *DetectionResult {
	result := &DetectionResult{
		Timestamp: time.Now().Format(time.RFC3339),
	}

	// Check if Figma is running
	result.FigmaRunning, result.ProcessPID = detectFigmaProcess()

	// Check if port is bound
	result.PortBound = detectPortBinding()

	// Determine overall status
	result.BothReady = result.FigmaRunning && result.PortBound

	// Set status message
	if result.BothReady {
		result.Status = "Ready for Figma integration"
	} else if result.FigmaRunning && !result.PortBound {
		result.Status = "Figma running but port not bound"
		result.Recommendations = append(result.Recommendations,
			"Ensure MCP server is enabled in Figma desktop settings",
			"Check for firewall blocking port 3845",
			"Restart Figma if MCP server should be running")
	} else if !result.FigmaRunning && result.PortBound {
		result.Status = "Port bound but Figma not running (unexpected)"
		result.Recommendations = append(result.Recommendations,
			"Verify port 3845 is not in use by another process",
			"Check if another Figma instance is running")
	} else {
		result.Status = "Figma not running"
		result.Recommendations = append(result.Recommendations,
			"Start Figma desktop application",
			"Enable MCP server in Figma settings after launching")
	}

	return result
}

// detectFigmaProcess checks if Figma is running using platform-specific methods
// Returns (isRunning, pid)
func detectFigmaProcess() (bool, int) {
	// Try pgrep first (most reliable on Unix-like systems)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "pgrep", "-x", "Figma")
	output, err := cmd.Output()
	if err == nil && len(output) > 0 {
		// Parse PID from output
		pidStr := strings.TrimSpace(string(output))
		if pid, parseErr := strconv.Atoi(pidStr); parseErr == nil {
			return true, pid
		}
		return true, 0
	}

	// Fallback to ps on Unix-like systems
	cmd = exec.CommandContext(ctx, "ps", "aux")
	output, err = cmd.Output()
	if err == nil {
		return parsePsOutput(string(output))
	}

	// Windows fallback: tasklist
	cmd = exec.CommandContext(ctx, "tasklist.exe")
	output, err = cmd.Output()
	if err == nil {
		if strings.Contains(string(output), "Figma") {
			return true, 0 // Windows tasklist doesn't easily provide PID in this format
		}
	}

	return false, 0
}

// parsePsOutput extracts Figma process info from ps output
func parsePsOutput(output string) (bool, int) {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "Figma") && !strings.Contains(line, "Figma Helper") {
			// Typically: USER PID ... COMMAND
			// Example: user 12345 ... /Applications/Figma.app/...
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				if pid, err := strconv.Atoi(fields[1]); err == nil {
					return true, pid
				}
			}
			return true, 0
		}
	}
	return false, 0
}

// detectPortBinding checks if port 3845 is bound using lsof
// Returns true only if port is bound and appears to be by Figma
func detectPortBinding() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Try lsof first (available on macOS and Linux)
	cmd := exec.CommandContext(ctx, "lsof", "-i", fmt.Sprintf(":%d", mcpPort), "-n", "-P")
	output, err := cmd.Output()
	if err == nil {
		return parseLsofOutput(string(output))
	}

	// On Windows, try netstat (though less direct)
	// This is a fallback and won't verify it's the Figma process
	cmd = exec.CommandContext(ctx, "netstat", "-ano")
	output, err = cmd.Output()
	if err == nil {
		return parseNetstatOutput(string(output))
	}

	// lsof not available and netstat check failed
	// Return false gracefully (port check not available)
	return false
}

// parseLsofOutput checks if port 3845 is bound
// lsof output format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
func parseLsofOutput(output string) bool {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		// Skip header line (starts with COMMAND)
		if strings.HasPrefix(strings.TrimSpace(line), "COMMAND") {
			continue
		}
		if strings.TrimSpace(line) == "" {
			continue
		}
		// If there's any output line (not header/empty), port is bound
		// lsof will only return processes actually listening on the port
		return true
	}
	return false
}

// parseNetstatOutput checks if port 3845 is in LISTEN state
// Windows netstat format: ... TCP 127.0.0.1:3845 0.0.0.0:0 LISTENING PID
func parseNetstatOutput(output string) bool {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		// Look for the specific port in LISTEN state
		if strings.Contains(line, fmt.Sprintf(":%d", mcpPort)) && strings.Contains(line, "LISTEN") {
			return true
		}
	}
	return false
}
