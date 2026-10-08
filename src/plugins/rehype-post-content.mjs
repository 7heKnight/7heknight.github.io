// Rehype plugin that post-processes rendered Markdown posts.
//
// Images that live under public/:
//  - replaces filename-style alt text ("image1.png") with the nearest heading,
//    so screenshots carry topical context for image search and screen readers;
//    hand-written alt text is left untouched
//  - adds intrinsic width/height (read from the PNG/JPEG header) so the browser
//    reserves space and the page does not shift while images load (CLS),
//    plus loading="lazy" / decoding="async" for those images
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const FILENAME_ALT = /^[\w .@()-]+\.(png|jpe?g|gif|webp|avif|svg)$/i;
const PNG_MAGIC = 0x89504e47;
const ALT_MAX = 125; // upper bound for useful alt text

const textOf = (node) =>
  node.type === 'text' ? node.value : (node.children ?? []).map(textOf).join('');

// Width/height from the file header: PNG (IHDR) and baseline/progressive JPEG (SOFn).
function imageSize(src) {
  let buf;
  try {
    buf = readFileSync(PUBLIC_DIR + decodeURIComponent(src).replace(/^\//, ''));
  } catch {
    throw new Error(`rehype-post-content: image not found under public/: ${src}`);
  }
  if (buf.length > 24 && buf.readUInt32BE(0) === PNG_MAGIC) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// Tables:
//  - wrapped in a keyboard-focusable, labelled scroll region so wide tables
//    scroll inside the article instead of widening the page (WCAG 2.1.1)

export default function rehypePostContent() {
  return (tree, file) => {
    const title = file.data?.astro?.frontmatter?.title ?? '';
    let heading = title;
    let figure = 0;
    let tables = 0;

    const walk = (node) => {
      if (node.type === 'element') {
        if (/^h[1-6]$/.test(node.tagName)) {
          heading = textOf(node).trim() || title;
          figure = 0;
        } else if (node.tagName === 'img') {
          figure += 1;
          const props = node.properties;
          const src = String(props.src ?? '');
          if (!src.startsWith('/') || src.startsWith('//')) return; // external or relative: leave alone
          if (!props.alt || FILENAME_ALT.test(String(props.alt))) {
            const suffix = ` (figure ${figure})`;
            const base = !title || heading === title ? heading : `${title}: ${heading}`;
            props.alt =
              base.length + suffix.length > ALT_MAX
                ? `${base.slice(0, ALT_MAX - suffix.length - 1)}…${suffix}`
                : base + suffix;
          }
          // Lazy-load only when the size is known; otherwise the late-loading
          // image would shift the layout. Unrecognised formats stay eager.
          const size = imageSize(src);
          if (size) Object.assign(props, size, { loading: 'lazy', decoding: 'async' });
        }
      }
      if (node.children) {
        node.children = node.children.map((child) => {
          walk(child);
          if (child.type !== 'element' || child.tagName !== 'table') return child;
          return {
            type: 'element',
            tagName: 'div',
            properties: { className: ['table-scroll'], role: 'region', tabIndex: 0, ariaLabel: `Table ${++tables}: ${heading}` },
            children: [child],
          };
        });
      }
    };
    walk(tree);
  };
}
