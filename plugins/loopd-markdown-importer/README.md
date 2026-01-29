# loopd Markdown Importer for Figma

A Figma plugin that converts Loop markdown exports into high-fidelity Figma designs with text, images, and styles.

## Overview

This plugin transforms `content.md` files from loopd exports into structured Figma designs using:
- Auto-layout frames for responsive hierarchy
- Text styles based on markdown headings
- Embedded images from the export tar file
- Semantic color application
- Proper typography and spacing

## Architecture

The plugin is served by `loopd` and consists of:

- **manifest.json** - Plugin metadata and configuration
- **ui.html** - User interface (runs in iframe)
- **code.js** - Plugin logic (runs in Figma context)

## Installation & Setup

### In loopd

The plugin files are served at:
```
http://localhost:8080/plugins/loopd-markdown-importer/
```

### In Figma (Development)

Figma requires manifest files to be local. Two options:

**Option 1: Using the served manifest**
1. Start loopd: `./loopd`
2. Download the manifest to a local folder:
   ```bash
   mkdir -p ~/figma-plugins
   curl http://localhost:8080/plugins/loopd-markdown-importer/manifest.json > ~/figma-plugins/manifest.json
   ```
3. In Figma: **Plugins** → **Development** → **Create plugin from manifest**
4. Select the local manifest file: `~/figma-plugins/manifest.json`

**Option 2: Direct manifest file**
1. Copy the manifest file from the repository to your local machine:
   ```bash
   cp plugins/loopd-markdown-importer/manifest.json ~/figma-plugins/
   ```
2. In Figma: **Plugins** → **Development** → **Create plugin from manifest**
3. Select the local manifest file

The plugin will connect to the loopd server running on localhost:8080 to load the UI and code files.

## Usage

### Step 1: Export from Loop

1. Open your Loop page
2. Open browser console (F12)
3. Paste and run `loopd.js` script
4. A `.tar` file will be downloaded containing:
   - `content.md` - Your page content
   - `images/` - All images from the page

### Step 2: Import to Figma

1. Open Figma file where you want to import
2. Run the loopd Markdown Importer plugin
3. Click **📁 From File** tab
4. Select your `.tar` file
5. Configure options:
   - **Generate text styles** - Creates h1, h2, h3 styles
   - **Apply semantic colors** - Uses colors for different heading levels
   - **Embed images** - Includes images from tar
   - **Create auto-layout frame** - Responsive layout structure
6. Click **Import to Figma**

The plugin will create a new frame with your markdown content.

### Step 3: Customize

The created design uses:
- **Auto-layout frames** - Edit spacing and padding
- **Text styles** - Edit fonts, sizes, colors globally
- **Native Figma objects** - Fully editable like any design

## Features

- ✅ Heading hierarchy (h1-h4)
- ✅ Paragraphs and body text
- ✅ Lists (unordered with bullets)
- ✅ Code blocks (with monospace styling)
- ✅ Image embedding
- ✅ Auto-layout frames
- ✅ Text style generation
- ✅ Color application
- ✅ Responsive design structure

## Roadmap

### Current (MVP)
- [x] Basic markdown parsing
- [x] Text node creation with typography
- [x] Auto-layout frames
- [x] Code blocks with styling
- [x] UI with file input

### Phase 2 (Images)
- [ ] Extract images from tar files
- [ ] Create image containers with proper sizing
- [ ] Apply image fills to rectangles

### Phase 3 (Advanced)
- [ ] Ordered lists with numbers
- [ ] Mixed text styles (bold, italic, code spans)
- [ ] Tables from markdown
- [ ] Blockquotes with styling
- [ ] Link handling

### Phase 4 (Integration)
- [ ] Fetch recent exports from loopd server
- [ ] Batch import multiple exports
- [ ] Create components from design patterns
- [ ] Sync with design tokens

### Phase 5 (Publishing)
- [ ] Submit to Figma Community plugin store
- [ ] Add analytics
- [ ] Support for more export formats
- [ ] Team collaboration features

## Technical Details

### Tar File Parsing

The plugin includes a basic tar file parser that extracts:
- `content.md` - Markdown file
- `images/*` - All image files

For production, consider using a proper tar library like `tar.js` or `js-untar`.

### Font Loading

The plugin loads fonts asynchronously before modifying text:
```javascript
await figma.loadFontAsync(fontName);
```

This is required to change text content in Figma.

### Auto-Layout

All frames use vertical auto-layout with:
- Padding: 24px (top/bottom/left/right)
- Item spacing: 16px
- Responsive sizing

### Color Values

Semantic colors used:
- Text: `#333333` (dark gray)
- Text Light: `#808080` (medium gray)
- Code Background: `#f2f2f2` (light gray)
- Code Foreground: `#333333` (dark gray)

## Development

### Build

The plugin is served directly from source files. No build step required.

### Local Testing

1. Start loopd: `./loopd`
2. Create test markdown file
3. Use Figma's "Create plugin from manifest" with local URL
4. Test imports

### Debugging

Enable browser DevTools console in Figma plugin UI:
- The UI runs in an iframe at `http://localhost:8080/plugins/loopd-markdown-importer/ui.html`
- The code runs in Figma's sandbox context
- Use `figma.ui.postMessage()` to communicate between them

## Limitations

Current limitations:
- Simple markdown parser (doesn't handle all GFM features)
- Basic tar parser (assumes standard tar format)
- Limited font library (defaults to Roboto)
- No component generation
- Single file import (no batch)

## Contributing

To improve the plugin:

1. **Enhance markdown parsing** - Support more GFM features
2. **Improve tar parsing** - Use proper tar library
3. **Add image support** - Extract and embed images
4. **Generate components** - Create reusable design patterns
5. **Add tests** - Validate imports

## License

Same as loopd project (MIT)

## See Also

- [loopd](../../README.md) - Markdown export tool
- [Figma Plugin API Docs](https://developers.figma.com/docs/plugins/)
- [Model Context Protocol](https://spec.modelcontextprotocol.io/)
