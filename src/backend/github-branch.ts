import { github, parseRepo } from './github';

export async function deleteBranch(options: { branch: string; repo?: string }) {
  const { branch, repo: repoName } = options;
  if (!branch) {
    throw new Error('branch is required');
  }

  const { owner, repo } = parseRepo(repoName);
  const ref = `heads/${branch}`;

  await github.git.deleteRef({
    owner,
    repo,
    ref,
  });

  return { deleted: true, ref };
}
