import React from 'react';

/**
 * Minimal safe markdown for chat messages.
 *
 * Block level:
 * - # through ###### headings
 * - unordered lists (- , * , +)
 * - ordered lists (1. / 1) )
 * - > blockquotes
 * - ``` fenced code blocks
 * - paragraphs separated by blank lines, single \n => <br>
 *
 * Inline level:
 * - `inline code`
 * - **bold** / __bold__
 * - *italic* / _italic_ (single delimiter)
 * - ~~strikethrough~~
 * - [label](https://url)
 *
 * No HTML is ever interpreted — all text is rendered as React text nodes,
 * only our own formatting elements are created. Links are limited to
 * http(s)/mailto targets, so no script execution or HTML injection is
 * possible through message content.
 */

type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'strike'; children: InlineNode[] }
  | { type: 'link'; label: string; url: string; children: InlineNode[] };

function isSafeUrl(url: string): boolean {
  // Only allow http(s) and mailto for safety.
  return /^(https?:\/\/|mailto:)/i.test(url);
}

function findEarliest(
  str: string,
): {
  index: number;
  length: number;
  type: 'code' | 'link' | 'bold' | 'bold2' | 'italic' | 'italic2' | 'strike';
  match: RegExpExecArray;
} | null {
  // Ordered by priority for same-start matches (code > link > bold > strike > italic)
  const patterns: Array<{
    type: 'code' | 'link' | 'bold' | 'bold2' | 'italic' | 'italic2' | 'strike';
    regex: RegExp;
  }> = [
    { type: 'code', regex: /`([^`\n]+?)`/g },
    // link with http(s) only
    { type: 'link', regex: /\[([^\]\n]+?)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g },
    { type: 'bold', regex: /\*\*([^\n]+?)\*\*/g },
    { type: 'bold2', regex: /__([^\n]+?)__/g },
    { type: 'strike', regex: /~~([^\n~]+?)~~/g },
    // italic: single * or _ not part of ** or __. Use negative lookahead/behind-ish
    { type: 'italic', regex: /(?:^|[^*])\*([^*\n]+?)\*(?:[^*]|$)/g },
    { type: 'italic2', regex: /(?:^|[^_])_([^_\n]+?)_(?:[^_]|$)/g },
  ];

  let best: {
    index: number;
    length: number;
    type: 'code' | 'link' | 'bold' | 'bold2' | 'italic' | 'italic2' | 'strike';
    match: RegExpExecArray;
  } | null = null;

  for (const p of patterns) {
    p.regex.lastIndex = 0;
    const m = p.regex.exec(str);
    if (!m) continue;
    let idx = m.index;
    let len = m[0].length;
    // For italic patterns we included surrounding char in match due to lookaround workaround
    if (p.type === 'italic' || p.type === 'italic2') {
      // The actual delimiter may be preceded by a char we captured via (?:^|[^*])
      // Adjust index to the position of * or _
      const delimChar = p.type === 'italic' ? '*' : '_';
      const offset = m[0].indexOf(delimChar);
      if (offset > 0 && m[0][0] !== delimChar) {
        idx += offset;
        len -= offset;
        // If we also have trailing char (when [^*] matched after), trim it
        if (len > 1 && m[0][m[0].length - 1] !== delimChar) {
          const last = m[0][m[0].length - 1];
          if (last !== '*' && last !== '_' && last !== undefined) {
            len -= 1;
          }
        }
      }
    }
    if (
      best === null ||
      idx < best.index ||
      (idx === best.index && len > best.length)
    ) {
      best = { index: idx, length: len, type: p.type, match: m };
    }
  }
  return best;
}

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const hit = findEarliest(remaining);
    if (!hit) {
      nodes.push({ type: 'text', text: remaining });
      break;
    }
    if (hit.index > 0) {
      nodes.push({ type: 'text', text: remaining.slice(0, hit.index) });
    }
    const rawMatch = hit.match;
    // Extract inner content depending on type
    if (hit.type === 'code') {
      const inner = rawMatch[1] ?? '';
      nodes.push({ type: 'code', text: inner });
    } else if (hit.type === 'link') {
      const label = rawMatch[1] ?? '';
      const url = rawMatch[2] ?? '';
      if (isSafeUrl(url)) {
        nodes.push({
          type: 'link',
          label,
          url,
          children: parseInline(label),
        });
      } else {
        // unsafe url -> treat as text
        nodes.push({ type: 'text', text: remaining.slice(hit.index, hit.index + hit.length) });
      }
    } else if (hit.type === 'bold' || hit.type === 'bold2') {
      const inner = rawMatch[1] ?? '';
      nodes.push({ type: 'bold', children: parseInline(inner) });
    } else if (hit.type === 'strike') {
      const inner = rawMatch[1] ?? '';
      nodes.push({ type: 'strike', children: parseInline(inner) });
    } else if (hit.type === 'italic' || hit.type === 'italic2') {
      const inner = rawMatch[1] ?? '';
      nodes.push({ type: 'italic', children: parseInline(inner) });
    }
    remaining = remaining.slice(hit.index + hit.length);
  }
  return nodes;
}

function renderInlineNodes(nodes: InlineNode[], keyPrefix: number | string = ''): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    if (n.type === 'text') {
      return n.text;
    }
    if (n.type === 'code') {
      return (
        <code key={key} className="md-inline-code">
          {n.text}
        </code>
      );
    }
    if (n.type === 'bold') {
      return (
        <strong key={key} className="md-bold">
          {renderInlineNodes(n.children, key)}
        </strong>
      );
    }
    if (n.type === 'italic') {
      return (
        <em key={key} className="md-italic">
          {renderInlineNodes(n.children, key)}
        </em>
      );
    }
    if (n.type === 'strike') {
      return (
        <span key={key} className="md-strike">
          {renderInlineNodes(n.children, key)}
        </span>
      );
    }
    if (n.type === 'link') {
      return (
        <a
          key={key}
          className="md-link"
          href={n.url}
          target="_blank"
          rel="noopener noreferrer"
          // Stop long-press / context menu from triggering message actions when clicking a link
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {renderInlineNodes(n.children, key)}
        </a>
      );
    }
    return null;
  });
}

/* ------------------------------------------------------------------ */
/* Block parser                                                        */
/* ------------------------------------------------------------------ */

type Block =
  | { type: 'code'; text: string; lang?: string }
  | { type: 'heading'; level: number; raw: string }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'quote'; raw: string }
  | { type: 'paragraph'; raw: string };

// CommonMark-style line starts (up to 3 leading spaces tolerated).
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const UL_ITEM_RE = /^\s{0,3}[-*+]\s+(.+)$/;
const OL_ITEM_RE = /^\s{0,3}(\d{1,9})[.)]\s+(.+)$/;

/**
 * Splits a non-code segment into block-level constructs. Consecutive lines
 * of the same construct are grouped (lists, quotes); blank lines end all
 * open constructs; everything else accumulates into paragraphs.
 */
function parseRichBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  function flushParagraph() {
    if (paragraph.some((l) => l.trim() !== '')) {
      blocks.push({ type: 'paragraph', raw: paragraph.join('\n') });
    }
    paragraph = [];
  }

  function flushQuote() {
    if (quote.some((l) => l.trim() !== '')) {
      blocks.push({ type: 'quote', raw: quote.join('\n') });
    }
    quote = [];
  }

  function flushList() {
    if (list && list.items.length > 0) {
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        start: list.start,
        items: list.items,
      });
    }
    list = null;
  }

  function flushAll() {
    flushParagraph();
    flushQuote();
    flushList();
  }

  for (const line of lines) {
    if (line.trim() === '') {
      flushAll();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushAll();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        // An optional closing sequence of #s is decoration, not content.
        raw: heading[2].replace(/\s+#+$/, ''),
      });
      continue;
    }

    const quoteLine = QUOTE_RE.exec(line);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }

    const ulItem = UL_ITEM_RE.exec(line);
    if (ulItem) {
      flushParagraph();
      flushQuote();
      if (list && !list.ordered) {
        list.items.push(ulItem[1]);
      } else {
        flushList();
        list = { ordered: false, start: 1, items: [ulItem[1]] };
      }
      continue;
    }

    const olItem = OL_ITEM_RE.exec(line);
    if (olItem) {
      flushParagraph();
      flushQuote();
      if (list && list.ordered) {
        list.items.push(olItem[2]);
      } else {
        flushList();
        list = { ordered: true, start: parseInt(olItem[1], 10), items: [olItem[2]] };
      }
      continue;
    }

    // Plain text line: ends quotes and lists, extends the paragraph.
    flushQuote();
    flushList();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}

function parseBlocks(input: string): Block[] {
  const blocks: Block[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = codeBlockRegex.exec(input)) !== null) {
    const before = input.slice(lastIndex, m.index);
    if (before) {
      blocks.push(...parseRichBlocks(before));
    }
    const lang = m[1];
    const text = m[2] ?? '';
    blocks.push({ type: 'code', text: text.replace(/\n$/, ''), lang });
    lastIndex = m.index + m[0].length;
  }
  const after = input.slice(lastIndex);
  if (after) {
    blocks.push(...parseRichBlocks(after));
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** Line-broken inline content, shared by paragraphs and quotes. */
function Lines({ raw, keyPrefix }: { raw: string; keyPrefix: string }) {
  const lines = raw.split('\n');
  return (
    <>
      {lines.map((line, li) => (
        <React.Fragment key={`${keyPrefix}-${li}`}>
          {renderInlineNodes(parseInline(line), `${keyPrefix}-${li}`)}
          {li < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </>
  );
}

export function MarkdownText({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);

  if (blocks.length === 0) return null;

  return (
    <span className="md-root">
      {blocks.map((b, i) => {
        if (b.type === 'code') {
          return (
            <pre key={i} className="md-code-block">
              <code>{b.text}</code>
            </pre>
          );
        }
        if (b.type === 'heading') {
          const level = Math.min(Math.max(b.level, 1), 6);
          return React.createElement(
            `h${level}`,
            { key: i, className: `md-heading md-h${level}` },
            renderInlineNodes(parseInline(b.raw), `h${i}`),
          );
        }
        if (b.type === 'list') {
          const items = b.items.map((item, ii) => (
            <li key={ii}>{renderInlineNodes(parseInline(item), `li${i}-${ii}`)}</li>
          ));
          return b.ordered ? (
            <ol
              key={i}
              className="md-list"
              start={b.start !== 1 ? b.start : undefined}
            >
              {items}
            </ol>
          ) : (
            <ul key={i} className="md-list">
              {items}
            </ul>
          );
        }
        if (b.type === 'quote') {
          return (
            <blockquote key={i} className="md-quote">
              <Lines raw={b.raw} keyPrefix={`q${i}`} />
            </blockquote>
          );
        }
        // paragraph
        const isLast = i === blocks.length - 1;
        return (
          <span key={i} className="md-paragraph">
            <Lines raw={b.raw} keyPrefix={`p${i}`} />
            {!isLast && <span className="md-paragraph-gap" />}
          </span>
        );
      })}
    </span>
  );
}

export default MarkdownText;
