// scripts/lib/design.mjs — reads DESIGN.md (the open DESIGN.md format) and lists what breaks it.
// Tokens come from the front matter, read as the block-style YAML subset the format uses.

/** The format's section order; each entry lists the headings it accepts for that section. */
export const SECTIONS = [
  ["Overview", "Brand & Style"],
  ["Colors"],
  ["Typography"],
  ["Layout", "Layout & Spacing"],
  ["Elevation & Depth", "Elevation"],
  ["Shapes"],
  ["Components"],
  ["Do's and Don'ts"],
];

/** WCAG 2.2 AA minimums, and the sizes where text counts as large (24px, or 14pt ≈ 18.67px bold). */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;
const LARGE_PX = 24;
const LARGE_BOLD_PX = 56 / 3;

/** `{ yaml, body }`; `yaml` is null without front matter, and `unclosed` flags a missing closing fence. */
export function splitFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return { yaml: null, body: text };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { yaml: null, body: text, unclosed: true };
  return { yaml: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

const isItem = (text) => text === "-" || text.startsWith("- ");
const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'#{[][^:]*?)\s*:(?:\s+(.*))?$/;

/** A front matter this reader cannot follow; `broken` marks YAML that is wrong, not merely unsupported. */
export class YamlError extends Error {
  constructor(message, broken = false) {
    super(message);
    this.broken = broken;
  }
}

function scalar(raw, n) {
  const v = raw.trim();
  if (v.startsWith("#")) throw new YamlError(`line ${n}: an unquoted value starting with # is a YAML comment — write "${v}"`, true);
  if (/^[[{&*|>!%@`]/.test(v)) throw new YamlError(`line ${n}: flow, anchor or block syntax`);
  if (v.startsWith('"') || v.startsWith("'")) {
    const q = v[0];
    let end = 1;
    while (end < v.length && (v[end] !== q || (q === '"' && v[end - 1] === "\\"))) end++;
    if (end >= v.length) throw new YamlError(`line ${n}: a quoted value that continues on the next line`);
    const tail = v.slice(end + 1).trim();
    if (tail && !tail.startsWith("#")) throw new YamlError(`line ${n}: text after a quoted value`, true);
    return q === '"' ? v.slice(1, end).replace(/\\"/g, '"') : v.slice(1, end);
  }
  return v.replace(/\s+#.*$/, "");
}

function unquote(key) {
  return /^["']/.test(key) ? key.slice(1, -1) : key;
}

function parseMap(lines, i, indent) {
  const map = {};
  while (i < lines.length && lines[i].indent === indent && !isItem(lines[i].text)) {
    const { n, text } = lines[i];
    const m = text.match(KEY);
    if (!m) throw new YamlError(`line ${n}: expected "key: value"`);
    const key = unquote(m[1]);
    i++;
    if (m[2] !== undefined && m[2].trim() !== "") map[key] = scalar(m[2], n);
    else if (i < lines.length && lines[i].indent > indent) [map[key], i] = parseBlock(lines, i);
    else if (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) [map[key], i] = parseList(lines, i);
    else map[key] = null;
  }
  if (i < lines.length && lines[i].indent > indent) throw new YamlError(`line ${lines[i].n}: unexpected indentation`);
  return [map, i];
}

function parseList(lines, i) {
  const indent = lines[i].indent;
  const list = [];
  while (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) {
    const { n, text } = lines[i];
    const rest = text.replace(/^-\s*/, "");
    if (rest === "") {
      i++;
      if (i < lines.length && lines[i].indent > indent) {
        let item;
        [item, i] = parseBlock(lines, i);
        list.push(item);
      } else list.push(null);
    } else if (KEY.test(rest)) {
      lines[i] = { n, indent: indent + text.length - rest.length, text: rest };
      let item;
      [item, i] = parseMap(lines, i, lines[i].indent);
      list.push(item);
    } else {
      list.push(scalar(rest, n));
      i++;
    }
  }
  return [list, i];
}

function parseBlock(lines, i) {
  return isItem(lines[i].text) ? parseList(lines, i) : parseMap(lines, i, lines[i].indent);
}

/** Parses block-style YAML (maps, lists, scalars, comments); throws on flow, anchors and block scalars. */
export function parseYaml(src) {
  const lines = [];
  src.split(/\r?\n/).forEach((raw, idx) => {
    if (!raw.trim() || raw.trimStart().startsWith("#")) return;
    const lead = raw.match(/^\s*/)[0];
    if (lead.includes("\t")) throw new YamlError(`line ${idx + 1}: YAML forbids a tab in the indentation`, true);
    lines.push({ n: idx + 1, indent: lead.length, text: raw.trim() });
  });
  if (lines.length === 0) return {};
  const [value, i] = parseBlock(lines, 0);
  if (i < lines.length) throw new YamlError(`line ${lines[i].n}: unexpected indentation`);
  return value;
}

const REF = /^\{([^{}]+)\}$/;

/** Follows `{path.to.token}` references; returns `{ value }`, or `{ broken }` naming the missing path. */
export function resolveRef(value, tokens, depth = 0) {
  const m = typeof value === "string" && value.match(REF);
  if (!m) return { value };
  if (depth > 10) return { broken: `${m[1]} (a reference loop)` };
  const found = m[1].split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), tokens);
  return found === undefined || found === null ? { broken: m[1] } : resolveRef(found, tokens, depth + 1);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const part = (s, scale) => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s));

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/** `{ r, g, b, a }` (channels 0–255, alpha 0–1) for hex, rgb() and hsl(); null for other formats. */
export function parseColor(value) {
  const v = String(value).trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
    const byte = (at) => parseInt(h.slice(at, at + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: h.length === 8 ? byte(6) / 255 : 1 };
  }
  m = v.match(/^(rgb|hsl)a?\(\s*([\d.]+(?:deg|%)?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
  if (!m) return null;
  const a = m[5] === undefined ? 1 : clamp(part(m[5], 1), 0, 1);
  if (m[1] === "rgb") return { r: clamp(part(m[2], 255), 0, 255), g: clamp(part(m[3], 255), 0, 255), b: clamp(part(m[4], 255), 0, 255), a };
  const rgb = hslToRgb(parseFloat(m[2]) % 360, clamp(part(m[3], 1), 0, 1), clamp(part(m[4], 1), 0, 1));
  return { ...rgb, a };
}

const linear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ({ r, g, b }) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** The WCAG contrast ratio of two opaque colours, unrounded. */
export function contrastRatio(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` painted over an opaque `bg`, as the eye sees it. */
export function blend(fg, bg) {
  const mix = (c) => fg[c] * fg.a + bg[c] * (1 - fg.a);
  return { r: mix("r"), g: mix("g"), b: mix("b"), a: 1 };
}

function px(size) {
  const m = String(size ?? "").trim().match(/^([\d.]+)(px|rem|em)$/);
  return m ? parseFloat(m[1]) * (m[2] === "px" ? 1 : 16) : null;
}

/** True for text WCAG treats as large: 24px, or 18.67px at weight 700 and above. */
export function isLargeText(typography) {
  const size = px(typography?.fontSize);
  if (size === null) return false;
  const weight = String(typography.fontWeight ?? "").trim() === "bold" ? 700 : parseFloat(typography.fontWeight);
  return size >= LARGE_PX || (size + 0.01 >= LARGE_BOLD_PX && weight >= 700);
}

/** Each component's own properties over those of its base (`button-primary` under `button-primary-hover`). */
function effectiveComponents(components) {
  const keys = Object.keys(components).sort((a, b) => a.length - b.length);
  const out = {};
  for (const key of keys) {
    const base = keys.filter((k) => k !== key && key.startsWith(`${k}-`)).at(-1);
    const own = components[key] && typeof components[key] === "object" ? components[key] : {};
    out[key] = { ...(base ? out[base] : {}), ...own };
  }
  return out;
}

function walkRefs(node, path, tokens, problems) {
  if (typeof node === "string") {
    const r = resolveRef(node, tokens);
    if (r.broken) problems.push(`${path} points at {${r.broken}}, which is not defined`);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walkRefs(v, path ? `${path}.${k}` : k, tokens, problems);
  }
}

function headings(body) {
  let fenced = false;
  const found = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /^## /.test(line)) found.push(line.slice(3).trim());
  }
  return found;
}

function checkSections(body, problems) {
  const seen = headings(body);
  const dupes = seen.filter((h, i) => seen.indexOf(h) !== i);
  for (const h of new Set(dupes)) problems.push(`"## ${h}" appears more than once, which the format rejects`);
  const order = seen.map((h) => SECTIONS.findIndex((names) => names.includes(h))).filter((i) => i >= 0);
  const sorted = [...order].sort((a, b) => a - b);
  if (order.some((v, i) => v !== sorted[i])) {
    problems.push(`sections are out of order; the format's order is ${SECTIONS.map((s) => s[0]).join(" → ")}`);
  }
}

function checkContrast(tokens, problems, notes) {
  const components = effectiveComponents(tokens.components && typeof tokens.components === "object" ? tokens.components : {});
  let pairs = 0;
  for (const [name, props] of Object.entries(components)) {
    if (props.textColor === undefined || props.backgroundColor === undefined) continue;
    const text = resolveRef(props.textColor, tokens);
    const back = resolveRef(props.backgroundColor, tokens);
    if (text.broken || back.broken) continue;
    const fg = parseColor(text.value);
    const bg = parseColor(back.value);
    if (!fg || !bg) {
      notes.push(`components.${name}: contrast not checked — "${!fg ? text.value : back.value}" is not hex, rgb() or hsl()`);
      continue;
    }
    if (bg.a < 1) {
      notes.push(`components.${name}: contrast not checked — the background is translucent, so the result depends on what is behind it`);
      continue;
    }
    const typo = resolveRef(props.typography, tokens).value;
    const large = isLargeText(typo && typeof typo === "object" ? typo : null);
    const need = large ? AA_LARGE : AA_NORMAL;
    const ratio = contrastRatio(blend(fg, bg), bg);
    pairs++;
    if (ratio < need) {
      const shown = Math.floor(ratio * 100) / 100;
      problems.push(
        `components.${name}: text ${text.value} on ${back.value} is ${shown.toFixed(2)}:1, below ${need}:1 for ${large ? "large" : "normal"} text (WCAG AA)`,
      );
    }
  }
  return pairs;
}

/** What breaks DESIGN.md: `problems` fail the gate, `notes` explain what was left unchecked. */
export function designProblems(text) {
  const problems = [];
  const notes = [];
  const { yaml, body, unclosed } = splitFrontMatter(text);
  if (unclosed) problems.push("the front matter opens with --- but never closes");
  checkSections(body, problems);
  if (yaml === null) return { problems, notes, pairs: 0 };
  let tokens;
  try {
    tokens = parseYaml(yaml);
  } catch (err) {
    if (err instanceof YamlError && err.broken) problems.push(`front matter ${err.message}`);
    else notes.push(`tokens not checked — ${err.message}; \`npm run design:lint\` reads any YAML`);
    return { problems, notes, pairs: 0 };
  }
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    problems.push("the front matter is not a map of token groups");
    return { problems, notes, pairs: 0 };
  }
  walkRefs(tokens, "", tokens, problems);
  const pairs = checkContrast(tokens, problems, notes);
  return { problems, notes, pairs };
}
