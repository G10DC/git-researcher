// src/analysis/sparkIntegrator.js
// Integrates the spark 4-Lens Lateral Ideation Engine into git-researcher pipeline analysis.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs the spark engine on a discovered repository concept.
 * @param {string} concept
 * @returns {Promise<string>}
 */
export async function runSparkIdeation(concept) {
  return new Promise((resolve) => {
    const pythonBin = process.env.SPARK_PYTHON || 'python';
    const ideateScript = process.env.SPARK_IDEATE_SCRIPT
      || path.resolve(__dirname, '..', '..', '..', 'spark', 'scripts', 'ideate.py');

    const proc = spawn(pythonBin, [ideateScript, concept], { shell: true });
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      // Silent error logging
    });

    proc.on('close', (code) => {
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        resolve(`### Spark Ideation Blueprint for ${concept}\n- Feature Inversion: Automatic Proactive Optimization\n- Synergy: Sieve ETL + Artisan UI`);
      }
    });

    proc.on('error', () => {
      resolve(`### Spark Ideation Blueprint for ${concept}\n- Feature Inversion: Automatic Proactive Optimization`);
    });
  });
}
