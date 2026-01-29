// loopd watches for .tar files and serves a rich preview
package main

import (
	"archive/tar"
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/bubbles/filepicker"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/fsnotify/fsnotify"
)

//go:embed templates/*
var templates embed.FS

const appName = "loopd"

// Version information - injected at build time via ldflags
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

// Config holds application settings
type Config struct {
	Port        int               `json:"port"`
	WatchDir    string            `json:"watch_dir"`
	OpenBrowser bool              `json:"open_browser"`
	Templates   map[string]string `json:"templates,omitempty"` // name -> file path
}

// DefaultConfig returns sensible defaults
func DefaultConfig() Config {
	return Config{
		Port:        8080,
		WatchDir:    ".",
		OpenBrowser: true,
		Templates:   make(map[string]string),
	}
}

// Global config for template access
var globalConfig Config

var (
	// Command line flags
	flagPort         = flag.Int("port", 0, "HTTP server port (0 = auto-find free port)")
	flagDir          = flag.String("dir", "", "Directory to watch for .tar files")
	flagOpen         = flag.Bool("open", true, "Open browser automatically")
	flagNoOpen       = flag.Bool("no-open", false, "Do not open browser")
	flagConfig       = flag.String("config", "", "Path to config file")
	flagSaveConfig   = flag.Bool("save-config", false, "Save current settings to config file")
	flagVersion      = flag.Bool("version", false, "Show version")
	flagHeadless     = flag.Bool("headless", false, "Run without TUI, Ctrl+C to quit")
	flagCopyScript   = flag.Bool("copy-script", false, "Copy export script to clipboard and exit")
	flagExportPlugin = flag.String("export-plugin", "", "Export Figma plugin to directory and exit")
)

func init() {
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, `%s v%s - Loop export preview server

Watches a directory for Loop export .tar files and serves a rich 
markdown preview at http://localhost:<port>

USAGE:
    %s [OPTIONS]

OPTIONS:
    --port <n>       HTTP server port (default: 8080, 0 = find free port)
    --dir <path>     Directory to watch (default: current directory)
    --open           Open browser automatically (default: true)
    --no-open        Do not open browser automatically
    --headless       Run without TUI, Ctrl+C to quit
    --copy-script    Copy export script to clipboard and exit
    --export-plugin <dir>  Export Figma plugin to directory and exit
    --config <path>  Path to config file (default: XDG config dir)
    --save-config    Save current settings to config file and exit
    --version        Show version and exit
    --help           Show this help

    Note: Single dash (-port) also works for all options.

CONFIG FILE:
    Settings are loaded from (in order of precedence):
    1. Command line flags
    2. Config file specified with --config
    3. $XDG_CONFIG_HOME/%s/settings.json
    4. ~/.config/%s/settings.json
    5. Built-in defaults

    Example settings.json:
    {
      "port": 8080,
      "watch_dir": ".",
      "open_browser": false
    }

EXAMPLES:
    %s                           # Watch current dir, auto-find port
    %s --dir ~/Downloads         # Watch Downloads folder
    %s --port 3000 --no-open     # Use port 3000, don't open browser
    %s --headless                 # Run without TUI, Ctrl+C to quit
    %s --save-config             # Save current settings for next time

`, appName, version, appName, appName, appName, appName, appName, appName, appName, appName)
	}
}

type Content struct {
	Markdown string
	Images   map[string]string // filename -> base64 data URL
	LoadedAt time.Time
	TarFile  string
	TarPath  string // full path to the tar file
}

var (
	currentContent *Content
	contentMu      sync.RWMutex
)

// ============================================================
// TUI Model and Messages
// ============================================================

// UI mode for the TUI
type uiMode int

const (
	modeNormal uiMode = iota
	modeBrowse
)

// logMsg is sent when there's a new log entry
type logMsg struct {
	text  string
	style string // "info", "success", "error", "warn"
}

// tickMsg is sent periodically to update UI
type tickMsg time.Time

// clearFilePickerMsg signals to clear filepicker selection state
type clearFilePickerMsg struct{}

// TUI model
type model struct {
	input       textinput.Model
	filepicker  filepicker.Model
	viewport    viewport.Model
	logs        []logEntry
	maxLogs     int
	url         string
	watchDir    string
	quitting    bool
	width       int
	height      int
	logChan     chan logMsg
	mode        uiMode
	ready       bool // viewport initialized
	showWelcome bool
}

type logEntry struct {
	time  time.Time
	text  string
	style string
}

// Global channel for log messages
var tuiLogChan chan logMsg

// Welcome screen content for interactive TUI (no ASCII art)
func getWelcomeContent() string {
	return `
  ┌─────────────────────────────────────────────────────────────┐
  │              loopd - M365 Loop Exporter                     │
  │       Microsoft Loop → Clean GitHub-Flavored Markdown       │
  └─────────────────────────────────────────────────────────────┘

  ┌─ Quick Start ───────────────────────────────────────────────┐
  │  1. Open a Loop page in your browser                        │
  │  2. Press F12 → Console tab                                 │
  │  3. Copy loopd.js from the web preview                      │
  │  4. Paste into console and press Enter                      │
  │  5. The .tar file will download automatically               │
  └─────────────────────────────────────────────────────────────┘

  ┌─ Commands ──────────────────────────────────────────────────┐
  │  Tab              Open file browser                         │
  │  /load <path>     Load a specific .tar file                 │
  │  /open, /o        Open preview in browser                   │
  │  /script          Copy export script to clipboard           │
  │  /help, /h        Show all commands                         │
  │  /quit, /q        Exit (or Ctrl+C)                          │
  └─────────────────────────────────────────────────────────────┘

  Waiting for Loop exports... Drop a .tar file or use Tab to browse
`
}

func initialModel(url, watchDir string, logChan chan logMsg) model {
	// Text input
	ti := textinput.New()
	ti.Placeholder = "Type /script to export file or press Tab to browse files..."
	ti.Focus()
	ti.CharLimit = 256
	ti.Width = 60
	ti.Prompt = "❯ "
	ti.PromptStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981")).Bold(true)
	ti.TextStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#E5E7EB"))

	// File picker - show .tar files only for selection
	fp := filepicker.New()
	fp.AllowedTypes = []string{".tar"} // Only .tar files can be selected
	fp.CurrentDirectory = watchDir
	fp.ShowHidden = false
	fp.ShowSize = true
	fp.ShowPermissions = false
	fp.DirAllowed = true  // Can navigate into directories
	fp.FileAllowed = true // Can select .tar files
	fp.Height = 15
	fp.AutoHeight = false
	// Style the filepicker - clear visual feedback
	// Green = selectable (.tar files), Blue = navigable (directories), Gray = disabled
	fp.Styles.Cursor = lipgloss.NewStyle().Foreground(lipgloss.Color("#FBBF24")).Bold(true)    // Yellow cursor >
	fp.Styles.Directory = lipgloss.NewStyle().Foreground(lipgloss.Color("#3B82F6")).Bold(true) // Blue directories
	fp.Styles.File = lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981"))                 // Green .tar files
	fp.Styles.Symlink = lipgloss.NewStyle().Foreground(lipgloss.Color("#A78BFA"))              // Purple symlinks
	fp.Styles.Selected = lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981")).Bold(true)  // Green selected
	fp.Styles.DisabledCursor = lipgloss.NewStyle().Foreground(lipgloss.Color("#FBBF24"))       // Yellow cursor on disabled
	fp.Styles.DisabledFile = lipgloss.NewStyle().Foreground(lipgloss.Color("#4B5563"))         // Dark gray non-.tar files
	fp.Styles.DisabledSelected = lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))     // Gray disabled selected

	// Viewport for logs
	vp := viewport.New(80, 10)
	vp.SetContent("")

	m := model{
		input:       ti,
		filepicker:  fp,
		viewport:    vp,
		logs:        []logEntry{},
		maxLogs:     100,
		url:         url,
		watchDir:    watchDir,
		logChan:     logChan,
		mode:        modeNormal,
		showWelcome: true,
	}

	return m
}

func (m model) Init() tea.Cmd {
	return tea.Batch(
		textinput.Blink,
		m.listenForLogs(),
		tickCmd(),
		m.filepicker.Init(),
	)
}

func tickCmd() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func (m model) listenForLogs() tea.Cmd {
	return func() tea.Msg {
		msg := <-m.logChan
		return msg
	}
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		// Global keys first
		switch msg.Type {
		case tea.KeyCtrlC:
			m.quitting = true
			return m, tea.Quit
		case tea.KeyTab:
			// Toggle browse mode
			if m.mode == modeNormal {
				m.mode = modeBrowse
				m.showWelcome = false
			} else {
				m.mode = modeNormal
			}
			return m, nil
		case tea.KeyEsc:
			if m.mode == modeBrowse {
				m.mode = modeNormal
				return m, nil
			}
		}

		// Mode-specific key handling
		if m.mode == modeBrowse {
			// Pass key to filepicker for navigation
			m.filepicker, cmd = m.filepicker.Update(msg)
			cmds = append(cmds, cmd)

			// Check if a .tar file was selected (AllowedTypes filters to .tar only)
			if didSelect, path := m.filepicker.DidSelectFile(msg); didSelect {
				m.mode = modeNormal
				go loadTar(path)
				m.addLog(fmt.Sprintf("Loading: %s", filepath.Base(path)), "info")
			}

			// Directories are navigated automatically by filepicker

			return m, tea.Batch(cmds...)
		}

		// Normal mode - handle input
		switch msg.Type {
		case tea.KeyEnter:
			input := strings.TrimSpace(m.input.Value())
			m.input.SetValue("")
			m.showWelcome = false
			if input != "" {
				cmds = append(cmds, m.handleCommand(input))
			}
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.input.Width = msg.Width - 6

		// Update viewport size (leave room for header, input, status)
		headerHeight := 4
		inputHeight := 3
		statusHeight := 2
		vpHeight := msg.Height - headerHeight - inputHeight - statusHeight - 2
		if vpHeight < 5 {
			vpHeight = 5
		}
		m.viewport.Width = msg.Width - 4
		m.viewport.Height = vpHeight
		m.filepicker.Height = vpHeight
		m.ready = true

	case logMsg:
		m.addLog(msg.text, msg.style)
		m.showWelcome = false
		m.updateViewportContent()
		cmds = append(cmds, m.listenForLogs())

	case tickMsg:
		cmds = append(cmds, tickCmd())

	case clearFilePickerMsg:
		// Reset filepicker state if needed
	}

	// Always update filepicker for non-key messages (processes internal readDir results)
	// Key messages are handled in browse mode block above
	switch msg.(type) {
	case tea.KeyMsg:
		// Keys handled in mode-specific blocks
	default:
		m.filepicker, cmd = m.filepicker.Update(msg)
		cmds = append(cmds, cmd)
	}

	// Update other components
	if m.mode == modeNormal {
		m.input, cmd = m.input.Update(msg)
		cmds = append(cmds, cmd)
	}

	m.viewport, cmd = m.viewport.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

func (m *model) updateViewportContent() {
	var lines []string
	logTimeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#4B5563"))
	logInfoStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#D1D5DB"))
	logSuccessStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981"))
	logErrorStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444"))
	logWarnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B"))

	for _, entry := range m.logs {
		timestamp := logTimeStyle.Render(entry.time.Format("15:04:05"))
		var textStyled string
		switch entry.style {
		case "success":
			textStyled = logSuccessStyle.Render(entry.text)
		case "error":
			textStyled = logErrorStyle.Render(entry.text)
		case "warn":
			textStyled = logWarnStyle.Render(entry.text)
		default:
			textStyled = logInfoStyle.Render(entry.text)
		}
		lines = append(lines, fmt.Sprintf("%s  %s", timestamp, textStyled))
	}

	m.viewport.SetContent(strings.Join(lines, "\n"))
	m.viewport.GotoBottom()
}

func (m *model) addLog(text, style string) {
	entry := logEntry{
		time:  time.Now(),
		text:  text,
		style: style,
	}
	m.logs = append(m.logs, entry)
	if len(m.logs) > m.maxLogs {
		m.logs = m.logs[1:]
	}
}

func (m model) handleCommand(input string) tea.Cmd {
	// Check if it's a command
	if strings.HasPrefix(input, "/") {
		parts := strings.Fields(input)
		cmd := strings.ToLower(parts[0])
		args := parts[1:]

		switch cmd {
		case "/help", "/h", "/?":
			return m.cmdHelp()
		case "/quit", "/q", "/exit":
			return tea.Quit
		case "/browse", "/b":
			return m.cmdBrowse()
		case "/load", "/l":
			if len(args) > 0 {
				return m.cmdLoad(strings.Join(args, " "))
			}
			return func() tea.Msg {
				return logMsg{text: "Usage: /load <path/to/file.tar>", style: "warn"}
			}
		case "/cd":
			if len(args) > 0 {
				return m.cmdChangeDir(strings.Join(args, " "))
			}
			return func() tea.Msg {
				return logMsg{text: "Usage: /cd <directory>", style: "warn"}
			}
		case "/open", "/o":
			return m.cmdOpen()
		case "/github", "/g":
			return m.cmdOpenTemplate("github")
		case "/vignelli", "/v":
			return m.cmdOpenTemplate("vignelli")
		case "/minimal", "/m":
			return m.cmdOpenTemplate("minimal")
		case "/status", "/s":
			return m.cmdStatus()
		case "/clear", "/c":
			return m.cmdClear()
		case "/templates", "/t":
			return m.cmdTemplates()
		case "/dir", "/d":
			return m.cmdDir()
		case "/reload", "/r":
			return m.cmdReload()
		case "/script", "/export":
			return m.cmdScript()
		default:
			return func() tea.Msg {
				return logMsg{text: fmt.Sprintf("Unknown command: %s (try /help)", cmd), style: "error"}
			}
		}
	}

	// Not a command, just echo it
	return func() tea.Msg {
		return logMsg{text: fmt.Sprintf("echo: %s", input), style: "info"}
	}
}

func (m model) cmdHelp() tea.Cmd {
	help := `Commands:
  /browse, /b     Open file browser (Tab also works)
  /load <path>    Load a specific .tar file
  /cd <path>      Change watch directory
  /open, /o       Open default preview in browser
  /github, /g     Open GitHub-style preview
  /minimal, /m    Open minimal dark preview
  /vignelli, /v   Open Vignelli typography preview
  /status, /s     Show current file status
  /templates, /t  List all preview templates
  /dir, /d        Show watched directory
  /reload, /r     Reload current tar file
  /script         Copy export script to clipboard
  /plugin [dir]   Export Figma plugin to ~/loopd-figma-plugin (or dir)
  /clear, /c      Clear event log
  /quit, /q       Exit (Ctrl+C also works)`
	return func() tea.Msg {
		return logMsg{text: help, style: "info"}
	}
}

func (m *model) cmdBrowse() tea.Cmd {
	m.mode = modeBrowse
	m.showWelcome = false
	return nil
}

func (m model) cmdLoad(path string) tea.Cmd {
	// Expand ~ to home directory
	if strings.HasPrefix(path, "~") {
		home, err := os.UserHomeDir()
		if err == nil {
			path = filepath.Join(home, path[1:])
		}
	}

	// Check if file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return func() tea.Msg {
			return logMsg{text: fmt.Sprintf("File not found: %s", path), style: "error"}
		}
	}

	go loadTar(path)
	return func() tea.Msg {
		return logMsg{text: fmt.Sprintf("Loading: %s", filepath.Base(path)), style: "info"}
	}
}

func (m *model) cmdChangeDir(path string) tea.Cmd {
	// Expand ~ to home directory
	if strings.HasPrefix(path, "~") {
		home, err := os.UserHomeDir()
		if err == nil {
			path = filepath.Join(home, path[1:])
		}
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return func() tea.Msg {
			return logMsg{text: fmt.Sprintf("Invalid path: %s", err), style: "error"}
		}
	}

	info, err := os.Stat(absPath)
	if os.IsNotExist(err) {
		return func() tea.Msg {
			return logMsg{text: fmt.Sprintf("Directory not found: %s", absPath), style: "error"}
		}
	}
	if !info.IsDir() {
		return func() tea.Msg {
			return logMsg{text: fmt.Sprintf("Not a directory: %s", absPath), style: "error"}
		}
	}

	m.watchDir = absPath
	m.filepicker.CurrentDirectory = absPath
	return func() tea.Msg {
		return logMsg{text: fmt.Sprintf("Watch directory changed to: %s", absPath), style: "success"}
	}
}

func (m model) cmdOpen() tea.Cmd {
	go openURL(m.url)
	return func() tea.Msg {
		return logMsg{text: fmt.Sprintf("Opening %s", m.url), style: "success"}
	}
}

func (m model) cmdOpenTemplate(template string) tea.Cmd {
	url := m.url + "/" + template
	go openURL(url)
	return func() tea.Msg {
		return logMsg{text: fmt.Sprintf("Opening %s", url), style: "success"}
	}
}

func (m model) cmdStatus() tea.Cmd {
	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	var status string
	if content != nil {
		status = fmt.Sprintf("Loaded: %s\nSize: %d bytes\nImages: %d\nTime: %s",
			content.TarFile,
			len(content.Markdown),
			len(content.Images),
			content.LoadedAt.Format("15:04:05"))
	} else {
		status = "No content loaded"
	}
	return func() tea.Msg {
		return logMsg{text: status, style: "info"}
	}
}

func (m *model) cmdClear() tea.Cmd {
	m.logs = []logEntry{}
	m.viewport.SetContent("")
	return nil
}

func (m model) cmdTemplates() tea.Cmd {
	var lines []string
	lines = append(lines, "Built-in templates:")
	lines = append(lines, fmt.Sprintf("  %s/          Landing page & instructions", m.url))
	lines = append(lines, fmt.Sprintf("  %s/minimal   Minimal dark mode", m.url))
	lines = append(lines, fmt.Sprintf("  %s/github    GitHub style", m.url))
	lines = append(lines, fmt.Sprintf("  %s/vignelli  Vignelli typography", m.url))

	if len(globalConfig.Templates) > 0 {
		lines = append(lines, "")
		lines = append(lines, "Custom templates:")
		for name, path := range globalConfig.Templates {
			lines = append(lines, fmt.Sprintf("  %s/t/%s  -> %s", m.url, name, path))
		}
	}

	return func() tea.Msg {
		return logMsg{text: strings.Join(lines, "\n"), style: "info"}
	}
}

func (m model) cmdDir() tea.Cmd {
	return func() tea.Msg {
		return logMsg{text: fmt.Sprintf("Watching: %s", m.watchDir), style: "info"}
	}
}

func (m model) cmdReload() tea.Cmd {
	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	if content == nil {
		return func() tea.Msg {
			return logMsg{text: "No content to reload", style: "warn"}
		}
	}

	path := content.TarPath
	go loadTar(path)
	return func() tea.Msg {
		return logMsg{text: fmt.Sprintf("Reloading %s", filepath.Base(path)), style: "info"}
	}
}

func (m model) cmdScript() tea.Cmd {
	if err := copyScriptToClipboard(); err != nil {
		return func() tea.Msg {
			return logMsg{text: fmt.Sprintf("Error: %v", err), style: "error"}
		}
	}
	return func() tea.Msg {
		return logMsg{text: "Export script copied to clipboard! Paste in browser console on a Loop page.", style: "success"}
	}
}

func (m model) cmdPlugin(destDir string) tea.Cmd {
	// Expand ~ to home directory
	if strings.HasPrefix(destDir, "~") {
		home, err := os.UserHomeDir()
		if err == nil {
			destDir = filepath.Join(home, destDir[1:])
		}
	}

	if err := exportFigmaPlugin(destDir); err != nil {
		return func() tea.Msg {
			return logMsg{text: fmt.Sprintf("Error: %v", err), style: "error"}
		}
	}
	return func() tea.Msg {
		return logMsg{text: fmt.Sprintf("Figma plugin exported to %s\nIn Figma: Plugins → Development → Import from manifest → select %s/manifest.json", destDir, destDir), style: "success"}
	}
}

// exportFigmaPlugin exports the Figma plugin files to the specified directory
func exportFigmaPlugin(destDir string) error {
	// Create destination directory
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("creating directory: %w", err)
	}

	// Files to export
	pluginFiles := []string{"manifest.json", "code.js", "ui.html"}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("getting executable path: %w", err)
	}
	exeDir := filepath.Dir(exePath)

	// Try multiple potential source locations
	sourceDirs := []string{
		filepath.Join(exeDir, "plugins", "loopd-markdown-importer"),
		"plugins/loopd-markdown-importer",
	}

	var sourceDir string
	for _, dir := range sourceDirs {
		if _, err := os.Stat(filepath.Join(dir, "manifest.json")); err == nil {
			sourceDir = dir
			break
		}
	}

	if sourceDir == "" {
		return fmt.Errorf("plugin source files not found")
	}

	// Copy each file
	for _, filename := range pluginFiles {
		src := filepath.Join(sourceDir, filename)
		dst := filepath.Join(destDir, filename)

		data, err := os.ReadFile(src)
		if err != nil {
			return fmt.Errorf("reading %s: %w", filename, err)
		}

		if err := os.WriteFile(dst, data, 0644); err != nil {
			return fmt.Errorf("writing %s: %w", filename, err)
		}
	}

	return nil
}

// copyScriptToClipboard copies the loopd.js export script to the system clipboard
func copyScriptToClipboard() error {
	// Load loopd.js content
	jsContent, err := getLoopdJSContent()
	if err != nil {
		return fmt.Errorf("loading script: %w", err)
	}

	// Build clipboard content with instructions
	instructions := `// loopd Export Script
// 
// HOW TO USE:
// 1. Open your Microsoft Loop page in a browser
// 2. Open the browser's Developer Tools (F12 or Cmd+Option+I)
// 3. Go to the Console tab
// 4. Paste this entire script and press Enter
// 5. The export will download as a .tar file
//
// After export, load the .tar file in loopd with /load or Tab to browse.
// -------------------------------------------------------------------

`
	fullScript := instructions + jsContent

	// Copy to clipboard using platform-specific command
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("pbcopy")
	case "linux":
		// Try xclip first, then xsel
		if _, err := exec.LookPath("xclip"); err == nil {
			cmd = exec.Command("xclip", "-selection", "clipboard")
		} else {
			cmd = exec.Command("xsel", "--clipboard", "--input")
		}
	case "windows":
		cmd = exec.Command("clip")
	default:
		return fmt.Errorf("clipboard not supported on %s", runtime.GOOS)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("clipboard pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("clipboard start: %w", err)
	}

	if _, err := stdin.Write([]byte(fullScript)); err != nil {
		stdin.Close()
		return fmt.Errorf("clipboard write: %w", err)
	}
	stdin.Close()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("clipboard: %w", err)
	}

	return nil
}

// getLoopdJSContent returns the loopd.js file content
func getLoopdJSContent() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}

	exeDir := filepath.Dir(exePath)

	// Try multiple potential locations for loopd.js
	potentialPaths := []string{
		filepath.Join(exeDir, "plugins", "loopd-loop-export", "loopd.js"),
		filepath.Join(exeDir, "loopd.js"),
		"plugins/loopd-loop-export/loopd.js",
		"loopd.js",
	}

	for _, p := range potentialPaths {
		data, err := os.ReadFile(p)
		if err == nil {
			return string(data), nil
		}
	}

	return "", fmt.Errorf("loopd.js not found")
}

func (m model) View() string {
	if m.quitting {
		return ""
	}

	// Styles
	titleStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("#7C3AED"))

	urlStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#10B981"))

	pathStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#3B82F6"))

	dimStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#6B7280"))

	borderStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#374151")).
		Padding(0, 1)

	modeStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#F59E0B")).
		Bold(true)

	// Calculate available height
	totalHeight := m.height
	if totalHeight == 0 {
		totalHeight = 24 // Default terminal height
	}

	// Header (fixed at top) - 2 lines
	header := titleStyle.Render(fmt.Sprintf("%s v%s", appName, version))
	urlLine := dimStyle.Render("  Preview: ") + urlStyle.Render(m.url) +
		dimStyle.Render("  •  Watching: ") + pathStyle.Render(m.watchDir)

	// Status bar content
	contentMu.RLock()
	statusContent := currentContent
	contentMu.RUnlock()

	var statusText string
	if statusContent != nil {
		statusText = fmt.Sprintf("📄 %s  •  %d images  •  %s",
			statusContent.TarFile,
			len(statusContent.Images),
			statusContent.LoadedAt.Format("15:04:05"))
	} else {
		statusText = "No content loaded  •  Press tab to load a .tar file or use /browse"
	}

	// Mode indicator
	modeText := ""
	if m.mode == modeBrowse {
		modeText = modeStyle.Render(" [BROWSE] ") + dimStyle.Render("Tab: exit • Enter: select • h/←: back")
	} else {
		modeText = dimStyle.Render("Tab: browse • /help: commands")
	}

	// Main content area
	var mainContent string
	if m.mode == modeBrowse {
		// Build breadcrumb path
		breadcrumbStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("#10B981")).
			Background(lipgloss.Color("#1F2937")).
			Padding(0, 1).
			Bold(true)

		// Create clickable-looking breadcrumb
		currentDir := m.filepicker.CurrentDirectory
		if home, err := os.UserHomeDir(); err == nil && strings.HasPrefix(currentDir, home) {
			currentDir = "~" + currentDir[len(home):]
		}
		breadcrumb := breadcrumbStyle.Render(" 📁 " + currentDir + " ")

		// Color legend
		legendStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280")).Italic(true)
		greenStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981"))
		blueStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#3B82F6"))
		grayStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#4B5563"))

		legend := legendStyle.Render("  ") +
			greenStyle.Render(".tar") + legendStyle.Render("=select  ") +
			blueStyle.Render("dir/") + legendStyle.Render("=navigate  ") +
			grayStyle.Render("other") + legendStyle.Render("=disabled")

		mainContent = breadcrumb + legend + "\n\n" + m.filepicker.View()
	} else if m.showWelcome && len(m.logs) == 0 {
		mainContent = getWelcomeContent()
	} else {
		mainContent = m.viewport.View()
	}

	// Input box (fixed at bottom)
	inputBox := borderStyle.Render(m.input.View())

	// Build the view from bottom up
	// We want: header at top, main content fills middle, input+status at bottom

	// Calculate main content height
	headerLines := 2
	inputLines := 3
	statusLines := 1
	modeLines := 1
	mainContentHeight := totalHeight - headerLines - inputLines - statusLines - modeLines - 2

	// Pad main content to push input to bottom
	mainLines := strings.Split(mainContent, "\n")
	if len(mainLines) < mainContentHeight {
		padding := mainContentHeight - len(mainLines)
		for i := 0; i < padding; i++ {
			mainLines = append(mainLines, "")
		}
	} else if len(mainLines) > mainContentHeight {
		mainLines = mainLines[len(mainLines)-mainContentHeight:]
	}
	mainContent = strings.Join(mainLines, "\n")

	// Compose final view
	return fmt.Sprintf("%s\n%s\n\n%s\n\n%s\n%s\n%s",
		header,
		urlLine,
		mainContent,
		inputBox,
		dimStyle.Render(statusText),
		modeText)
}

// tuiLog sends a log message to the TUI
func tuiLog(text, style string) {
	if tuiLogChan != nil {
		select {
		case tuiLogChan <- logMsg{text: text, style: style}:
		default:
			// Channel full, drop message
		}
	}
}

// runHeadless runs the server in non-interactive mode (like vite)
func runHeadless(url, watchDir string) {
	headerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981")).Bold(true)
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#3B82F6")).Bold(true)
	urlStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#E5E7EB")).Underline(true)
	pathStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#E5E7EB"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))

	fmt.Println()
	fmt.Printf("  %s %s\n", headerStyle.Render(appName), dimStyle.Render("v"+version))
	fmt.Println()
	fmt.Printf("  %s  %s\n", labelStyle.Render("➜  Local:"), urlStyle.Render(url))
	fmt.Printf("  %s  %s\n", labelStyle.Render("➜  Watch:"), pathStyle.Render(watchDir))
	fmt.Println()

	// Block forever - server runs in goroutine, Ctrl+C to exit
	select {}
}

// handleAPIOpen opens the browser
func handleAPIOpen(w http.ResponseWriter, r *http.Request) {
	port := r.URL.Query().Get("port")
	if port == "" {
		port = "8080"
	}
	url := fmt.Sprintf("http://localhost:%s", port)
	openURL(url)
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"opened": %q}`, url)
}

// handleAPIRoutes returns available routes
func handleAPIRoutes(w http.ResponseWriter, r *http.Request) {
	host := r.Host
	if host == "" {
		host = "localhost:8080"
	}
	base := fmt.Sprintf("http://%s", host)
	routes := map[string]string{
		"/":                 "Landing page with instructions",
		"/minimal":          "Dark mode preview",
		"/github":           "GitHub file browser style",
		"/vignelli":         "Typography focused",
		"/raw":              "Raw markdown content",
		"/content":          "Markdown with image URLs resolved",
		"/images/":          "Image browser",
		"/api/status":       "Server status JSON",
		"/api/tar":          "Download loaded tar file",
		"/api/routes":       "This endpoint",
		"/api/open":         "Open browser (query: ?port=8080)",
		"/api/figma-detect": "Figma desktop and MCP server detection",
		"/loopd.js":         "Export script for clipboard",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"base":   base,
		"routes": routes,
	})
}

// corsHandler adds CORS headers to allow cross-origin requests from iframes and data: URLs
func corsHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Allow all origins, including data: URLs (origin: null)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		// Handle OPTIONS preflight requests
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

func main() {
	flag.Parse()

	if *flagVersion {
		// Colorized version output
		nameStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981")).Bold(true)
		versionStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))
		fmt.Printf("%s %s\n", nameStyle.Render(appName), versionStyle.Render("v"+version))
		os.Exit(0)
	}

	// Copy script to clipboard if requested
	if *flagCopyScript {
		if err := copyScriptToClipboard(); err != nil {
			errorStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444")).Bold(true)
			fmt.Fprintln(os.Stderr, errorStyle.Render(fmt.Sprintf("Error: %v", err)))
			os.Exit(1)
		}

		// Styles for colorized output
		successStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981")).Bold(true)
		headerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#E5E7EB")).Bold(true)
		stepStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#3B82F6")).Bold(true)
		textStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#9CA3AF"))
		codeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#A78BFA"))
		dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))

		fmt.Println()
		fmt.Println(successStyle.Render("✓ Export script copied to clipboard!"))
		fmt.Println()
		fmt.Println(headerStyle.Render("Next Steps:"))
		fmt.Println()

		// Step 1
		fmt.Printf("  %s %s\n", stepStyle.Render("1."), headerStyle.Render("Open a Loop page"))
		fmt.Printf("     %s\n", textStyle.Render("Navigate to the Loop page you want to export in your browser"))
		fmt.Println()

		// Step 2
		fmt.Printf("  %s %s\n", stepStyle.Render("2."), headerStyle.Render("Open DevTools Console"))
		fmt.Println()
		fmt.Printf("     %s  %s   %s\n",
			dimStyle.Render("Chrome:"),
			codeStyle.Render("⌘⌥J"),
			dimStyle.Render("(Mac)  Ctrl+Shift+J (Win)"))
		fmt.Printf("     %s %s   %s\n",
			dimStyle.Render("Firefox:"),
			codeStyle.Render("⌘⌥K"),
			dimStyle.Render("(Mac)  Ctrl+Shift+K (Win)"))
		fmt.Printf("     %s  %s   %s\n",
			dimStyle.Render("Safari:"),
			codeStyle.Render("⌘⌥C"),
			dimStyle.Render("(Mac)  Enable in Develop menu first"))
		fmt.Printf("     %s    %s   %s\n",
			dimStyle.Render("Edge:"),
			codeStyle.Render("⌘⌥J"),
			dimStyle.Render("(Mac)  Ctrl+Shift+J (Win)"))
		fmt.Println()

		// Step 3
		fmt.Printf("  %s %s\n", stepStyle.Render("3."), headerStyle.Render("Paste and run"))
		fmt.Printf("     %s %s %s\n",
			textStyle.Render("Paste the script into the console and press"),
			codeStyle.Render("Enter"),
			textStyle.Render(""))
		fmt.Println()

		// Step 4
		fmt.Printf("  %s %s\n", stepStyle.Render("4."), headerStyle.Render("Load the export"))
		fmt.Printf("     %s\n", textStyle.Render("A .tar file will download. Load it in loopd:"))
		fmt.Printf("     %s  %s\n", dimStyle.Render("•"), codeStyle.Render("./loopd"))
		fmt.Printf("     %s  %s\n", dimStyle.Render("•"), textStyle.Render("Press Tab to browse, or /load <file.tar>"))
		fmt.Println()

		os.Exit(0)
	}

	// Export Figma plugin if requested
	if *flagExportPlugin != "" {
		destDir := *flagExportPlugin
		// Expand ~ to home directory
		if strings.HasPrefix(destDir, "~") {
			home, err := os.UserHomeDir()
			if err == nil {
				destDir = filepath.Join(home, destDir[1:])
			}
		}

		if err := exportFigmaPlugin(destDir); err != nil {
			errorStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444")).Bold(true)
			fmt.Fprintln(os.Stderr, errorStyle.Render(fmt.Sprintf("Error: %v", err)))
			os.Exit(1)
		}

		// Styles for colorized output
		successStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981")).Bold(true)
		headerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#E5E7EB")).Bold(true)
		stepStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#3B82F6")).Bold(true)
		textStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#9CA3AF"))
		codeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#A78BFA"))
		pathStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#FBBF24"))

		fmt.Println()
		fmt.Println(successStyle.Render("✓ Figma plugin exported!"))
		fmt.Println()
		fmt.Printf("  %s %s\n", textStyle.Render("Location:"), pathStyle.Render(destDir))
		fmt.Println()
		fmt.Println(headerStyle.Render("To install in Figma:"))
		fmt.Println()
		fmt.Printf("  %s %s\n", stepStyle.Render("1."), textStyle.Render("Open Figma desktop app"))
		fmt.Printf("  %s %s\n", stepStyle.Render("2."), textStyle.Render("Go to the Plugins menu"))
		fmt.Printf("  %s %s\n", stepStyle.Render("3."), textStyle.Render("Click \"Development\" → \"Import plugin from manifest...\""))
		fmt.Printf("  %s %s\n", stepStyle.Render("4."), textStyle.Render("Select:"))
		fmt.Printf("     %s\n", codeStyle.Render(filepath.Join(destDir, "manifest.json")))
		fmt.Println()
		fmt.Printf("  %s\n", textStyle.Render("Then run the plugin from Plugins → Development → loopd Markdown Importer"))
		fmt.Println()

		os.Exit(0)
	}

	// Load config (XDG compliant)
	cfg := loadConfig()
	globalConfig = cfg

	// Apply command line overrides
	if *flagPort != 0 {
		cfg.Port = *flagPort
	}
	if *flagDir != "" {
		cfg.WatchDir = *flagDir
	}
	if *flagNoOpen {
		cfg.OpenBrowser = false
	} else if isFlagSet("open") {
		cfg.OpenBrowser = *flagOpen
	}

	// Save config if requested
	if *flagSaveConfig {
		if err := saveConfig(cfg); err != nil {
			errorStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444")).Bold(true)
			fmt.Fprintln(os.Stderr, errorStyle.Render(fmt.Sprintf("Failed to save config: %v", err)))
			os.Exit(1)
		}
		successStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#10B981"))
		pathStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#E5E7EB")).Bold(true)
		fmt.Printf("%s %s\n", successStyle.Render("Config saved to"), pathStyle.Render(getConfigPath()))
		os.Exit(0)
	}

	// Resolve watch directory
	absDir, err := filepath.Abs(cfg.WatchDir)
	if err != nil {
		errorStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444")).Bold(true)
		fmt.Fprintln(os.Stderr, errorStyle.Render(fmt.Sprintf("Error: %v", err)))
		os.Exit(1)
	}

	// Find available port
	port, listener, err := findAvailablePort(cfg.Port)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Could not find available port: %v\n", err)
		os.Exit(1)
	}

	url := fmt.Sprintf("http://localhost:%d", port)

	// Create log channel for TUI
	tuiLogChan = make(chan logMsg, 100)

	// HTTP handlers are registered on mux below (in main function)

	// Create HTTP server with CORS middleware
	mux := http.NewServeMux()

	// Register handlers on mux
	mux.HandleFunc("/", corsHandler(handleIndex))
	mux.HandleFunc("/minimal", corsHandler(handleMinimal))
	mux.HandleFunc("/github", corsHandler(handleGithub))
	mux.HandleFunc("/vignelli", corsHandler(handleVignelli))
	mux.HandleFunc("/t/", corsHandler(handleCustomTemplate))
	mux.HandleFunc("/content", corsHandler(handleContent))
	mux.HandleFunc("/raw", corsHandler(handleRaw))
	mux.HandleFunc("/images/", corsHandler(handleImages))
	mux.HandleFunc("/api/status", corsHandler(handleStatus))
	mux.HandleFunc("/api/tar", corsHandler(handleTarDownload))
	mux.HandleFunc("/api/routes", corsHandler(handleAPIRoutes))
	mux.HandleFunc("/api/open", corsHandler(handleAPIOpen))
	mux.HandleFunc("/api/figma-detect", corsHandler(handleFigmaDetect))
	mux.HandleFunc("/loopd.js", corsHandler(handleLoopdJS))
	mux.HandleFunc("/plugins/", corsHandler(handlePlugins))

	// Start HTTP server in goroutine
	go func() {
		if err := http.Serve(listener, mux); err != nil {
			tuiLog(fmt.Sprintf("HTTP server error: %v", err), "error")
		}
	}()

	// Check for existing tar files on startup
	go func() {
		time.Sleep(100 * time.Millisecond)
		checkExistingTars(absDir)
	}()

	// Start file watcher
	go watchDirectory(absDir)

	// Open browser if requested
	if cfg.OpenBrowser {
		go func() {
			time.Sleep(500 * time.Millisecond)
			openURL(url)
		}()
	}

	// Run in headless mode or TUI mode
	if *flagHeadless {
		runHeadless(url, absDir)
		return
	}

	// Run TUI (with graceful fallback for non-TTY environments)
	p := tea.NewProgram(
		initialModel(url, absDir, tuiLogChan),
		tea.WithAltScreen(),
	)

	if _, err := p.Run(); err != nil {
		// TUI failed (likely no TTY available). Just keep the server running.
		// Log the error but don't exit - the HTTP server is already running.
		fmt.Fprintf(os.Stderr, "Note: Running in headless mode (no TUI available)\n")
		fmt.Fprintf(os.Stderr, "Server running at: %s\n", url)
		fmt.Fprintf(os.Stderr, "Press Ctrl+C to stop\n")

		// Keep the server running with a blocking call
		select {}
	}
}

// isFlagSet checks if a flag was explicitly set on command line
func isFlagSet(name string) bool {
	found := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == name {
			found = true
		}
	})
	return found
}

// getConfigDir returns XDG compliant config directory
func getConfigDir() string {
	if xdgConfig := os.Getenv("XDG_CONFIG_HOME"); xdgConfig != "" {
		return filepath.Join(xdgConfig, appName)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".config", appName)
}

// getConfigPath returns full path to config file
func getConfigPath() string {
	if *flagConfig != "" {
		return *flagConfig
	}
	return filepath.Join(getConfigDir(), "settings.json")
}

// loadConfig loads settings from XDG config location
func loadConfig() Config {
	cfg := DefaultConfig()

	configPath := getConfigPath()
	if configPath == "" {
		return cfg
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		// Config file doesn't exist yet, use defaults
		return cfg
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not parse config file: %v\n", err)
		return DefaultConfig()
	}

	// Ensure Templates map is initialized
	if cfg.Templates == nil {
		cfg.Templates = make(map[string]string)
	}

	return cfg
}

// saveConfig saves settings to XDG config location
func saveConfig(cfg Config) error {
	configPath := getConfigPath()
	configDir := filepath.Dir(configPath)

	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return fmt.Errorf("write config: %w", err)
	}

	return nil
}

// findAvailablePort finds a free port starting from the preferred port
func findAvailablePort(preferred int) (int, net.Listener, error) {
	// If preferred is 0, let OS pick
	if preferred == 0 {
		preferred = 8080
	}

	// Try preferred port first
	for port := preferred; port < preferred+100; port++ {
		addr := fmt.Sprintf(":%d", port)
		listener, err := net.Listen("tcp", addr)
		if err == nil {
			if port != preferred {
				tuiLog(fmt.Sprintf("Port %d in use, using %d instead", preferred, port), "warn")
			}
			return port, listener, nil
		}
	}

	return 0, nil, fmt.Errorf("no available port found in range %d-%d", preferred, preferred+99)
}

// openURL opens a URL in the default browser
func openURL(url string) {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	default:
		tuiLog(fmt.Sprintf("Cannot open browser on %s, please visit: %s", runtime.GOOS, url), "warn")
		return
	}

	if err := cmd.Start(); err != nil {
		tuiLog(fmt.Sprintf("Failed to open browser: %v", err), "error")
		tuiLog(fmt.Sprintf("Please open manually: %s", url), "info")
	}
}

func checkExistingTars(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	var newest string
	var newestTime time.Time

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".tar") {
			continue
		}
		// Accept: loop_export_*.tar, Loop Export*.tar, or *at [time].tar
		name := entry.Name()
		isLoopExport := strings.HasPrefix(name, "loop_export_") ||
			strings.HasPrefix(name, "Loop Export") ||
			strings.Contains(name, " at ") // matches "Page Title - 2026-01-28 at 1.39 PM.tar"
		if !isLoopExport {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().After(newestTime) {
			newestTime = info.ModTime()
			newest = filepath.Join(dir, entry.Name())
		}
	}

	if newest != "" {
		tuiLog(fmt.Sprintf("Found existing: %s", filepath.Base(newest)), "info")
		loadTar(newest)
	}
}

func watchDirectory(dir string) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		tuiLog(fmt.Sprintf("Failed to create watcher: %v", err), "error")
		return
	}
	defer watcher.Close()

	if err := watcher.Add(dir); err != nil {
		tuiLog(fmt.Sprintf("Failed to watch directory: %v", err), "error")
		return
	}

	// Debounce map for file events
	pending := make(map[string]time.Time)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if event.Op&(fsnotify.Create|fsnotify.Write) != 0 {
				if strings.HasSuffix(event.Name, ".tar") {
					// Accept: loop_export_*.tar, Loop Export*.tar, or *at [time].tar
					base := filepath.Base(event.Name)
					isLoopExport := strings.HasPrefix(base, "loop_export_") ||
						strings.HasPrefix(base, "Loop Export") ||
						strings.Contains(base, " at ")
					if isLoopExport {
						pending[event.Name] = time.Now()
					}
				}
			}

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			tuiLog(fmt.Sprintf("Watcher error: %v", err), "error")

		case <-ticker.C:
			now := time.Now()
			for path, lastEvent := range pending {
				// Wait 1 second after last event before processing
				if now.Sub(lastEvent) > time.Second {
					delete(pending, path)
					tuiLog(fmt.Sprintf("Detected: %s", filepath.Base(path)), "info")
					loadTar(path)
				}
			}
		}
	}
}

func loadTar(path string) {
	f, err := os.Open(path)
	if err != nil {
		tuiLog(fmt.Sprintf("Failed to open tar: %v", err), "error")
		return
	}
	defer f.Close()

	content := &Content{
		Images:   make(map[string]string),
		LoadedAt: time.Now(),
		TarFile:  filepath.Base(path),
		TarPath:  path,
	}

	tr := tar.NewReader(f)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			tuiLog(fmt.Sprintf("Tar read error: %v", err), "error")
			return
		}

		if header.Typeflag == tar.TypeDir {
			continue
		}

		data, err := io.ReadAll(tr)
		if err != nil {
			tuiLog(fmt.Sprintf("Failed to read %s: %v", header.Name, err), "error")
			continue
		}

		name := header.Name
		if name == "content.md" {
			content.Markdown = string(data)
		} else if strings.HasPrefix(name, "images/") {
			imgName := strings.TrimPrefix(name, "images/")
			mimeType := getMimeType(imgName)
			b64 := base64.StdEncoding.EncodeToString(data)
			content.Images[imgName] = fmt.Sprintf("data:%s;base64,%s", mimeType, b64)
		}
	}

	contentMu.Lock()
	currentContent = content
	contentMu.Unlock()

	tuiLog(fmt.Sprintf("Loaded: %s (%d bytes, %d images)", content.TarFile, len(content.Markdown), len(content.Images)), "success")
}

func getMimeType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	default:
		return "application/octet-stream"
	}
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	tmplData, err := templates.ReadFile("templates/index.html")
	if err != nil {
		http.Error(w, "Template not found", 500)
		return
	}

	tmpl, err := template.New("index").Parse(string(tmplData))
	if err != nil {
		http.Error(w, "Template parse error", 500)
		return
	}

	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	data := struct {
		HasContent   bool
		TarFile      string
		LoadedAt     string
		Port         int
		MarkdownSize string
		ImageCount   int
	}{
		HasContent: content != nil,
		Port:       globalConfig.Port,
	}

	if content != nil {
		data.TarFile = content.TarFile
		data.LoadedAt = content.LoadedAt.Format("15:04:05")
		data.MarkdownSize = formatSize(len(content.Markdown))
		data.ImageCount = len(content.Images)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	tmpl.Execute(w, data)
}

func handleMinimal(w http.ResponseWriter, r *http.Request) {
	tmplData, err := templates.ReadFile("templates/minimal.html")
	if err != nil {
		http.Error(w, "Template not found", 500)
		return
	}

	tmpl, err := template.New("minimal").Parse(string(tmplData))
	if err != nil {
		http.Error(w, "Template parse error", 500)
		return
	}

	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	data := struct {
		HasContent   bool
		TarFile      string
		LoadedAt     string
		MarkdownSize string
		ImageCount   int
	}{
		HasContent: content != nil,
	}

	if content != nil {
		data.TarFile = content.TarFile
		data.LoadedAt = content.LoadedAt.Format("15:04:05")
		data.MarkdownSize = formatSize(len(content.Markdown))
		data.ImageCount = len(content.Images)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	tmpl.Execute(w, data)
}

func handleLoopdJS(w http.ResponseWriter, r *http.Request) {
	// Serve loopd.js from plugins/loopd-loop-export/
	exePath, err := os.Executable()
	if err != nil {
		http.Error(w, "Could not locate loopd.js", 500)
		return
	}

	exeDir := filepath.Dir(exePath)

	// Try multiple potential locations for loopd.js
	potentialPaths := []string{
		// Development: relative to source directory
		filepath.Join(exeDir, "plugins", "loopd-loop-export", "loopd.js"),
		// Installed: same directory as executable
		filepath.Join(exeDir, "loopd.js"),
		// Working directory
		"plugins/loopd-loop-export/loopd.js",
		"loopd.js",
	}

	var data []byte
	for _, p := range potentialPaths {
		data, err = os.ReadFile(p)
		if err == nil {
			break
		}
	}

	if data == nil {
		http.Error(w, "loopd.js not found", 404)
		return
	}

	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Write(data)
}

func handleGithub(w http.ResponseWriter, r *http.Request) {
	tmplData, err := templates.ReadFile("templates/github.html")
	if err != nil {
		http.Error(w, "Template not found", 500)
		return
	}

	tmpl, err := template.New("github").Parse(string(tmplData))
	if err != nil {
		http.Error(w, "Template parse error", 500)
		return
	}

	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	data := struct {
		HasContent   bool
		TarFile      string
		LoadedAt     string
		MarkdownSize string
		ImageCount   int
	}{
		HasContent: content != nil,
	}

	if content != nil {
		data.TarFile = content.TarFile
		data.LoadedAt = content.LoadedAt.Format("15:04:05")
		data.MarkdownSize = formatSize(len(content.Markdown))
		data.ImageCount = len(content.Images)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	tmpl.Execute(w, data)
}

func handleVignelli(w http.ResponseWriter, r *http.Request) {
	tmplData, err := templates.ReadFile("templates/vignelli.html")
	if err != nil {
		http.Error(w, "Template not found", 500)
		return
	}

	tmpl, err := template.New("vignelli").Parse(string(tmplData))
	if err != nil {
		http.Error(w, "Template parse error", 500)
		return
	}

	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	data := struct {
		HasContent   bool
		TarFile      string
		TarDir       string
		LoadedAt     string
		MarkdownSize string
		ImageCount   int
	}{
		HasContent: content != nil,
	}

	if content != nil {
		data.TarFile = content.TarFile
		// Show the directory containing the tar (where extracted files would be)
		data.TarDir = filepath.Dir(content.TarPath)
		data.LoadedAt = content.LoadedAt.Format("15:04:05")
		data.MarkdownSize = formatSize(len(content.Markdown))
		data.ImageCount = len(content.Images)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	tmpl.Execute(w, data)
}

// handleCustomTemplate serves user-defined templates from config
func handleCustomTemplate(w http.ResponseWriter, r *http.Request) {
	// Extract template name from path: /t/mytemplate -> mytemplate
	name := strings.TrimPrefix(r.URL.Path, "/t/")
	if name == "" {
		// List available custom templates
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html>
<html><head><title>Custom Templates</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
h1 { font-size: 18px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
ul { list-style: none; padding: 0; }
li { padding: 6px 0; border-bottom: 1px solid #eee; }
li:last-child { border-bottom: none; }
.back { margin-bottom: 20px; display: block; }
.path { color: #666; font-size: 0.85em; margin-left: 1em; }
</style></head><body>
<a class="back" href="/">← Back to preview</a>
<h1>Custom Templates</h1>
<ul>`)
		if len(globalConfig.Templates) == 0 {
			fmt.Fprintf(w, `<li>No custom templates configured. Add them to settings.json</li>`)
		} else {
			for tmplName, tmplPath := range globalConfig.Templates {
				fmt.Fprintf(w, `<li><a href="/t/%s">%s</a><span class="path">%s</span></li>`, tmplName, tmplName, tmplPath)
			}
		}
		fmt.Fprintf(w, `</ul></body></html>`)
		return
	}

	// Look up template path
	tmplPath, ok := globalConfig.Templates[name]
	if !ok {
		http.Error(w, fmt.Sprintf("Template '%s' not found in config", name), 404)
		return
	}

	// Read template file
	tmplData, err := os.ReadFile(tmplPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read template: %v", err), 500)
		return
	}

	tmpl, err := template.New(name).Parse(string(tmplData))
	if err != nil {
		http.Error(w, fmt.Sprintf("Template parse error: %v", err), 500)
		return
	}

	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	data := struct {
		HasContent   bool
		TarFile      string
		TarDir       string
		LoadedAt     string
		MarkdownSize string
		ImageCount   int
	}{
		HasContent: content != nil,
	}

	if content != nil {
		data.TarFile = content.TarFile
		data.TarDir = filepath.Dir(content.TarPath)
		data.LoadedAt = content.LoadedAt.Format("15:04:05")
		data.MarkdownSize = formatSize(len(content.Markdown))
		data.ImageCount = len(content.Images)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	tmpl.Execute(w, data)
}

// formatSize formats byte count as human readable
func formatSize(bytes int) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := unit, 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

func handleContent(w http.ResponseWriter, r *http.Request) {
	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	if content == nil {
		http.Error(w, "No content loaded", 404)
		return
	}

	// Replace image references with base64 data URLs
	md := content.Markdown
	for filename, dataURL := range content.Images {
		md = strings.ReplaceAll(md, "images/"+filename, dataURL)
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(md))
}

func handleRaw(w http.ResponseWriter, r *http.Request) {
	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	if content == nil {
		http.Error(w, "No content loaded", 404)
		return
	}

	// Replace image references with /images/ URLs for browser viewing
	md := content.Markdown
	for filename := range content.Images {
		md = strings.ReplaceAll(md, "images/"+filename, "/images/"+filename)
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(md))
}

func handleImages(w http.ResponseWriter, r *http.Request) {
	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	if content == nil {
		http.Error(w, "No content loaded", 404)
		return
	}

	// Extract filename from path: /images/foo.png -> foo.png
	name := strings.TrimPrefix(r.URL.Path, "/images/")

	// If no filename, show directory listing
	if name == "" {
		// Determine back link from Referer header
		backLink := "/"
		if referer := r.Header.Get("Referer"); referer != "" {
			// Extract path from referer URL
			if idx := strings.Index(referer, "://"); idx != -1 {
				if pathStart := strings.Index(referer[idx+3:], "/"); pathStart != -1 {
					backLink = referer[idx+3+pathStart:]
				}
			}
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html>
<html><head><title>images/</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
h1 { font-size: 18px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
ul { list-style: none; padding: 0; }
li { padding: 6px 0; border-bottom: 1px solid #eee; }
li:last-child { border-bottom: none; }
.back { margin-bottom: 20px; display: block; }
</style></head><body>
<a class="back" href="%s">← Back to preview</a>
<h1>images/</h1>
<ul>`, backLink)
		for filename := range content.Images {
			fmt.Fprintf(w, `<li><a href="/images/%s">%s</a></li>`, filename, filename)
		}
		fmt.Fprintf(w, `</ul></body></html>`)
		return
	}

	// Serve specific image
	dataURL, ok := content.Images[name]
	if !ok {
		http.Error(w, "Image not found", 404)
		return
	}

	// Parse data URL: data:image/png;base64,xxxx
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		http.Error(w, "Invalid image data", 500)
		return
	}

	// Extract MIME type from data:image/png;base64
	mimeType := "image/png"
	if strings.HasPrefix(parts[0], "data:") {
		meta := strings.TrimPrefix(parts[0], "data:")
		meta = strings.TrimSuffix(meta, ";base64")
		if meta != "" {
			mimeType = meta
		}
	}

	// Decode base64
	imgData, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		http.Error(w, "Failed to decode image", 500)
		return
	}

	w.Header().Set("Content-Type", mimeType)
	w.Write(imgData)
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")

	if content == nil {
		w.Write([]byte(`{"loaded":false}`))
		return
	}

	fmt.Fprintf(w, `{"loaded":true,"file":%q,"time":%q,"images":%d}`,
		content.TarFile,
		content.LoadedAt.Format(time.RFC3339),
		len(content.Images))
}

func handleTarDownload(w http.ResponseWriter, r *http.Request) {
	contentMu.RLock()
	content := currentContent
	contentMu.RUnlock()

	if content == nil {
		http.Error(w, "No tar file loaded", 404)
		return
	}

	// Serve the tar file as application/x-tar
	w.Header().Set("Content-Type", "application/x-tar")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, content.TarFile))
	// Prevent caching - always serve fresh content
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Serve the file from disk
	http.ServeFile(w, r, content.TarPath)
}

func handlePlugins(w http.ResponseWriter, r *http.Request) {
	// Serve plugin files from plugins/ directory
	exePath, err := os.Executable()
	if err != nil {
		http.Error(w, "Could not locate plugin files", 500)
		return
	}

	// Extract requested plugin file path
	pluginPath := strings.TrimPrefix(r.URL.Path, "/plugins/")
	if pluginPath == "" {
		http.Error(w, "Plugin path required", 400)
		return
	}

	// Security: prevent directory traversal
	if strings.Contains(pluginPath, "..") {
		http.Error(w, "Invalid plugin path", 400)
		return
	}

	// Construct full file path
	dir := filepath.Dir(exePath)
	fullPath := filepath.Join(dir, "plugins", pluginPath)

	// Verify the file exists and is in the plugins directory
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		http.Error(w, "Invalid path", 400)
		return
	}

	pluginsDir, err := filepath.Abs(filepath.Join(dir, "plugins"))
	if err != nil {
		http.Error(w, "Could not locate plugins directory", 500)
		return
	}

	// Ensure the requested file is within the plugins directory
	if !strings.HasPrefix(absPath, pluginsDir) {
		http.Error(w, "Access denied", 403)
		return
	}

	// Set appropriate content type
	switch filepath.Ext(pluginPath) {
	case ".json":
		w.Header().Set("Content-Type", "application/json")
	case ".html":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case ".js":
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	case ".css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	case ".svg":
		w.Header().Set("Content-Type", "image/svg+xml")
	case ".md":
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	}

	// Serve the file
	http.ServeFile(w, r, absPath)
}

// ============================================================
// Figma Detection (from loopd-figma-detect plugin)
// ============================================================

const figmaMCPPort = 3845

// FigmaDetectionResult contains the detection results
type FigmaDetectionResult struct {
	FigmaRunning    bool     `json:"figma_running"`
	PortBound       bool     `json:"port_bound"`
	BothReady       bool     `json:"both_ready"`
	Status          string   `json:"status"`
	Timestamp       string   `json:"timestamp"`
	ProcessPID      int      `json:"process_pid,omitempty"`
	Recommendations []string `json:"recommendations,omitempty"`
	Error           string   `json:"error,omitempty"`
}

// detectFigma performs the full detection check
func detectFigma() *FigmaDetectionResult {
	result := &FigmaDetectionResult{
		Timestamp: time.Now().Format(time.RFC3339),
	}

	// Check if Figma is running
	result.FigmaRunning, result.ProcessPID = detectFigmaProcess()

	// Check if port is bound
	result.PortBound = detectFigmaPortBinding()

	// Determine overall status
	result.BothReady = result.FigmaRunning && result.PortBound

	// Set status message
	if result.BothReady {
		result.Status = "Ready for Figma integration"
	} else if result.FigmaRunning && !result.PortBound {
		result.Status = "Figma running but MCP port not bound"
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

// detectFigmaProcess checks if Figma is running
func detectFigmaProcess() (bool, int) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Try pgrep first (most reliable on Unix-like systems)
	cmd := exec.CommandContext(ctx, "pgrep", "-x", "Figma")
	output, err := cmd.Output()
	if err == nil && len(output) > 0 {
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
		return parseFigmaPsOutput(string(output))
	}

	// Windows fallback: tasklist
	cmd = exec.CommandContext(ctx, "tasklist.exe")
	output, err = cmd.Output()
	if err == nil {
		if strings.Contains(string(output), "Figma") {
			return true, 0
		}
	}

	return false, 0
}

// parseFigmaPsOutput extracts Figma process info from ps output
func parseFigmaPsOutput(output string) (bool, int) {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "Figma") && !strings.Contains(line, "Figma Helper") {
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

// detectFigmaPortBinding checks if port 3845 is bound
func detectFigmaPortBinding() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Try lsof first (available on macOS and Linux)
	cmd := exec.CommandContext(ctx, "lsof", "-i", fmt.Sprintf(":%d", figmaMCPPort), "-n", "-P")
	output, err := cmd.Output()
	if err == nil {
		return parseFigmaLsofOutput(string(output))
	}

	// Windows fallback: netstat
	cmd = exec.CommandContext(ctx, "netstat", "-ano")
	output, err = cmd.Output()
	if err == nil {
		return parseFigmaNetstatOutput(string(output))
	}

	return false
}

// parseFigmaLsofOutput checks if port is bound
func parseFigmaLsofOutput(output string) bool {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "COMMAND") {
			continue
		}
		if strings.TrimSpace(line) == "" {
			continue
		}
		return true
	}
	return false
}

// parseFigmaNetstatOutput checks if port is in LISTEN state
func parseFigmaNetstatOutput(output string) bool {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, fmt.Sprintf(":%d", figmaMCPPort)) && strings.Contains(line, "LISTEN") {
			return true
		}
	}
	return false
}

func handleFigmaDetect(w http.ResponseWriter, r *http.Request) {
	result := detectFigma()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
