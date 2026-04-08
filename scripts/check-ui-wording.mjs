#!/usr/bin/env node
/**
 * UI 文言チェッカ
 *
 * 目的: ユーザー画面に表示される文字列に「独特な英略語」「設計基準と異なる用語」が
 *      混入することを防ぐ。設計基準（土地改良パイプライン技術書）に揃えた呼称を維持する。
 *
 * 仕組み:
 *   TypeScript の AST を歩き、ユーザーに表示される可能性が高い文字列ノードのみ
 *   を対象に禁止語をチェックする。コード識別子・import・型注釈・コメントは対象外。
 *
 * チェック対象:
 *   1. JSX テキスト（<div>これ</div>）
 *   2. JSX 属性 title / aria-label / placeholder / alt / label の文字列
 *   3. オブジェクトプロパティで、キーが {title, label, name, desc, description,
 *      text, message, hint, tooltip, ariaLabel, placeholder} の文字列値
 *
 * 使い方:
 *   node scripts/check-ui-wording.mjs
 *
 * 禁止語の追加: 下の FORBIDDEN 配列に { term, reason, suggest } を追加。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const TARGET_DIRS = [
  join(REPO_ROOT, 'apps', 'web-free', 'src'),
];

/** @type {{ term: RegExp, reason: string, suggest: string }[]} */
const FORBIDDEN = [
  {
    term: /\bMOC\b/,
    reason: '設計基準（技術書 §8.3.4）では「数値解法 / 数値解析」、その下位の手法として「特性曲線法」と呼称している。英略語 MOC をユーザー画面に出さない。',
    suggest: '一般カテゴリは「数値解析」、アルゴリズム参照が必要なら「特性曲線法」を使う',
  },
];

const UI_ATTR_NAMES = new Set([
  'title', 'aria-label', 'ariaLabel', 'placeholder', 'alt', 'label',
]);

const UI_PROPERTY_KEYS = new Set([
  'title', 'label', 'name', 'desc', 'description', 'text',
  'message', 'hint', 'tooltip', 'ariaLabel', 'placeholder',
]);

/** @type {{ file: string, line: number, col: number, text: string, rule: typeof FORBIDDEN[number] }[]} */
const violations = [];

function walkDir(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...walkDir(p));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

function checkString(text, file, pos, sourceFile) {
  for (const rule of FORBIDDEN) {
    if (rule.term.test(text)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
      violations.push({
        file: relative(REPO_ROOT, file),
        line: line + 1,
        col: character + 1,
        text: text.trim().slice(0, 80),
        rule,
      });
    }
  }
}

function getStringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  // テンプレートリテラルも head 部分はチェック
  if (ts.isTemplateExpression(node)) {
    return node.head.text;
  }
  return null;
}

function processFile(file) {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function visit(node) {
    // (1) JSX テキスト
    if (ts.isJsxText(node)) {
      const text = node.text;
      if (text.trim()) {
        checkString(text, file, node.getStart(sf), sf);
      }
    }

    // (2) JSX 属性
    if (ts.isJsxAttribute(node) && node.name && ts.isIdentifier(node.name)) {
      const attrName = node.name.text;
      if (UI_ATTR_NAMES.has(attrName) && node.initializer) {
        let valueNode = node.initializer;
        if (ts.isJsxExpression(valueNode) && valueNode.expression) {
          valueNode = valueNode.expression;
        }
        const v = getStringValue(valueNode);
        if (v) checkString(v, file, valueNode.getStart(sf), sf);
      }
    }

    // (3) オブジェクトプロパティ（label/desc/title 等）
    if (ts.isPropertyAssignment(node) && node.name) {
      let key = null;
      if (ts.isIdentifier(node.name)) key = node.name.text;
      else if (ts.isStringLiteral(node.name)) key = node.name.text;
      if (key && UI_PROPERTY_KEYS.has(key)) {
        const v = getStringValue(node.initializer);
        if (v) checkString(v, file, node.initializer.getStart(sf), sf);
      }
    }

    // (4) JSX 式コンテナ内の単純な文字列リテラル {'foo'}
    if (ts.isJsxExpression(node) && node.expression) {
      const v = getStringValue(node.expression);
      if (v) checkString(v, file, node.expression.getStart(sf), sf);
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
}

for (const dir of TARGET_DIRS) {
  for (const file of walkDir(dir)) {
    processFile(file);
  }
}

if (violations.length === 0) {
  console.log('UI 文言チェック: OK (禁止語なし)');
  process.exit(0);
}

console.error(`UI 文言チェック: ${violations.length} 件の禁止語使用を検出\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}:${v.col}`);
  console.error(`    "${v.text}"`);
  console.error(`    → ${v.rule.reason}`);
  console.error(`    推奨: ${v.rule.suggest}\n`);
}
process.exit(1);
