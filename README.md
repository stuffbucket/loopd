# loopd - M365 Loop to Markdown Exporter

Microsoft Loop doesn't provide a native export to Markdown. Well then, get loopd! Export any Loop page to clean GitHub-flavored Markdown, complete with images.

## The Problem

Microsoft Loop offers limited options for getting your content out:

- **Copy and paste**: Loses formatting, mangles tables, doesn't include images
- **Print to PDF**: Produces a static document that can't be edited or version-controlled
- **"Copy as Markdown"** (if available): Partial support, often misses complex formatting, no image handling

None of these options give you portable, editable content that works well with modern tools.

### Why Markdown?

Markdown solves these problems:

- **Portable**: Plain text works everywhere—Git repos, wikis, documentation sites, note apps
- **Editable**: Easy to modify in any text editor
- **Version-controllable**: Diffs are readable; works with Git
- **Convertible**: Transform to HTML, PDF, Word, or other formats with standard tools
- **Future-proof**: Your content isn't locked into a complex format

## What It Does

- Exports Loop pages to a `.tar` archive containing:
  - `content.md` - The page content as GitHub-flavored Markdown
  - `images/` - All images from the page
- Preserves formatting: headings, lists, tables, code blocks, links, bold, italic, strikethrough
- Converts Loop callouts to GitHub Alerts (`> [!NOTE]`, `> [!WARNING]`, etc.)
- Expands collapsed sections before export so they don't get missed (I'm not looking at you shadow DOM)
- Downloads images and rewrites references to local paths

## Installation

### Homebrew (macOS, Linux, WSL2)

```bash
brew install stuffbucket/tap/loopd
```

### Download Binary

Download the latest release for your platform from [GitHub Releases](https://github.com/stuffbucket/loopd/releases):

| Platform | Architecture | Download |
|----------|--------------|----------|
| macOS | Intel | `loopd_*_darwin_amd64.tar.gz` |
| macOS | Apple Silicon | `loopd_*_darwin_arm64.tar.gz` |
| Linux | x86_64 | `loopd_*_linux_amd64.tar.gz` |
| Linux | ARM64 | `loopd_*_linux_arm64.tar.gz` |
| Windows | x86_64 | `loopd_*_windows_amd64.zip` |

Extract and move to your PATH:

```bash
# macOS/Linux
tar -xzf loopd_*_darwin_arm64.tar.gz
sudo mv loopd /usr/local/bin/
```

### Build from Source

Requires Go 1.24+:

```bash
go install github.com/stuffbucket/loopd@latest
```

Or clone and build:

```bash
git clone https://github.com/stuffbucket/loopd.git
cd loopd
go build -o loopd .
```

## How to Use

### Quick Start: Bookmarklet (Edge/Chrome)

The fastest way to export—no DevTools required:

1. Run `./loopd` to start the preview server
2. Open http://localhost:8080 and drag the **"Export Loop"** button to your bookmarks bar
3. Navigate to any Loop page and click the bookmarklet
4. Wait for the export to complete and download

> **Note**: Safari blocks bookmarklets on Loop pages. Use the console method below instead.

### Console Method (All Browsers)

#### Step 1: Open the Loop Page

Navigate to the Loop page you want to export in your browser.

### Step 2: Open Developer Tools Console

#### Microsoft Edge / Google Chrome

1. Press `F12` or `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac)
2. Click the **Console** tab

Or use the menu:
- **Edge**: Menu (⋯) → More tools → Developer tools → Console tab
- **Chrome**: Menu (⋮) → More tools → Developer tools → Console tab

#### Mozilla Firefox

1. Press `F12` or `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac)
2. Click the **Console** tab

Or: Menu (☰) → More tools → Web Developer Tools → Console tab

#### Safari

Safari requires enabling Developer tools first:

1. Open Safari → Settings (or Preferences)
2. Go to the **Advanced** tab
3. Check **"Show features for web developers"** (or "Show Develop menu in menu bar")
4. Close Settings

Then open the console:
- Press `Cmd+Option+C`
- Or: **Develop** menu → Show JavaScript Console

### Step 3: Paste and Run the Script

1. Copy the entire contents of `loopd.js`
2. Paste it into the Console
3. Press `Enter` to run

You'll see progress messages in the console:
```
loopd2: Loading remark ecosystem from esm.sh...
loopd2: Remark ecosystem loaded successfully
loopd2: Content element found...
loopd2: Expanding collapsed sections...
loopd2: Images found: 27
loopd2: Converting to markdown with remark...
loopd2: Building tar archive...
loopd2: Export complete!
```

### Re-running the Export

After the script runs once, you can export again without re-pasting the script. Just type in the console:

```
loopd()
```

This is useful if you made changes to the page or navigated to a different Loop page in the same tab.

### Step 4: Handle the Download

When the export finishes, your browser will download a file like `Page Title - 2026-01-28 at 1.39 PM.tar` (using the Loop page title and current date/time).

**Important**: Your browser may ask what to do with the download:
- **Chrome/Edge**: The download usually starts automatically. Check the download bar at the bottom of the window, or click the download icon in the toolbar.
- **Firefox**: A dialog may appear asking to save or open the file. Choose **Save File**.
- **Safari**: The file appears in your Downloads. You may need to click "Allow" if prompted about downloads from this site.

If nothing seems to happen, check:
- The browser's download manager (Ctrl+J / Cmd+J)
- Any popup blockers that might have intercepted the download

### Step 5: Extract and Use

1. Find the `.tar` file in your Downloads folder
2. Extract it:
   - **macOS**: Double-click the file, or `tar -xf "*.tar"`
   - **Windows 11**: Double-click the file in File Explorer, or use PowerShell
   - **Windows 10**: Use PowerShell or install [7-Zip](https://7-zip.org/) / [WinRAR](https://www.rarlab.com/)
   - **Linux**: `tar -xf "*.tar"`
3. Open `content.md` in any Markdown editor or viewer

The extracted folder contains:
```
Page Title - 2026-01-28 at 1.39 PM/
├── content.md          # Your Loop page as Markdown
├── images/             # All images from the page
│   ├── image_0.png
│   ├── image_1.png
│   └── ...
└── debug-mdast.json    # (Debug info, can be deleted)
```

### Importing into Figma

For the best experience, use the **loopd Markdown Importer** Figma plugin (see [Figma Plugin](#figma-plugin) below). It imports markdown with proper formatting directly into your canvas.

**Manual import** (without the plugin):

1. **Images**: Drag and drop the entire `images/` folder onto your Figma canvas—all images import at once
2. **Text content**: Open `content.md` in a text editor, Select All (`Cmd+A` / `Ctrl+A`), Copy (`Cmd+C` / `Ctrl+C`), then paste into a Figma text box

## Tools

### Preview Server

The `loopd` utility watches a directory for exported tar files and serves a rich preview in your browser. It auto-opens the browser and finds a free port if the default is in use.

#### Building

```bash
go build -o loopd .
```

#### Usage

```bash
# Watch current directory, auto-open browser
./loopd

# Watch Downloads folder
./loopd --dir ~/Downloads

# Use specific port, don't open browser
./loopd --port 3000 --no-open

# Save settings for next time
./loopd --dir ~/Downloads --save-config
```

Run `./loopd --help` for all options.

#### Configuration

Settings are saved to `~/.config/loopd/settings.json` (XDG compliant). Use `-save-config` to persist your preferred settings.

```json
{
  "port": 8080,
  "watch_dir": "~/Downloads",
  "open_browser": true
}
```

### Figma Plugin

The **loopd Markdown Importer** plugin imports Loop exports directly into Figma with proper text formatting.

#### Installing the Plugin

Export the plugin files, then import into Figma:

```bash
# Export plugin to your home directory
./loopd --export-plugin ~/loopd-figma-plugin
```

Then in Figma desktop app:

1. Open the **Plugins** menu
2. Click **Development** → **Import plugin from manifest...**
3. Select `~/loopd-figma-plugin/manifest.json`

#### Running the Plugin

1. With loopd running (`./loopd`), load a Loop export
2. In Figma: **Plugins** → **Development** → **loopd Markdown Importer**
3. Click **Import from loopd** to fetch and render the content

The plugin connects to loopd's preview server to fetch the markdown and images, then creates formatted text and image nodes on your canvas.

### Figma Detection Tool

The Figma detection tool is integrated into `loopd` as a plugin. It checks whether the Figma desktop application is running and if the MCP (Model Context Protocol) server is listening on port 3845.

#### Web Interface

When loopd is running, access the detector at:

```
http://localhost:8080/plugins/loopd-figma-detect/index.html
```

Features:
- Real-time status dashboard
- Process ID tracking
- Port binding verification
- Actionable recommendations
- Auto-refresh every 5 seconds

#### API Endpoint

```bash
curl http://localhost:8080/api/figma-detect
```

**Response:**
```json
{
  "figma_running": true,
  "port_bound": true,
  "both_ready": true,
  "status": "Ready for Figma integration",
  "timestamp": "2026-01-28T21:25:00Z",
  "process_pid": 12345
}
```

#### Standalone CLI

The plugin can also be built and run as a standalone tool:

```bash
cd plugins/loopd-figma-detect
go build
./loopd-figma-detect --help
```

Options:
- `--human`: Human-readable output
- `--exit-code`: Use exit codes for scripting (0=ready, 1=not ready)
- `--version`: Show version

#### Detection Method

- **Process Detection**: Uses `pgrep`, `ps` (Unix-like systems), or `tasklist` (Windows)
- **Port Binding Check**: Uses `lsof` (macOS/Linux) or `netstat` (Windows) to verify port 3845
- **Platform Support**: macOS, Linux, Windows with graceful degradation

#### Integration Points

1. **Web UI**: Call the tool from `loopd` to add a `/api/figma-status` endpoint
2. **Shell Scripts**: Use exit codes for automation and CI/CD workflows
3. **Manual Verification**: Users can run directly to verify Figma readiness before exporting

## Troubleshooting

### "Blocked by Content Security Policy" or similar error
Some enterprise configurations may block script execution. Try a different browser or ask your IT department about developer tools access. NOTE: You may see this error and others generated by Loop itself every so often. Right click on the console and `clear console` before you paste things in.

### Images are missing
The script downloads images from URLs in the page. If images fail to download (timeouts, auth required), they'll be skipped with a warning in the console.

### Collapsed sections not expanding
The script attempts to expand all collapsed sections automatically. If some remain collapsed, try expanding them manually before running the script.

### Console shows errors
Check that you copied the entire script. The script requires a modern browser with ES module support (Edge, Chrome, Firefox, Safari all work).

## License

[MIT](LICENSE)
