#!/usr/bin/env node
/** Build the immediate-route stylesheet from the existing canonical cascade. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const index = fs.readFileSync(path.join(site, "index.html"), "utf8");
const sources = ["styles.css", "theme-569.css", "design-system.css"];
const css = Object.fromEntries(sources.map(name => [name, fs.readFileSync(path.join(site, name), "utf8")]));

function compactCss(value) {
  let output = "", quote = null, escaped = false, whitespace = false;
  for (const character of value) {
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      if (whitespace && output && !"{(:;,>".includes(output.at(-1))) output += " ";
      whitespace = false; quote = character; output += character; continue;
    }
    if (/\s/.test(character)) { whitespace = true; continue; }
    if ("{}:;,>".includes(character)) {
      if (character === ":" && whitespace && output && !"{(:;,>".includes(output.at(-1))) output += " ";
      else output = output.replace(/ $/, "");
      if (!(character === "}" && output.endsWith(";"))) output += character;
      else output = output.slice(0, -1) + character;
      whitespace = false; continue;
    }
    if (whitespace && output && !"{(:;,>".includes(output.at(-1))) output += " ";
    whitespace = false; output += character;
  }
  return output.trim() + "\n";
}

function parseRules(source) {
  const rules = [];
  let cursor = 0;
  const skipTrivia = () => {
    while (cursor < source.length) {
      if (/\s/.test(source[cursor])) { cursor += 1; continue; }
      if (source.startsWith("/*", cursor)) {
        const end = source.indexOf("*/", cursor + 2);
        cursor = end < 0 ? source.length : end + 2;
        continue;
      }
      break;
    }
  };
  const cleanHeader = value => value.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim();
  while (cursor < source.length) {
    skipTrivia();
    if (cursor >= source.length) break;
    const start = cursor;
    let quote = null, escaped = false, comment = false, delimiter = null;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor], next = source[cursor + 1];
      if (comment) { if (character === "*" && next === "/") { comment = false; cursor += 1; } continue; }
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === "/" && next === "*") { comment = true; cursor += 1; continue; }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === "{" || character === ";") { delimiter = character; break; }
    }
    const header = cleanHeader(source.slice(start, cursor));
    if (!delimiter) break;
    if (delimiter === ";") {
      cursor += 1;
      if (header) rules.push({ header, statement: true });
      continue;
    }
    cursor += 1;
    const bodyStart = cursor;
    let depth = 1; quote = null; escaped = false; comment = false;
    for (; cursor < source.length && depth > 0; cursor += 1) {
      const character = source[cursor], next = source[cursor + 1];
      if (comment) { if (character === "*" && next === "/") { comment = false; cursor += 1; } continue; }
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === "/" && next === "*") { comment = true; cursor += 1; continue; }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
    const body = source.slice(bodyStart, Math.max(bodyStart, cursor - 1));
    if (header) rules.push({ header, body });
  }
  return rules;
}

const preservedAtRule = header => /^@(?:-webkit-)?keyframes\b|^@(?:font-face|property|font-feature-values|counter-style|page)\b/i.test(header);
const nestedAtRule = header => /^@(?:media|supports|container|layer|scope|document|starting-style)\b/i.test(header);
function buildRuleTree(source) {
  return parseRules(source).map(rule => !rule.statement && rule.header.startsWith("@") && nestedAtRule(rule.header)
    ? { ...rule, children: buildRuleTree(rule.body) }
    : rule);
}
function collectSelectors(rules, output = new Set()) {
  for (const rule of rules) {
    if (rule.children) collectSelectors(rule.children, output);
    else if (!rule.statement && !rule.header.startsWith("@")) output.add(rule.header);
  }
  return output;
}
function serializeRules(rules, accepted) {
  return rules.map(rule => {
    if (rule.statement) return /^@(?:charset|namespace|layer)\b/i.test(rule.header) ? `${rule.header};` : "";
    if (!rule.header.startsWith("@")) return accepted.has(rule.header) ? `${rule.header}{${rule.body}}` : "";
    if (preservedAtRule(rule.header) || !rule.children) return `${rule.header}{${rule.body}}`;
    const body = serializeRules(rule.children, accepted);
    return body ? `${rule.header}{${body}}` : "";
  }).filter(Boolean).join("\n");
}

function serializeRejectedRules(rules, accepted) {
  return rules.map(rule => {
    if (rule.statement) return /^@(?:charset|namespace|layer)\b/i.test(rule.header) ? `${rule.header};` : "";
    if (!rule.header.startsWith("@")) return accepted.has(rule.header) ? "" : `${rule.header}{${rule.body}}`;
    if (preservedAtRule(rule.header) || !rule.children) return "";
    const body = serializeRejectedRules(rule.children, accepted);
    return body ? `${rule.header}{${body}}` : "";
  }).filter(Boolean).join("\n");
}

const trees = Object.fromEntries(["styles.css", "design-system.css"].map(name => [name, buildRuleTree(css[name])]));
const selectors = [...new Set(Object.values(trees).flatMap(tree => [...collectSelectors(tree)]))];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(index.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
  const acceptedSelectors = await page.evaluate(selectors => {
    const corePages = new Set(["dashboard", "tonight", "schedule", "games"]);
    document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", corePages.has(page.id)));
    document.documentElement.dataset.theme = "dark";

    const routePattern = /(?:\.|#)(?:home|watch-next|visit|dashboard|tonight|calendar|schedule-pressure|game-centre|game-detail|quick-game|game-hero|story-chapter|chapter-nav|chapter-return|season-file|season-state)[\w-]*/i;
    const dynamicPseudos = /::(?:before|after|marker|placeholder|backdrop)|:(?:hover|active|focus|focus-visible|focus-within|visited|target|checked|disabled|enabled|open)\b/g;
    const belongsToCore = element => {
      const page = element.closest?.(".page");
      if (!page) return true;
      if (!corePages.has(page.id)) return false;
      if (page.id === "schedule") {
        const chapter = element.closest?.(".schedule-chapter");
        if (chapter && chapter.id !== "schedule-calendar-chapter") return false;
      }
      if (page.id === "games") {
        const pane = element.closest?.(".game-centre-pane");
        if (pane && pane.dataset.gamePane !== "featured") return false;
      }
      return true;
    };
    const targetsCore = selector => {
      if (routePattern.test(selector)) return true;
      const query = selector.replace(dynamicPseudos, "");
      try {
        return [...document.querySelectorAll(query)].some(belongsToCore);
      } catch (_) {
        return false;
      }
    };
    return selectors.filter(targetsCore);
  }, selectors);
  const accepted = new Set(acceptedSelectors);
  const coreOutput = `/* Generated by scripts/extract_core_styles.mjs. Keep canonical rules in their source files. */\n${serializeRules(trees["styles.css"], accepted)}\n${css["theme-569.css"]}\n${serializeRules(trees["design-system.css"], accepted)}\n`;
  const fullOutput = `/* Generated deep-route remainder. Core declarations are already active in core-routes.css. */\n${serializeRejectedRules(trees["styles.css"], accepted)}\n${serializeRejectedRules(trees["design-system.css"], accepted)}\n`;
  const compact = compactCss(coreOutput);
  const fullCompact = compactCss(fullOutput);
  const emptyDeclaration = `${compact}\n${fullCompact}`.match(/[\w-]+:;/);
  if (emptyDeclaration) throw new Error(`Generated CSS contains an empty declaration: ${emptyDeclaration[0]}`);
  fs.writeFileSync(path.join(site, "core-routes.css"), compact);
  fs.writeFileSync(path.join(site, "full-routes.css"), fullCompact);
  console.log(`core-routes.css=${Buffer.byteLength(compact)} bytes`);
  console.log(`full-routes.css=${Buffer.byteLength(fullCompact)} bytes`);
} finally {
  await browser.close();
}
