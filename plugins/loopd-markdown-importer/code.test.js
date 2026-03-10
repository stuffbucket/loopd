// Tests for the bare markdown import code path
//
// Extracts pure functions from code.js (which runs in Figma's sandbox)
// and verifies the new markdown import logic in Node.js.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ============================================================================
// Extract pure functions from code.js by eval-ing them in isolation.
// These have no Figma API dependencies.
// ============================================================================

// --- extractFilename ---
function extractFilename(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.substring(slash + 1);
}

// --- scaleToFit ---
function scaleToFit(width, height, maxWidth) {
  if (width <= maxWidth) return { width: width, height: height };
  const scale = maxWidth / width;
  return { width: maxWidth, height: height * scale };
}

// --- decodeUtf8 ---
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
      i += 3;
    }
  }
  return result;
}

// --- PLACEHOLDER_ASPECTS ---
var PLACEHOLDER_ASPECTS = [
  { name: "16:10 (MacBook)",  width: 1440, height: 900 },
  { name: "16:9 (Desktop)",   width: 1920, height: 1080 },
  { name: "3:2 (Surface)",    width: 1500, height: 1000 },
  { name: "4:3 (iPad)",       width: 1024, height: 768 },
  { name: "21:9 (Ultrawide)", width: 2520, height: 1080 }
];

// --- generatePlaceholderImage ---
function generatePlaceholderImage(index) {
  var aspect = PLACEHOLDER_ASPECTS[index % PLACEHOLDER_ASPECTS.length];
  return {
    width: aspect.width,
    height: aspect.height,
    label: aspect.name
  };
}

// --- parseMarkdown (copied from code.js) ---
function parseMarkdown(text) {
  var lines = text.split("\n");
  var ast = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    var trimmedLine = line.trim();
    if (!trimmedLine) { i++; continue; }
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
    } else if (trimmedLine.startsWith("> ")) {
      var quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2).trim());
        i++;
      }
      i--;
      ast.push({ type: "blockquote", content: quoteLines.join("\n") });
    } else if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ") || trimmedLine.startsWith("· ")) {
      ast.push({ type: "li", content: trimmedLine.slice(2).trim() });
    } else if (/^\d+\.\s/.test(trimmedLine)) {
      var olMatch = trimmedLine.match(/^(\d+)\.\s(.*)$/);
      if (olMatch) {
        ast.push({ type: "ol", index: parseInt(olMatch[1], 10), content: olMatch[2].trim() });
      }
    } else if (trimmedLine.startsWith("```")) {
      var codeLines = [];
      var lang = trimmedLine.slice(3).trim();
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      ast.push({ type: "code", content: codeLines.join("\n"), language: lang || null });
    } else if (/^!\[([^\]]*)\]\(([^)]+)\)$/.test(trimmedLine)) {
      var imgMatch = trimmedLine.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      ast.push({ type: "image", alt: imgMatch[1], path: imgMatch[2] });
    } else {
      ast.push({ type: "p", content: trimmedLine });
    }
    i++;
  }
  return ast;
}

// --- Simulate the image-collection logic from handleMarkdownImport ---
function collectPlaceholderImages(ast) {
  var images = {};
  var placeholderIndex = 0;
  for (var i = 0; i < ast.length; i++) {
    if (ast[i].type === "image") {
      var filename = extractFilename(ast[i].path);
      if (!images[filename]) {
        images[filename] = generatePlaceholderImage(placeholderIndex++);
      }
    }
  }
  return images;
}

// ============================================================================
// TESTS
// ============================================================================

describe('generatePlaceholderImage', () => {
  test('returns correct aspect ratio for each index', () => {
    const p0 = generatePlaceholderImage(0);
    assert.equal(p0.width, 1440);
    assert.equal(p0.height, 900);
    assert.equal(p0.label, '16:10 (MacBook)');

    const p1 = generatePlaceholderImage(1);
    assert.equal(p1.width, 1920);
    assert.equal(p1.height, 1080);
    assert.equal(p1.label, '16:9 (Desktop)');

    const p4 = generatePlaceholderImage(4);
    assert.equal(p4.width, 2520);
    assert.equal(p4.height, 1080);
    assert.equal(p4.label, '21:9 (Ultrawide)');
  });

  test('cycles through aspects when index exceeds array length', () => {
    const p5 = generatePlaceholderImage(5);
    const p0 = generatePlaceholderImage(0);
    assert.deepEqual(p5, p0);

    const p7 = generatePlaceholderImage(7);
    const p2 = generatePlaceholderImage(2);
    assert.deepEqual(p7, p2);
  });

  test('returns object with width, height, and label', () => {
    for (let i = 0; i < 10; i++) {
      const p = generatePlaceholderImage(i);
      assert.equal(typeof p.width, 'number');
      assert.equal(typeof p.height, 'number');
      assert.equal(typeof p.label, 'string');
      assert.ok(p.width > 0);
      assert.ok(p.height > 0);
    }
  });
});

describe('parseMarkdown – image nodes', () => {
  test('parses standalone image reference', () => {
    const ast = parseMarkdown('![screenshot](images/screen.png)');
    assert.equal(ast.length, 1);
    assert.equal(ast[0].type, 'image');
    assert.equal(ast[0].alt, 'screenshot');
    assert.equal(ast[0].path, 'images/screen.png');
  });

  test('parses multiple images among other content', () => {
    const md = [
      '# Title',
      '',
      'Some text here.',
      '',
      '![first](images/a.png)',
      '',
      '## Section',
      '',
      '![second](images/b.jpg)',
      '',
      'More text.'
    ].join('\n');

    const ast = parseMarkdown(md);
    const images = ast.filter(n => n.type === 'image');
    assert.equal(images.length, 2);
    assert.equal(images[0].path, 'images/a.png');
    assert.equal(images[1].path, 'images/b.jpg');
  });

  test('does not parse inline image within paragraph text', () => {
    // Image syntax embedded in text is treated as paragraph
    const ast = parseMarkdown('Check this ![img](foo.png) out');
    assert.equal(ast.length, 1);
    assert.equal(ast[0].type, 'p');
  });
});

describe('collectPlaceholderImages', () => {
  test('generates one placeholder per unique image filename', () => {
    const md = [
      '![a](images/one.png)',
      '![b](images/two.png)',
      '![c](images/three.png)'
    ].join('\n');
    const ast = parseMarkdown(md);
    const images = collectPlaceholderImages(ast);

    assert.equal(Object.keys(images).length, 3);
    assert.ok(images['one.png']);
    assert.ok(images['two.png']);
    assert.ok(images['three.png']);
  });

  test('deduplicates repeated image references', () => {
    const md = [
      '![a](images/same.png)',
      '![b](images/same.png)',
      '![c](images/same.png)'
    ].join('\n');
    const ast = parseMarkdown(md);
    const images = collectPlaceholderImages(ast);

    assert.equal(Object.keys(images).length, 1);
    assert.ok(images['same.png']);
  });

  test('assigns different aspect ratios to different images', () => {
    const md = [
      '![a](images/a.png)',
      '![b](images/b.png)',
      '![c](images/c.png)'
    ].join('\n');
    const ast = parseMarkdown(md);
    const images = collectPlaceholderImages(ast);

    // First three should get different aspect ratios
    assert.notEqual(images['a.png'].label, images['b.png'].label);
    assert.notEqual(images['b.png'].label, images['c.png'].label);
  });

  test('returns empty map when no images in markdown', () => {
    const md = '# Hello\n\nJust text.';
    const ast = parseMarkdown(md);
    const images = collectPlaceholderImages(ast);
    assert.equal(Object.keys(images).length, 0);
  });

  test('extracts filename from deeply nested paths', () => {
    const md = '![x](some/deep/path/to/photo.png)';
    const ast = parseMarkdown(md);
    const images = collectPlaceholderImages(ast);
    assert.ok(images['photo.png']);
    assert.equal(Object.keys(images).length, 1);
  });
});

describe('scaleToFit', () => {
  test('does not scale images smaller than maxWidth', () => {
    const result = scaleToFit(800, 600, 1440);
    assert.equal(result.width, 800);
    assert.equal(result.height, 600);
  });

  test('scales images larger than maxWidth proportionally', () => {
    const result = scaleToFit(1920, 1080, 1440);
    assert.equal(result.width, 1440);
    assert.equal(result.height, 810);
  });

  test('preserves aspect ratio for ultrawide', () => {
    const result = scaleToFit(2520, 1080, 1440);
    assert.equal(result.width, 1440);
    // 1080 * (1440/2520) ≈ 617.14
    assert.ok(Math.abs(result.height - 617.14) < 0.1);
  });
});

describe('decodeUtf8', () => {
  test('decodes ASCII text from Uint8Array', () => {
    const bytes = new Uint8Array(Buffer.from('Hello, world!'));
    assert.equal(decodeUtf8(bytes), 'Hello, world!');
  });

  test('decodes multi-byte UTF-8 characters', () => {
    const bytes = new Uint8Array(Buffer.from('café'));
    assert.equal(decodeUtf8(bytes), 'café');
  });

  test('returns empty string for null input', () => {
    assert.equal(decodeUtf8(null), '');
  });

  test('returns empty string for undefined input', () => {
    assert.equal(decodeUtf8(undefined), '');
  });
});

describe('extractFilename', () => {
  test('extracts filename from path with slashes', () => {
    assert.equal(extractFilename('images/photo.png'), 'photo.png');
  });

  test('returns input when no slashes present', () => {
    assert.equal(extractFilename('photo.png'), 'photo.png');
  });

  test('handles deeply nested paths', () => {
    assert.equal(extractFilename('a/b/c/d/file.jpg'), 'file.jpg');
  });
});

describe('end-to-end: bare markdown → placeholder pipeline', () => {
  test('typical Loop export markdown produces correct placeholders', () => {
    const md = [
      '# Meeting Notes',
      '',
      '## Agenda',
      '',
      '- Item one',
      '- Item two',
      '',
      '![whiteboard](images/whiteboard-capture.png)',
      '',
      '## Action Items',
      '',
      '1. Follow up on design',
      '2. Review code',
      '',
      '![diagram](images/architecture-diagram.png)',
      '',
      '> [!NOTE]',
      '> Remember to share with team.',
      '',
      '![whiteboard](images/whiteboard-capture.png)',
    ].join('\n');

    const ast = parseMarkdown(md);
    const images = collectPlaceholderImages(ast);

    // 2 unique images (whiteboard-capture.png appears twice)
    assert.equal(Object.keys(images).length, 2);
    assert.ok(images['whiteboard-capture.png']);
    assert.ok(images['architecture-diagram.png']);

    // First image gets MacBook ratio, second gets Desktop ratio
    assert.equal(images['whiteboard-capture.png'].label, '16:10 (MacBook)');
    assert.equal(images['architecture-diagram.png'].label, '16:9 (Desktop)');

    // Dimensions are valid
    const CONTENT_WIDTH = 1440;
    for (const filename of Object.keys(images)) {
      const spec = images[filename];
      const scaled = scaleToFit(spec.width, spec.height, CONTENT_WIDTH);
      assert.ok(scaled.width <= CONTENT_WIDTH);
      assert.ok(scaled.width > 0);
      assert.ok(scaled.height > 0);
    }
  });

  test('markdown with no images produces zero placeholders', () => {
    const md = '# Just a heading\n\nParagraph text.\n\n- List item';
    const ast = parseMarkdown(md);
    const images = collectPlaceholderImages(ast);
    assert.equal(Object.keys(images).length, 0);
  });

  test('six images cycle back to first aspect ratio', () => {
    const lines = [];
    for (let i = 0; i < 6; i++) {
      lines.push(`![img${i}](images/img${i}.png)`);
    }
    const ast = parseMarkdown(lines.join('\n'));
    const images = collectPlaceholderImages(ast);

    assert.equal(Object.keys(images).length, 6);
    // 6th image (index 5) wraps to index 0
    assert.equal(images['img0.png'].label, images['img5.png'].label);
  });
});
