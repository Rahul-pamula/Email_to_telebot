import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const denoJsonPath = path.resolve(__dirname, '../../supabase/functions/email-bot/deno.json');
const denoJson = JSON.parse(fs.readFileSync(denoJsonPath, 'utf-8'));

const denoPlugin = {
  name: 'deno-plugin',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      // Check if the import path is in deno.json imports
      if (denoJson.imports && denoJson.imports[args.path]) {
        return { path: denoJson.imports[args.path], external: true };
      }
      return null; // let esbuild handle it normally
    });
  },
};

async function bundle() {
  const entryPoint = path.resolve(__dirname, '../../supabase/functions/email-bot/index.ts');
  const outfile = path.resolve(__dirname, '../public/email-bot-bundle.ts');

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outfile,
      format: 'esm',
      target: 'esnext',
      plugins: [denoPlugin],
      external: ['https://*', 'http://*', 'npm:*', 'npm:@*', 'jsr:*'],
    });
    console.log('✅ Edge function bundled successfully to public/email-bot-bundle.ts');
  } catch (e) {
    console.error('❌ Failed to bundle edge function:', e);
    process.exit(1);
  }
}

bundle();
