// src/testing/mocks.js
// DI mocks for dryRun: no real calls to Claude/DuckDuckGo/GitHub.
// Extracted from the pipeline to keep the orchestrator slim and reuse mocks in tests.

/**
 * Builds the mock set for a dryRun.
 * @param {string} idea
 * @returns {{
 *   mockIntent:Function, mockModules:Function, mockClaudeMd:Function,
 *   mockFetch:Function, mockGetPage:Function, mockFetchIssues:Function
 * }}
 */
export function createDryRunMocks(idea) {
  const mockIntent = () => ({
    project_name: 'Demo Project (dryRun)',
    description: idea,
    components: ['Core Engine', 'Storage', 'API Layer'],
    technologies: ['rust'],
    keywords: ['vector database', 'rust', 'hnsw', 'distributed'],
  });

  const mockModules = () => ({
    project_name: 'Demo Project (dryRun)',
    description: idea,
    points: [
      { id: 1, name: 'Core Engine', description: 'main engine', specialist_role: 'Core Engineer', specialist_system_prompt: 'You are a core engineer.', analysis_prompt: 'Analyze the Core Engine.' },
      { id: 2, name: 'Storage', description: 'persistence', specialist_role: 'Database Designer', specialist_system_prompt: 'You are a database designer.', analysis_prompt: 'Analyze the storage.' },
      { id: 3, name: 'API Layer', description: 'api', specialist_role: 'API Architect', specialist_system_prompt: 'You are an API architect.', analysis_prompt: 'Analyze the API layer.' },
    ],
  });

  const mockClaudeMd = (prompt) =>
    `## Analysis (dryRun mock)\n\nPrompt received (${String(prompt).length} chars). ` +
    `Fictional content to validate the pipeline without real calls to Claude.`;

  const mockFetch = () =>
    Promise.resolve({
      ok: true,
      text: async () =>
        `<html><body>
          <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fqdrant%2Fqdrant">qdrant/qdrant</a><a class="result__snippet">vector search engine and vector database</a></div>
          <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fweaviate%2Fweaviate">weaviate/weaviate</a><a class="result__snippet">vector database</a></div>
          <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fmilvus-io%2Fmilvus">milvus-io/milvus</a><a class="result__snippet">cloud-native vector database</a></div>
        </body></html>`,
    });

  const mockGetPage = (url) => {
    const m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
    const owner = m ? m[1] : 'owner';
    const repo = m ? m[2] : 'repo';
    return Promise.resolve(
      `<!doctype html><html><head>
        <title>GitHub - ${owner}/${repo}: vector search engine</title>
        <meta name="description" content="${repo} - high-performance vector search engine and database">
       </head><body>
        <a href="/${owner}/${repo}/stargazers" id="repo-stars-counter-star">20.1k</a>
        <a id="issues-repo-tab-count" href="/${owner}/${repo}/issues">Issues 15</a>
        <span itemprop="programmingLanguage">rust</span>
        <a class="topic-tag">vector</a><a class="topic-tag">database</a>
        <relative-time datetime="${new Date(Date.now() - 5 * 86400000).toISOString()}">5 days ago</relative-time>
        <article class="markdown-body"># ${repo}\n\nVector database and similarity search engine. Distributed, fast, written in rust.</article>
       </body></html>`
    );
  };

  const mockFetchIssues = async () => [
    { title: 'Memory grows unbounded on large datasets', body: 'Reported by several users on 10M+ vectors.' },
    { title: 'Add disk-based index option', body: '' },
  ];

  return { mockIntent, mockModules, mockClaudeMd, mockFetch, mockGetPage, mockFetchIssues };
}
