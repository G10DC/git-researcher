// src/discovery/intentExtractor.js
// Breaks the idea down into components/technologies/keywords for the search.

import { runClaudeJSONWithRetry as defaultRetry } from '../core/claude.js';
import { MAX_KEYWORDS } from '../core/config.js';

/**
 * @typedef {Object} IntentResult
 * @property {string} project_name
 * @property {string} description
 * @property {string[]} components
 * @property {string[]} technologies
 * @property {string[]} keywords
 */

/**
 * Breaks the user's idea down into components, technologies and search keywords.
 * @param {string} idea
 * @param {{runClaudeJSONWithRetry?:Function}} [deps]
 * @returns {Promise<IntentResult>}
 */
export async function extractIntent(idea, deps = {}) {
  const runJSON = deps.runClaudeJSONWithRetry || defaultRetry;

  const systemPrompt =
    'You are a Lead System Architect skilled at breaking software ideas down into ' +
    'architectural components and selecting effective keywords to search for similar projects. ' +
    'Respond ONLY with valid JSON.';

  const prompt = `The user proposed a software idea:
"${idea}"

Break this idea down. Return ONLY valid JSON with this exact structure (no extra text, no markdown fences):
{
  "project_name": "Concise project name",
  "description": "General project description",
  "components": ["component/module 1", "component/module 2", "...3-5 items"],
  "technologies": ["technology/framework 1", "..."],
  "keywords": ["search keyword 1", "...up to ${MAX_KEYWORDS} keywords, a mix of technical terms, frameworks and useful synonyms to find similar repositories on GitHub"]
}`;

  const result = await runJSON(prompt, systemPrompt);

  return {
    project_name: result.project_name || idea.slice(0, 60),
    description: result.description || idea,
    components: Array.isArray(result.components) ? result.components : [],
    technologies: Array.isArray(result.technologies) ? result.technologies : [],
    keywords: Array.isArray(result.keywords) ? result.keywords.slice(0, MAX_KEYWORDS) : [],
  };
}
