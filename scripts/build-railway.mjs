import fs from 'node:fs/promises';
import {prepareAssets} from './build-assets.mjs';
await prepareAssets();await fs.rm('dist/public',{recursive:true,force:true});await fs.mkdir('dist/public',{recursive:true});await fs.cp('src','dist/public',{recursive:true});console.log('Built Railway static assets and browser workers.');
