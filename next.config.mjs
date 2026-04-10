/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/api/chat': ['./config/repos.yml'],
    '/tools/call': ['./config/repos.yml'],
    '/api/github/*': ['./config/repos.yml'],
  },
};

export default nextConfig;
