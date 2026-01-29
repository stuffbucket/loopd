package main

import (
	"runtime"
)

// PlatformInfo contains platform-specific detection methods
type PlatformInfo struct {
	OS       string // darwin, linux, windows
	Arch     string // amd64, arm64, etc
	HasPgrep bool
	HasLsof  bool
}

// GetPlatformInfo returns information about the current platform
func GetPlatformInfo() PlatformInfo {
	return PlatformInfo{
		OS:   runtime.GOOS,
		Arch: runtime.GOARCH,
		// These would be determined at runtime if needed
		// For now, detection.go handles the tool availability checks
	}
}

// IsSupported returns true if platform detection is supported
func (p PlatformInfo) IsSupported() bool {
	switch p.OS {
	case "darwin", "linux", "windows":
		return true
	default:
		return false
	}
}

// Description returns human-readable platform description
func (p PlatformInfo) Description() string {
	osName := p.OS
	switch p.OS {
	case "darwin":
		osName = "macOS"
	case "linux":
		osName = "Linux"
	case "windows":
		osName = "Windows"
	}
	return osName + " (" + p.Arch + ")"
}
