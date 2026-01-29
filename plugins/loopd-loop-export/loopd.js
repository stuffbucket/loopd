/**
 * loopd2.js - M365 Loop Exporter using remark ecosystem
 * 
 * Uses:
 * - Direct DOM → MDAST conversion (custom)
 * - remark-stringify: Serialize MDAST to Markdown string
 * - remark-gfm: GFM extensions (tables, task lists, strikethrough)
 * - unified: Processing pipeline orchestration
 */

(async function() {
  'use strict';
  
  console.log('loopd2: Loading remark ecosystem from esm.sh...');
  
  // ============================================================
  // Dynamic imports from esm.sh CDN
  // ============================================================
  
  const { unified } = await import('https://esm.sh/unified@11');
  const remarkStringify = (await import('https://esm.sh/remark-stringify@11')).default;
  const remarkGfm = (await import('https://esm.sh/remark-gfm@4')).default;
  const { visit } = await import('https://esm.sh/unist-util-visit@5');
  const { remove } = await import('https://esm.sh/unist-util-remove@4');
  
  console.log('loopd2: Remark ecosystem loaded successfully');
  
  // ============================================================
  // IndexedDB for image storage (reused from loopd.js)
  // ============================================================
  
  const DB_NAME = 'LoopExportDB2';
  const STORE_NAME = 'images';
  let db;
  
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onerror = () => reject(new Error('Failed to open IndexedDB'));
      request.onsuccess = () => { db = request.result; resolve(); };
      request.onupgradeneeded = (event) => {
        const dbInstance = event.target.result;
        if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
          dbInstance.createObjectStore(STORE_NAME, { keyPath: 'url' });
        }
      };
    });
  }
  
  function storeImage(url, blob) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ url, blob }).onerror = reject;
      tx.oncomplete = resolve;
    });
  }
  
  function getImage(url) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(url);
      request.onerror = reject;
      request.onsuccess = () => resolve(request.result);
    });
  }
  
  function clearDB() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear().onerror = reject;
      tx.oncomplete = resolve;
    });
  }
  
  // ============================================================
  // DOM Visitor Pattern (reused from loopd.js)
  // ============================================================
  
  function visitAllNodes(callback) {
    function visit(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        callback(node);
        if (node.shadowRoot) {
          visit(node.shadowRoot);
        }
      }
      const children = node.childNodes || node.children || [];
      for (let i = 0; i < children.length; i++) {
        visit(children[i]);
      }
    }
    visit(document.documentElement);
  }
  
  // ============================================================
  // Collapsed Section Expansion (reused from loopd.js)
  // ============================================================
  
  function expandAllCollapsedSections(container) {
    return new Promise((resolve) => {
      const attempted = new Set();
      const confirmed = new Set();
      const failed = new Set();
      const maxOperations = 100;
      let operations = 0;
      
      function getElementId(el) {
        if (!el.dataset.expandId) {
          el.dataset.expandId = 'exp_' + Math.random().toString(36).slice(2, 10);
        }
        return el.dataset.expandId;
      }
      
      function findCollapsedToggles() {
        const results = [];
        
        function visitNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const className = node.className || '';
            
            // Primary: scriptor-collapseButtonContainer
            if (/scriptor-collapseButtonContainer/i.test(className)) {
              const ariaExpanded = node.getAttribute('aria-expanded');
              if (ariaExpanded === 'false') {
                const id = getElementId(node);
                if (!confirmed.has(id) && !failed.has(id) && !results.includes(node)) {
                  results.push(node);
                }
              }
            }
            
            // Fallback: other collapse buttons
            if (!results.includes(node)) {
              const ariaExpanded = node.getAttribute('aria-expanded');
              const role = node.getAttribute('role');
              const ariaLabel = node.getAttribute('aria-label');
              
              if (ariaExpanded === 'false' &&
                  role === 'button' &&
                  ariaLabel &&
                  !/menuButton/i.test(className) &&
                  /collapse/i.test(className)) {
                const id = getElementId(node);
                if (!confirmed.has(id) && !failed.has(id)) {
                  results.push(node);
                }
              }
            }
            
            if (node.shadowRoot) {
              visitNode(node.shadowRoot);
            }
          }
          
          const children = node.childNodes || node.children || [];
          for (let i = 0; i < children.length; i++) {
            visitNode(children[i]);
          }
        }
        
        visitNode(document.documentElement);
        return results;
      }
      
      function tryClick(el) {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        
        const mouseEventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          screenX: x + window.screenX,
          screenY: y + window.screenY,
          button: 0,
          buttons: 1
        };
        
        el.dispatchEvent(new MouseEvent('mouseenter', mouseEventInit));
        el.dispatchEvent(new MouseEvent('mouseover', mouseEventInit));
        el.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
        
        setTimeout(() => {
          el.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
          el.dispatchEvent(new MouseEvent('click', mouseEventInit));
          
          setTimeout(() => {
            if (el.getAttribute('aria-expanded') === 'true') return;
            el.click();
            
            setTimeout(() => {
              if (el.getAttribute('aria-expanded') === 'true') return;
              
              const keys = Object.keys(el);
              for (const key of keys) {
                if (key.startsWith('__reactProps$')) {
                  const props = el[key];
                  if (props?.onClick) {
                    props.onClick({
                      preventDefault: () => {},
                      stopPropagation: () => {},
                      nativeEvent: new MouseEvent('click', mouseEventInit),
                      target: el,
                      currentTarget: el
                    });
                    return;
                  }
                }
              }
            }, 100);
          }, 50);
        }, 30);
      }
      
      async function expandNext() {
        operations++;
        
        if (operations > maxOperations) {
          console.log('Max operations reached. Confirmed:', confirmed.size, 'Failed:', failed.size);
          await new Promise(r => setTimeout(r, 500));
          resolve();
          return;
        }
        
        const collapsed = findCollapsedToggles();
        
        if (collapsed.length === 0) {
          console.log('Expansion complete. Confirmed:', confirmed.size, 'Failed:', failed.size);
          await new Promise(r => setTimeout(r, 500));
          resolve();
          return;
        }
        
        let toggle = null;
        for (const el of collapsed) {
          const id = getElementId(el);
          if (!attempted.has(id)) {
            toggle = el;
            break;
          }
        }
        
        if (!toggle) {
          for (const el of collapsed) {
            const id = getElementId(el);
            if (!failed.has(id) && !confirmed.has(id)) {
              failed.add(id);
            }
          }
          console.log('No more expandable sections. Confirmed:', confirmed.size, 'Failed:', failed.size);
          await new Promise(r => setTimeout(r, 500));
          resolve();
          return;
        }
        
        const id = getElementId(toggle);
        const label = toggle.getAttribute('aria-label') || '(unknown)';
        
        console.log(`Expanding [${operations}]:`, label.slice(0, 50));
        attempted.add(id);
        
        toggle.scrollIntoView({ block: 'center', behavior: 'instant' });
        
        // Wait for scroll to settle before clicking
        await new Promise(r => setTimeout(r, 150));
        
        // Re-verify element is visible and get fresh coordinates
        const rect = toggle.getBoundingClientRect();
        const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
        if (!isVisible) {
          console.log('  Element not in viewport after scroll, trying again...');
          toggle.scrollIntoView({ block: 'center', behavior: 'instant' });
          await new Promise(r => setTimeout(r, 100));
        }
        
        tryClick(toggle);
        
        await new Promise(r => setTimeout(r, 800));
        
        const stateAfter = toggle.getAttribute('aria-expanded');
        if (stateAfter === 'true') {
          confirmed.add(id);
          console.log('  -> SUCCESS');
        } else {
          failed.add(id);
          console.log('  -> FAILED (aria-expanded=' + stateAfter + ')');
        }
        expandNext();
      }
      
      // Open all <details> elements
      visitAllNodes((el) => {
        if (el.tagName === 'DETAILS' && !el.open) {
          el.open = true;
        }
      });
      
      // Scroll to load virtualized content
      function scrollToLoadContent() {
        return new Promise((scrollResolve) => {
          const scrollables = [];
          
          if (document.body.scrollHeight > window.innerHeight) {
            scrollables.push({ el: null, useWindow: true });
          }
          
          document.querySelectorAll('div').forEach((div) => {
            const style = window.getComputedStyle(div);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                div.scrollHeight > div.clientHeight + 100) {
              scrollables.push({ el: div, useWindow: false });
            }
          });
          
          console.log('Found', scrollables.length, 'scrollable areas');
          
          let scrollIndex = 0;
          
          function scrollNextContainer() {
            if (scrollIndex >= scrollables.length) {
              setTimeout(scrollResolve, 500);
              return;
            }
            
            const item = scrollables[scrollIndex++];
            let scrollHeight = item.useWindow ? document.body.scrollHeight : item.el.scrollHeight;
            const viewportHeight = item.useWindow ? window.innerHeight : item.el.clientHeight;
            let currentScroll = 0;
            const scrollStep = viewportHeight * 0.7;
            
            function scrollNext() {
              if (currentScroll >= scrollHeight) {
                if (item.useWindow) {
                  window.scrollTo(0, 0);
                } else {
                  item.el.scrollTop = 0;
                }
                setTimeout(scrollNextContainer, 300);
                return;
              }
              
              currentScroll += scrollStep;
              
              if (item.useWindow) {
                window.scrollTo(0, currentScroll);
              } else {
                item.el.scrollTop = currentScroll;
              }
              
              scrollHeight = item.useWindow ? document.body.scrollHeight : item.el.scrollHeight;
              setTimeout(scrollNext, 100);
            }
            
            scrollNext();
          }
          
          if (scrollables.length === 0) {
            scrollResolve();
          } else {
            scrollNextContainer();
          }
        });
      }
      
      scrollToLoadContent().then(() => {
        console.log('Starting expansion...');
        expandNext();
      });
    });
  }
  
  // ============================================================
  // Image Processing
  // ============================================================
  
  function getExtensionFromSrc(src) {
    if (src.startsWith('data:')) {
      const match = src.match(/^data:image\/([a-z]+)/i);
      if (match) {
        const ext = match[1].toLowerCase();
        return ext === 'jpeg' ? 'jpg' : ext;
      }
      return 'png';
    }
    const path = src.split('?')[0].split('#')[0];
    const lastDot = path.lastIndexOf('.');
    if (lastDot > 0) {
      const ext = path.substring(lastDot + 1).toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    }
    return 'png';
  }
  
  function shouldSkipImage(img) {
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    const isSmall = (width > 0 && width < 50) || (height > 0 && height < 50);
    const parentClasses = img.closest('[class]')?.className || '';
    const isAvatar = /avatar|presence|profile|user-photo/i.test(img.className + ' ' + parentClasses);
    const isInHeader = img.closest('.scriptor-pageHeader, [class*="header"], [class*="presence"], [class*="author"]');
    
    return isSmall || isAvatar || isInHeader;
  }
  
  async function downloadImages(imgElements) {
    const urlMap = {};
    let index = 0;
    
    for (const img of imgElements) {
      const src = img.src;
      if (!src || urlMap[src] || shouldSkipImage(img)) continue;
      
      console.log('Downloading image', ++index, 'of', imgElements.length);
      
      try {
        let blob;
        
        if (src.startsWith('data:')) {
          // Convert data URL to blob
          const response = await fetch(src);
          blob = await response.blob();
        } else {
          // Fetch remote URL
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          
          const response = await fetch(src, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (!response.ok) throw new Error('HTTP ' + response.status);
          
          blob = await response.blob();
        }
        
        const ext = getExtensionFromSrc(src);
        const filename = 'image_' + Object.keys(urlMap).length + '.' + ext;
        urlMap[src] = filename;
        await storeImage(src, blob);
      } catch (err) {
        console.warn('Failed to download image:', err.name === 'AbortError' ? '(timeout)' : err);
      }
    }
    
    return urlMap;
  }
  
  // ============================================================
  // DOM → MDAST Direct Conversion
  // ============================================================
  
  /**
   * Get className as string (handles SVGAnimatedString)
   */
  function getClassName(el) {
    if (!el || !el.className) return '';
    return typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
  }
  
  /**
   * Check if element should be skipped (UI elements, hidden, etc.)
   */
  function shouldSkipElement(el) {
    const className = getClassName(el);
    const tag = el.tagName?.toLowerCase();
    
    // Skip UI elements
    if (/scriptor-(collapseButton|block-command|commands|toolbar|pageHeader)/i.test(className)) {
      return true;
    }
    if (/presence|avatar|toolbar|menu/i.test(className)) {
      return true;
    }
    
    // Skip non-content elements
    if (['style', 'script', 'noscript', 'meta', 'link'].includes(tag)) {
      return true;
    }
    
    // Skip hidden elements
    if (el.getAttribute('aria-hidden') === 'true') {
      return true;
    }
    
    return false;
  }
  
  /**
   * Get all child nodes including shadow DOM children
   */
  function getChildren(el) {
    const children = [];
    
    // Shadow DOM children first (they typically replace light DOM)
    if (el.shadowRoot) {
      for (const child of el.shadowRoot.childNodes) {
        children.push(child);
      }
    }
    
    // Light DOM children
    for (const child of el.childNodes) {
      children.push(child);
    }
    
    return children;
  }
  
  /**
   * Extract plain text from a DOM node
   */
  function extractText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (shouldSkipElement(node)) return '';
      return getChildren(node).map(extractText).join('');
    }
    return '';
  }
  
  /**
   * Extract text from code element, preserving <br> as newlines
   */
  function extractCodeText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName?.toLowerCase();
      if (tag === 'br') return '\n';
      if (shouldSkipElement(node)) return '';
      return getChildren(node).map(extractCodeText).join('');
    }
    return '';
  }
  
  /**
   * Convert DOM node to MDAST nodes
   */
  function domToMdast(node, urlMap, context = {}) {
    // Text node
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      // Normalize whitespace unless in code context
      if (context.preserveWhitespace) {
        return text ? [{ type: 'text', value: text }] : [];
      }
      // Replace all whitespace (including newlines) with single spaces
      // This prevents remark-stringify from escaping newlines as backslashes
      const normalized = text.replace(/[\s\n\r]+/g, ' ');
      // Keep whitespace-only nodes as single spaces - they provide word boundaries
      // between adjacent inline elements like <span>word</span> <span>word</span>
      if (!normalized) {
        return [];
      }
      return [{ type: 'text', value: normalized }];
    }
    
    // Not an element
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }
    
    // Skip UI elements
    if (shouldSkipElement(node)) {
      return [];
    }
    
    const el = node;
    const tag = el.tagName?.toLowerCase();
    const className = getClassName(el);
    const role = el.getAttribute('role');
    
    // ---- Loop collapsed code blocks (check early) ----
    // Only match small containers that look like code snippet blocks
    // Must have: language label as direct/near child, short content, "Show more lines" indicator
    if (/scriptor-code|code-snippet|collapsed.*code/i.test(className)) {
      const showMoreText = extractText(el);
      if (/Show more lines/i.test(showMoreText)) {
        const textContent = showMoreText.replace(/Show more lines/gi, '').trim();
        const langMatch = textContent.match(/^(Shell|PowerShell|Bash|JavaScript|TypeScript|Python|JSON|HTML|CSS|SQL|C#|Java|Go|Rust|Ruby|PHP|Kotlin|Swift|YAML|XML|Markdown|Text)\s*/i);
        const lang = langMatch ? langMatch[1].toLowerCase() : '';
        const codeContent = langMatch ? textContent.slice(langMatch[0].length).trim() : textContent;
        if (codeContent && codeContent.length < 500) {
          console.log('loopd2: Found collapsed code block (' + (lang || 'no lang') + '):', codeContent.slice(0, 40));
          return [{
            type: 'code',
            lang: lang || null,
            value: codeContent
          }];
        }
      }
    }
    
    // ---- Headings (check BEFORE everything else) ----
    // Standard HTML headings
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1], 10);
      const children = processChildren(el, urlMap, context);
      console.log('loopd2: Found H' + level + ' heading:', extractText(el).slice(0, 50));
      return [{
        type: 'heading',
        depth: level,
        children: flattenInline(children)
      }];
    }
    
    // ARIA headings and Loop-specific heading patterns
    const isHeading = role === 'heading' || 
                      /scriptor-collapsibleHeading|scriptor-heading|scriptor-title/i.test(className) ||
                      el.getAttribute('data-automation-type')?.includes('heading');
    if (isHeading) {
      const level = parseInt(el.getAttribute('aria-level'), 10) || 
                    parseInt(className.match(/heading(\d)/i)?.[1], 10) || 2;
      const children = processChildren(el, urlMap, context);
      // Only create heading if it has content
      const inlineChildren = flattenInline(children);
      if (inlineChildren.length > 0) {
        console.log('loopd2: Found ARIA/Loop heading (level ' + level + '):', extractText(el).slice(0, 50));
        return [{
          type: 'heading',
          depth: Math.min(Math.max(level, 1), 6),
          children: inlineChildren
        }];
      }
    }
    
    // ---- Inline code (check BEFORE code blocks) ----
    // Short <code> elements should always be inline code
    if (tag === 'code' && !/scriptor-codeBlock|scriptor-code-editor/i.test(className)) {
      const text = extractCodeText(el).trim();
      // If it has newlines, it's a code block
      if (text && text.includes('\n')) {
        const lang = el.getAttribute('data-language') || 
                     className.match(/language-(\w+)/i)?.[1] || '';
        console.log('loopd2: Found code block in <code>:', text.slice(0, 40));
        return [{
          type: 'code',
          lang: lang || null,
          value: text
        }];
      }
      // Inline if short and no newlines
      if (text && text.length < 200) {
        console.log('loopd2: Found inlineCode (<code>):', text.slice(0, 40));
        return [{
          type: 'inlineCode',
          value: text
        }];
      }
    }
    
    // Check for Loop-specific inline code classes or monospace styling
    const automationType = el.getAttribute('data-automation-type') || '';
    const hasInlineCodeClass = /scriptor-inlineCode|inline-?code|code-?span/i.test(className) ||
                               automationType.toLowerCase().includes('code') ||
                               className.toLowerCase().includes('monospace');
    
    // Also check computed style for span/div elements that might be styled as code
    let hasCodeStyle = false;
    if (tag === 'span' || tag === 'div') {
      try {
        const computed = window.getComputedStyle(el);
        const fontFamily = computed?.fontFamily?.toLowerCase() || '';
        hasCodeStyle = fontFamily.includes('monospace') || 
                       fontFamily.includes('consolas') || 
                       fontFamily.includes('monaco') ||
                       fontFamily.includes('courier') ||
                       fontFamily.includes('menlo');
      } catch (e) {
        // getComputedStyle might fail on detached elements
      }
    }
    
    if (hasInlineCodeClass || hasCodeStyle) {
      const text = extractCodeText(el).trim();
      if (text && text.includes('\n')) {
        const lang = el.getAttribute('data-language') || 
                     className.match(/language-(\w+)/i)?.[1] || '';
        return [{
          type: 'code',
          lang: lang || null,
          value: text
        }];
      }
      if (text && text.length < 200) {
        console.log('loopd2: Found inlineCode (style):', text.slice(0, 40));
        return [{
          type: 'inlineCode',
          value: text
        }];
      }
    }
    
    // ---- Code blocks ----
    // Only match specific Loop code block patterns, or <pre> tags
    if (/scriptor-codeBlock|scriptor-code-editor/i.test(className)) {
      const lang = el.getAttribute('data-language') || 
                   className.match(/language-(\w+)/i)?.[1] || '';
      const codeText = extractCodeBlockText(el);
      // Skip whitespace-only code blocks
      if (!codeText || !codeText.trim()) {
        return processChildren(el, urlMap, context);
      }
      return [{
        type: 'code',
        lang: lang || null,
        value: codeText
      }];
    }
    
    // Standard <pre> with optional <code> child
    if (tag === 'pre' && !context.inCode) {
      // Check for nested code element for language
      const codeChild = el.querySelector('code');
      const lang = el.getAttribute('data-language') || 
                   className.match(/language-(\w+)/i)?.[1] ||
                   (codeChild && getClassName(codeChild).match(/language-(\w+)/i)?.[1]) || '';
      const codeText = extractCodeBlockText(el);
      // Skip whitespace-only code blocks
      if (!codeText || !codeText.trim()) {
        return processChildren(el, urlMap, context);
      }
      return [{
        type: 'code',
        lang: lang || null,
        value: codeText
      }];
    }
    
    // Long <code> content becomes a code block
    if (tag === 'code') {
      const text = extractCodeText(el).trim();
      if (text && (text.length >= 200 || text.includes('\n'))) {
        const lang = el.getAttribute('data-language') || 
                     className.match(/language-(\w+)/i)?.[1] || '';
        return [{
          type: 'code',
          lang: lang || null,
          value: text
        }];
      }
    }
    
    // ---- Tables ----
    if (tag === 'table' || role === 'table' || role === 'grid') {
      return [convertTable(el, urlMap, context)];
    }
    
    // ---- Lists ----
    // Standard HTML lists
    // Loop renders each list item in its own <ul> element, but the FIRST <ul>
    // has an aria-owns attribute that lists all the list item IDs for the logical list.
    // Subsequent <ul> elements have aria-hidden="true" and should be skipped.
    if (tag === 'ul' || tag === 'ol') {
      // Skip aria-hidden lists - these are duplicate DOM for list items
      // that belong to an earlier list via aria-owns
      if (el.getAttribute('aria-hidden') === 'true') {
        return [];
      }
      
      const items = [];
      const ordered = tag === 'ol';
      
      // Check for aria-owns which contains space-separated list of listItem IDs
      const ariaOwns = el.getAttribute('aria-owns');
      if (ariaOwns) {
        const itemIds = ariaOwns.split(/\s+/).filter(id => id);
        for (const itemId of itemIds) {
          // Find the element by ID in the document
          const itemEl = el.ownerDocument?.getElementById(itemId);
          if (itemEl) {
            items.push(convertListItem(itemEl, urlMap, context));
          }
        }
      } else {
        // Fallback to direct children for standard HTML lists
        for (const child of getChildren(el)) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const childTag = child.tagName?.toLowerCase();
            const childRole = child.getAttribute?.('role');
            // Accept <li> or elements with listitem role
            if (childTag === 'li' || childRole === 'listitem') {
              items.push(convertListItem(child, urlMap, context));
            }
          }
        }
      }
      
      if (items.length === 0) return processChildren(el, urlMap, context);
      return [{
        type: 'list',
        ordered: ordered,
        spread: false,
        children: items
      }];
    }
    
    // ARIA role-based lists (Loop may use these)
    if (role === 'list') {
      // Skip aria-hidden lists
      if (el.getAttribute('aria-hidden') === 'true') {
        return [];
      }
      
      const items = [];
      
      // Check for aria-owns which contains space-separated list of listItem IDs
      const ariaOwns = el.getAttribute('aria-owns');
      if (ariaOwns) {
        const itemIds = ariaOwns.split(/\s+/).filter(id => id);
        for (const itemId of itemIds) {
          const itemEl = el.ownerDocument?.getElementById(itemId);
          if (itemEl) {
            items.push(convertListItem(itemEl, urlMap, context));
          }
        }
      } else {
        for (const child of getChildren(el)) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const childTag = child.tagName?.toLowerCase();
            const childRole = child.getAttribute?.('role');
            if (childTag === 'li' || childRole === 'listitem') {
              items.push(convertListItem(child, urlMap, context));
            }
          }
        }
      }
      
      if (items.length === 0) return processChildren(el, urlMap, context);
      return [{
        type: 'list',
        ordered: false,
        spread: false,
        children: items
      }];
    }
    
    // ---- Task items (Loop-specific) ----
    if (/scriptor-task|scriptor-checkbox/i.test(className)) {
      const checkbox = el.querySelector('input[type="checkbox"]');
      const checked = checkbox?.checked || el.getAttribute('aria-checked') === 'true';
      const children = processChildren(el, urlMap, context);
      return [{
        type: 'listItem',
        checked: checked,
        spread: false,
        children: wrapInParagraph(children)
      }];
    }
    
    // ---- Blockquotes ----
    if (tag === 'blockquote') {
      const children = processChildren(el, urlMap, context);
      return [{
        type: 'blockquote',
        children: wrapInParagraph(children)
      }];
    }
    
    // ---- Callouts → GitHub Alerts ----
    // Loop callout blocks have classes like: scriptor-callout, scriptor-infoBlock, 
    // scriptor-highlightBlock, scriptor-component-block-callout, scriptor-block-callout-border
    if (/scriptor-callout|scriptor-infoBlock|scriptor-highlightBlock|scriptor-component-block-callout|scriptor-block-callout/i.test(className)) {
      const alertType = detectCalloutType(className, el);
      const children = processChildren(el, urlMap, context);
      console.log('loopd2: Found callout block (' + alertType + '):', extractText(el).slice(0, 50));
      return [{
        type: 'blockquote',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: `[!${alertType}]` }]
          },
          ...wrapInParagraph(children)
        ]
      }];
    }
    
    // ---- Horizontal rules ----
    if (tag === 'hr' || /scriptor-divider|scriptor-horizontalRule/i.test(className)) {
      return [{ type: 'thematicBreak' }];
    }
    
    // ---- Images ----
    if (tag === 'img') {
      const src = el.getAttribute('src') || el.src;
      const alt = el.getAttribute('alt') || '';
      
      if (!src) return [];
      
      // Use urlMap for downloaded images
      if (urlMap[src]) {
        return [{
          type: 'image',
          url: 'images/' + urlMap[src],
          alt: alt
        }];
      }
      
      // Skip data URLs not in urlMap
      if (src.startsWith('data:')) {
        return [];
      }
      
      // External URL
      return [{
        type: 'image',
        url: src,
        alt: alt
      }];
    }
    
    // ---- Links ----
    // Loop-style links: span with scriptor-hyperlink class and role="link"
    // URL is stored in title attribute as "url\nClick to follow link"
    if (role === 'link' || /scriptor-hyperlink/i.test(className)) {
      const title = el.getAttribute('title') || '';
      // Extract URL from title (before "Click to follow link")
      const urlMatch = title.match(/^(https?:\/\/[^\s\n]+)/i) || title.match(/^([^\s\n]+)/);
      const href = urlMatch ? urlMatch[1] : '';
      if (href && !href.startsWith('Click')) {
        const children = processChildren(el, urlMap, context);
        console.log('loopd2: Found Loop link:', href.slice(0, 50), '->', extractText(el).slice(0, 30));
        return [{
          type: 'link',
          url: href,
          children: flattenInline(children).length > 0 
            ? flattenInline(children) 
            : [{ type: 'text', value: extractText(el) || href }]
        }];
      }
    }
    
    // Standard <a> tags
    if (tag === 'a') {
      const href = el.getAttribute('href') || el.href || '';
      const children = processChildren(el, urlMap, context);
      // Always return link if we have href, even with complex hrefs
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        console.log('loopd2: Found link:', href.slice(0, 50), '->', extractText(el).slice(0, 30));
        return [{
          type: 'link',
          url: href,
          children: flattenInline(children).length > 0 
            ? flattenInline(children) 
            : [{ type: 'text', value: extractText(el) || href }]
        }];
      }
      return children;
    }
    
    // ---- Bold/Strong ----
    if (tag === 'strong' || tag === 'b') {
      const children = processChildren(el, urlMap, context);
      const inlineChildren = flattenInline(children);
      // Skip empty strong (would produce bare **)
      if (inlineChildren.length === 0) return [];
      return [{
        type: 'strong',
        children: inlineChildren
      }];
    }
    
    // ---- Italic/Emphasis ----
    if (tag === 'em' || tag === 'i') {
      const children = processChildren(el, urlMap, context);
      const inlineChildren = flattenInline(children);
      // Skip empty emphasis (would produce bare *)
      if (inlineChildren.length === 0) return [];
      return [{
        type: 'emphasis',
        children: inlineChildren
      }];
    }
    
    // ---- Strikethrough ----
    if (tag === 's' || tag === 'del' || tag === 'strike') {
      const children = processChildren(el, urlMap, context);
      const inlineChildren = flattenInline(children);
      // Skip empty delete (would produce bare ~~)
      if (inlineChildren.length === 0) return [];
      return [{
        type: 'delete',
        children: inlineChildren
      }];
    }
    
    // ---- Line breaks ----
    // Be conservative with <br> - only include if it's meaningful (between content)
    if (tag === 'br') {
      // Skip if this is the last child of a block element (trailing br)
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.childNodes);
        const myIndex = siblings.indexOf(el);
        // Check if there's any meaningful content after this br
        let hasContentAfter = false;
        for (let i = myIndex + 1; i < siblings.length; i++) {
          const sib = siblings[i];
          if (sib.nodeType === Node.TEXT_NODE && sib.textContent?.trim()) {
            hasContentAfter = true;
            break;
          }
          if (sib.nodeType === Node.ELEMENT_NODE && sib.tagName !== 'BR') {
            hasContentAfter = true;
            break;
          }
        }
        if (!hasContentAfter) {
          return []; // Skip trailing <br>
        }
      }
      return [{ type: 'break' }];
    }
    
    // ---- Paragraphs ----
    if (tag === 'p' || /scriptor-paragraph/i.test(className)) {
      const children = processChildren(el, urlMap, context);
      if (children.length === 0) return [];
      
      // If all children are block-level, don't wrap
      const hasBlockChildren = children.some(c => 
        ['paragraph', 'heading', 'code', 'blockquote', 'list', 'table', 'thematicBreak'].includes(c.type)
      );
      if (hasBlockChildren) return children;
      
      // Strip trailing breaks from paragraphs
      const inlineChildren = flattenInline(children, { keepBreaks: true });
      // Remove trailing break nodes
      while (inlineChildren.length > 0 && inlineChildren[inlineChildren.length - 1].type === 'break') {
        inlineChildren.pop();
      }
      
      if (inlineChildren.length === 0) return [];
      
      return [{
        type: 'paragraph',
        children: inlineChildren
      }];
    }
    
    // ---- Divs and other containers ----
    // Just process children
    return processChildren(el, urlMap, context);
  }
  
  /**
   * Process all children of an element
   */
  function processChildren(el, urlMap, context) {
    const results = [];
    for (const child of getChildren(el)) {
      results.push(...domToMdast(child, urlMap, context));
    }
    return results;
  }
  
  /**
   * Flatten to inline-only nodes
   * Preserves: text, inlineCode, strong, emphasis, delete, link, image
   * Filters out break nodes (they cause issues in headings and inline contexts)
   */
  function flattenInline(nodes, options = {}) {
    const result = [];
    const keepBreaks = options.keepBreaks || false;
    
    for (const node of nodes) {
      if (!node) continue;
      
      // Skip break nodes unless explicitly keeping them
      if (node.type === 'break') {
        if (keepBreaks) result.push(node);
        continue;
      }
      
      // Keep these inline types as-is
      if (['text', 'inlineCode', 'strong', 'emphasis', 'delete', 'link', 'image'].includes(node.type)) {
        result.push(node);
      } else if (node.type === 'paragraph' && node.children) {
        // Unwrap paragraphs
        result.push(...flattenInline(node.children, options));
      } else if (node.type === 'code') {
        // Convert code blocks to inline code in inline context
        result.push({
          type: 'inlineCode',
          value: node.value || ''
        });
      } else if (node.children) {
        // Recursively flatten other containers
        result.push(...flattenInline(node.children, options));
      } else if (node.value) {
        // Convert any remaining value nodes to text
        result.push({ type: 'text', value: node.value });
      }
    }
    return result;
  }
  
  /**
   * Wrap inline nodes in paragraphs for block contexts
   */
  function wrapInParagraph(nodes) {
    const result = [];
    let inlineBuffer = [];
    
    function flushInline() {
      if (inlineBuffer.length > 0) {
        result.push({
          type: 'paragraph',
          children: inlineBuffer
        });
        inlineBuffer = [];
      }
    }
    
    for (const node of nodes) {
      if (['paragraph', 'heading', 'code', 'blockquote', 'list', 'table', 'thematicBreak'].includes(node.type)) {
        flushInline();
        result.push(node);
      } else {
        inlineBuffer.push(node);
      }
    }
    
    flushInline();
    return result;
  }
  
  /**
   * Extract code block text preserving line structure
   */
  function extractCodeBlockText(el) {
    const lines = [];
    
    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || '';
      }
      
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName?.toLowerCase();
        const className = getClassName(node);
        
        // Skip line numbers
        if (/line-number|lineNumber/i.test(className)) {
          return '';
        }
        
        // BR = newline
        if (tag === 'br') {
          return '\n';
        }
        
        // Block elements = lines
        const isBlock = ['p', 'div', 'pre', 'li'].includes(tag) ||
                       /scriptor-paragraph|scriptor-line/i.test(className);
        
        const children = node.shadowRoot 
          ? [...node.shadowRoot.childNodes, ...node.childNodes]
          : node.childNodes;
        
        let content = '';
        for (const child of children) {
          content += processNode(child);
        }
        
        if (isBlock && content.trim()) {
          lines.push(content);
          return '';
        }
        
        return content;
      }
      
      return '';
    }
    
    const children = el.shadowRoot 
      ? [...el.shadowRoot.childNodes, ...el.childNodes]
      : el.childNodes;
    
    for (const child of children) {
      const result = processNode(child);
      if (result.trim()) {
        lines.push(result);
      }
    }
    
    return lines.length > 0 ? lines.join('\n') : extractText(el);
  }
  
  /**
   * Convert a list item
   */
  function convertListItem(li, urlMap, context) {
    const checkbox = li.querySelector('input[type="checkbox"]');
    const children = processChildren(li, urlMap, context);
    
    return {
      type: 'listItem',
      checked: checkbox ? checkbox.checked : null,
      spread: false,
      children: wrapInParagraph(children)
    };
  }
  
  /**
   * Convert a table element to MDAST
   */
  function convertTable(tableEl, urlMap, context) {
    const rows = [];
    const align = [];
    
    // Find all rows
    function findRows(el) {
      const found = [];
      for (const child of getChildren(el)) {
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = child.tagName?.toLowerCase();
        const role = child.getAttribute?.('role');
        const className = getClassName(child);
        
        if (tag === 'tr' || role === 'row' || /scriptor-tableRow/i.test(className)) {
          found.push(child);
        } else if (['thead', 'tbody', 'tfoot'].includes(tag)) {
          found.push(...findRows(child));
        }
      }
      return found;
    }
    
    const tableRows = findRows(tableEl);
    
    for (const row of tableRows) {
      const cells = [];
      
      for (const cell of getChildren(row)) {
        if (cell.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = cell.tagName?.toLowerCase();
        const role = cell.getAttribute?.('role');
        const className = getClassName(cell);
        
        // Skip row number cells (rowheader with just a number)
        if (role === 'rowheader') {
          const cellText = extractText(cell).trim();
          // If it's just a number, it's likely a row index - skip it
          if (/^\d+$/.test(cellText)) {
            continue;
          }
        }
        
        if (tag === 'th' || tag === 'td' || 
            ['cell', 'gridcell', 'columnheader'].includes(role) ||
            /scriptor-tableCell/i.test(className)) {
          
          const children = processChildren(cell, urlMap, context);
          cells.push({
            type: 'tableCell',
            children: flattenInline(children).length > 0 
              ? flattenInline(children) 
              : [{ type: 'text', value: '' }]
          });
          
          // Track alignment from first row
          if (rows.length === 0) {
            align.push(null);
          }
        }
      }
      
      if (cells.length > 0) {
        rows.push({
          type: 'tableRow',
          children: cells
        });
      }
    }
    
    if (rows.length === 0) {
      return { type: 'paragraph', children: [{ type: 'text', value: '' }] };
    }
    
    return {
      type: 'table',
      align: align.length > 0 ? align : null,
      children: rows
    };
  }
  
  /**
   * Detect callout type
   */
  function detectCalloutType(className, el) {
    const typeSource = (className + ' ' + (el.getAttribute('data-type') || '')).toLowerCase();
    
    const typeMap = {
      'note': 'NOTE', 'info': 'NOTE',
      'tip': 'TIP', 'hint': 'TIP', 'success': 'TIP',
      'important': 'IMPORTANT',
      'warning': 'WARNING',
      'caution': 'CAUTION', 'danger': 'CAUTION', 'error': 'CAUTION'
    };
    
    for (const [pattern, type] of Object.entries(typeMap)) {
      if (typeSource.includes(pattern)) return type;
    }
    
    return 'NOTE';
  }
  
  /**
   * CSS patterns to strip
   */
  const CSS_PATTERNS = [
    /@media[^{]*\{[\s\S]*?\}\s*\}/g,
    /@keyframes[^{]*\{[\s\S]*?\}\s*\}/g,
    /@font-face\s*\{[^}]*\}/g,
    /\.[a-zA-Z_][\w-]*\s*\{[^}]*\}/g,
    /#[a-zA-Z_][\w-]*\s*\{[^}]*\}/g,
    /\{[^}]*(?:display|position|margin|padding|font-size|color|background|border|width|height)\s*:[^}]*\}/g
  ];
  
  function stripCss(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    for (const pattern of CSS_PATTERNS) {
      result = result.replace(pattern, '');
    }
    // Don't trim - preserve leading/trailing whitespace for word boundaries
    return result;
  }
  
  /**
   * Post-process MDAST to clean up
   */
  function mdastCleanup(urlMap) {
    return (tree) => {
      // Strip CSS from text nodes (NOT inline code)
      visit(tree, 'text', (node) => {
        if (node.value) {
          node.value = stripCss(node.value);
        }
      });
      
      // Merge adjacent text nodes and ensure proper spacing
      function mergeTextNodes(parent) {
        if (!parent.children) return;
        const merged = [];
        for (const child of parent.children) {
          if (child.type === 'text' && merged.length > 0 && merged[merged.length - 1].type === 'text') {
            // Merge with previous text node
            merged[merged.length - 1].value += child.value;
          } else {
            merged.push(child);
            // Recurse into containers
            if (child.children) mergeTextNodes(child);
          }
        }
        // Normalize merged text: collapse multiple spaces
        for (const node of merged) {
          if (node.type === 'text' && node.value) {
            node.value = node.value.replace(/  +/g, ' ');
          }
        }
        parent.children = merged;
      }
      mergeTextNodes(tree);
      
      // Ensure spaces around inline elements within paragraphs AND headings
      function ensureInlineSpacing(node) {
        if (!node.children || node.children.length < 2) return;
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          const prev = node.children[i - 1];
          const next = node.children[i + 1];
          
          // Types that need spacing around them
          if (['inlineCode', 'link', 'strong', 'emphasis', 'delete'].includes(child.type)) {
            // Add space before if previous is text not ending in space/punctuation
            if (prev && prev.type === 'text' && prev.value && !/[\s([{]$/.test(prev.value)) {
              prev.value = prev.value + ' ';
            }
            // Add space after if next is text not starting with space/punctuation
            if (next && next.type === 'text' && next.value && !/^[\s.,;:!?)\]}]/.test(next.value)) {
              next.value = ' ' + next.value;
            }
          }
        }
      }
      
      visit(tree, 'paragraph', ensureInlineSpacing);
      visit(tree, 'heading', ensureInlineSpacing);
      
      // Convert paragraphs with [LangLabel][inlineCode][Show more lines] to code blocks
      const LANG_LABELS = /^(Shell|PowerShell|Bash|JavaScript|TypeScript|Python|JSON|HTML|CSS|SQL|C#|Java|Go|Rust|Ruby|PHP|Kotlin|Swift|YAML|XML|Markdown|Text)$/i;
      visit(tree, 'root', (rootNode) => {
        if (!rootNode.children) return;
        rootNode.children = rootNode.children.map((child) => {
          if (child.type !== 'paragraph' || !child.children) return child;
          
          // Look for pattern: text(lang) + inlineCode + optional text("Show more lines")
          const kids = child.children;
          let langIdx = -1, codeIdx = -1, showMoreIdx = -1;
          
          for (let i = 0; i < kids.length; i++) {
            const k = kids[i];
            if (k.type === 'text' && LANG_LABELS.test(k.value?.trim())) {
              langIdx = i;
            } else if (k.type === 'inlineCode' && langIdx >= 0 && codeIdx < 0) {
              codeIdx = i;
            } else if (k.type === 'text' && /Show more lines/i.test(k.value)) {
              showMoreIdx = i;
            }
          }
          
          // If we found lang + code pattern, convert to code block
          if (langIdx >= 0 && codeIdx >= 0 && codeIdx > langIdx) {
            const lang = kids[langIdx].value.trim().toLowerCase();
            const codeValue = kids[codeIdx].value;
            console.log('loopd2: Converting to code block (' + lang + '):', codeValue.slice(0, 40));
            return {
              type: 'code',
              lang: lang,
              value: codeValue
            };
          }
          
          return child;
        });
      });
      
      // Strip CSS from code blocks without language
      visit(tree, 'code', (node) => {
        if (node.value && !node.lang) {
          const stripped = stripCss(node.value);
          if (stripped !== node.value && stripped.trim() === '') {
            node.value = '';
          }
        }
      });
      
      // Fix data URLs in images
      visit(tree, 'image', (node) => {
        if (node.url?.startsWith('data:')) {
          if (urlMap[node.url]) {
            node.url = 'images/' + urlMap[node.url];
          } else {
            node.url = '';
          }
        }
      });
      
      // Remove empty nodes (but never remove inlineCode)
      remove(tree, (node) => {
        if (node.type === 'paragraph' && (!node.children || node.children.length === 0)) return true;
        if (node.type === 'code' && (!node.value || node.value.trim() === '')) return true;
        if (node.type === 'image' && (!node.url || node.url === '')) return true;
        // Remove empty strong/emphasis/delete that would produce bare **/*/~~
        if (node.type === 'strong' && (!node.children || node.children.length === 0)) return true;
        if (node.type === 'emphasis' && (!node.children || node.children.length === 0)) return true;
        if (node.type === 'delete' && (!node.children || node.children.length === 0)) return true;
        // Never remove inlineCode nodes
        return false;
      });
      
      // Remove empty text-only paragraphs
      visit(tree, 'root', (node) => {
        if (node.children) {
          node.children = node.children.filter((child) => {
            if (child.type === 'paragraph' && 
                child.children?.length === 1 &&
                child.children[0].type === 'text' &&
                child.children[0].value.trim() === '') {
              return false;
            }
            return true;
          });
        }
      });
      
      return tree;
    };
  }
  
  /**
   * Convert DOM element to Markdown
   */
  async function convertToMarkdown(element, urlMap) {
    console.log('loopd2: Converting DOM to MDAST...');
    
    // Build MDAST directly from DOM
    const children = domToMdast(element, urlMap, {});
    const mdast = {
      type: 'root',
      children: wrapInParagraph(children)
    };
    
    // Store raw MDAST for debugging (before cleanup)
    const rawMdast = JSON.parse(JSON.stringify(mdast));
    
    console.log('loopd2: MDAST node count:', countNodes(mdast));
    
    console.log('loopd2: Processing with remark pipeline...');
    
    // Create processor with remarkGfm BEFORE remarkStringify
    // remarkGfm adds GFM extensions for tables, task lists, strikethrough, etc.
    const processor = unified()
      .use(remarkGfm)  // GFM extensions first
      .use(remarkStringify, {
        bullet: '-',
        emphasis: '*',
        strong: '**',
        fence: '`',
        fences: true,
        listItemIndent: 'one',
        rule: '-'
      });
    
    // Run cleanup on MDAST
    const cleanupPlugin = mdastCleanup(urlMap);
    const cleaned = cleanupPlugin(mdast);
    
    // Stringify to markdown
    const markdown = processor.stringify(cleaned);
    
    return { markdown, rawMdast };
  }
  
  /**
   * Count nodes in MDAST for debugging
   */
  function countNodes(node) {
    let count = 1;
    const types = {};
    const samples = {
      heading: [],
      inlineCode: [],
      code: []
    };
    
    function walk(n) {
      types[n.type] = (types[n.type] || 0) + 1;
      
      // Collect samples for debugging
      if (n.type === 'heading' && samples.heading.length < 3) {
        const text = n.children?.map(c => c.value || '').join('') || '';
        samples.heading.push({ depth: n.depth, text: text.slice(0, 50) });
      }
      if (n.type === 'inlineCode' && samples.inlineCode.length < 5) {
        samples.inlineCode.push(n.value?.slice(0, 30) || '');
      }
      if (n.type === 'code' && samples.code.length < 3) {
        samples.code.push({ lang: n.lang, length: n.value?.length || 0 });
      }
      
      if (n.children) {
        for (const child of n.children) {
          count++;
          walk(child);
        }
      }
    }
    walk(node);
    
    console.log('loopd2: Node types:', types);
    if (samples.heading.length > 0) console.log('loopd2: Heading samples:', samples.heading);
    if (samples.inlineCode.length > 0) console.log('loopd2: InlineCode samples:', samples.inlineCode);
    if (samples.code.length > 0) console.log('loopd2: CodeBlock samples:', samples.code);
    
    return count;
  }
  
  // ============================================================
  // Tar Building (reused from loopd.js)
  // ============================================================
  
  function stringToBytes(str) {
    return new TextEncoder().encode(str);
  }
  
  function getPaddingSize(size) {
    const remainder = size % 512;
    return remainder === 0 ? 0 : 512 - remainder;
  }
  
  function buildTarHeader(filename, size, isDir) {
    const header = new Uint8Array(512);
    const nameBytes = stringToBytes(filename);
    header.set(nameBytes.slice(0, 100));
    
    const mode = isDir ? '0000755' : '0000644';
    header.set(stringToBytes(mode), 100);
    header[107] = 0;
    
    header.set(stringToBytes('0000000'), 108);
    header[115] = 0;
    header.set(stringToBytes('0000000'), 116);
    header[123] = 0;
    
    const sizeStr = size.toString(8).padStart(11, '0');
    header.set(stringToBytes(sizeStr), 124);
    header[135] = 0;
    
    const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0');
    header.set(stringToBytes(mtime), 136);
    header[147] = 0;
    
    for (let i = 148; i < 156; i++) header[i] = 32;
    
    header[156] = isDir ? 53 : 48;
    
    header.set(stringToBytes('ustar'), 257);
    header[262] = 0;
    header[263] = 48;
    header[264] = 48;
    
    header.set(stringToBytes('0000000'), 329);
    header[336] = 0;
    header.set(stringToBytes('0000000'), 337);
    header[344] = 0;
    
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    
    const checksumStr = checksum.toString(8).padStart(6, '0');
    header.set(stringToBytes(checksumStr), 148);
    header[154] = 0;
    header[155] = 32;
    
    return header;
  }
  
  async function buildTarStreaming(urlMap, markdown, automationTypes, rawMdast) {
    let tarBlob = new Blob([], { type: 'application/x-tar' });
    
    function appendToTar(data) {
      tarBlob = new Blob([tarBlob, data], { type: 'application/x-tar' });
    }
    
    function appendFileEntry(filename, data) {
      const size = data.byteLength || data.size || 0;
      const header = buildTarHeader(filename, size, false);
      appendToTar(header);
      appendToTar(data);
      const padding = getPaddingSize(size);
      if (padding > 0) {
        appendToTar(new Uint8Array(padding));
      }
    }
    
    function appendDirEntry(dirname) {
      const name = dirname.endsWith('/') ? dirname : dirname + '/';
      const header = buildTarHeader(name, 0, true);
      appendToTar(header);
    }
    
    // Add markdown content
    const mdBytes = stringToBytes(markdown);
    appendFileEntry('content.md', mdBytes);
    
    // Add raw MDAST for debugging
    if (rawMdast) {
      const mdastJson = JSON.stringify(rawMdast, null, 2);
      const mdastBytes = stringToBytes(mdastJson);
      appendFileEntry('debug-mdast.json', mdastBytes);
      console.log('loopd2: Added debug-mdast.json (' + Math.round(mdastBytes.length / 1024) + 'KB)');
    }
    
    // Add automation types JSON
    if (automationTypes && Object.keys(automationTypes).length > 0) {
      const typesJson = JSON.stringify(automationTypes, null, 2);
      const typesBytes = stringToBytes(typesJson);
      appendFileEntry('automation-types.json', typesBytes);
      console.log('loopd2: Found', Object.keys(automationTypes).length, 'unique data-automation-type values');
    }
    
    // Add images
    const imageUrls = Object.keys(urlMap);
    if (imageUrls.length > 0) {
      appendDirEntry('images');
    }
    
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const filename = 'images/' + urlMap[url];
      
      console.log('Adding to tar:', i + 1, 'of', imageUrls.length, '-', filename);
      
      const item = await getImage(url);
      if (item?.blob) {
        appendFileEntry(filename, item.blob);
      }
    }
    
    // Finalize: two 512-byte zero blocks
    appendToTar(new Uint8Array(1024));
    
    return tarBlob;
  }
  
  // ============================================================
  // Content Element Detection
  // ============================================================
  
  function findContentElement() {
    const CONTENT_SELECTORS = [
      'div.scriptor-pageContainer',
      'div[class*="pageContainer"]',
      '.scriptor-pageFrame.scriptor-firstPage',
      '.scriptor-pageBody',
      '.scriptor-pageFrame',
      '.scriptor-canvas',
      '[id^="componentPartHostingElementId"]',
      '[role="main"]'
    ];
    
    let contentElement = null;
    let maxScore = 0;
    
    for (const selector of CONTENT_SELECTORS) {
      const candidates = document.querySelectorAll(selector);
      
      for (const el of candidates) {
        const paragraphs = el.querySelectorAll('.scriptor-paragraph, p, [role="heading"]');
        const images = el.querySelectorAll('img');
        const score = paragraphs.length + images.length;
        
        if (score > maxScore) {
          maxScore = score;
          contentElement = el;
        }
      }
    }
    
    // Fallback: find parent of scriptor-paragraph elements
    if (!contentElement) {
      const firstParagraph = document.querySelector('.scriptor-paragraph');
      if (firstParagraph) {
        let parent = firstParagraph.parentElement;
        while (parent && parent !== document.body) {
          const paragraphCount = parent.querySelectorAll('.scriptor-paragraph').length;
          if (paragraphCount >= 3) {
            contentElement = parent;
            break;
          }
          parent = parent.parentElement;
        }
      }
    }
    
    return contentElement;
  }
  
  // ============================================================
  // Main Export Function
  // ============================================================
  
  /**
   * Collect all data-automation-type values from the DOM
   */
  function collectAutomationTypes(element) {
    const types = {};
    
    function visit(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const automationType = node.getAttribute('data-automation-type');
        if (automationType) {
          if (!types[automationType]) {
            types[automationType] = {
              count: 0,
              samples: []
            };
          }
          types[automationType].count++;
          
          // Collect sample info (first 3)
          if (types[automationType].samples.length < 3) {
            // className can be SVGAnimatedString for SVG elements
            let className = node.className;
            if (typeof className !== 'string') {
              className = className?.baseVal || '';
            }
            types[automationType].samples.push({
              tag: node.tagName.toLowerCase(),
              className: (className || '').slice(0, 80),
              text: (node.textContent || '').slice(0, 100).trim()
            });
          }
        }
        
        // Recurse into shadow DOM
        if (node.shadowRoot) {
          visit(node.shadowRoot);
        }
      }
      
      const children = node.childNodes || [];
      for (let i = 0; i < children.length; i++) {
        visit(children[i]);
      }
    }
    
    visit(element);
    return types;
  }
  
  async function exportLoopToTar() {
    const contentElement = findContentElement();
    
    if (!contentElement) {
      console.error('Could not find Loop content');
      alert('Could not find Loop content. Check console for debug info.');
      return;
    }
    
    console.log('loopd2: Content element found:', contentElement.tagName, contentElement.className.slice(0, 60));
    
    // Collect automation types before any DOM modifications
    console.log('loopd2: Collecting data-automation-type values...');
    const automationTypes = collectAutomationTypes(contentElement);
    
    console.log('loopd2: Expanding collapsed sections...');
    await expandAllCollapsedSections(contentElement);
    
    // Collect images from both light DOM and shadow DOM
    const imgElements = [];
    function collectImages(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'IMG') {
          imgElements.push(node);
        }
        if (node.shadowRoot) {
          collectImages(node.shadowRoot);
        }
      }
      const children = node.childNodes || [];
      for (let i = 0; i < children.length; i++) {
        collectImages(children[i]);
      }
    }
    collectImages(contentElement);
    console.log('loopd2: Images found:', imgElements.length);
    
    const urlMap = await downloadImages(imgElements);
    console.log('loopd2: Images downloaded:', Object.keys(urlMap).length);
    
    console.log('loopd2: Converting to markdown with remark...');
    const { markdown, rawMdast } = await convertToMarkdown(contentElement, urlMap);
    
    console.log('loopd2: Building tar archive...');
    const blob = await buildTarStreaming(urlMap, markdown, automationTypes, rawMdast);
    
    console.log('loopd2: Tar created:', Math.round(blob.size / 1024 / 1024) + 'MB');
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Generate friendly filename with page title and date
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD format
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':', '.');
    
    // Try to get page title from content area (not menubar)
    let pageTitle = '';
    // First try: Look for title within the content element we're exporting
    const contentTitleEl = contentElement.querySelector('.scriptor-pageTitle, [data-automation-type="Title"]');
    if (contentTitleEl) {
      pageTitle = contentTitleEl.textContent?.trim() || '';
    }
    // Second try: First h1 within content area
    if (!pageTitle) {
      const h1 = contentElement.querySelector('h1, [role="heading"][aria-level="1"]');
      if (h1) {
        pageTitle = h1.textContent?.trim() || '';
      }
    }
    // Third try: Document title (strip suffix like " - Microsoft Loop")
    if (!pageTitle) {
      pageTitle = document.title?.replace(/\s*[-–—|].*$/, '').trim() || '';
    }
    
    // Sanitize for cross-platform filename compatibility
    // Windows forbidden: < > : " / \ | ? *
    // macOS forbidden: : /
    // Linux forbidden: / null
    // Also remove control characters and leading/trailing dots/spaces
    pageTitle = pageTitle
      .slice(0, 60)                          // Limit length
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove forbidden chars
      .replace(/\s+/g, ' ')                  // Collapse whitespace
      .replace(/^[\s.]+|[\s.]+$/g, '')       // Trim spaces and dots
      .trim();
    
    const filename = pageTitle 
      ? `${pageTitle} - ${dateStr} at ${timeStr}.tar`
      : `Loop Export ${dateStr} at ${timeStr}.tar`;
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    await clearDB();
    console.log('loopd2: Export complete!');
  }
  
  // ============================================================
  // Initialize and Run
  // ============================================================
  
  console.log('loopd2: Initializing IndexedDB...');
  await initDB();
  await clearDB();
  console.log('loopd2: Ready.');
  
  // Expose loopd() globally for re-running exports
  window.loopd = async function() {
    await clearDB();
    await exportLoopToTar();
  };
  
  await exportLoopToTar();
  
})().catch(err => {
  console.error('loopd2 error:', err);
});
