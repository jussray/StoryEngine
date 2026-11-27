import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/front_door.html', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../public/l99_auth.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/front-door-cinematic.css', import.meta.url), 'utf8');

test('public front door has only the immersive portal and real sign-in, no tools or bottom cards', () => {
  assert.match(html, /id="guestPortal"/);
  assert.match(html, /id="guestLogin"/);
  assert.match(html, /id="loginAccessKey"/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="creatorShell"[^>]*hidden/);
  assert.doesNotMatch(html, /class="format-rail"/);
  assert.doesNotMatch(html, /data-quick-medium=/);
  assert.doesNotMatch(html, /feature-tile/);
  assert.doesNotMatch(html, /Continue with Google|Continue with Apple/);
});

test('creator workflow remains present behind the authenticated screen', () => {
  for (const id of ['frontView','shapeView','vision','startBtn','continueBtn','ideaPreview']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /L99Auth\.currentSession/);
  assert.match(html, /L99Auth\.signInWithAccessKey/);
  assert.match(html, /id="signOutBtn"/);
});

test('manual sign-in is an explicit interaction and never stores the bootstrap credential', () => {
  assert.match(html, /name="storyengine-manual-auth"/);
  assert.match(auth, /signInWithAccessKey/);
  assert.match(auth, /document\.querySelector\('meta\[name="storyengine-manual-auth"\]'\)/);
  assert.doesNotMatch(auth, /localStorage\.setItem\(/);
  assert.doesNotMatch(auth, /sessionStorage\.setItem\(/);
});

test('visual composition uses background art, glass sign-in, and mobile layout', () => {
  assert.match(css, /\.guest-stage/);
  assert.match(css, /\.login-glass/);
  assert.match(css, /backdrop-filter:\s*blur/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.match(css, /:focus-visible/);
});
