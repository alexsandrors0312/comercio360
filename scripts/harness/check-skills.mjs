import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.agents/skills');
const folders = readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name);
const expected = ['c360-orquestrar', 'c360-dados', 'c360-dominio', 'c360-aplicacao', 'c360-interface', 'c360-verificar'];
const errors = [];
for (const name of expected) if (!folders.includes(name)) errors.push(`missing skill: ${name}`);
for (const folder of folders) {
  const skill = join(root, folder, 'SKILL.md');
  if (!existsSync(skill)) { errors.push(`missing SKILL.md: ${folder}`); continue; }
  const source = readFileSync(skill, 'utf8');
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!front) { errors.push(`missing frontmatter: ${folder}`); continue; }
  const lines = front[1].split(/\r?\n/);
  const fields = Object.fromEntries(lines.map(line => /^([a-z_]+):\s*(.+)$/.exec(line)).filter(Boolean).map(m => [m[1], m[2]]));
  if (fields.name !== folder) errors.push(`name/folder mismatch: ${folder}`);
  if (!fields.description || fields.description.length < 25) errors.push(`missing or weak description: ${folder}`);
  if (Object.keys(fields).some(key => !['name', 'description'].includes(key))) errors.push(`unexpected frontmatter field: ${folder}`);
  if (source.slice(front[0].length).trim().length < 80) errors.push(`empty instructions: ${folder}`);
  if (/TODO|\[TODO\]|placeholder/i.test(source)) errors.push(`unfinished placeholder: ${folder}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Skill structure OK: ${folders.length} project skills`);
