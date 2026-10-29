// A common Illustrator / SVG 1.1 export has a DOCTYPE even when its shapes
// don't need an external DTD. Never give that DTD to an XML parser: remove it
// locally and resolve only bounded, text-only internal general entities.
const MAX_ENTITY_COUNT = 128;
const MAX_ENTITY_DEPTH = 12;
const MAX_ENTITY_VALUE = 256 * 1024;
const MAX_ENTITY_REFERENCES = 20000;
const MAX_EXPANDED_XML = 2 * 1024 * 1024;
const NAME = /^[:_\p{L}][:_\p{L}\p{N}\p{M}.\-]*$/u;
const REFERENCE =
  /&(#x[0-9a-fA-F]+|#[0-9]+|[:_\p{L}][:_\p{L}\p{N}\p{M}.\-]*);/gu;
const BUILTIN = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
});
const ESCAPED = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
});

function invalid() {
  throw Error("SVG 的 DOCTYPE 或实体声明无效");
}

function boundedAppend(output, part, limit = MAX_ENTITY_VALUE) {
  if (output.length + part.length > limit)
    throw Error("SVG 实体展开内容过大，请在设计软件中展开并简化");
  return output + part;
}

// The terminal '>' may appear inside a quoted identifier, internal entity or
// comment. Track both quotes and internal-subset brackets instead of splitting
// on the first '>'. No external DTD is fetched or passed to DOMParser.
function readDoctype(xml, start) {
  let quote = "",
    depth = 0,
    subsetStart = -1,
    subsetEnd = -1;
  for (let i = start + 9; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end < 0) invalid();
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[") {
      if (depth++ === 0) subsetStart = i + 1;
    } else if (c === "]") {
      if (--depth < 0) invalid();
      if (depth === 0) subsetEnd = i;
    } else if (c === ">" && depth === 0) {
      if (subsetStart >= 0 !== subsetEnd >= 0) invalid();
      return {
        end: i + 1,
        subset: subsetStart < 0 ? "" : xml.slice(subsetStart, subsetEnd),
      };
    }
  }
  invalid();
}

function readDeclaration(text, start) {
  let quote = "";
  for (let i = start + 2; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i + 1;
  }
  invalid();
}

function readInternalEntities(subset) {
  const values = new Map(),
    external = new Set();
  let count = 0;
  for (let i = 0; i < subset.length; ) {
    if (subset.startsWith("<!--", i)) {
      const end = subset.indexOf("-->", i + 4);
      if (end < 0) invalid();
      i = end + 3;
      continue;
    }
    if (subset.startsWith("<?", i)) {
      const end = subset.indexOf("?>", i + 2);
      if (end < 0) invalid();
      i = end + 2;
      continue;
    }
    if (subset.startsWith("<![", i))
      throw Error("SVG 含有复杂的 DTD 条件声明，请在设计软件中展开后导出");
    if (!subset.startsWith("<!", i)) {
      i++;
      continue;
    }
    const end = readDeclaration(subset, i),
      declaration = subset.slice(i, end);
    i = end;
    if (!/^<!ENTITY\s/i.test(declaration)) continue;
    const spec = declaration.slice(8, -1).trim();
    // Parameter entities only affect the discarded DTD; never evaluate them.
    if (spec.startsWith("%")) continue;
    const parts = /^(\S+)\s+([\s\S]+)$/.exec(spec);
    if (!parts || !NAME.test(parts[1])) invalid();
    const name = parts[1],
      value = parts[2].trim();
    if (++count > MAX_ENTITY_COUNT)
      throw Error("SVG 实体声明过多，请在设计软件中展开并简化");
    if (values.has(name) || external.has(name)) invalid();
    // The five XML predefined entities always retain their standard meaning.
    if (Object.hasOwn(BUILTIN, name)) continue;
    if (/^(?:SYSTEM|PUBLIC)\s/i.test(value)) {
      external.add(name);
      continue;
    }
    const quote = value[0];
    if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) invalid();
    const literal = value.slice(1, -1);
    if (literal.includes(quote)) invalid();
    if (
      literal.includes("<") ||
      /%[:_\p{L}][:_\p{L}\p{N}\p{M}.\-]*;/u.test(literal)
    )
      throw Error("SVG 实体包含标签或参数实体，请在设计软件中展开后导出");
    values.set(name, literal);
  }
  return { values, external };
}

function characterReference(reference) {
  if (reference[0] !== "#") return null;
  const code =
    reference[1] === "x"
      ? Number.parseInt(reference.slice(2), 16)
      : Number.parseInt(reference.slice(1), 10);
  if (
    !Number.isInteger(code) ||
    !(
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
    )
  )
    invalid();
  return String.fromCodePoint(code);
}

function makeResolver(values, external) {
  const memo = new Map(),
    visiting = new Set();
  let referenceCount = 0;
  const resolve = (name) => {
    if (Object.hasOwn(BUILTIN, name)) return BUILTIN[name];
    if (external.has(name) || !values.has(name)) {
      const label = name.length > 80 ? name.slice(0, 80) + "…" : name;
      throw Error(
        `SVG 引用了外部或未定义实体「${label}」，请在设计软件中展开后导出`,
      );
    }
    if (memo.has(name)) return memo.get(name);
    if (visiting.has(name) || visiting.size >= MAX_ENTITY_DEPTH)
      throw Error("SVG 实体循环引用或嵌套过深，请在设计软件中展开后导出");
    visiting.add(name);
    const literal = values.get(name);
    let output = "",
      last = 0;
    const refs = new RegExp(REFERENCE.source, "gu");
    for (const match of literal.matchAll(refs)) {
      if (++referenceCount > MAX_ENTITY_REFERENCES)
        throw Error("SVG 实体引用过多，请在设计软件中展开并简化");
      const plain = literal.slice(last, match.index);
      if (plain.includes("&")) invalid();
      output = boundedAppend(output, plain);
      const token = match[1];
      output = boundedAppend(
        output,
        token[0] === "#" ? characterReference(token) : resolve(token),
      );
      last = match.index + match[0].length;
    }
    const tail = literal.slice(last);
    if (tail.includes("&")) invalid();
    output = boundedAppend(output, tail);
    visiting.delete(name);
    memo.set(name, output);
    return output;
  };
  return resolve;
}

// Replace named internal entities outside comments, CDATA, and processing
// instructions. Escaping the resulting text preserves attribute boundaries and
// prevents an entity from becoming markup, an event handler, or an extra node.
function replaceNamedEntities(xml, resolve) {
  const tokens = /<!--|<!\[CDATA\[|<\?|&/g;
  let output = "",
    last = 0,
    referenceCount = 0,
    match;
  while ((match = tokens.exec(xml))) {
    const start = match.index;
    if (match[0] !== "&") {
      const terminator =
        match[0] === "<!--" ? "-->" : match[0] === "<?" ? "?>" : "]]>";
      const end = xml.indexOf(terminator, tokens.lastIndex);
      if (end < 0) invalid();
      tokens.lastIndex = end + terminator.length;
      continue;
    }
    const reference =
      /^&(#x[0-9a-fA-F]+|#[0-9]+|[:_\p{L}][:_\p{L}\p{N}\p{M}.\-]*);/u.exec(
        xml.slice(start),
      );
    if (
      !reference ||
      reference[1][0] === "#" ||
      Object.hasOwn(BUILTIN, reference[1])
    )
      continue;
    if (++referenceCount > MAX_ENTITY_REFERENCES)
      throw Error("SVG 实体引用过多，请在设计软件中展开并简化");
    const value = resolve(reference[1]).replace(/[&<>"']/g, (c) => ESCAPED[c]);
    output = boundedAppend(output, xml.slice(last, start), MAX_EXPANDED_XML);
    output = boundedAppend(output, value, MAX_EXPANDED_XML);
    last = start + reference[0].length;
    tokens.lastIndex = last;
  }
  return boundedAppend(output, xml.slice(last), MAX_EXPANDED_XML);
}

export function sanitizeSvgXml(xml) {
  const tokens = /<!--|<!\[CDATA\[|<\?|<!DOCTYPE\b|<!ENTITY\b/gi;
  let match,
    doctype = null;
  while ((match = tokens.exec(xml))) {
    const token = match[0].toUpperCase();
    if (token === "<!--" || token === "<![CDATA[" || token === "<?") {
      const terminator =
        token === "<!--" ? "-->" : token === "<?" ? "?>" : "]]>";
      const end = xml.indexOf(terminator, tokens.lastIndex);
      if (end < 0) invalid();
      tokens.lastIndex = end + terminator.length;
      continue;
    }
    if (token === "<!ENTITY" || doctype) invalid();
    doctype = { start: match.index, ...readDoctype(xml, match.index) };
    tokens.lastIndex = doctype.end;
  }
  const { values, external } = readInternalEntities(doctype?.subset || "");
  const stripped = doctype
    ? xml.slice(0, doctype.start) + "\n" + xml.slice(doctype.end)
    : xml;
  return replaceNamedEntities(stripped, makeResolver(values, external));
}
