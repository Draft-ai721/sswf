import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export function openDatabase(path){mkdirSync(dirname(path),{recursive:true,mode:0o700});const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');db.exec('CREATE TABLE IF NOT EXISTS objects(key TEXT PRIMARY KEY, data BLOB NOT NULL, etag TEXT NOT NULL, metadata TEXT NOT NULL, updated_at TEXT NOT NULL)');return db}
export class SqliteBucket{
 constructor(db){this.db=db}
 async get(key){const row=this.db.prepare('SELECT * FROM objects WHERE key=?').get(key);if(!row)return null;const data=Buffer.from(row.data),meta=JSON.parse(row.metadata);return {key,etag:row.etag,size:data.length,...meta,body:new Blob([data]).stream(),json:async()=>JSON.parse(data.toString('utf8')),arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),text:async()=>data.toString('utf8')}}
 async head(key){const row=this.db.prepare('SELECT key,etag,metadata,length(data) AS size FROM objects WHERE key=?').get(key);return row?{key:row.key,etag:row.etag,size:row.size,...JSON.parse(row.metadata)}:null}
 async put(key,value,options={}){const data=typeof value==='string'?Buffer.from(value):Buffer.from(await new Response(value).arrayBuffer());const db=this.db;db.exec('BEGIN IMMEDIATE');try{const old=db.prepare('SELECT etag FROM objects WHERE key=?').get(key),condition=options.onlyIf;if(condition?.etagMatches&&old?.etag!==condition.etagMatches||condition?.etagDoesNotMatch==='*'&&old){db.exec('ROLLBACK');return null}const etag=randomUUID(),metadata=JSON.stringify({httpMetadata:options.httpMetadata||{},customMetadata:options.customMetadata||{}});db.prepare('INSERT INTO objects(key,data,etag,metadata,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,etag=excluded.etag,metadata=excluded.metadata,updated_at=excluded.updated_at').run(key,data,etag,metadata,new Date().toISOString());db.exec('COMMIT');return {key,etag,size:data.length}}catch(e){db.exec('ROLLBACK');throw e}}
 async delete(key){this.db.prepare('DELETE FROM objects WHERE key=?').run(key)}
}
