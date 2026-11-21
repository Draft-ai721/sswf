import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {openskpFixes} from './openskp-plugin.mjs';
export async function prepareAssets(){
 await fs.mkdir('src/shared',{recursive:true});await fs.copyFile('shared/design-workflow.js','src/shared/design-workflow.js');await fs.copyFile('shared/space-planning.js','src/shared/space-planning.js');await fs.copyFile('shared/studio-actions.js','src/shared/studio-actions.js');
 await build({entryPoints:['browser-workers/skp-worker.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,outfile:'src/skp-worker.js',plugins:[openskpFixes],legalComments:'inline'});
 await fs.copyFile('node_modules/pdfjs-dist/build/pdf.mjs','src/vendor/pdf.mjs');await fs.copyFile('node_modules/pdfjs-dist/build/pdf.worker.mjs','src/vendor/pdf.worker.mjs');await fs.copyFile('node_modules/pdfjs-dist/LICENSE','src/vendor/PDFJS-LICENSE.txt');await fs.cp('node_modules/pdfjs-dist/cmaps','src/pdf-cmaps',{recursive:true});await fs.cp('node_modules/pdfjs-dist/standard_fonts','src/pdf-fonts',{recursive:true});
}
