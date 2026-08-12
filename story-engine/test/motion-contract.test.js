import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const movie = fs.readFileSync(new URL('../public/movie.html', import.meta.url), 'utf8');
const motion = fs.readFileSync(new URL('../public/motion.css', import.meta.url), 'utf8');

test('movie mode wires the shared narrative motion stylesheet', () => {
  assert.match(movie, /\/motion\.css/);
  assert.match(motion, /--motion-base:/);
  assert.match(motion, /#beats \.beat-card/);
  assert.match(motion, /@keyframes beat-enter/);
});

test('narrative motion respects reduced-motion preference', () => {
  assert.match(motion, /prefers-reduced-motion:\s*reduce/);
  assert.match(motion, /animation-duration:\s*1ms\s*!important/);
  assert.match(motion, /transition-duration:\s*1ms\s*!important/);
});
