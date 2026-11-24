'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const intelligencePath = path.join(root, 'public/operaciones-inteligentes.js');
const intelligence = fs.readFileSync(intelligencePath, 'utf8');

test('la página principal carga una sola vez Inteligencia de producción', () => {
  const references = html.match(/<script\s+src=["']\/operaciones-inteligentes\.js\?v=1["']\s*>\s*<\/script>/gi) || [];
  assert.equal(references.length, 1, 'index.html debe cargar el módulo de Inteligencia exactamente una vez');
});

test('el módulo de Inteligencia monta el tablero y soporta carga después del DOM', () => {
  assert.match(intelligence, /id='aktOperationsIntelligence'/);
  assert.match(intelligence, /DOMContentLoaded/);
  assert.match(intelligence, /function start\(\)/);
});
