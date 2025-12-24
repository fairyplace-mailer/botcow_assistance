import { getGithubClient, parseRepo } from './github';

export async function findOpenPullRequestByHeadSha(options: {
  repoFullName: string;
  sha: string;
}) {
  const { owner, repo } = parseRepo(options.repoFullName);

  const github = getGithubClient();

  const res = await github.pulls.list({
    owner,
    repo,
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
  });

  const pr = res.data.find((p) => p.head?.sha === options.sha) ?? null;
  return pr;
}

export async function commentOnceOnPullRequest(options: {
  repoFullName: string;
  pull_number: number;
  body: string;
  marker: string;
}) {
  const { owner, repo } = parseRepo(options.repoFullName);

  const github = getGithubClient();

  const existing = await github.issues.listComments({
    owner,
    repo,
    issue_number: options.pull_number,
    per_page: 100,
  });

  const already = existing.data.some(
    (c) => typeof c.body === 'string' && c.body.includes(options.marker),
  );

  if (already) return { skipped: true };

  const created = await github.issues.createComment({
    owner,
    repo,
    issue_number: options.pull_number,
    body: options.body,
  });

  return { skipped: false, comment: created.data };
}
