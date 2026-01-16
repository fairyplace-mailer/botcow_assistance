process.env.BOTCOW_CONFIG_REPOS_FILE = 'config/repos.yml';

jest.mock('../src/backend/db', () => {
  const store = new Map<string, any>();

  const prisma = {
    kvItem: {
      findUnique: async ({ where }: any) => {
        const key = where?.key;
        if (!key) return null;
        return store.get(key) ?? null;
      },
      upsert: async ({ where, create, update }: any) => {
        const key = where?.key;
        const next = {
          key,
          valueJson: update?.valueJson ?? create?.valueJson,
          expiresAt: update?.expiresAt ?? create?.expiresAt ?? null,
          updatedAt: new Date(),
        };
        store.set(key, next);
        return next;
      },
      delete: async ({ where }: any) => {
        const key = where?.key;
        store.delete(key);
      },
    },
  };

  return { prisma };
});
