import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewPng, SANS, SERIF, textWidth } from '../pipeline/preview_image.mjs';

// resvg quietly falls back to another font when it can't find one, so check
// that both typefaces really are in use: the same words differ in width.
test('the share pictures use both of the site’s fonts', () => {
  const serif = textWidth('Atlas Meridian', SERIF, 40);
  const sans = textWidth('Atlas Meridian', SANS, 40);
  assert.ok(serif > 0 && sans > 0);
  assert.ok(Math.abs(serif - sans) > 5, `serif ${serif} and sans ${sans} look like the same font`);
});

test('a share picture is a 1200×630 PNG, even for a long name with no outline', () => {
  const png = previewPng({
    name: 'Saint Vincent and the Grenadines',
    kicker: 'Latin America & Caribbean',
    facts: [['99.9K', 'Population, 2025']],
    note: '44 speeches at the UN General Debate, 1980–2025',
    footer: 'Footer',
  });
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
