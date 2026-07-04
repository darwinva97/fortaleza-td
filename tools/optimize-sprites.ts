/**
 * Optimiza los sprites recortados (public/sprites) para el deploy: baja la resolución
 * al tamaño en que se ven en el juego y recomprime. Sobrescribe in-place.
 * Uso: pnpm exec tsx tools/optimize-sprites.ts
 */
import sharp from 'sharp';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = 'apps/client/public/sprites';

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.png'));
  let before = 0;
  let after = 0;
  for (const f of files) {
    const p = path.join(DIR, f);
    before += statSync(p).size;
    // altura tope según categoría (se ven a ~48-160px; con DPR ×3 → ~480 máx para torres)
    const maxH = f.startsWith('tower_') ? 420 : f.startsWith('proj_') ? 160 : 200;
    // partículas (part_*) tienen alfa suave → sin paleta; el resto sí (más chico)
    const palette = !f.startsWith('part_');
    const buf = await sharp(p)
      .resize({ height: maxH, withoutEnlargement: true })
      .png({ compressionLevel: 9, effort: 10, palette, quality: 92 })
      .toBuffer();
    writeFileSync(p, buf);
    after += buf.length;
  }
  console.log(
    `optimizados ${files.length} PNG: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(2)} MB`,
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
