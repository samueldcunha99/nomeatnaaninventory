import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { pageTutorials, getPageTutorial, tutorialMessages, type TutorialTopic } from './page-tutorials.ts';
import { translator } from './i18n/index.ts';

const pages = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(item =>
  item.isDirectory() ? pages(join(dir, item.name)) : item.name === 'page.tsx' ? [join(dir, item.name)] : []);

test('every rendered page has a specific tutorial; redirected day sheets use the destination report', () => {
  const used = new Set<string>();
  for (const file of pages('app')) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const guides: ts.JsxAttributes[] = [];
    let redirects = false;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'redirect') redirects = true;
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'PageTutorial') guides.push(node.attributes);
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (file.replaceAll('\\', '/') === 'app/production/[date]/page.tsx') { assert.ok(redirects); continue; }
    assert.equal(guides.length, 1, `Missing/duplicate tutorial in ${file}`);
    const topic = guides[0].properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'topic');
    assert.ok(topic && ts.isJsxAttribute(topic) && topic.initializer && ts.isStringLiteral(topic.initializer), file);
    assert.ok(Object.hasOwn(pageTutorials, topic.initializer.text), file);
    assert.ok(!used.has(topic.initializer.text), `Generic tutorial reused by ${file}`);
    used.add(topic.initializer.text);
    if (!['login', 'tracking'].includes(topic.initializer.text)) {
      const role = guides[0].properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'role');
      assert.ok(role && /\b(?:actor|user)\.role\b/.test(role.getText(source)), `Role context missing in ${file}`);
    }
  }
  assert.deepEqual([...used].sort(), Object.keys(pageTutorials).sort());
});

test('every tutorial sentence and heading is translated into Hindi and Marathi without an English fallback', () => {
  for (const [english, pair] of Object.entries(tutorialMessages)) {
    assert.equal(pair.length, 2, english);
    for (const [i, locale] of ['hi', 'mr'].entries()) {
      assert.match(pair[i], /[\u0900-\u097f]/, english);
      assert.equal(translator(locale as 'hi' | 'mr')(english), pair[i], english);
    }
  }
  for (const topic of Object.keys(pageTutorials) as TutorialTopic[]) {
    for (const role of [undefined, 'owner', 'manager', 'counter', 'kitchen'] as const) {
      const guide = getPageTutorial(topic, role);
      assert.ok(guide.description && guide.result && guide.steps.length >= 2, topic);
    }
  }
});

test('counter and public guides do not instruct staff to use manager-only setup or refund controls', () => {
  assert.ok(getPageTutorial('overview', 'owner').steps.some(s => s.includes('configure menu prices')));
  assert.ok(!getPageTutorial('overview', 'counter').steps.some(s => s.includes('configure menu prices')));
  assert.ok(getPageTutorial('orderDetail', 'manager').steps.some(s => s.includes('Record a refund')));
  assert.ok(!getPageTutorial('orderDetail', 'counter').steps.some(s => s.includes('Record a refund')));
  assert.ok(!getPageTutorial('ingredients').steps.some(s => s.startsWith('Add or edit')));
  assert.deepEqual(getPageTutorial('kitchen', 'kitchen'), getPageTutorial('kitchen', 'owner'));
  const publicText = Object.values(getPageTutorial('tracking')).flat().join(' ');
  assert.ok(!/material cost|hourly rate|password|refund control/i.test(publicText));
});
