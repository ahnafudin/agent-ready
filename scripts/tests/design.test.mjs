// DESIGN.md keeps the open DESIGN.md format, and the design check reads it the way the format means.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AA_NORMAL, blend, contrastRatio, designProblems, isLargeText, parseColor, parseYaml, SECTIONS } from "../lib/design.mjs";
import { at } from "../lib/util.mjs";

const doc = (front, body = "") => `---\n${front}\n---\n${body}`;
const ratio = (a, b) => contrastRatio(parseColor(a), parseColor(b));
const failures = (text) => designProblems(text).problems.join("\n");

describe("the shipped DESIGN.md", () => {
  const text = readFileSync(at("DESIGN.md"), "utf8");

  it("passes the design check with nothing left unread", () => {
    assert.deepEqual(designProblems(text), { problems: [], notes: [], pairs: 0 });
  });

  it("carries every section of the format, in order", () => {
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    assert.deepEqual(headings, SECTIONS.map((names) => names[0]));
  });
});

describe("front matter", () => {
  it("reads nested maps, lists of maps, quotes and comments", () => {
    const yaml = ["name: Daylight  # a comment", "colors:", '  primary: "#1A1C1E"', "omitted:", "  - spacing", "  - section: rounded", "    reason: 'none yet'"];
    assert.deepEqual(parseYaml(yaml.join("\n")), {
      name: "Daylight",
      colors: { primary: "#1A1C1E" },
      omitted: ["spacing", { section: "rounded", reason: "none yet" }],
    });
  });

  it("fails an unquoted colour, which YAML reads as a comment", () => {
    assert.match(failures(doc("colors:\n  primary: #1A1C1E")), /is a YAML comment/);
  });

  it("leaves YAML it does not read to the official linter instead of failing", () => {
    const { problems, notes } = designProblems(doc("colors: {primary: '#000000'}"));
    assert.deepEqual(problems, []);
    assert.match(notes.join("\n"), /design:lint/);
  });

  it("fails a reference to a token that does not exist", () => {
    const front = 'colors:\n  ink: "#111111"\ncomponents:\n  card:\n    textColor: "{colors.inc}"';
    assert.match(failures(doc(front)), /components\.card\.textColor points at \{colors\.inc\}/);
  });

  it("fails a front matter that never closes", () => {
    assert.match(failures("---\nname: x\n"), /never closes/);
  });
});

describe("sections", () => {
  it("fails a section that appears twice", () => {
    assert.match(failures("## Colors\n\n## Colors\n"), /more than once/);
  });

  it("fails sections out of the format's order", () => {
    assert.match(failures("## Colors\n\n## Overview\n"), /out of order/);
  });

  it("accepts a section the format does not name, and ignores headings inside code", () => {
    assert.equal(failures("## Overview\n\n## Iconography\n\n```\n## Colors\n## Colors\n```\n\n## Colors\n"), "");
  });
});

describe("contrast", () => {
  const pair = (text, back) => doc(`components:\n  x:\n    textColor: "${text}"\n    backgroundColor: "${back}"`);

  it("matches WCAG's reference values", () => {
    assert.equal(ratio("#000", "#fff").toFixed(2), "21.00");
    assert.equal(ratio("#777777", "#ffffff").toFixed(2), "4.48");
    assert.equal(ratio("#767676", "#ffffff").toFixed(2), "4.54");
  });

  it("compares the unrounded ratio, so 4.4957 fails 4.5", () => {
    const r = ratio("#507d8f", "#ffffff");
    assert.ok(r > 4.495 && r < AA_NORMAL, `ratio ${r}`);
    assert.match(failures(pair("#507d8f", "#ffffff")), /4\.49:1, below 4\.5:1 for normal text/);
  });

  it("treats 24px, or 18.67px bold, as large text and 18px bold as normal", () => {
    assert.equal(isLargeText({ fontSize: "24px", fontWeight: 400 }), true);
    assert.equal(isLargeText({ fontSize: "1.5rem" }), true);
    assert.equal(isLargeText({ fontSize: "18.67px", fontWeight: 700 }), true);
    assert.equal(isLargeText({ fontSize: "18px", fontWeight: 700 }), false);
    assert.equal(isLargeText({ fontSize: "20px", fontWeight: 400 }), false);
  });

  it("holds large text to 3:1 and normal text to 4.5:1", () => {
    const large = ["typography:", "  display:", "    fontSize: 32px", "components:", "  x:", '    textColor: "#949494"', '    backgroundColor: "#ffffff"', '    typography: "{typography.display}"'];
    assert.equal(failures(doc(large.join("\n"))), "", "#949494 on white is about 3.03:1, enough for large text");
    assert.match(failures(pair("#949494", "#ffffff")), /below 4\.5:1 for normal text/);
  });

  it("paints translucent text over its background before measuring", () => {
    assert.ok(contrastRatio(blend(parseColor("#00000014"), parseColor("#ffffff")), parseColor("#ffffff")) < 1.3);
    assert.match(failures(pair("#00000014", "#ffffff")), /components\.x/);
  });

  it("does not guess over a translucent background", () => {
    const { problems, notes } = designProblems(pair("#000000", "#ffffff80"));
    assert.deepEqual(problems, []);
    assert.match(notes.join("\n"), /translucent/);
  });

  it("checks a variant against its base component's text colour", () => {
    const front = ["components:", "  button:", '    textColor: "#ffffff"', '    backgroundColor: "#1a1c1e"', "  button-hover:", '    backgroundColor: "#dddddd"'];
    assert.match(failures(doc(front.join("\n"))), /components\.button-hover: text #ffffff on #dddddd/);
  });

  it("reads rgb() and hsl(), and says which colours it could not read", () => {
    assert.equal(ratio("rgb(0 0 0)", "hsl(0, 0%, 100%)").toFixed(2), "21.00");
    const { problems, notes } = designProblems(pair("oklch(0.2 0 0)", "#ffffff"));
    assert.deepEqual(problems, []);
    assert.match(notes.join("\n"), /not hex, rgb\(\) or hsl\(\)/);
  });
});
