/**
 * Schema validation utilities — l99-StoryEngine
 *
 * Used by:
 *  - CI schema validation workflow
 *  - Runtime engine startup (validateGraph in engine.ts)
 *  - reconciliation controller
 *
 * Validates story schema JSON files against the declared schema types.
 */
import * as fs from 'fs';
import * as path from 'path';

export type SchemaValidationResult = {
  file: string;
  valid: boolean;
  errors: string[];
};

/**
 * Validates all JSON files in a given directory against basic structural rules.
 * For deep validation, extend with ajv or zod.
 */
export function validateSchemaDirectory(dir: string): SchemaValidationResult[] {
  const results: SchemaValidationResult[] = [];

  if (!fs.existsSync(dir)) {
    return [{ file: dir, valid: false, errors: [`Directory '${dir}' does not exist`] }];
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(dir, file);
    const errors: string[] = [];

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (typeof parsed !== 'object' || parsed === null) {
        errors.push('Schema must be a JSON object');
      } else {
        if (!parsed.$schema && !parsed.type && !parsed.properties) {
          errors.push('Schema missing: $schema, type, or properties fields');
        }
      }
    } catch (e) {
      errors.push(`JSON parse error: ${String(e)}`);
    }

    results.push({ file, valid: errors.length === 0, errors });
  }

  return results;
}

/** CLI entrypoint: run directly with `npx tsx schemas/validate.ts` */
if (require.main === module) {
  const dir = process.argv[2] ?? path.resolve(__dirname, '.');
  const results = validateSchemaDirectory(dir);
  let hasErrors = false;

  for (const r of results) {
    if (!r.valid) {
      hasErrors = true;
      console.error(`❌ ${r.file}:`);
      r.errors.forEach(e => console.error(`   ${e}`));
    } else {
      console.log(`✅ ${r.file}`);
    }
  }

  process.exit(hasErrors ? 1 : 0);
}
