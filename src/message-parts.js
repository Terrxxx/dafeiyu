// Blank lines mark separate chat bubbles; long paragraphs split at sentence boundaries.
export function messageParts(text, limit = 240) {
  const parts = [];
  for (const paragraph of String(text).split(/\n\s*\n/)) {
    let rest = paragraph.trim();
    while (Array.from(rest).length > limit) {
      const chars = Array.from(rest);
      let end = limit;
      for (let i = limit - 1; i >= Math.floor(limit / 2); i--) {
        if (/[。！？!?；;\n\s]/.test(chars[i])) { end = i + 1; break; }
      }
      // Keep URLs intact even when they cross the preferred bubble length.
      const offset = chars.slice(0, end).join('').length;
      const url = [...rest.matchAll(/https?:\/\/[^\s<>]+/g)].find(m => m.index < offset && m.index + m[0].length > offset);
      if (url) end = url.index > 0 ? Array.from(rest.slice(0, url.index)).length : Array.from(url[0]).length;
      const piece = chars.slice(0, end).join('').trim();
      if (piece.length > 1500) throw new Error('单个链接过长，无法分条发送');
      if (piece) parts.push(piece);
      rest = chars.slice(end).join('').trim();
    }
    if (rest) parts.push(rest);
  }
  if (!parts.length) throw new Error('消息不能为空');
  return parts;
}
