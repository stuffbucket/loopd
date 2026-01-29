// loopd Markdown Importer for Figma
// =================================
//
// ARCHITECTURE:
//
//   MAIN COMPONENTS (stored on "Components" page):
//     - Semantic templates: "Heading 1", "Paragraph", "Code Block", etc.
//     - Define styling (font, size, color, layout)
//     - Created once per document, reused forever
//     - ONE main component per semantic type
//
//   INSTANCES (created during import):
//     - Created from main components via component.createInstance()
//     - Each markdown node becomes an instance of its semantic type's main component
//     - Instance receives the actual content
//     - Linked to main component - updates to main propagate to instances
//
// Example flow for "## My Heading":
//   1. Parse markdown -> { type: "h2", content: "My Heading" }
//   2. Find/create main component "Heading 2" on Components page
//   3. Create instance: mainComponent.createInstance()
//   4. Set instance text content to "My Heading"
//   5. Add instance to document

// ============================================================================
// DESIGN TOKENS (W3C Design Tokens Format)
// https://design-tokens.github.io/community-group/format/
// ============================================================================

var TOKENS = {
  // === SCALE CONFIGURATION ===
  // Musical interval ratios for typographic scales
  // Mixed scale: large-master for display, small-master for text
  
  scaleRatios: {
    minorSecond:     { $value: 1.067, $type: "number", $description: "Minor Second - very subtle" },
    majorSecond:     { $value: 1.125, $type: "number", $description: "Major Second - subtle" },
    minorThird:      { $value: 1.200, $type: "number", $description: "Minor Third - balanced" },
    majorThird:      { $value: 1.250, $type: "number", $description: "Major Third - distinct" },
    perfectFourth:   { $value: 1.333, $type: "number", $description: "Perfect Fourth - prominent" },
    augmentedFourth: { $value: 1.414, $type: "number", $description: "Augmented Fourth - dramatic" },
    perfectFifth:    { $value: 1.500, $type: "number", $description: "Perfect Fifth - bold" },
    goldenRatio:     { $value: 1.618, $type: "number", $description: "Golden Ratio - classical" }
  },
  
  scale: {
    base: { $value: 16, $type: "dimension", $description: "Base font size in px" },
    // Large-master: display typography (h1, h2) - more dramatic scale
    largeMaster: { $value: 1.333, $type: "number", $description: "Perfect Fourth for display" },
    // Small-master: text typography (h3-h6, body) - tighter scale
    smallMaster: { $value: 1.200, $type: "number", $description: "Minor Third for text" }
  },
  
  // === CORE PRIMITIVES ===
  
  // Spacing scale (4px grid base)
  spacing: {
    unit: { $value: 4, $type: "dimension", $description: "Base spacing unit (4px grid)" },
    xs:   { $value: 4, $type: "dimension" },   // 1 unit
    sm:   { $value: 8, $type: "dimension" },   // 2 units
    md:   { $value: 16, $type: "dimension" },  // 4 units
    lg:   { $value: 24, $type: "dimension" },  // 6 units
    xl:   { $value: 32, $type: "dimension" },  // 8 units
    xxl:  { $value: 48, $type: "dimension" },  // 12 units
    xxxl: { $value: 64, $type: "dimension" }   // 16 units
  },
  
  // Layout dimensions
  layout: {
    pageWidth:    { $value: 1920, $type: "dimension", $description: "Fixed page width" },
    contentWidth: { $value: 1440, $type: "dimension", $description: "Max content width" },
    gutterX:      { $value: 240, $type: "dimension", $description: "Horizontal page gutter ((1920-1440)/2)" },
    gutterY:      { $value: 0, $type: "dimension", $description: "Vertical page gutter" },
    columnGap:    { $value: 0, $type: "dimension", $description: "Gap between layout items" }
  },
  
  // Measure (reading width) in pixels - approximating ch units
  // All values snapped to 4px grid for layout consistency
  // 1ch ≈ 8.5px at 16px body text
  measure: {
    narrow:  { $value: 552, $type: "dimension", $description: "~65ch - narrow reading" },
    compact: { $value: 596, $type: "dimension", $description: "~70ch - compact reading" },
    default: { $value: 680, $type: "dimension", $description: "~80ch - optimal reading" },
    wide:    { $value: 764, $type: "dimension", $description: "~90ch - wide reading" },
    full:    { $value: 1440, $type: "dimension", $description: "Full content width" }
  },
  
  // Colors
  color: {
    text: {
      primary:   { $value: { r: 0.133, g: 0.133, b: 0.133 }, $type: "color", $description: "#222222" },
      secondary: { $value: { r: 0.32, g: 0.32, b: 0.32 }, $type: "color" },
      muted:     { $value: { r: 0.5, g: 0.5, b: 0.5 }, $type: "color" },
      link:      { $value: { r: 0.0, g: 0.4, b: 0.8 }, $type: "color" }
    },
    surface: {
      page:      { $value: { r: 1, g: 1, b: 1 }, $type: "color" },
      code:      { $value: { r: 0.95, g: 0.95, b: 0.95 }, $type: "color" },
      note:      { $value: { r: 1.0, g: 0.98, b: 0.9 }, $type: "color" },
      placeholder: { $value: { r: 0.85, g: 0.85, b: 0.85 }, $type: "color" }
    },
    border: {
      note:      { $value: { r: 0.9, g: 0.85, b: 0.6 }, $type: "color" }
    }
  },
  
  // === TYPOGRAPHY PRIMITIVES ===
  // Raw values - use textStyle presets for semantic usage
  
  typography: {
    fontFamily: {
      sans:  { $value: "Inter", $type: "fontFamily" },
      serif: { $value: "Source Serif 4", $type: "fontFamily" },
      mono:  { $value: "JetBrains Mono", $type: "fontFamily" }
    },
    // fontSize: computed dynamically via scaleSize() function
    // Small-master scale steps: -2, -1, 0, +1, +2, +3
    // Large-master scale steps: +1, +2, +3, +4 (from small-master h3 as anchor)
    
    // Line height as ratios (multiply by fontSize for px)
    lineHeight: {
      none:    { $value: 1.0, $type: "number", $description: "Single line, no leading" },
      tight:   { $value: 1.15, $type: "number", $description: "Headings - compact" },
      snug:    { $value: 1.25, $type: "number", $description: "Subheadings" },
      normal:  { $value: 1.5, $type: "number", $description: "Body text - optimal" },
      relaxed: { $value: 1.6, $type: "number", $description: "Body text - spacious" },
      loose:   { $value: 1.75, $type: "number", $description: "Small text readability" }
    },
    // Letter spacing in percent (Figma: { value: X, unit: "PERCENT" })
    // Negative for display, neutral for body, positive for small caps/labels
    letterSpacing: {
      tight:   { $value: -2.2, $type: "number", $description: "-2.2% for large display" },
      snug:    { $value: -1.5, $type: "number", $description: "-1.5% for headings" },
      normal:  { $value: 0, $type: "number", $description: "0% for body" },
      wide:    { $value: 2.5, $type: "number", $description: "2.5% for labels/small" }
    },
    fontWeight: {
      regular:  { $value: 400, $type: "number" },
      medium:   { $value: 500, $type: "number" },
      semibold: { $value: 600, $type: "number" },
      bold:     { $value: 700, $type: "number" }
    },
    // Paragraph spacing (space after paragraph, Figma: paragraphSpacing)
    paragraphSpacing: {
      none:   { $value: 0, $type: "dimension" },
      tight:  { $value: 8, $type: "dimension", $description: "2 units" },
      normal: { $value: 16, $type: "dimension", $description: "4 units - 1em at base" }
    },
    // Text decoration (Figma: textDecoration)
    textDecoration: {
      none:          { $value: "NONE", $type: "string" },
      underline:     { $value: "UNDERLINE", $type: "string" },
      strikethrough: { $value: "STRIKETHROUGH", $type: "string" }
    },
    // Text case (Figma: textCase)
    textCase: {
      none:      { $value: "ORIGINAL", $type: "string" },
      uppercase: { $value: "UPPER", $type: "string" },
      lowercase: { $value: "LOWER", $type: "string" },
      title:     { $value: "TITLE", $type: "string" }
    }
  },
  
  // === SEMANTIC TEXT STYLES ===
  // Presets combining primitives for common use cases
  
  textStyle: {
    // Body text defaults
    body: {
      fontFamily: { $value: "serif", $type: "alias", $description: "Use serif for reading" },
      fontWeight: { $value: 400, $type: "number" },
      lineHeight: { $value: 1.6, $type: "number", $description: "Relaxed for readability" },
      letterSpacing: { $value: 0, $type: "number", $description: "Neutral tracking" }
    },
    // Heading defaults
    heading: {
      fontFamily: { $value: "sans", $type: "alias", $description: "Sans for contrast" },
      fontWeight: { $value: 700, $type: "number" },
      lineHeight: { $value: 1.15, $type: "number", $description: "Tight for impact" },
      letterSpacing: { $value: -2.2, $type: "number", $description: "Negative tracking" }
    },
    // Code/mono defaults
    mono: {
      fontFamily: { $value: "mono", $type: "alias" },
      fontWeight: { $value: 400, $type: "number" },
      lineHeight: { $value: 1.5, $type: "number" },
      letterSpacing: { $value: 0, $type: "number" }
    },
    // UI/label defaults
    ui: {
      fontFamily: { $value: "sans", $type: "alias" },
      fontWeight: { $value: 500, $type: "number" },
      lineHeight: { $value: 1.25, $type: "number" },
      letterSpacing: { $value: 0, $type: "number" }
    }
  },
  
  // === SEMANTIC SPACING ===
  
  // Block spacing (vertical rhythm) - Vignelli typesetting principles
  // Spacing is based on body line height (~24px at 16px/1.6)
  // This creates harmonious vertical rhythm tied to the type ramp
  // 4px grid: 1 line = 24px (6 units), 1.5 lines = 36px, 2 lines = 48px, etc.
  blockSpacing: {
    h1: { $value: 0, $type: "dimension", $description: "H1 starts content, no top space" },
    h2: { $value: 72, $type: "dimension", $description: "3× line height - major section break" },
    h3: { $value: 56, $type: "dimension", $description: "~2.3× line height - section break" },
    h4: { $value: 48, $type: "dimension", $description: "2× line height - subsection break" },
    h5: { $value: 36, $type: "dimension", $description: "1.5× line height - minor break" },
    h6: { $value: 36, $type: "dimension", $description: "1.5× line height - minor break" },
    p:  { $value: 24, $type: "dimension", $description: "1× line height - paragraph spacing" },
    li: { $value: 8, $type: "dimension", $description: "Tight list item spacing for flow" },
    ol: { $value: 8, $type: "dimension", $description: "Tight ordered list item spacing" },
    blockquote: { $value: 36, $type: "dimension", $description: "1.5× line height" },
    table: { $value: 36, $type: "dimension", $description: "1.5× line height" },
    code: { $value: 36, $type: "dimension", $description: "1.5× line height" },
    image: { $value: 48, $type: "dimension", $description: "2× line height - visual break for images" }
  },
  
  // Table styling
  table: {
    cellPadding: { $value: 12, $type: "dimension", $description: "3 units - compact cell padding" },
    borderWidth: { $value: 1, $type: "dimension" },
    borderColor: { $value: { r: 0.85, g: 0.85, b: 0.87 }, $type: "color" },
    headerBg: { $value: { r: 0.96, g: 0.96, b: 0.97 }, $type: "color" },
    minCellWidth: { $value: 120, $type: "dimension", $description: "30 units - min column width" },
    minCellHeight: { $value: 44, $type: "dimension", $description: "11 units - derived from 2*padding + lineHeight" }
  },
  
  // Blockquote styling
  // Padding values are INTERNAL (border is rendered separately)
  blockquote: {
    borderWidth: { $value: 4, $type: "dimension", $description: "1 unit - accent border" },
    borderColor: { $value: { r: 0.8, g: 0.8, b: 0.82 }, $type: "color" },
    bg: { $value: { r: 0.98, g: 0.98, b: 0.99 }, $type: "color" },
    paddingLeft: { $value: 16, $type: "dimension", $description: "4 units - internal left padding" },
    paddingRight: { $value: 16, $type: "dimension", $description: "4 units - internal right padding" },
    paddingY: { $value: 16, $type: "dimension", $description: "4 units - vertical padding" }
  },
  
  // Corner radii (can be sub-grid for optical precision)
  radius: {
    none: { $value: 0, $type: "dimension" },
    sm: { $value: 4, $type: "dimension", $description: "1 unit - subtle rounding" },
    md: { $value: 8, $type: "dimension", $description: "2 units - default rounding" },
    lg: { $value: 12, $type: "dimension", $description: "3 units - prominent rounding" }
  },
  
  // Breakpoints for responsive images
  breakpoint: {
    mobile:  { $value: 360, $type: "dimension" },
    tablet:  { $value: 768, $type: "dimension" },
    desktop: { $value: 1200, $type: "dimension" },
    full:    { $value: 1440, $type: "dimension" }
  },
  
  // Fluent2 UI Elevation System
  // Shadow definitions for depth and layering
  // Each level has primary (darker, closer) and ambient (lighter, spread) shadows
  // blendMode required by Figma API for DROP_SHADOW effects
  elevation: {
    shadow02: {
      $value: [
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.06 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0, blendMode: "NORMAL", visible: true },
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.02 }, offset: { x: 0, y: 0 }, radius: 2, spread: 0, blendMode: "NORMAL", visible: true }
      ],
      $type: "shadow",
      $description: "Layer 0 - Subtle elevation for cards at rest"
    },
    shadow04: {
      $value: [
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, blendMode: "NORMAL", visible: true },
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.02 }, offset: { x: 0, y: 0 }, radius: 2, spread: 0, blendMode: "NORMAL", visible: true }
      ],
      $type: "shadow",
      $description: "Layer 1 - Hover state elevation"
    },
    shadow08: {
      $value: [
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0, blendMode: "NORMAL", visible: true },
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.02 }, offset: { x: 0, y: 0 }, radius: 2, spread: 0, blendMode: "NORMAL", visible: true }
      ],
      $type: "shadow",
      $description: "Layer 2 - Active/pressed state or floating elements"
    },
    shadow16: {
      $value: [
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.10 }, offset: { x: 0, y: 8 }, radius: 16, spread: 0, blendMode: "NORMAL", visible: true },
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.04 }, offset: { x: 0, y: 0 }, radius: 4, spread: 0, blendMode: "NORMAL", visible: true }
      ],
      $type: "shadow",
      $description: "Layer 3 - Popovers and dropdowns"
    },
    shadow28: {
      $value: [
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 14 }, radius: 28, spread: 0, blendMode: "NORMAL", visible: true },
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.04 }, offset: { x: 0, y: 0 }, radius: 8, spread: 0, blendMode: "NORMAL", visible: true }
      ],
      $type: "shadow",
      $description: "Layer 4 - Dialogs and modal panels"
    },
    shadow64: {
      $value: [
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.14 }, offset: { x: 0, y: 32 }, radius: 64, spread: 0, blendMode: "NORMAL", visible: true },
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.06 }, offset: { x: 0, y: 0 }, radius: 16, spread: 0, blendMode: "NORMAL", visible: true }
      ],
      $type: "shadow",
      $description: "Layer 5 - Full-screen overlays"
    }
  }
};

// ============================================================================
// CONFIGURATION (derived from tokens)
// ============================================================================

// Font families - matching vignelli.html
const FONT_SANS = { family: TOKENS.typography.fontFamily.sans.$value, style: "Regular" };
const FONT_SANS_MEDIUM = { family: TOKENS.typography.fontFamily.sans.$value, style: "Medium" };
const FONT_SANS_SEMIBOLD = { family: TOKENS.typography.fontFamily.sans.$value, style: "SemiBold" };
const FONT_SANS_BOLD = { family: TOKENS.typography.fontFamily.sans.$value, style: "Bold" };
const FONT_SERIF = { family: TOKENS.typography.fontFamily.serif.$value, style: "Regular" };
const FONT_MONO = { family: TOKENS.typography.fontFamily.mono.$value, style: "Regular" };

// Fallback fonts if primary not available
const DEFAULT_FONT = { family: "Roboto", style: "Regular" };
const CODE_FONT = { family: "Courier New", style: "Regular" };

// Additional font styles for mixed text formatting
const FONT_SERIF_BOLD = { family: TOKENS.typography.fontFamily.serif.$value, style: "Bold" };
const FONT_SERIF_ITALIC = { family: TOKENS.typography.fontFamily.serif.$value, style: "Italic" };
const FONT_SERIF_BOLD_ITALIC = { family: TOKENS.typography.fontFamily.serif.$value, style: "Bold Italic" };
const FONT_SANS_ITALIC = { family: TOKENS.typography.fontFamily.sans.$value, style: "Italic" };
const FONT_SANS_BOLD_ITALIC = { family: TOKENS.typography.fontFamily.sans.$value, style: "Bold Italic" };

// Layout constants from tokens
const PAGE_WIDTH = TOKENS.layout.pageWidth.$value;
const CONTENT_WIDTH = TOKENS.layout.contentWidth.$value;
const GUTTER_X = TOKENS.layout.gutterX.$value;

// ============================================================================
// DUAL-SCALE TYPE SYSTEM
// ============================================================================

/**
 * Compute font size from scale.
 * @param {number} step - Scale step (0 = base, positive = larger, negative = smaller)
 * @param {string} master - "large" for display scale, "small" for text scale
 * @returns {number} Font size in px, rounded to nearest integer
 */
function scaleSize(step, master) {
  var base = TOKENS.scale.base.$value;
  var ratio = master === "large" 
    ? TOKENS.scale.largeMaster.$value 
    : TOKENS.scale.smallMaster.$value;
  return Math.round(base * Math.pow(ratio, step));
}

/**
 * Compute line height snapped to 4px grid.
 * @param {number} fontSize - Font size in px
 * @param {number} ratio - Line height ratio (e.g. 1.15 for tight)
 * @returns {number} Line height in px, snapped to 4px grid
 */
function gridLineHeight(fontSize, ratio) {
  var raw = fontSize * ratio;
  return Math.round(raw / 4) * 4;  // Snap to 4px grid
}

// Pre-computed scale sizes for reference:
// Small-master (1.2 Minor Third): 11, 13, 16, 19, 23, 28, 33, 40
// Large-master (1.333 Perfect Fourth): 16, 21, 28, 38, 51, 68

// Type ramp - mixed scale system
// Large-master: h1, h2 (dramatic hierarchy for display)
// Small-master: h3-h6, body (tighter hierarchy for reading)
// Line heights snap to 4px grid; tracking in percent for Figma
const TYPE_RAMP = {
  // === DISPLAY (Large Master - Perfect Fourth 1.333) ===
  // Uses dramatic scale for visual impact
  h1: {
    fontSize: scaleSize(4, "large"),           // ~51px
    lineHeightPx: gridLineHeight(scaleSize(4, "large"), 1.15),
    tracking: TOKENS.typography.letterSpacing.tight.$value,  // -2.2%
    fontStyle: "Bold",
    master: "large",
    blockSpacing: TOKENS.blockSpacing.h1.$value
  },
  h2: {
    fontSize: scaleSize(3, "large"),           // ~38px
    lineHeightPx: gridLineHeight(scaleSize(3, "large"), 1.15),
    tracking: TOKENS.typography.letterSpacing.tight.$value,  // -2.2%
    fontStyle: "SemiBold",
    master: "large",
    blockSpacing: TOKENS.blockSpacing.h2.$value
  },
  
  // === HEADINGS (Small Master - Minor Third 1.2) ===
  // Tighter scale for content hierarchy
  h3: {
    fontSize: scaleSize(3, "small"),           // ~28px
    lineHeightPx: gridLineHeight(scaleSize(3, "small"), 1.2),
    tracking: TOKENS.typography.letterSpacing.snug.$value,   // -1.5%
    fontStyle: "SemiBold",
    master: "small",
    blockSpacing: TOKENS.blockSpacing.h3.$value
  },
  h4: {
    fontSize: scaleSize(2, "small"),           // ~23px
    lineHeightPx: gridLineHeight(scaleSize(2, "small"), 1.25),
    tracking: TOKENS.typography.letterSpacing.snug.$value,   // -1.5%
    fontStyle: "SemiBold",
    master: "small",
    blockSpacing: TOKENS.blockSpacing.h4.$value
  },
  h5: {
    fontSize: scaleSize(1, "small"),           // ~19px
    lineHeightPx: gridLineHeight(scaleSize(1, "small"), 1.25),
    tracking: TOKENS.typography.letterSpacing.normal.$value, // 0%
    fontStyle: "Medium",
    master: "small",
    blockSpacing: TOKENS.blockSpacing.h5.$value
  },
  h6: {
    fontSize: TOKENS.scale.base.$value,        // 16px (base)
    lineHeightPx: gridLineHeight(TOKENS.scale.base.$value, 1.4),
    tracking: TOKENS.typography.letterSpacing.normal.$value, // 0%
    fontStyle: "Medium",
    master: "small",
    blockSpacing: TOKENS.blockSpacing.h6.$value
  },
  
  // === BODY TEXT (Small Master) ===
  p: {
    fontSize: TOKENS.scale.base.$value,        // 16px
    lineHeightPx: gridLineHeight(TOKENS.scale.base.$value, 1.6),
    tracking: TOKENS.typography.letterSpacing.normal.$value, // 0%
    fontStyle: "Regular",
    master: "small",
    useSerif: true,
    blockSpacing: TOKENS.blockSpacing.p.$value
  },
  li: {
    fontSize: TOKENS.scale.base.$value,        // 16px
    lineHeightPx: gridLineHeight(TOKENS.scale.base.$value, 1.6),
    tracking: TOKENS.typography.letterSpacing.normal.$value,
    fontStyle: "Regular",
    master: "small",
    useSerif: true,
    blockSpacing: TOKENS.blockSpacing.li.$value
  },
  
  // === CODE (Small Master) ===
  code: {
    fontSize: scaleSize(-1, "small"),          // ~13px
    lineHeightPx: gridLineHeight(scaleSize(-1, "small"), 1.5),
    tracking: TOKENS.typography.letterSpacing.normal.$value,
    fontStyle: "Regular",
    master: "small",
    useMono: true,
    blockSpacing: TOKENS.blockSpacing.code.$value
  },
  
  // === SPECIAL ===
  caption: {
    fontSize: scaleSize(-1, "small"),          // ~13px
    lineHeightPx: gridLineHeight(scaleSize(-1, "small"), 1.5),
    tracking: 1,                               // +1% for small text legibility
    fontStyle: "Regular",
    master: "small",
    blockSpacing: TOKENS.blockSpacing.p.$value
  },
  
  // === ORDERED LISTS ===
  ol: {
    fontSize: TOKENS.scale.base.$value,        // 16px
    lineHeightPx: gridLineHeight(TOKENS.scale.base.$value, 1.6),
    tracking: TOKENS.typography.letterSpacing.normal.$value,
    fontStyle: "Regular",
    master: "small",
    useSerif: true,
    blockSpacing: TOKENS.blockSpacing.ol.$value
  },
  
  // === BLOCKQUOTES ===
  blockquote: {
    fontSize: TOKENS.scale.base.$value,        // 16px
    lineHeightPx: gridLineHeight(TOKENS.scale.base.$value, 1.6),
    tracking: TOKENS.typography.letterSpacing.normal.$value,
    fontStyle: "Italic",
    master: "small",
    useSerif: true,
    blockSpacing: TOKENS.blockSpacing.blockquote.$value
  },
  
  // === TABLES ===
  tableHeader: {
    fontSize: scaleSize(-1, "small"),          // ~13px
    lineHeightPx: gridLineHeight(scaleSize(-1, "small"), 1.5),
    tracking: TOKENS.typography.letterSpacing.normal.$value,
    fontStyle: "SemiBold",
    master: "small",
    blockSpacing: 0
  },
  tableCell: {
    fontSize: scaleSize(-1, "small"),          // ~13px
    lineHeightPx: gridLineHeight(scaleSize(-1, "small"), 1.5),
    tracking: TOKENS.typography.letterSpacing.normal.$value,
    fontStyle: "Regular",
    master: "small",
    blockSpacing: 0
  },
  table: {
    fontSize: scaleSize(-1, "small"),          // ~13px
    lineHeightPx: gridLineHeight(scaleSize(-1, "small"), 1.5),
    tracking: TOKENS.typography.letterSpacing.normal.$value,
    fontStyle: "Regular",
    master: "small",
    blockSpacing: TOKENS.blockSpacing.table.$value
  }
};

// Semantic component definitions using type ramp
// Maps markdown AST type -> main component configuration
// Note: Figma plugin runtime doesn't support spread operator, so we use Object.assign
// Sample text is long enough to demonstrate line wrapping at the reading measure
var SEMANTIC_COMPONENTS = {};
SEMANTIC_COMPONENTS.h1 = Object.assign({ name: "Heading 1", sampleText: "Primary Document Title That May Span Multiple Lines" }, TYPE_RAMP.h1);
SEMANTIC_COMPONENTS.h2 = Object.assign({ name: "Heading 2", sampleText: "Major Section Heading for Content Organization" }, TYPE_RAMP.h2);
SEMANTIC_COMPONENTS.h3 = Object.assign({ name: "Heading 3", sampleText: "Subsection Heading with Supporting Context" }, TYPE_RAMP.h3);
SEMANTIC_COMPONENTS.h4 = Object.assign({ name: "Heading 4", sampleText: "Topic Heading for Detailed Sections" }, TYPE_RAMP.h4);
SEMANTIC_COMPONENTS.h5 = Object.assign({ name: "Heading 5", sampleText: "Minor heading for grouped content" }, TYPE_RAMP.h5);
SEMANTIC_COMPONENTS.h6 = Object.assign({ name: "Heading 6", sampleText: "Inline heading for supplementary notes" }, TYPE_RAMP.h6);
SEMANTIC_COMPONENTS.p = Object.assign({ name: "Paragraph", sampleText: "Body text paragraph with enough content to demonstrate proper line wrapping behavior at the optimal reading measure. The ideal line length for comfortable reading is between 65-75 characters, which helps readers track from line to line without losing their place." }, TYPE_RAMP.p);
SEMANTIC_COMPONENTS.li = Object.assign({ name: "List Item", sampleText: "List item with sufficient text to show how longer items wrap within the measure", listType: "UNORDERED" }, TYPE_RAMP.li);
SEMANTIC_COMPONENTS.ol = Object.assign({ name: "Ordered List Item", sampleText: "Numbered item demonstrating wrapping behavior for ordered lists", listType: "ORDERED" }, TYPE_RAMP.ol);
// Note: Blockquote and Table have specialized component creation functions
// because they need auto-layout structures, not simple text containers
SEMANTIC_COMPONENTS.code = Object.assign({ name: "Code Block", sampleText: "function example(param) {\n  const result = param.map(item => item.value);\n  return result.filter(Boolean);\n}", isCode: true }, TYPE_RAMP.code);
SEMANTIC_COMPONENTS.image = Object.assign({ name: "Image", sampleText: "[Image placeholder]", isPlaceholder: true }, TYPE_RAMP.caption);
SEMANTIC_COMPONENTS.link = Object.assign({ name: "Link", sampleText: "Link text with context", isLink: true }, TYPE_RAMP.p);
SEMANTIC_COMPONENTS.note = Object.assign({ name: "Note", sampleText: "Note: Important information that readers should pay attention to when following these instructions.", isNote: true }, TYPE_RAMP.p);

// Colors derived from tokens
const COLORS = {
  text: TOKENS.color.text.primary.$value,
  textMuted: TOKENS.color.text.muted.$value,
  codeBg: TOKENS.color.surface.code.$value,
  noteBg: TOKENS.color.surface.note.$value,
  noteBorder: TOKENS.color.border.note.$value,
  link: TOKENS.color.text.link.$value,
  placeholder: TOKENS.color.surface.placeholder.$value,
  page: TOKENS.color.surface.page.$value,
  // Table colors
  tableBorder: TOKENS.table.borderColor.$value,
  tableHeaderBg: TOKENS.table.headerBg.$value,
  // Blockquote
  blockquoteBorder: TOKENS.blockquote.borderColor.$value,
  blockquoteBg: TOKENS.blockquote.bg.$value
};

// ============================================================================
// PLUGIN ENTRY POINT
// ============================================================================

figma.showUI(__html__, { width: 360, height: 540 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "import-tar") {
    await handleImport(msg.data);
  }
};

async function handleImport(arrayBuffer) {
  figma.ui.postMessage({ type: "loading", show: true });

  try {
    // Debug: Log received ArrayBuffer size and SHA-1 hash
    console.log("=== RECEIVED ARRAYBUFFER ===");
    console.log("ArrayBuffer byteLength:", arrayBuffer.byteLength);
    const hash = await sha1(arrayBuffer);
    console.log("SHA-1 hash:", hash);
    
    // Step 1: Extract tar contents
    const { markdown, images } = extractTar(arrayBuffer);
    if (!markdown) throw new Error("No content.md in tar file");

    // Debug: Show tar extraction results
    console.log("Extracted markdown length:", markdown.length);
    console.log("Extracted image count:", Object.keys(images).length);
    
    // Debug: Show raw markdown content (first 800 chars)
    console.log("=== RAW MARKDOWN (first 800 chars) ===");
    console.log(markdown.slice(0, 800));
    console.log("=== END RAW MARKDOWN ===");
    
    // Step 2: Parse markdown to AST
    const ast = parseMarkdown(markdown);
    console.log("Parsed " + ast.length + " nodes");
    
    // Debug: Count list items
    var liCount = 0, olCount = 0;
    for (var _i = 0; _i < ast.length; _i++) {
      if (ast[_i].type === "li") liCount++;
      if (ast[_i].type === "ol") olCount++;
    }
    console.log("List items: " + liCount + " unordered, " + olCount + " ordered");

    // Step 3: Load required fonts (primary + fallbacks + italic/bold variants)
    const fontsToLoad = [
      FONT_SANS, FONT_SANS_MEDIUM, FONT_SANS_SEMIBOLD, FONT_SANS_BOLD,
      FONT_SANS_ITALIC, FONT_SANS_BOLD_ITALIC,
      FONT_SERIF, FONT_SERIF_BOLD, FONT_SERIF_ITALIC, FONT_SERIF_BOLD_ITALIC,
      FONT_MONO,
      DEFAULT_FONT, CODE_FONT
    ];
    const loadedFonts = [];
    const failedFonts = [];
    for (const font of fontsToLoad) {
      try {
        await figma.loadFontAsync(font);
        loadedFonts.push(font.family + " " + font.style);
      } catch (e) {
        failedFonts.push(font.family + " " + font.style);
        console.warn("Font load failed: " + font.family + " " + font.style + " - " + e.message);
      }
    }
    if (failedFonts.length > 0) {
      console.warn("Failed to load " + failedFonts.length + " fonts: " + failedFonts.join(", "));
    }

    // Step 4: Get/create main components (one per semantic type)
    const mainComponents = await getOrCreateMainComponents();

    // Step 5: Get/create image main components
    const imageMainComponents = await getOrCreateImageComponents(images);

    // Step 6: Build document using instances of main components
    await buildDocument(ast, mainComponents, imageMainComponents);

    figma.ui.postMessage({ type: "success", message: "Import complete!" });
  } catch (error) {
    console.error("Import error:", error);
    figma.ui.postMessage({ type: "error", message: error.message });
  } finally {
    figma.ui.postMessage({ type: "loading", show: false });
  }
}

// ============================================================================
// MAIN COMPONENT MANAGEMENT
// ============================================================================

const OUTER_CONTAINER_NAME = "All Components";
const COMPONENTS_FRAME_NAME = "Semantic Components";

/**
 * Get or create main components for all semantic types.
 * Components are stored in a frame with auto-layout on the "Components" page.
 * This is STATIC - same components every time, just find or create once.
 * Returns: { h1: ComponentNode, h2: ComponentNode, p: ComponentNode, ... }
 */
async function getOrCreateMainComponents() {
  const page = await getOrCreatePage("Components");
  
  // Find or create outer container (two-row layout for components + proof)
  let outerContainer = findFrameByName(page, OUTER_CONTAINER_NAME);
  
  if (!outerContainer) {
    console.log("Creating outer components container");
    outerContainer = figma.createFrame();
    outerContainer.name = OUTER_CONTAINER_NAME;
    
    // Auto-layout: vertical (two rows), 64px gap between rows
    outerContainer.layoutMode = "VERTICAL";
    outerContainer.primaryAxisSizingMode = "AUTO";   // Height hugs content
    outerContainer.counterAxisSizingMode = "AUTO";   // Width hugs content
    outerContainer.itemSpacing = 64;                 // Gap between Semantic Components and Typography Proof
    outerContainer.paddingLeft = 0;
    outerContainer.paddingRight = 0;
    outerContainer.paddingTop = 0;
    outerContainer.paddingBottom = 0;
    outerContainer.fills = [];
    
    page.appendChild(outerContainer);
    outerContainer.x = 100;
    outerContainer.y = 100;
  } else {
    console.log("Found existing outer components container");
  }
  
  // Find or create the base frame (row 1: hosts all component category frames)
  let baseFrame = findFrameByName(outerContainer, COMPONENTS_FRAME_NAME);
  
  if (!baseFrame) {
    console.log("Creating components base frame");
    baseFrame = figma.createFrame();
    baseFrame.name = COMPONENTS_FRAME_NAME;
    
    // Auto-layout: horizontal, 64px gap, hug content
    baseFrame.layoutMode = "HORIZONTAL";
    baseFrame.primaryAxisSizingMode = "AUTO";   // Width hugs content
    baseFrame.counterAxisSizingMode = "AUTO";   // Height hugs content
    baseFrame.itemSpacing = 64;                 // 64px gap between category frames
    baseFrame.paddingLeft = 0;
    baseFrame.paddingRight = 0;
    baseFrame.paddingTop = 0;
    baseFrame.paddingBottom = 0;
    baseFrame.fills = [];
    
    outerContainer.appendChild(baseFrame);
    baseFrame.layoutSizingHorizontal = "HUG";
    baseFrame.layoutSizingVertical = "HUG";
  } else {
    console.log("Found existing components base frame");
  }

  // Helper: create or find a category frame within the base
  function getOrCreateCategoryFrame(name, description) {
    var frame = findFrameByName(baseFrame, name);
    if (!frame) {
      frame = figma.createFrame();
      frame.name = name;
      frame.layoutMode = "VERTICAL";
      frame.primaryAxisSizingMode = "AUTO";   // Height hugs content
      frame.counterAxisSizingMode = "AUTO";   // Width hugs content
      frame.itemSpacing = TOKENS.spacing.md.$value;  // 16px between components
      frame.paddingLeft = TOKENS.spacing.lg.$value;
      frame.paddingRight = TOKENS.spacing.lg.$value;
      frame.paddingTop = TOKENS.spacing.lg.$value;
      frame.paddingBottom = TOKENS.spacing.lg.$value;
      frame.fills = [{ type: "SOLID", color: COLORS.blockquoteBg }];
      frame.cornerRadius = TOKENS.radius.lg.$value;
      baseFrame.appendChild(frame);
      frame.layoutSizingHorizontal = "HUG";
      frame.layoutSizingVertical = "HUG";
      console.log("Creating category frame: " + name);
    }
    return frame;
  }

  // Category frames
  var typographyFrame = getOrCreateCategoryFrame("Typography", "Semantic text components");
  var textLayoutFrame = getOrCreateCategoryFrame("Text Layout", "Text width variants");
  var layoutFrame = getOrCreateCategoryFrame("Layout", "Container and viewport components");
  var cardsFrame = getOrCreateCategoryFrame("Cards", "Card components with elevation");
  var elevationFrame = getOrCreateCategoryFrame("Elevation", "Shadow depth samples");

  // Get or create each semantic component (Typography frame)
  const mainComponents = {};
  
  for (const [type, config] of Object.entries(SEMANTIC_COMPONENTS)) {
    let mainComponent = findComponentInFrame(typographyFrame, config.name);
    
    if (!mainComponent) {
      console.log("Creating component: " + config.name);
      mainComponent = createSemanticComponent(config);
      typographyFrame.appendChild(mainComponent);
      mainComponent.layoutSizingHorizontal = "FILL";  // Fill parent width
      mainComponent.layoutSizingVertical = "HUG";     // Hug content height
    } else {
      console.log("Found existing component: " + config.name);
    }
    
    mainComponents[type] = mainComponent;
  }

  // Get or create Text Layout component (Text Layout frame)
  var textLayoutSet = findComponentSetInFrame(textLayoutFrame, "Text Layout");
  if (!textLayoutSet) {
    console.log("Creating Text Layout component");
    textLayoutSet = createTextLayoutComponent(textLayoutFrame);
  } else {
    console.log("Found existing Text Layout component");
  }
  mainComponents["textLayout"] = textLayoutSet;

  // Get or create Blockquote component (Typography frame)
  var blockquoteComponent = findComponentInFrame(typographyFrame, "Blockquote");
  if (!blockquoteComponent) {
    console.log("Creating Blockquote component");
    blockquoteComponent = createBlockquoteComponent(typographyFrame);
  } else {
    console.log("Found existing Blockquote component");
  }
  mainComponents["blockquote"] = blockquoteComponent;

  // Get or create Table Cell component set (Typography frame)
  var tableCellSet = findComponentSetInFrame(typographyFrame, "Table Cell");
  if (!tableCellSet) {
    console.log("Creating Table Cell component");
    tableCellSet = createTableCellsComponent(typographyFrame);
    // Component sets get auto-layout sizing from their parent after append
  } else {
    console.log("Found existing Table Cell component");
  }
  mainComponents["tableCell"] = tableCellSet;

  // Get or create Content component (Layout frame)
  var contentSet = findComponentSetInFrame(layoutFrame, "Content");
  if (!contentSet) {
    console.log("Creating Content component");
    contentSet = createContentComponent(layoutFrame);
  } else {
    console.log("Found existing Content component");
  }
  mainComponents["content"] = contentSet;

  // Get or create Card component (Cards frame)
  var cardSet = findComponentSetInFrame(cardsFrame, "Card");
  if (!cardSet) {
    console.log("Creating Card component");
    cardSet = createCardComponent(cardsFrame);
  } else {
    console.log("Found existing Card component");
  }
  mainComponents["card"] = cardSet;

  // Get or create Markdown Content component (Layout frame)
  var markdownContentSet = findComponentSetInFrame(layoutFrame, "Markdown Content");
  if (!markdownContentSet) {
    console.log("Creating Markdown Content component");
    markdownContentSet = createMarkdownContentComponent(layoutFrame);
  } else {
    console.log("Found existing Markdown Content component");
  }
  mainComponents["markdownContent"] = markdownContentSet;

  // Create elevation samples section (Elevation frame)
  var elevationSamples = findFrameByName(elevationFrame, "Samples");
  if (!elevationSamples) {
    console.log("Creating Elevation Samples");
    createElevationSamples(elevationFrame);
  } else {
    console.log("Found existing Elevation Samples");
  }

  // Create or update proof frame showing components at various viewport widths
  // Proof frame is row 2 in the outer container
  await createOrUpdateProofFrame(outerContainer, mainComponents);

  return mainComponents;
}

/**
 * Create Content component with viewport variants.
 * This is the responsive container that constrains child widths.
 * Children use FILL sizing to respond to the content width.
 * 
 * Variants: Mobile (390px), Tablet (768px), Desktop (1440px)
 */
function createContentComponent(containerFrame) {
  var components = [];
  
  // Content area widths (viewport minus gutters)
  var contentVariants = [
    { name: "Mobile", width: TOKENS.breakpoint.mobile.$value - 32, gutter: 16 },   // 358px content
    { name: "Tablet", width: TOKENS.breakpoint.tablet.$value - 64, gutter: 32 },   // 704px content
    { name: "Desktop", width: TOKENS.breakpoint.desktop.$value - 128, gutter: 64 } // 1312px content
  ];
  
  for (var i = 0; i < contentVariants.length; i++) {
    var variant = contentVariants[i];
    var component = figma.createComponent();
    component.name = "Viewport=" + variant.name;
    
    // Auto-layout: vertical, fixed width, hug height (unbounded scroll)
    component.layoutMode = "VERTICAL";
    component.primaryAxisSizingMode = "AUTO";    // Hug height (unbounded)
    component.counterAxisSizingMode = "FIXED";   // Fixed viewport width
    component.resize(variant.width + (variant.gutter * 2), 200);
    component.paddingLeft = variant.gutter;
    component.paddingRight = variant.gutter;
    component.paddingTop = TOKENS.spacing.xl.$value;
    component.paddingBottom = TOKENS.spacing.xl.$value;
    component.itemSpacing = 0;  // Block spacing handled by wrapper paddingTop
    component.fills = [{ type: "SOLID", color: COLORS.page }];
    component.counterAxisAlignItems = "MIN";  // Left-align content
    component.clipsContent = false;
    
    // Add placeholder text to show content area
    var placeholder = figma.createText();
    placeholder.fontName = FONT_SANS;
    placeholder.fontSize = 12;
    placeholder.characters = "Content goes here...";
    placeholder.fills = [{ type: "SOLID", color: COLORS.textMuted }];
    component.appendChild(placeholder);
    placeholder.layoutSizingHorizontal = "FILL";
    placeholder.layoutSizingVertical = "HUG";
    
    containerFrame.appendChild(component);
    components.push(component);
  }
  
  // Combine into component set
  if (components.length > 0) {
    var componentSet = figma.combineAsVariants(components, containerFrame);
    componentSet.name = "Content";
    return componentSet;
  }
  return null;
}

/**
 * Create Markdown Content component with viewport and reading width variants.
 * 
 * Each variant targets a specific device width (1920px to mobile) with padding
 * calculated to achieve optimal reading widths based on character measure:
 * - 65ch = 552px (comfortable narrow reading)
 * - 70ch = 595px
 * - 75ch = 637px  
 * - 80ch = 680px (default optimal reading width)
 * - 85ch = 722px
 * - 90ch = 765px (wide reading, good for code-heavy content)
 * 
 * Reading width in pixels: (targetCh / 80) * 680
 * Gutter calculation: (viewportWidth - contentWidth) / 2
 */
function createMarkdownContentComponent(containerFrame) {
  var components = [];
  
  // Viewport variants with calculated reading widths
  // ch-to-px conversion based on 80ch = 680px (TOKENS.measure.default)
  var variants = [
    { name: "Mobile",       viewport: 390,  ch: null, gutter: 16 },   // 358px natural (too narrow for 65ch)
    { name: "Tablet",       viewport: 768,  ch: 65,   gutter: 108 },  // 552px = 65ch
    { name: "Laptop",       viewport: 1024, ch: 70,   gutter: 215 },  // ~595px = 70ch
    { name: "Desktop",      viewport: 1280, ch: 75,   gutter: 322 },  // ~637px = 75ch
    { name: "Desktop Large", viewport: 1440, ch: 80,   gutter: 380 },  // 680px = 80ch
    { name: "Desktop XL",   viewport: 1680, ch: 85,   gutter: 479 },  // ~722px = 85ch
    { name: "Ultrawide",    viewport: 1920, ch: 90,   gutter: 578 }   // ~765px = 90ch
  ];
  
  for (var i = 0; i < variants.length; i++) {
    var v = variants[i];
    var component = figma.createComponent();
    
    // Variant name includes both viewport and reading width
    var readingLabel = v.ch ? v.ch + "ch" : "auto";
    component.name = "Viewport=" + v.name + ", Reading=" + readingLabel;
    
    // Auto-layout: vertical, fixed width, hug height
    component.layoutMode = "VERTICAL";
    component.primaryAxisSizingMode = "AUTO";    // Hug height (unbounded scroll)
    component.counterAxisSizingMode = "FIXED";   // Fixed viewport width
    component.resize(v.viewport, 200);
    component.paddingLeft = v.gutter;
    component.paddingRight = v.gutter;
    component.paddingTop = TOKENS.spacing.xxxl.$value;
    component.paddingBottom = TOKENS.spacing.xxxl.$value;
    component.itemSpacing = 0;  // Block spacing handled by wrapper paddingTop
    component.fills = [{ type: "SOLID", color: COLORS.page }];
    component.counterAxisAlignItems = "MIN";  // Left-align content
    component.clipsContent = false;
    
    // Add placeholder showing content area and reading width
    var placeholder = figma.createText();
    placeholder.fontName = FONT_SANS;
    placeholder.fontSize = 12;
    var contentWidth = v.viewport - (v.gutter * 2);
    placeholder.characters = v.name + " (" + v.viewport + "px viewport, " + contentWidth + "px content" + (v.ch ? ", " + v.ch + "ch reading" : "") + ")";
    placeholder.fills = [{ type: "SOLID", color: COLORS.textMuted }];
    component.appendChild(placeholder);
    placeholder.layoutSizingHorizontal = "FILL";
    placeholder.layoutSizingVertical = "HUG";
    
    containerFrame.appendChild(component);
    components.push(component);
  }
  
  // Combine into component set
  if (components.length > 0) {
    var componentSet = figma.combineAsVariants(components, containerFrame);
    componentSet.name = "Markdown Content";
    return componentSet;
  }
  return null;
}

/**
 * Create Card component with elevation variants.
 * Cards are containers with rounded corners and shadow elevation.
 * Perfect for images, media, and grouped content.
 * 
 * Variants: Elevation=Shadow02|Shadow04|Shadow08|Shadow16|Shadow28|Shadow64
 */
function createCardComponent(containerFrame) {
  var components = [];
  
  var elevationLevels = [
    { name: "Shadow02", shadow: TOKENS.elevation.shadow02.$value, desc: "Rest state" },
    { name: "Shadow04", shadow: TOKENS.elevation.shadow04.$value, desc: "Hover" },
    { name: "Shadow08", shadow: TOKENS.elevation.shadow08.$value, desc: "Active" },
    { name: "Shadow16", shadow: TOKENS.elevation.shadow16.$value, desc: "Popover" },
    { name: "Shadow28", shadow: TOKENS.elevation.shadow28.$value, desc: "Dialog" },
    { name: "Shadow64", shadow: TOKENS.elevation.shadow64.$value, desc: "Overlay" }
  ];
  
  for (var i = 0; i < elevationLevels.length; i++) {
    var level = elevationLevels[i];
    var component = figma.createComponent();
    component.name = "Elevation=" + level.name;
    
    // Auto-layout frame that hugs content
    component.layoutMode = "VERTICAL";
    component.primaryAxisSizingMode = "AUTO";    // Hug height
    component.counterAxisSizingMode = "AUTO";    // Hug width
    component.paddingLeft = 0;
    component.paddingRight = 0;
    component.paddingTop = 0;
    component.paddingBottom = 0;
    component.itemSpacing = 0;
    component.fills = [{ type: "SOLID", color: COLORS.page }];
    component.cornerRadius = TOKENS.radius.lg.$value;
    component.clipsContent = true;  // Clip overflowing content (important for images)
    
    // Apply shadow effects (tokens contain complete Figma effect objects)
    component.effects = level.shadow;
    
    // Add placeholder content (240x160 for 3:2 aspect ratio)
    var placeholder = figma.createRectangle();
    placeholder.name = "Content Placeholder";
    placeholder.resize(240, 160);
    placeholder.fills = [{ type: "SOLID", color: COLORS.placeholder }];
    placeholder.cornerRadius = 0;  // Card handles rounding via clipsContent
    component.appendChild(placeholder);
    
    // Placeholder uses fixed sizing within the auto-layout card
    placeholder.layoutSizingHorizontal = "FIXED";
    placeholder.layoutSizingVertical = "FIXED";
    
    containerFrame.appendChild(component);
    components.push(component);
  }
  
  // Combine into component set
  if (components.length > 0) {
    var componentSet = figma.combineAsVariants(components, containerFrame);
    componentSet.name = "Card";
    return componentSet;
  }
  return null;
}

/**
 * Create elevation samples frame showing all shadow levels.
 * Displays each elevation with label for design reference.
 */
function createElevationSamples(containerFrame) {
  var samplesFrame = figma.createFrame();
  samplesFrame.name = "Samples";
  
  // Horizontal auto-layout to show all elevations side-by-side
  samplesFrame.layoutMode = "HORIZONTAL";
  samplesFrame.primaryAxisSizingMode = "AUTO";
  samplesFrame.counterAxisSizingMode = "AUTO";
  samplesFrame.itemSpacing = 48;  // Extra space due to shadow spread
  samplesFrame.paddingLeft = 32;
  samplesFrame.paddingRight = 64;  // Extra for shadow on right edge
  samplesFrame.paddingTop = 32;
  samplesFrame.paddingBottom = 64;  // Extra for shadow on bottom
  samplesFrame.fills = [];  // Transparent - parent has background
  samplesFrame.cornerRadius = 0;
  
  var elevationLevels = [
    { name: "Shadow02", shadow: TOKENS.elevation.shadow02.$value, label: "Layer 0\nRest" },
    { name: "Shadow04", shadow: TOKENS.elevation.shadow04.$value, label: "Layer 1\nHover" },
    { name: "Shadow08", shadow: TOKENS.elevation.shadow08.$value, label: "Layer 2\nActive" },
    { name: "Shadow16", shadow: TOKENS.elevation.shadow16.$value, label: "Layer 3\nPopover" },
    { name: "Shadow28", shadow: TOKENS.elevation.shadow28.$value, label: "Layer 4\nDialog" },
    { name: "Shadow64", shadow: TOKENS.elevation.shadow64.$value, label: "Layer 5\nOverlay" }
  ];
  
  for (var i = 0; i < elevationLevels.length; i++) {
    var level = elevationLevels[i];
    
    // Container for each sample (vertical: card + label)
    var sampleContainer = figma.createFrame();
    sampleContainer.name = level.name;
    sampleContainer.layoutMode = "VERTICAL";
    sampleContainer.primaryAxisSizingMode = "AUTO";
    sampleContainer.counterAxisSizingMode = "AUTO";
    sampleContainer.itemSpacing = 12;
    sampleContainer.counterAxisAlignItems = "CENTER";
    sampleContainer.fills = [];
    
    // Sample card with shadow
    var card = figma.createFrame();
    card.name = "Card";
    card.resize(120, 80);
    card.fills = [{ type: "SOLID", color: COLORS.page }];
    card.cornerRadius = TOKENS.radius.md.$value;
    card.effects = level.shadow;  // Tokens contain complete Figma effect objects
    sampleContainer.appendChild(card);
    card.layoutSizingHorizontal = "FIXED";
    card.layoutSizingVertical = "FIXED";
    
    // Label text
    var label = figma.createText();
    label.fontName = FONT_SANS;
    label.fontSize = 12;
    label.characters = level.label;
    label.fills = [{ type: "SOLID", color: COLORS.textMuted }];
    label.textAlignHorizontal = "CENTER";
    sampleContainer.appendChild(label);
    label.layoutSizingHorizontal = "HUG";
    label.layoutSizingVertical = "HUG";
    
    samplesFrame.appendChild(sampleContainer);
    sampleContainer.layoutSizingHorizontal = "HUG";
    sampleContainer.layoutSizingVertical = "HUG";
  }
  
  containerFrame.appendChild(samplesFrame);
  return samplesFrame;
}

/**
 * Create a proof frame demonstrating components at various viewport widths.
 * Shows lorem ipsum style content to visualize the type system.
 * @param {FrameNode} container - The outer container (row 2 of "All Components")
 */
async function createOrUpdateProofFrame(container, mainComponents) {
  const PROOF_FRAME_NAME = "Typography Proof";
  
  // Remove existing proof frame from container
  for (var i = container.children.length - 1; i >= 0; i--) {
    if (container.children[i].name === PROOF_FRAME_NAME) {
      container.children[i].remove();
    }
  }
  
  // Viewport widths to demonstrate
  const viewports = [
    { name: "Mobile", width: TOKENS.breakpoint.mobile.$value, gutter: 16 },
    { name: "Tablet", width: TOKENS.breakpoint.tablet.$value, gutter: 32 },
    { name: "Desktop", width: TOKENS.breakpoint.desktop.$value, gutter: 64 }
  ];
  
  // Lorem content for demonstration
  const loremContent = {
    h1: "Getting Started with the Platform",
    h2: "Introduction",
    p1: "Welcome to the platform documentation. This guide will walk you through the essential concepts and help you get started quickly. We've designed the system to be intuitive while providing the flexibility needed for complex workflows.",
    h3: "Prerequisites",
    p2: "Before you begin, ensure you have the following installed on your system. These tools are required for the basic setup and will be used throughout the documentation.",
    li1: "Node.js version 18 or later installed on your system",
    li2: "A code editor such as VS Code with recommended extensions",
    li3: "Basic familiarity with command-line interfaces",
    h4: "Quick Start",
    p3: "The fastest way to get started is to use our CLI tool. Simply run the installation command and follow the prompts to configure your environment.",
    code: "npm install -g @platform/cli\nplatform init my-project\ncd my-project && npm start"
  };
  
  // Create proof container
  var proofFrame = figma.createFrame();
  proofFrame.name = PROOF_FRAME_NAME;
  proofFrame.layoutMode = "HORIZONTAL";
  proofFrame.primaryAxisSizingMode = "AUTO";
  proofFrame.counterAxisSizingMode = "AUTO";
  proofFrame.itemSpacing = 64;
  proofFrame.paddingLeft = 48;
  proofFrame.paddingRight = 48;
  proofFrame.paddingTop = 48;
  proofFrame.paddingBottom = 48;
  proofFrame.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
  proofFrame.cornerRadius = 16;
  
  // Create a viewport sample for each size
  for (var v = 0; v < viewports.length; v++) {
    var viewport = viewports[v];
    
    var viewportFrame = figma.createFrame();
    viewportFrame.name = viewport.name + " (" + viewport.width + "px)";
    viewportFrame.layoutMode = "VERTICAL";
    viewportFrame.primaryAxisSizingMode = "AUTO";
    viewportFrame.counterAxisSizingMode = "FIXED";
    viewportFrame.resize(viewport.width, 100);
    viewportFrame.paddingLeft = viewport.gutter;
    viewportFrame.paddingRight = viewport.gutter;
    viewportFrame.paddingTop = 32;
    viewportFrame.paddingBottom = 32;
    viewportFrame.itemSpacing = 0;
    viewportFrame.fills = [{ type: "SOLID", color: COLORS.page }];
    viewportFrame.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.87 } }];
    viewportFrame.strokeWeight = 1;
    viewportFrame.cornerRadius = 8;
    viewportFrame.clipsContent = true;
    
    // Add viewport label
    var label = figma.createText();
    label.fontName = FONT_SANS_MEDIUM;
    label.fontSize = 11;
    label.characters = viewport.name.toUpperCase() + " \u2014 " + viewport.width + "px";
    label.fills = [{ type: "SOLID", color: COLORS.textMuted }];
    label.letterSpacing = { value: 5, unit: "PERCENT" };
    viewportFrame.appendChild(label);
    label.layoutSizingHorizontal = "FILL";
    label.layoutSizingVertical = "HUG";
    
    // Spacer after label
    var spacer = figma.createFrame();
    spacer.name = "Spacer";
    spacer.resize(10, 24);
    spacer.fills = [];
    viewportFrame.appendChild(spacer);
    spacer.layoutSizingHorizontal = "FILL";
    spacer.layoutSizingVertical = "FIXED";
    
    // Add content blocks using instances where possible
    var contentBlocks = [
      { type: "h1", text: loremContent.h1 },
      { type: "p", text: loremContent.p1, spacing: 24 },
      { type: "h2", text: loremContent.h2, spacing: 48 },
      { type: "p", text: loremContent.p2, spacing: 24 },
      { type: "h3", text: loremContent.h3, spacing: 40 },
      { type: "li", text: loremContent.li1, spacing: 8 },
      { type: "li", text: loremContent.li2, spacing: 8 },
      { type: "li", text: loremContent.li3, spacing: 8 },
      { type: "h4", text: loremContent.h4, spacing: 32 },
      { type: "p", text: loremContent.p3, spacing: 24 }
    ];
    
    for (var b = 0; b < contentBlocks.length; b++) {
      var block = contentBlocks[b];
      var component = mainComponents[block.type];
      
      if (component) {
        // Create spacing wrapper
        var wrapper = figma.createFrame();
        wrapper.name = "Block/" + block.type;
        wrapper.layoutMode = "VERTICAL";
        wrapper.primaryAxisSizingMode = "AUTO";
        wrapper.counterAxisSizingMode = "FIXED";
        wrapper.itemSpacing = 0;
        wrapper.fills = [];
        wrapper.paddingTop = block.spacing || 0;
        
        // Create instance
        var instance = component.createInstance();
        var textNode = findTextNode(instance);
        if (textNode) {
          textNode.characters = block.text;
        }
        
        wrapper.appendChild(instance);
        instance.layoutSizingHorizontal = "HUG";
        instance.layoutSizingVertical = "HUG";
        
        viewportFrame.appendChild(wrapper);
        wrapper.layoutSizingHorizontal = "FILL";
        wrapper.layoutSizingVertical = "HUG";
      }
    }
    
    proofFrame.appendChild(viewportFrame);
    viewportFrame.layoutSizingHorizontal = "FIXED";
    viewportFrame.layoutSizingVertical = "HUG";
  }
  
  container.appendChild(proofFrame);
  proofFrame.layoutSizingHorizontal = "HUG";
  proofFrame.layoutSizingVertical = "HUG";
}

/**
 * Find a component set by name inside a frame
 */
function findComponentSetInFrame(frame, name) {
  if (!frame.children) return null;
  for (var i = 0; i < frame.children.length; i++) {
    var child = frame.children[i];
    if (child.type === "COMPONENT_SET" && child.name === name) {
      return child;
    }
  }
  return null;
}

// Text Layout tracking variants (letter-spacing as percentage)
// ±20% from normal (0%)
var TEXT_LAYOUT_TRACKING = {
  "Tight": -1.0,   // -20% of typical tracking range (-1%)
  "Normal": 0,      // Default (0%)
  "Loose": 1.0      // +20% of typical tracking range (+1%)
};

// Text Layout leading variants (line-height multipliers)
// Base line-height is 1.6; ±20% for tight/loose
var TEXT_LAYOUT_LEADING = {
  "Tight": 1.28,    // 1.6 * 0.8 = 1.28 (~20px at 16px font)
  "Normal": 1.6,    // Default (~26px at 16px font)
  "Loose": 1.92     // 1.6 * 1.2 = 1.92 (~32px at 16px font)
};

// Default text layout width (80ch)
var TEXT_LAYOUT_WIDTH = 680;

/**
 * Create Text Layout component with 9 variants (3 tracking × 3 leading).
 * Combinations: Tight/Normal/Loose tracking × Tight/Normal/Loose leading.
 * Used to constrain paragraph text with typographic control.
 */
function createTextLayoutComponent(containerFrame) {
  var components = [];
  var trackingNames = ["Tight", "Normal", "Loose"];
  var leadingNames = ["Tight", "Normal", "Loose"];
  
  for (var ti = 0; ti < trackingNames.length; ti++) {
    var trackingName = trackingNames[ti];
    var trackingValue = TEXT_LAYOUT_TRACKING[trackingName];
    
    for (var li = 0; li < leadingNames.length; li++) {
      var leadingName = leadingNames[li];
      var leadingMultiplier = TEXT_LAYOUT_LEADING[leadingName];
      
      var component = figma.createComponent();
      component.name = "Tracking=" + trackingName + ", Leading=" + leadingName;
      
      // Auto-layout: vertical, left aligned, hug content
      component.layoutMode = "VERTICAL";
      component.primaryAxisSizingMode = "AUTO";      // Hug height
      component.counterAxisSizingMode = "FIXED";     // Fixed width
      component.resize(TEXT_LAYOUT_WIDTH, 100);
      component.counterAxisAlignItems = "MIN";       // Left align
      component.itemSpacing = 0;
      component.fills = [];
      
      // Calculate line height in pixels (grid-aligned to 4px)
      var fontSize = TYPE_RAMP.p.fontSize;
      var rawLineHeight = fontSize * leadingMultiplier;
      var lineHeightPx = Math.round(rawLineHeight / 4) * 4;  // Snap to 4px grid
      
      // Create text placeholder - IMPORTANT: set characters BEFORE textAutoResize
      var textNode = figma.createText();
      textNode.name = "Content";
      try {
        textNode.fontName = FONT_SERIF;
      } catch (e) {
        textNode.fontName = DEFAULT_FONT;
      }
      textNode.fontSize = fontSize;
      textNode.lineHeight = { value: lineHeightPx, unit: "PIXELS" };
      textNode.letterSpacing = { value: trackingValue, unit: "PERCENT" };
      textNode.fills = [{ type: "SOLID", color: COLORS.text }];
      textNode.characters = "Body text paragraph with optimal reading width for comfortable reading. This sample text demonstrates line wrapping and spacing behavior with the selected tracking and leading combination.";
      
      // Set text to fixed width, auto height AFTER setting characters
      textNode.textAutoResize = "HEIGHT";
      textNode.resize(TEXT_LAYOUT_WIDTH, textNode.height);
      
      component.appendChild(textNode);
      
      // In auto-layout: FILL width (matches component), HUG height (from text content)
      textNode.layoutSizingHorizontal = "FILL";
      textNode.layoutSizingVertical = "HUG";
      
      containerFrame.appendChild(component);
      components.push(component);
    }
  }
  
  // Combine into component set
  if (components.length > 0) {
    var componentSet = figma.combineAsVariants(components, containerFrame);
    componentSet.name = "Text Layout";
    return componentSet;
  }
  return null;
}

/**
 * Create Blockquote component with auto-layout.
 * Has left border, background, padding - ready to accept content override.
 */
function createBlockquoteComponent(containerFrame) {
  var component = figma.createComponent();
  component.name = "Blockquote";
  
  // Auto-layout: vertical, constrained to optimal reading width
  component.layoutMode = "VERTICAL";
  component.primaryAxisSizingMode = "AUTO";    // Hug height
  component.counterAxisSizingMode = "FIXED";   // Fixed width for reading measure
  component.resize(TOKENS.measure.default.$value, 100);  // Set to optimal reading width
  component.itemSpacing = TOKENS.spacing.sm.$value;
  component.paddingLeft = TOKENS.blockquote.paddingLeft.$value;
  component.paddingRight = TOKENS.blockquote.paddingRight.$value;
  component.paddingTop = TOKENS.blockquote.paddingY.$value;
  component.paddingBottom = TOKENS.blockquote.paddingY.$value;
  
  // Background and left border
  component.fills = [{ type: "SOLID", color: COLORS.blockquoteBg }];
  component.strokes = [{ type: "SOLID", color: COLORS.blockquoteBorder }];
  component.strokeAlign = "INSIDE";
  component.strokeTopWeight = 0;
  component.strokeRightWeight = 0;
  component.strokeBottomWeight = 0;
  component.strokeLeftWeight = TOKENS.blockquote.borderWidth.$value;
  component.cornerRadius = TOKENS.radius.sm.$value;
  
  // Create text placeholder - fills container, constrained by padding
  var textNode = figma.createText();
  textNode.name = "Quote Text";
  try {
    textNode.fontName = FONT_SERIF_ITALIC;
  } catch (e) {
    try {
      textNode.fontName = FONT_SERIF;
    } catch (e2) {
      textNode.fontName = DEFAULT_FONT;
    }
  }
  textNode.fontSize = TYPE_RAMP.blockquote.fontSize;
  textNode.lineHeight = { value: TYPE_RAMP.blockquote.lineHeightPx, unit: "PIXELS" };
  textNode.characters = "Important quote or callout text goes here.";
  textNode.fills = [{ type: "SOLID", color: COLORS.textMuted }];
  textNode.textAutoResize = "HEIGHT";
  // Width determined by FILL sizing in fixed-width parent
  
  component.appendChild(textNode);
  textNode.layoutSizingHorizontal = "FILL";
  textNode.layoutSizingVertical = "HUG";
  
  containerFrame.appendChild(component);
  return component;
}

/**
 * Create Table Cell component set with Header and Body variants.
 * Cells have proper padding, borders, and typography.
 */
function createTableCellsComponent(containerFrame) {
  var components = [];
  var cellPadding = TOKENS.table.cellPadding.$value;
  var borderWidth = TOKENS.table.borderWidth.$value;
  
  // Create Header Cell variant
  var headerCell = figma.createComponent();
  headerCell.name = "Type=Header";
  headerCell.layoutMode = "VERTICAL";
  headerCell.primaryAxisAlignItems = "CENTER";  // Vertical center
  headerCell.counterAxisAlignItems = "MIN";     // Left align (default)
  headerCell.paddingLeft = cellPadding;
  headerCell.paddingRight = cellPadding;
  headerCell.paddingTop = cellPadding;
  headerCell.paddingBottom = cellPadding;
  headerCell.fills = [{ type: "SOLID", color: COLORS.tableHeaderBg }];
  headerCell.strokes = [{ type: "SOLID", color: COLORS.tableBorder }];
  headerCell.strokeAlign = "INSIDE";
  headerCell.strokeTopWeight = 0;
  headerCell.strokeRightWeight = 0;
  headerCell.strokeBottomWeight = borderWidth;
  headerCell.strokeLeftWeight = 0;
  headerCell.resize(TOKENS.table.minCellWidth.$value, TOKENS.table.minCellHeight.$value);
  
  var headerText = figma.createText();
  headerText.name = "Cell Content";
  try { headerText.fontName = FONT_SANS_SEMIBOLD; } catch (e) { headerText.fontName = DEFAULT_FONT; }
  headerText.fontSize = TYPE_RAMP.tableCell.fontSize;
  headerText.lineHeight = { value: TYPE_RAMP.tableCell.lineHeightPx, unit: "PIXELS" };
  headerText.characters = "Header";
  headerText.fills = [{ type: "SOLID", color: COLORS.text }];
  headerText.textAutoResize = "WIDTH_AND_HEIGHT";
  headerCell.appendChild(headerText);
  headerText.layoutSizingHorizontal = "FILL";
  headerText.layoutSizingVertical = "HUG";
  
  containerFrame.appendChild(headerCell);
  headerCell.layoutSizingVertical = "HUG";
  components.push(headerCell);
  
  // Create Body Cell variant
  var bodyCell = figma.createComponent();
  bodyCell.name = "Type=Body";
  bodyCell.layoutMode = "VERTICAL";
  bodyCell.primaryAxisAlignItems = "CENTER";
  bodyCell.counterAxisAlignItems = "MIN";
  bodyCell.paddingLeft = cellPadding;
  bodyCell.paddingRight = cellPadding;
  bodyCell.paddingTop = cellPadding;
  bodyCell.paddingBottom = cellPadding;
  bodyCell.fills = [{ type: "SOLID", color: COLORS.page }];
  bodyCell.strokes = [{ type: "SOLID", color: COLORS.tableBorder }];
  bodyCell.strokeAlign = "INSIDE";
  bodyCell.strokeTopWeight = 0;
  bodyCell.strokeRightWeight = 0;
  bodyCell.strokeBottomWeight = borderWidth;
  bodyCell.strokeLeftWeight = 0;
  bodyCell.resize(TOKENS.table.minCellWidth.$value, TOKENS.table.minCellHeight.$value);
  
  var bodyText = figma.createText();
  bodyText.name = "Cell Content";
  try { bodyText.fontName = FONT_SANS; } catch (e) { bodyText.fontName = DEFAULT_FONT; }
  bodyText.fontSize = TYPE_RAMP.tableCell.fontSize;
  bodyText.lineHeight = { value: TYPE_RAMP.tableCell.lineHeightPx, unit: "PIXELS" };
  bodyText.characters = "Cell value";
  bodyText.fills = [{ type: "SOLID", color: COLORS.text }];
  bodyText.textAutoResize = "WIDTH_AND_HEIGHT";
  bodyCell.appendChild(bodyText);
  bodyText.layoutSizingHorizontal = "FILL";
  bodyText.layoutSizingVertical = "HUG";
  
  containerFrame.appendChild(bodyCell);
  bodyCell.layoutSizingVertical = "HUG";
  components.push(bodyCell);
  
  // Combine into component set
  if (components.length > 0) {
    var componentSet = figma.combineAsVariants(components, containerFrame);
    componentSet.name = "Table Cell";
    return componentSet;
  }
  return null;
}

/**
 * Find a frame by name in a page
 */
function findFrameByName(page, name) {
  if (!page.children) return null;
  for (const child of page.children) {
    if (child.type === "FRAME" && child.name === name) {
      return child;
    }
  }
  return null;
}

/**
 * Find a component by name inside a frame
 */
function findComponentInFrame(frame, name) {
  if (!frame.children) return null;
  for (const child of frame.children) {
    if (child.type === "COMPONENT" && child.name === name) {
      return child;
    }
  }
  return null;
}

/**
 * Get the appropriate font based on config.
 * Respects optical sizing: large-master for display, small-master for text.
 */
function getFontForConfig(config) {
  // Code uses monospace
  if (config.useMono || config.isCode) {
    return FONT_MONO;
  }
  
  // Body text uses serif (Source Serif 4)
  if (config.useSerif) {
    return FONT_SERIF;
  }
  
  // Headings use sans-serif (Inter) with appropriate weight
  const fontStyle = config.fontStyle || "Regular";
  switch (fontStyle) {
    case "Bold": return FONT_SANS_BOLD;
    case "SemiBold": return FONT_SANS_SEMIBOLD;
    case "Medium": return FONT_SANS_MEDIUM;
    default: return FONT_SANS;
  }
}

/**
 * Get fallback font if primary not available
 */
function getFallbackFont(config) {
  if (config.useMono || config.isCode) return CODE_FONT;
  return DEFAULT_FONT;
}

/**
 * Create a semantic component (NO auto-layout on the component itself).
 * The component is a simple container with styled content.
 * Uses optical sizing: large-master for H1/H2, small-master for rest.
 */
function createSemanticComponent(config) {
  const component = figma.createComponent();
  component.name = config.name;
  
  // AUTO-LAYOUT: vertical, hug both directions (will set FILL when placed in container)
  component.layoutMode = "VERTICAL";
  component.primaryAxisSizingMode = "AUTO";    // Hug height
  component.counterAxisSizingMode = "AUTO";    // Hug width (becomes FILL when placed)
  component.counterAxisAlignItems = "MIN";     // Left align text
  component.itemSpacing = 0;
  
  // Set max width to reading measure - except for code blocks which fill width
  if (!config.isCode) {
    component.maxWidth = TOKENS.measure.default.$value;  // 680px
  }
  component.resize(TOKENS.measure.default.$value, 40);
  
  // Padding for boxed elements (code, note, placeholder) - using token scale
  const needsPadding = config.isCode || config.isNote || config.isPlaceholder;
  if (needsPadding) {
    component.paddingLeft = TOKENS.spacing.md.$value;    // 16px
    component.paddingRight = TOKENS.spacing.md.$value;
    component.paddingTop = TOKENS.spacing.sm.$value;     // 8px
    component.paddingBottom = TOKENS.spacing.sm.$value;
  } else {
    component.paddingLeft = 0;
    component.paddingRight = 0;
    component.paddingTop = 0;
    component.paddingBottom = 0;
  }
  
  // Style based on component type
  if (config.isCode) {
    component.fills = [{ type: "SOLID", color: COLORS.codeBg }];
    component.cornerRadius = TOKENS.radius.md.$value;
  } else if (config.isNote) {
    component.fills = [{ type: "SOLID", color: COLORS.noteBg }];
    component.strokes = [{ type: "SOLID", color: COLORS.noteBorder }];
    component.strokeWeight = 1;
    component.strokeAlign = "INSIDE";
    component.cornerRadius = TOKENS.radius.md.$value;
  } else if (config.isPlaceholder) {
    component.fills = [{ type: "SOLID", color: COLORS.placeholder }];
    component.cornerRadius = TOKENS.radius.md.$value;
  } else {
    component.fills = [];
  }
  
  // Create text node with proper typography
  const textNode = figma.createText();
  textNode.name = "Content";
  
  // Set font - try primary, fall back to default
  const primaryFont = getFontForConfig(config);
  const fallbackFont = getFallbackFont(config);
  try {
    textNode.fontName = primaryFont;
  } catch (e) {
    textNode.fontName = fallbackFont;
  }
  
  // Typography from type ramp
  textNode.fontSize = config.fontSize;
  
  // Line height in pixels (4px grid aligned)
  if (config.lineHeightPx) {
    textNode.lineHeight = { value: config.lineHeightPx, unit: "PIXELS" };
  } else {
    textNode.lineHeight = { value: config.fontSize * 1.5, unit: "PIXELS" };
  }
  
  // Letter spacing (tracking) - in percent for Figma
  if (config.tracking && config.tracking !== 0) {
    textNode.letterSpacing = { value: config.tracking, unit: "PERCENT" };
  }
  
  textNode.characters = config.sampleText;
  
  // Text color based on type
  if (config.isLink) {
    textNode.fills = [{ type: "SOLID", color: COLORS.link }];
    textNode.textDecoration = "UNDERLINE";
  } else {
    textNode.fills = [{ type: "SOLID", color: COLORS.text }];
  }
  
  // Apply list style for list items
  if (config.listType) {
    textNode.setRangeListOptions(0, textNode.characters.length, { type: config.listType });
  }
  
  // Text sizing for auto-layout: fixed width (fills parent), auto height
  textNode.textAutoResize = "HEIGHT";
  
  // Add to component, then set layout sizing
  component.appendChild(textNode);
  textNode.layoutSizingHorizontal = "FILL";   // Fill component width
  textNode.layoutSizingVertical = "HUG";      // Hug text height
  
  return component;
}

// ============================================================================
// IMAGES PAGE (Two frames: Source Images + Image Components)
// ============================================================================

// Media breakpoints - derived from tokens
const BREAKPOINTS = {
  mobile:  { name: "Mobile",  width: TOKENS.breakpoint.mobile.$value },
  tablet:  { name: "Tablet",  width: TOKENS.breakpoint.tablet.$value },
  desktop: { name: "Desktop", width: TOKENS.breakpoint.desktop.$value },
  full:    { name: "Full",    width: TOKENS.breakpoint.full.$value }
};

const SOURCE_IMAGES_FRAME_NAME = "Source Images";
const IMAGE_COMPONENTS_FRAME_NAME = "Image Components";

/**
 * Get or create images on the Images page.
 * Creates two frames:
 * 1. Source Images - framed images (not components) for reference/copying
 * Returns: { 
 *   imageHashes: { filename: hash }, 
 *   imageDimensions: { filename: { width, height } },
 *   sourceFrames: { filename: FrameNode }  // For cloning into documents
 * }
 */
async function getOrCreateImageComponents(images) {
  const page = await getOrCreatePage("Images");
  
  // Get or create source images frame
  let sourceFrame = findFrameByName(page, SOURCE_IMAGES_FRAME_NAME);
  if (!sourceFrame) {
    sourceFrame = createContainerFrame(SOURCE_IMAGES_FRAME_NAME, "Source images - drag to use or copy fill");
    page.appendChild(sourceFrame);
    sourceFrame.x = 100;
    sourceFrame.y = 100;
  }
  
  // Add source images (as framed images, NOT components)
  // Track hashes, dimensions, and source frames for cloning
  var imageHashes = {};
  var imageDimensions = {};
  var sourceFrames = {};
  for (var filename in images) {
    if (images.hasOwnProperty(filename)) {
      var imageData = images[filename];
      
      // Get native dimensions
      var dims = getImageDimensions(imageData);
      imageDimensions[filename] = { width: dims.width, height: dims.height };
      
      // Check if already exists by name
      var existing = findFrameByName(sourceFrame, filename);
      if (!existing) {
        console.log("Creating source image: " + filename);
        var result = createSourceImage(filename, imageData);
        sourceFrame.appendChild(result.frame);
        imageHashes[filename] = result.hash;
        sourceFrames[filename] = result.frame;
      } else {
        console.log("Found existing source image: " + filename);
        sourceFrames[filename] = existing;
        // Get hash from existing
        var rect = findRectangleInFrame(existing);
        if (rect && rect.fills && rect.fills[0] && rect.fills[0].imageHash) {
          imageHashes[filename] = rect.fills[0].imageHash;
        }
        // Get dimensions from existing frame
        if (!imageDimensions[filename]) {
          imageDimensions[filename] = { width: existing.width, height: existing.height };
        }
      }
    }
  }
  
  return { 
    imageHashes: imageHashes, 
    imageDimensions: imageDimensions,
    sourceFrames: sourceFrames
  };
}

/**
 * Find a rectangle in a frame
 */
function findRectangleInFrame(frame) {
  if (!frame.children) return null;
  for (var i = 0; i < frame.children.length; i++) {
    if (frame.children[i].type === "RECTANGLE") {
      return frame.children[i];
    }
  }
  return null;
}

/**
 * Create a container frame with auto-layout
 */
function createContainerFrame(name, description) {
  const frame = figma.createFrame();
  frame.name = name;
  
  // Auto-layout with 4px grid
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";
  frame.itemSpacing = TOKENS.spacing.md.$value;
  frame.paddingLeft = TOKENS.spacing.lg.$value;
  frame.paddingRight = TOKENS.spacing.lg.$value;
  frame.paddingTop = TOKENS.spacing.lg.$value;
  frame.paddingBottom = TOKENS.spacing.lg.$value;
  frame.fills = [{ type: "SOLID", color: COLORS.blockquoteBg }];
  frame.cornerRadius = TOKENS.radius.lg.$value;
  
  // Add description label
  if (description) {
    const label = figma.createText();
    label.name = "Description";
    try {
      label.fontName = FONT_SANS;
    } catch (e) {
      label.fontName = DEFAULT_FONT;
    }
    label.fontSize = 12;
    label.lineHeight = { value: 16, unit: "PIXELS" };
    label.characters = description;
    label.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
    frame.appendChild(label);
  }
  
  return frame;
}

/**
 * Create a source image (framed image, not a component)
 * 
 * WHY RESPONSIVE IMAGES WORK:
 * - Plain frame (no auto-layout) allows constraints-based scaling
 * - Inner rectangle uses constraints: { horizontal: "SCALE", vertical: "SCALE" }
 *   which makes it scale proportionally when the parent frame resizes
 * - Frame has lockAspectRatio() called, so when placed with FILL width in an
 *   auto-layout parent, the frame width changes but height scales proportionally
 * - The combination of FILL width + FIXED height + lockAspectRatio creates
 *   true responsive behavior: images scale with container while maintaining
 *   their aspect ratio
 * 
 * Returns: { frame: FrameNode, hash: string }
 */
function createSourceImage(filename, imageData) {
  var dims = getImageDimensions(imageData);
  var size = scaleToFit(dims.width, dims.height, CONTENT_WIDTH);

  // Create a plain frame (no auto-layout) to hold the image
  // This allows constraints-based responsive behavior
  var frame = figma.createFrame();
  frame.name = filename;
  // No layoutMode - use constraints instead
  frame.resize(size.width, size.height);
  frame.fills = [];
  frame.clipsContent = true;

  // Create the image rectangle at exact aspect-ratio dimensions
  var image = figma.createImage(imageData);
  var rect = figma.createRectangle();
  rect.name = "Image";
  rect.resize(size.width, size.height);
  rect.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
  
  // Rectangle fills parent frame using constraints
  rect.constraints = { horizontal: "SCALE", vertical: "SCALE" };

  frame.appendChild(rect);
  
  // Lock frame's aspect ratio - when frame is resized, maintains proportions
  frame.lockAspectRatio();
  
  return { frame: frame, hash: image.hash };
}

// ============================================================================
// DOCUMENT BUILDING (using instances of main components)
// ============================================================================

/**
 * Build the Figma document from AST nodes.
 * Uses the Markdown Content component structure: viewport container with
 * calculated gutters to achieve specific reading widths (65ch-90ch).
 * 
 * The "viewport" parameter determines which device size to build for.
 * Reading widths are calculated to maintain optimal typographic measure.
 * Default is "Desktop Large" (1440px viewport, 80ch reading width).
 */
async function buildDocument(ast, mainComponents, imageMainComponents, viewport) {
  viewport = viewport || "Desktop Large";
  
  // Content configuration matching Markdown Content component variants
  // Gutters calculated to achieve specific ch-based reading widths
  // ch-to-px: (targetCh / 80) * 680
  var contentConfig = {
    "Mobile":        { width: 390,  gutter: 16,  ch: null },  // 358px natural
    "Tablet":        { width: 768,  gutter: 108, ch: 65 },    // 552px = 65ch
    "Laptop":        { width: 1024, gutter: 215, ch: 70 },    // ~595px = 70ch
    "Desktop":       { width: 1280, gutter: 322, ch: 75 },    // ~637px = 75ch
    "Desktop Large": { width: 1440, gutter: 380, ch: 80 },    // 680px = 80ch
    "Desktop XL":    { width: 1680, gutter: 479, ch: 85 },    // ~722px = 85ch
    "Ultrawide":     { width: 1920, gutter: 578, ch: 90 }     // ~765px = 90ch
  };
  
  var config = contentConfig[viewport] || contentConfig["Desktop Large"];
  
  // Create the page frame (viewport width with gutters for reading width)
  var frame = figma.createFrame();
  var readingLabel = config.ch ? config.ch + "ch" : "auto";
  frame.name = "Markdown Content (" + viewport + ", " + readingLabel + ")";
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";      // Height hugs content (unbounded scroll)
  frame.counterAxisSizingMode = "AUTO";      // Width hugs content
  frame.resize(config.width, 100);
  frame.paddingLeft = config.gutter;
  frame.paddingRight = config.gutter;
  frame.paddingTop = TOKENS.spacing.xxxl.$value;
  frame.paddingBottom = TOKENS.spacing.xxxl.$value;
  frame.itemSpacing = 0;                     // Block spacing via wrapper paddingTop
  frame.fills = [{ type: "SOLID", color: COLORS.page }];
  frame.counterAxisAlignItems = "MIN";       // Left align children

  var isFirstElement = true;
  var processedCount = 0;

  // Process each AST node
  for (var i = 0; i < ast.length; i++) {
    var node = ast[i];
    console.log("Processing node " + i + ": type=" + node.type + ", content=" + (node.content ? node.content.slice(0, 30) + "..." : "(none)"));
    try {
      var instance = await createInstanceFromNode(node, mainComponents, imageMainComponents);
      if (instance) {
        // Create a layout wrapper for proper spacing
        var wrapper = createBlockWrapper(node, instance, isFirstElement);
        frame.appendChild(wrapper);
        
        // Wrapper fills width, hugs height
        wrapper.layoutSizingHorizontal = "FILL";
        wrapper.layoutSizingVertical = "HUG";
        
        isFirstElement = false;
        processedCount++;
        console.log("  -> Created instance OK");
      } else {
        console.warn("No instance created for node " + i + " (type=" + node.type + ")");
      }
    } catch (err) {
      console.error("ERROR processing node " + i + " (type=" + node.type + "): " + err.message);
      console.error(err.stack);
    }
  }
  
  console.log("Processed " + processedCount + " of " + ast.length + " nodes");

  // Position to avoid overlapping existing content
  var pos = findClearPosition();
  frame.x = pos.x;
  frame.y = pos.y;

  // Select and focus
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
}

/**
 * Create a layout wrapper frame for a content element.
 * Handles block spacing (paddingTop) and alignment.
 */
function createBlockWrapper(node, content, isFirst) {
  var wrapper = figma.createFrame();
  wrapper.name = "Block/" + node.type;
  wrapper.layoutMode = "VERTICAL";
  wrapper.primaryAxisSizingMode = "AUTO";    // Hug height
  wrapper.counterAxisSizingMode = "FIXED";   // Fill width (set after append)
  wrapper.itemSpacing = 0;
  wrapper.fills = [];
  
  // Block spacing (top padding) based on element type
  var blockSpacing = getBlockSpacing(node.type);
  wrapper.paddingTop = isFirst ? 0 : blockSpacing;  // No top padding on first element
  wrapper.paddingBottom = 0;
  wrapper.paddingLeft = 0;
  wrapper.paddingRight = 0;
  
  // Alignment based on element type
  // Tables are centered (fixed-width content); code and images fill width
  if (node.type === "table") {
    wrapper.counterAxisAlignItems = "CENTER";  // Center tables
  } else {
    wrapper.counterAxisAlignItems = "MIN";     // Left align text, code, and images
  }
  
  // Add content to wrapper
  wrapper.appendChild(content);
  
  // Helper: check if node supports auto-layout sizing
  // Plain frames (no layoutMode) use FIXED sizing automatically
  var hasAutoLayout = content.layoutMode && content.layoutMode !== "NONE";
  var supportsLayoutSizing = content.type === "TEXT" || 
    content.type === "INSTANCE" ||
    (content.type === "FRAME" && hasAutoLayout) ||
    (content.type === "COMPONENT" && hasAutoLayout);
  
  // Set content sizing based on type
  if (node.type === "image") {
    // Image frames (plain frames, no auto-layout) use FILL width
    // lockAspectRatio on the frame makes height scale proportionally
    content.layoutSizingHorizontal = "FILL";
    content.layoutSizingVertical = "FIXED";
  } else if (node.type === "code") {
    // Code blocks fill width like images, content left-aligned inside
    content.layoutSizingHorizontal = "FILL";
    content.layoutSizingVertical = "HUG";
  } else if (!supportsLayoutSizing) {
    // Content doesn't support HUG sizing - use FIXED
    content.layoutSizingHorizontal = "FIXED";
    content.layoutSizingVertical = "FIXED";
  } else {
    // Text and other auto-layout content fills available width
    content.layoutSizingHorizontal = "FILL";
    content.layoutSizingVertical = "HUG";
  }
  
  return wrapper;
}

/**
 * Get block spacing (top margin) for an element type
 */
function getBlockSpacing(type) {
  // Check TYPE_RAMP first
  var config = TYPE_RAMP[type];
  if (config && config.blockSpacing !== undefined) {
    return config.blockSpacing;
  }
  // Special handling for types not in TYPE_RAMP
  if (type === "image") {
    return TOKENS.blockSpacing.image.$value;
  }
  if (type === "blockquote") {
    return TOKENS.blockSpacing.blockquote.$value;
  }
  if (type === "table") {
    return TOKENS.blockSpacing.table.$value;
  }
  // Default spacing
  return TOKENS.spacing.lg.$value;
}

/**
 * Create a blockquote frame from a node.
 * Styled container with left border.
 */
async function createBlockquoteFrame(node) {
  var frame = figma.createFrame();
  frame.name = "Blockquote";
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";    // Hug height
  frame.counterAxisSizingMode = "FIXED";   // Fixed width for reading measure
  frame.resize(TOKENS.measure.default.$value, 100);
  frame.itemSpacing = TOKENS.spacing.sm.$value;
  frame.paddingLeft = TOKENS.blockquote.paddingLeft.$value;
  frame.paddingRight = TOKENS.blockquote.paddingRight.$value;
  frame.paddingTop = TOKENS.blockquote.paddingY.$value;
  frame.paddingBottom = TOKENS.blockquote.paddingY.$value;
  
  // Background and border
  frame.fills = [{ type: "SOLID", color: COLORS.blockquoteBg }];
  frame.strokes = [{ type: "SOLID", color: COLORS.blockquoteBorder }];
  frame.strokeAlign = "INSIDE";
  // Use individual stroke weights for left-border only effect
  frame.strokeTopWeight = 0;
  frame.strokeRightWeight = 0;
  frame.strokeBottomWeight = 0;
  frame.strokeLeftWeight = TOKENS.blockquote.borderWidth.$value;
  frame.cornerRadius = TOKENS.radius.sm.$value;
  
  // Create text node for quote content
  var textNode = figma.createText();
  textNode.name = "Quote Text";
  
  // Try to load italic serif font
  try {
    await figma.loadFontAsync(FONT_SERIF_ITALIC);
    textNode.fontName = FONT_SERIF_ITALIC;
  } catch (e) {
    try {
      await figma.loadFontAsync(FONT_SERIF);
      textNode.fontName = FONT_SERIF;
    } catch (e2) {
      await figma.loadFontAsync(DEFAULT_FONT);
      textNode.fontName = DEFAULT_FONT;
    }
  }
  
  textNode.fontSize = TYPE_RAMP.blockquote.fontSize;
  textNode.lineHeight = { value: TYPE_RAMP.blockquote.lineHeightPx, unit: "PIXELS" };
  textNode.fills = [{ type: "SOLID", color: COLORS.textMuted }];
  
  // Apply content with inline formatting
  await applyInlineFormatting(textNode, node.content);
  
  // Width determined by FILL sizing in fixed-width parent
  textNode.textAutoResize = "HEIGHT";
  
  frame.appendChild(textNode);
  textNode.layoutSizingHorizontal = "FILL";
  textNode.layoutSizingVertical = "HUG";
  
  return frame;
}

/**
 * Create a table frame from a node.
 * Uses Frame-based approach (no native Table API in Figma plugins).
 */
async function createTableFrame(node, mainComponents) {
  var rows = node.rows || [];
  var alignments = node.alignments || [];
  var hasHeader = node.hasHeader;
  
  if (rows.length === 0) return null;
  
  var columnCount = rows[0].length;
  var minCellWidth = TOKENS.table.minCellWidth.$value;
  
  // Get Table Cell component set
  var tableCellSet = mainComponents ? mainComponents["tableCell"] : null;
  var headerVariant = null;
  var bodyVariant = null;
  
  if (tableCellSet && tableCellSet.children) {
    for (var i = 0; i < tableCellSet.children.length; i++) {
      var child = tableCellSet.children[i];
      if (child.name === "Type=Header") {
        headerVariant = child;
      } else if (child.name === "Type=Body") {
        bodyVariant = child;
      }
    }
  }
  
  // Create main table container
  var tableFrame = figma.createFrame();
  tableFrame.name = "Table";
  tableFrame.layoutMode = "VERTICAL";
  tableFrame.itemSpacing = 0;
  tableFrame.paddingLeft = 0;
  tableFrame.paddingRight = 0;
  tableFrame.paddingTop = 0;
  tableFrame.paddingBottom = 0;
  tableFrame.fills = [{ type: "SOLID", color: COLORS.page }];
  tableFrame.cornerRadius = TOKENS.radius.md.$value;
  tableFrame.clipsContent = true;
  
  // Set table width based on column count
  var tableWidth = Math.min(columnCount * minCellWidth, CONTENT_WIDTH);
  tableFrame.resize(tableWidth, 100);
  tableFrame.primaryAxisSizingMode = "AUTO";     // Hug height
  tableFrame.counterAxisSizingMode = "FIXED";    // Fixed width
  
  // Load fonts for inline formatting
  try { await figma.loadFontAsync(FONT_SANS); } catch (e) {}
  try { await figma.loadFontAsync(FONT_SANS_SEMIBOLD); } catch (e) {}
  
  // Create rows
  for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    var rowData = rows[rowIndex];
    var isHeader = hasHeader && rowIndex === 0;
    
    var rowFrame = figma.createFrame();
    rowFrame.name = "Row " + (rowIndex + 1) + (isHeader ? " (Header)" : "");
    rowFrame.layoutMode = "HORIZONTAL";
    rowFrame.itemSpacing = 0;
    rowFrame.paddingLeft = 0;
    rowFrame.paddingRight = 0;
    rowFrame.paddingTop = 0;
    rowFrame.paddingBottom = 0;
    rowFrame.fills = [];
    
    // Create cells for this row
    for (var cellIndex = 0; cellIndex < rowData.length; cellIndex++) {
      var cellText = rowData[cellIndex];
      var alignment = alignments[cellIndex] || "left";
      
      // Select appropriate variant
      var variant = isHeader ? headerVariant : bodyVariant;
      var cellFrame;
      
      if (variant) {
        // Use component instance
        cellFrame = variant.createInstance();
        cellFrame.name = "Cell " + (rowIndex + 1) + "-" + (cellIndex + 1);
        
        // Apply alignment to instance
        if (alignment === "center") {
          cellFrame.counterAxisAlignItems = "CENTER";
        } else if (alignment === "right") {
          cellFrame.counterAxisAlignItems = "MAX";
        } else {
          cellFrame.counterAxisAlignItems = "MIN";
        }
        
        // Find and update text content
        var textNode = findTextNode(cellFrame);
        if (textNode && cellText.trim()) {
          await applyInlineFormatting(textNode, cellText);
        } else if (textNode && !cellText.trim()) {
          textNode.characters = "";
        }
      } else {
        // Fallback: create raw frame if component not available
        cellFrame = figma.createFrame();
        cellFrame.name = "Cell " + (rowIndex + 1) + "-" + (cellIndex + 1);
        cellFrame.layoutMode = "VERTICAL";
        cellFrame.primaryAxisAlignItems = "CENTER";
        
        if (alignment === "center") {
          cellFrame.counterAxisAlignItems = "CENTER";
        } else if (alignment === "right") {
          cellFrame.counterAxisAlignItems = "MAX";
        } else {
          cellFrame.counterAxisAlignItems = "MIN";
        }
        
        var cellPadding = TOKENS.table.cellPadding.$value;
        var borderWidth = TOKENS.table.borderWidth.$value;
        cellFrame.paddingLeft = cellPadding;
        cellFrame.paddingRight = cellPadding;
        cellFrame.paddingTop = cellPadding;
        cellFrame.paddingBottom = cellPadding;
        
        var bgColor = isHeader ? COLORS.tableHeaderBg : COLORS.page;
        cellFrame.fills = [{ type: "SOLID", color: bgColor }];
        cellFrame.strokes = [{ type: "SOLID", color: COLORS.tableBorder }];
        cellFrame.strokeAlign = "INSIDE";
        cellFrame.strokeTopWeight = 0;
        cellFrame.strokeRightWeight = 0;
        cellFrame.strokeBottomWeight = borderWidth;
        cellFrame.strokeLeftWeight = 0;
        
        if (cellText.trim()) {
          var textNode = figma.createText();
          textNode.fontName = isHeader ? FONT_SANS_SEMIBOLD : FONT_SANS;
          textNode.fontSize = TYPE_RAMP.tableCell.fontSize;
          textNode.lineHeight = { value: TYPE_RAMP.tableCell.lineHeightPx, unit: "PIXELS" };
          textNode.fills = [{ type: "SOLID", color: COLORS.text }];
          await applyInlineFormatting(textNode, cellText);
          textNode.textAutoResize = "WIDTH_AND_HEIGHT";
          cellFrame.appendChild(textNode);
          textNode.layoutSizingHorizontal = "FILL";
          textNode.layoutSizingVertical = "HUG";
        }
      }
      
      rowFrame.appendChild(cellFrame);
      cellFrame.layoutSizingHorizontal = "FILL";
      cellFrame.layoutSizingVertical = "FILL";
    }
    
    tableFrame.appendChild(rowFrame);
    rowFrame.layoutSizingHorizontal = "FILL";
    rowFrame.layoutSizingVertical = "HUG";
  }
  
  return tableFrame;
}

/**
 * Create an instance from an AST node.
 * The instance is a copy of the main component, filled with actual content.
 */
async function createInstanceFromNode(node, mainComponents, imageData) {
  // Handle tables (creates frame structure with cell instances)
  if (node.type === "table") {
    return await createTableFrame(node, mainComponents);
  }
  
  // Handle blockquotes (create instance of blockquote component)
  if (node.type === "blockquote") {
    var blockquoteComponent = mainComponents["blockquote"];
    if (blockquoteComponent) {
      var instance = blockquoteComponent.createInstance();
      var textNode = findTextNode(instance);
      if (textNode && node.content) {
        await applyInlineFormatting(textNode, node.content);
      }
      // Set width to content width
      instance.resize(TOKENS.measure.default.$value, instance.height);
      return instance;
    }
    // Fallback to raw frame if component not found
    return await createBlockquoteFrame(node);
  }
  
  // Handle ordered lists - use Figma's ordered list style
  if (node.type === "ol") {
    console.log("Creating ordered list item: " + (node.content ? node.content.slice(0, 50) : "(empty)"));
    var olComponent = mainComponents["ol"];
    if (!olComponent) {
      console.error("Missing 'ol' component!");
      return null;
    }
    var instance = olComponent.createInstance();
    var textNode = findTextNode(instance);
    if (textNode && node.content) {
      // Set content without manual number prefix - Figma handles numbering
      await applyInlineFormatting(textNode, node.content);
      // Re-apply ordered list style after content change
      textNode.setRangeListOptions(0, textNode.characters.length, { type: "ORDERED" });
    }
    return instance;
  }
  
  // Handle unordered list items - use Figma's unordered list style
  if (node.type === "li") {
    console.log("Creating unordered list item: " + (node.content ? node.content.slice(0, 50) : "(empty)"));
    var liComponent = mainComponents["li"];
    if (!liComponent) {
      console.error("Missing 'li' component!");
      return null;
    }
    var instance = liComponent.createInstance();
    var textNode = findTextNode(instance);
    if (textNode && node.content) {
      // Set content without manual bullet - Figma handles bullets
      await applyInlineFormatting(textNode, node.content);
      // Re-apply unordered list style after content change
      textNode.setRangeListOptions(0, textNode.characters.length, { type: "UNORDERED" });
    }
    return instance;
  }
  
  // Handle images from tar file - clone source frame from Images page
  // Block wrapper provides the container; we just need the image frame
  if (node.type === "image") {
    var filename = extractFilename(node.path);
    var sourceFrame = imageData.sourceFrames[filename];
    
    if (!sourceFrame) {
      // No source frame found, create placeholder
      console.warn("No source frame for: " + filename);
      var placeholder = figma.createFrame();
      placeholder.name = "Image: " + filename + " (missing)";
      placeholder.resize(400, 225);  // 16:9 placeholder
      placeholder.fills = [{ type: "SOLID", color: COLORS.placeholder }];
      placeholder.cornerRadius = TOKENS.radius.sm.$value;
      return placeholder;
    }
    
    // Clone the source frame from Images page
    var imageFrame = sourceFrame.clone();
    imageFrame.name = "Image: " + filename;
    
    return imageFrame;
  }

  // Handle paragraphs using Text Layout component with Normal tracking and leading (default)
  if (node.type === "p") {
    var textLayoutSet = mainComponents["textLayout"];
    if (textLayoutSet && textLayoutSet.type === "COMPONENT_SET") {
      // Find the Normal/Normal variant (default)
      var defaultVariant = null;
      for (var i = 0; i < textLayoutSet.children.length; i++) {
        if (textLayoutSet.children[i].name === "Tracking=Normal, Leading=Normal") {
          defaultVariant = textLayoutSet.children[i];
          break;
        }
      }
      if (defaultVariant) {
        var instance = defaultVariant.createInstance();
        var textNode = findTextNode(instance);
        if (textNode && node.content) {
          // Parse and style inline links
          await applyTextWithInlineLinks(textNode, node.content);
        }
        return instance;
      }
    }
    // Fall back to Paragraph component
  }

  // Handle text nodes (h1, h2, p, li, code, link, note, etc.)
  var mainComponent = mainComponents[node.type];
  if (!mainComponent) {
    console.warn("No main component for type: " + node.type);
    return null;
  }

  // Create instance of the main component
  var instance = mainComponent.createInstance();

  // Find the text node in the instance and set its content
  var textNode = findTextNode(instance);
  if (textNode && node.content) {
    // Apply inline formatting (links, bold, italic, code) for any text content
    await applyInlineFormatting(textNode, node.content);
  }

  return instance;
}

/**
 * Parse inline formatting from markdown text.
 * Handles: **bold**, *italic*, `code`, ~~strikethrough~~, [links](url)
 * Returns array of segments with text, position, and formatting flags.
 */
function parseInlineFormatting(content) {
  // Guard against null/undefined/empty content
  if (!content || content.length === 0) {
    return [{ text: "", start: 0, end: 0 }];
  }
  
  var segments = [];
  
  // Interface for detected patterns
  var patterns = [];
  var match;
  
  // 1. Find links [text](url)
  var linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(content)) !== null) {
    // Strip any markdown formatting from link text
    var linkText = match[1];
    linkText = linkText.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
    linkText = linkText.replace(/\*\*([^*]+)\*\*/g, "$1");
    linkText = linkText.replace(/\*([^*]+)\*/g, "$1");
    linkText = linkText.replace(/`([^`]+)`/g, "$1");
    
    patterns.push({
      type: "link",
      start: match.index,
      end: match.index + match[0].length,
      content: linkText,
      url: match[2],
      originalLength: match[0].length
    });
  }
  
  // Helper to check if position is inside a link
  function isInsideLink(pos) {
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      if (p.type === "link" && pos >= p.start && pos < p.end) return true;
    }
    return false;
  }
  
  // 2. Find inline code `code`
  var codeRegex = /`([^`]+)`/g;
  while ((match = codeRegex.exec(content)) !== null) {
    if (!isInsideLink(match.index)) {
      patterns.push({
        type: "code",
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        originalLength: match[0].length
      });
    }
  }
  
  // Check if overlaps existing pattern
  function overlapsExisting(pos) {
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      if (pos >= p.start && pos < p.end) return true;
    }
    return false;
  }
  
  // 3. Find bold+italic ***text***
  var boldItalicRegex = /\*\*\*([^*]+)\*\*\*/g;
  while ((match = boldItalicRegex.exec(content)) !== null) {
    if (!overlapsExisting(match.index)) {
      patterns.push({
        type: "bolditalic",
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        isBold: true,
        isItalic: true,
        originalLength: match[0].length
      });
    }
  }
  
  // 4. Find bold **text**
  var boldRegex = /\*\*([^*]+)\*\*/g;
  while ((match = boldRegex.exec(content)) !== null) {
    if (!overlapsExisting(match.index)) {
      patterns.push({
        type: "bold",
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        isBold: true,
        originalLength: match[0].length
      });
    }
  }
  
  // 5. Find italic *text*
  var italicRegex = /\*([^*]+)\*/g;
  while ((match = italicRegex.exec(content)) !== null) {
    if (!overlapsExisting(match.index)) {
      patterns.push({
        type: "italic",
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        isItalic: true,
        originalLength: match[0].length
      });
    }
  }
  
  // 6. Find strikethrough ~~text~~
  var strikeRegex = /~~([^~]+)~~/g;
  while ((match = strikeRegex.exec(content)) !== null) {
    if (!overlapsExisting(match.index)) {
      patterns.push({
        type: "strike",
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        isStrike: true,
        originalLength: match[0].length
      });
    }
  }
  
  // Sort patterns by start position
  patterns.sort(function(a, b) { return a.start - b.start; });
  
  // Build final segments with correct positions
  var currentInputPos = 0;
  var currentOutputPos = 0;
  
  for (var i = 0; i < patterns.length; i++) {
    var pattern = patterns[i];
    
    // Add text before this pattern
    if (pattern.start > currentInputPos) {
      var beforeText = content.slice(currentInputPos, pattern.start);
      if (beforeText) {
        segments.push({
          text: beforeText,
          start: currentOutputPos,
          end: currentOutputPos + beforeText.length
        });
        currentOutputPos += beforeText.length;
      }
    }
    
    // Add the pattern segment
    segments.push({
      text: pattern.content,
      start: currentOutputPos,
      end: currentOutputPos + pattern.content.length,
      isLink: pattern.type === "link",
      linkUrl: pattern.url,
      isBold: pattern.isBold,
      isItalic: pattern.isItalic,
      isCode: pattern.type === "code",
      isStrike: pattern.isStrike
    });
    
    currentOutputPos += pattern.content.length;
    currentInputPos = pattern.end;
  }
  
  // Add remaining text after last pattern
  if (currentInputPos < content.length) {
    var remainingText = content.slice(currentInputPos);
    if (remainingText) {
      segments.push({
        text: remainingText,
        start: currentOutputPos,
        end: currentOutputPos + remainingText.length
      });
    }
  }
  
  return segments.length > 0 ? segments : [{ text: content, start: 0, end: content.length }];
}

/**
 * Apply inline formatting (bold, italic, code, links, strikethrough) to a text node.
 * Uses Figma's range-based APIs for mixed formatting within a single text node.
 * MUST be called async - loads fonts before applying them.
 */
async function applyInlineFormatting(textNode, content) {
  // Guard against null/undefined content
  if (!content) {
    textNode.characters = "";
    return;
  }
  
  // Parse into segments
  var segments = parseInlineFormatting(content);
  
  // Build plain text
  var plainText = "";
  for (var i = 0; i < segments.length; i++) {
    plainText += segments[i].text;
  }
  
  // Set the plain text first
  textNode.characters = plainText;
  
  // If only one segment with no formatting, we're done
  if (segments.length === 1 && !segments[0].isLink && !segments[0].isBold && 
      !segments[0].isItalic && !segments[0].isCode && !segments[0].isStrike) {
    return;
  }
  
  // Apply formatting to each segment
  for (var j = 0; j < segments.length; j++) {
    var seg = segments[j];
    
    try {
      // Bold + Italic formatting - must load font first
      if (seg.isBold && seg.isItalic) {
        try {
          await figma.loadFontAsync(FONT_SERIF_BOLD_ITALIC);
          textNode.setRangeFontName(seg.start, seg.end, FONT_SERIF_BOLD_ITALIC);
        } catch (fontErr) {
          console.warn("Could not load bold italic font, trying fallback");
          try {
            await figma.loadFontAsync(FONT_SERIF_BOLD);
            textNode.setRangeFontName(seg.start, seg.end, FONT_SERIF_BOLD);
          } catch (e) { /* ignore */ }
        }
      } else if (seg.isBold) {
        try {
          await figma.loadFontAsync(FONT_SERIF_BOLD);
          textNode.setRangeFontName(seg.start, seg.end, FONT_SERIF_BOLD);
        } catch (fontErr) {
          console.warn("Could not load bold font");
        }
      } else if (seg.isItalic) {
        try {
          await figma.loadFontAsync(FONT_SERIF_ITALIC);
          textNode.setRangeFontName(seg.start, seg.end, FONT_SERIF_ITALIC);
        } catch (fontErr) {
          console.warn("Could not load italic font");
        }
      }
      
      // Code formatting (monospace)
      if (seg.isCode) {
        try {
          await figma.loadFontAsync(FONT_MONO);
          textNode.setRangeFontName(seg.start, seg.end, FONT_MONO);
        } catch (fontErr) {
          // Try fallback
          try {
            await figma.loadFontAsync(CODE_FONT);
            textNode.setRangeFontName(seg.start, seg.end, CODE_FONT);
          } catch (e) { /* ignore */ }
        }
        textNode.setRangeFills(seg.start, seg.end, [{ type: "SOLID", color: COLORS.text }]);
      }
      
      // Strikethrough
      if (seg.isStrike) {
        textNode.setRangeTextDecoration(seg.start, seg.end, "STRIKETHROUGH");
      }
      
      // Link formatting
      if (seg.isLink) {
        textNode.setRangeFills(seg.start, seg.end, [{ type: "SOLID", color: COLORS.link }]);
        textNode.setRangeTextDecoration(seg.start, seg.end, "UNDERLINE");
        // Apply hyperlink
        if (seg.linkUrl) {
          try {
            textNode.setRangeHyperlink(seg.start, seg.end, { type: "URL", value: seg.linkUrl });
          } catch (linkErr) {
            console.warn("Could not set hyperlink: " + linkErr.message);
          }
        }
      }
    } catch (e) {
      console.warn("Failed to apply formatting to segment: " + e.message);
    }
  }
}

// Legacy function name for backward compatibility
async function applyTextWithInlineLinks(textNode, content) {
  await applyInlineFormatting(textNode, content);
}

/**
 * Find a rectangle in any node (recursive)
 */
function findRectangleInNode(node) {
  if (node.type === "RECTANGLE") return node;
  if ("children" in node) {
    for (var i = 0; i < node.children.length; i++) {
      var found = findRectangleInNode(node.children[i]);
      if (found) return found;
    }
  }
  return null;
}

// ============================================================================
// UTILITIES
// ============================================================================

async function getOrCreatePage(name) {
  for (const page of figma.root.children) {
    if (page.name === name) {
      await page.loadAsync();
      return page;
    }
  }
  const page = figma.createPage();
  page.name = name;
  return page;
}

function findTextNode(node) {
  if (node.type === "TEXT") return node;
  if ("children" in node) {
    for (const child of node.children) {
      const found = findTextNode(child);
      if (found) return found;
    }
  }
  return null;
}

function findClearPosition() {
  const padding = 50;
  const start = { x: 100, y: 100 };

  if (!figma.currentPage || !figma.currentPage.children || figma.currentPage.children.length === 0) {
    return start;
  }

  let maxRight = start.x;
  for (const child of figma.currentPage.children) {
    if (child.absoluteBoundingBox) {
      const right = child.absoluteBoundingBox.x + child.absoluteBoundingBox.width;
      maxRight = Math.max(maxRight, right);
    }
  }

  return { x: maxRight + padding, y: start.y };
}

function extractFilename(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.substring(slash + 1);
}

function scaleToFit(width, height, maxWidth) {
  if (width <= maxWidth) return { width: width, height: height };
  const scale = maxWidth / width;
  return { width: maxWidth, height: height * scale };
}

function getImageDimensions(data) {
  // PNG signature: 89 50 4E 47
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    if (data.length >= 24) {
      const w = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
      const h = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
      return { width: w, height: h };
    }
  }
  // JPEG signature: FF D8 FF
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    return { width: 800, height: 600 }; // JPEG parsing is complex
  }
  return { width: 400, height: 300 };
}

// ============================================================================
// TAR EXTRACTION
// ============================================================================

function extractTar(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const markdownData = extractFileFromTar(data, "content.md");
  return {
    markdown: markdownData ? decodeUtf8(markdownData) : null,
    images: extractImagesFromTar(data),
  };
}
function extractFileFromTar(data, filename) {
  // Tar files have 512-byte header blocks
  const BLOCK_SIZE = 512;
  let offset = 0;

  while (offset < data.length - BLOCK_SIZE) {
    // Read filename (first 100 bytes of header)
    const headerName = decodeUtf8(data.slice(offset, offset + 100))
      .split("\0")[0];

    if (headerName === filename) {
      // File found, read size from header (offset 124, 12 bytes, octal)
      const sizeStr = decodeUtf8(data.slice(offset + 124, offset + 136))
        .trim();
      const fileSize = parseInt(sizeStr, 8);

      // File data starts after header block
      const fileData = data.slice(offset + BLOCK_SIZE, offset + BLOCK_SIZE + fileSize);
      return fileData;
    }

    // Move to next block (file data + padding + next header)
    const sizeStr = decodeUtf8(data.slice(offset + 124, offset + 136))
      .trim();
    const fileSize = parseInt(sizeStr, 8);
    const blocksUsed = Math.ceil(fileSize / BLOCK_SIZE) + 1;
    offset += blocksUsed * BLOCK_SIZE;
  }

  return null;
}

/**
 * Extract all image files from tar (images/ directory)
 * Returns object mapping filename -> Uint8Array data
 */
function extractImagesFromTar(data) {
  const BLOCK_SIZE = 512;
  let offset = 0;
  const images = {};

  while (offset < data.length - BLOCK_SIZE) {
    // Read filename (first 100 bytes of header)
    const headerName = decodeUtf8(data.slice(offset, offset + 100))
      .split("\0")[0];

    // Check if file is in images/ directory
    if (headerName.startsWith("images/") && headerName.length > "images/".length) {
      // Extract the filename part (without directory)
      const filename = extractFilename(headerName);

      // Read size from header (offset 124, 12 bytes, octal)
      const sizeStr = decodeUtf8(data.slice(offset + 124, offset + 136))
        .trim();
      const fileSize = parseInt(sizeStr, 8);

      // File data starts after header block
      const fileData = data.slice(offset + BLOCK_SIZE, offset + BLOCK_SIZE + fileSize);
      images[filename] = fileData;
    }

    // Move to next block
    const sizeStr = decodeUtf8(data.slice(offset + 124, offset + 136))
      .trim();
    const fileSize = parseInt(sizeStr, 8);
    const blocksUsed = Math.ceil(fileSize / BLOCK_SIZE) + 1;
    offset += blocksUsed * BLOCK_SIZE;
  }

  return images;
}

// ============================================================================
// MARKDOWN PARSING
// ============================================================================

function parseMarkdown(text) {
  var lines = text.split("\n");
  var ast = [];
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];
    var trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine) {
      i++;
      continue;
    }

    // Headings H1-H6 (order matters - check longer prefixes first)
    if (trimmedLine.startsWith("###### ")) {
      ast.push({ type: "h6", content: trimmedLine.slice(7).trim() });
    } else if (trimmedLine.startsWith("##### ")) {
      ast.push({ type: "h5", content: trimmedLine.slice(6).trim() });
    } else if (trimmedLine.startsWith("#### ")) {
      ast.push({ type: "h4", content: trimmedLine.slice(5).trim() });
    } else if (trimmedLine.startsWith("### ")) {
      ast.push({ type: "h3", content: trimmedLine.slice(4).trim() });
    } else if (trimmedLine.startsWith("## ")) {
      ast.push({ type: "h2", content: trimmedLine.slice(3).trim() });
    } else if (trimmedLine.startsWith("# ")) {
      ast.push({ type: "h1", content: trimmedLine.slice(2).trim() });
    
    // Blockquotes (> prefix)
    } else if (trimmedLine.startsWith("> ")) {
      var quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2).trim());
        i++;
      }
      i--; // Back up one since we'll increment at end of loop
      ast.push({ type: "blockquote", content: quoteLines.join("\n") });
    
    // Unordered lists (- or * or · middle dot)
    } else if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ") || trimmedLine.startsWith("· ")) {
      var liContent = trimmedLine.slice(2).trim();
      console.log("Parsed list item [" + i + "]: " + liContent.slice(0, 40) + "...");
      ast.push({ type: "li", content: liContent });
    
    // Ordered lists (1. 2. etc)
    } else if (/^\d+\.\s/.test(trimmedLine)) {
      var olMatch = trimmedLine.match(/^(\d+)\.\s(.*)$/);
      if (olMatch) {
        console.log("Parsed ordered list item [" + i + "]: " + olMatch[2].slice(0, 40) + "...");
        ast.push({ type: "ol", index: parseInt(olMatch[1], 10), content: olMatch[2].trim() });
      }
    
    // Code blocks
    } else if (trimmedLine.startsWith("```")) {
      var codeLines = [];
      var lang = trimmedLine.slice(3).trim(); // Language identifier after ```
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      ast.push({ type: "code", content: codeLines.join("\n"), language: lang || null });
    
    // Tables (| col | col |)
    } else if (trimmedLine.startsWith("|") && trimmedLine.endsWith("|")) {
      var tableRows = [];
      var alignments = [];
      var hasHeader = false;
      
      // Collect all table rows
      while (i < lines.length) {
        var tableLine = lines[i].trim();
        if (!tableLine.startsWith("|") || !tableLine.endsWith("|")) break;
        
        // Check if this is a separator line (|---|---|)
        if (isTableSeparatorLine(tableLine)) {
          hasHeader = tableRows.length > 0;
          alignments = parseTableAlignments(tableLine);
          i++;
          continue;
        }
        
        // Parse cells from this row
        var cells = parseTableRow(tableLine);
        tableRows.push(cells);
        i++;
      }
      i--; // Back up one
      
      if (tableRows.length > 0) {
        ast.push({ 
          type: "table", 
          rows: tableRows,
          alignments: alignments,
          hasHeader: hasHeader
        });
      }
    
    // Images
    } else if (/^!\[([^\]]*)\]\(([^)]+)\)$/.test(trimmedLine)) {
      var imgMatch = trimmedLine.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      ast.push({ type: "image", alt: imgMatch[1], path: imgMatch[2] });
    
    // Regular paragraphs
    } else {
      ast.push({ type: "p", content: trimmedLine });
    }
    
    i++;
  }

  return ast;
}

/**
 * Check if a line is a table separator (|---|---|)
 */
function isTableSeparatorLine(line) {
  var trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  
  var cells = trimmed.slice(1, -1).split("|");
  return cells.every(function(cell) {
    var c = cell.trim();
    return /^:?-+:?$/.test(c);
  });
}

/**
 * Parse table column alignments from separator line
 */
function parseTableAlignments(line) {
  var trimmed = line.trim();
  var cells = trimmed.slice(1, -1).split("|");
  
  return cells.map(function(cell) {
    var c = cell.trim();
    if (c.startsWith(":") && c.endsWith(":")) return "center";
    if (c.endsWith(":")) return "right";
    return "left";
  });
}

/**
 * Parse a table row into cells (strips leading/trailing pipes)
 */
function parseTableRow(line) {
  var trimmed = line.trim();
  var content = trimmed.slice(1, -1); // Remove leading/trailing |
  
  var cells = [];
  var current = "";
  var i = 0;
  
  while (i < content.length) {
    var char = content[i];
    
    if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else if (char === "\\" && i + 1 < content.length) {
      // Escape character
      var nextChar = content[i + 1];
      if (nextChar === "|" || nextChar === "\\") {
        current += nextChar;
        i++;
      } else {
        current += char;
      }
    } else {
      current += char;
    }
    i++;
  }
  
  // Last cell
  cells.push(current.trim());
  
  return cells;
}

// ============================================================================
// SHA-1 HASHING (for debug comparison)
// ============================================================================

async function sha1(arrayBuffer) {
  // Use SubtleCrypto if available, otherwise simple checksum
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-1', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // Fall through to simple checksum
    }
  }
  // Fallback: simple checksum (not SHA-1, but good enough for comparison)
  const data = new Uint8Array(arrayBuffer);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum = (sum + data[i]) & 0xffffffff;
  }
  return 'checksum-' + sum.toString(16);
}

// ============================================================================
// UTF-8 DECODING (TextDecoder not available in Figma runtime)
// ============================================================================

function decodeUtf8(bytes) {
  if (!bytes) return "";
  var result = "";
  var i = 0;
  while (i < bytes.length) {
    var b1 = bytes[i++];
    if ((b1 & 0x80) === 0) {
      result += String.fromCharCode(b1);
    } else if ((b1 & 0xE0) === 0xC0) {
      result += String.fromCharCode(((b1 & 0x1F) << 6) | (bytes[i++] & 0x3F));
    } else if ((b1 & 0xF0) === 0xE0) {
      result += String.fromCharCode(((b1 & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
    } else if ((b1 & 0xF8) === 0xF0) {
      i += 3; // Skip 4-byte chars
    }
  }
  return result;
}
