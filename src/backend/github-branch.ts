import { github, parseRepo } from './github';

export async function deleteBranch(options: { branch: string; repo?: string }) {
  const { branch } = options;
  if (!branch) {
    throw new Error('branch is required');
  }

  const repoName = options.repo ?? (process.env.BOTCOW_DEFAULT_REPO as string);
  const { owner, repo } = parseRepo(repoName);

  const ref = `heads/${branch}`;

  await github.git.deleteRef({
    owner,
    repo,
    ref,
  });

  return { deleted: true, ref };
}
