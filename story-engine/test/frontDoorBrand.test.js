import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/front_door.html', import.meta.url), 'utf8');

test('cinematic front door preserves the working creator form while exposing selectable formats', () => {
  assert.match(html, /href="\/front-door-cinematic\.css"/);
  assert.match(html, /id="frontView" class="view cinematic-door"/);
  assert.match(html, /class="story-glass creator-glass"/);
  assert.match(html, /id="vision"/);
  assert.match(html, /id="startBtn"/);
  assert.match(html, /id="continueBtn"/);
  assert.match(html, /data-quick-medium="book"/);
  assert.match(html, /data-quick-medium="movie"/);
  assert.match(html, /data-quick-medium="comic"/);
  assert.match(html, /selections\.medium = value/);
  assert.equal((html.match(/class="hero-art"/g) || []).length, 1);
});

test('cinematic style uses the real artwork as an immersive scene and keeps mobile controls visible', () => {
  const css = readFileSync(new URL('../public/front-door-cinematic.css', import.meta.url), 'utf8');
  assert.match(css, /#frontView\s+\.hero-art\s*\{/);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(css, /main\.app\s*\{[^}]*padding:\s*0;/);
  assert.match(css, /backdrop-filter:\s*blur/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.match(css, /\.quick-format:focus-visible/);
});
