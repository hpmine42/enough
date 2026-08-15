import React from 'react';

/**
 * Minimal safe markdown for chat messages.
 * Supports:
 * - ```code blocks```
 * - `inline code`
 * - **bold** / __bold__
 * - *italic* / _italic_ (single delimiter)
 * - ~~strikethrough~~
 * - [label](https://url)
 * - paragraphs separated by blank lines, single \n => <br>
 *
 * No HTML is ever interpreted — all text is rendered as React text nodes,
 * only our own formatting elements are created.
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

// Block parser

type Block =
  | { type: 'code'; text: string; lang?: string }
  | { type: 'paragraph'; raw: string };

function parseBlocks(input: string): Block[] {
  const blocks: Block[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = codeBlockRegex.exec(input)) !== null) {
    const before = input.slice(lastIndex, m.index);
    if (before) {
      // Push paragraph blocks for text before code block
      // Split by blank lines? Keep as one raw that will be further split into lines later.
      blocks.push(...splitParagraphs(before));
    }
    const lang = m[1];
    const text = m[2] ?? '';
    blocks.push({ type: 'code', text: text.replace(/\n$/, ''), lang });
    lastIndex = m.index + m[0].length;
  }
  const after = input.slice(lastIndex);
  if (after) {
    blocks.push(...splitParagraphs(after));
  }
  // If no code blocks, splitParagraphs will handle whole input
  if (blocks.length === 0 && input) {
    blocks.push(...splitParagraphs(input));
  }
  return blocks;
}

function splitParagraphs(text: string): Block[] {
  // Normalize \r\n
  const normalized = text.replace(/\r\n/g, '\n');
  // Split by two or more newlines into paragraphs
  const parts = normalized.split(/\n{2,}/);
  const out: Block[] = [];
  for (const p of parts) {
    if (p.trim() === '') continue;
    out.push({ type: 'paragraph', raw: p });
  }
  return out;
}

function Paragraph({ raw, idx }: { raw: string; idx: number }) {
  // Split by single newline — each newline becomes <br> except last
  const lines = raw.split('\n');
  return (
    <>
      {lines.map((line, li) => {
        const inline = parseInline(line);
        return (
          <React.Fragment key={`${idx}-${li}`}>
            {renderInlineNodes(inline, `${idx}-${li}`)}
            {li < lines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
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
        // paragraph
        const isLast = i === blocks.length - 1;
        return (
          <span key={i} className="md-paragraph">
            <Paragraph raw={b.raw} idx={i} />
            {!isLast && <span className="md-paragraph-gap" />}
          </span>
        );
      })}
    </span>
  );
}

export default MarkdownText;
