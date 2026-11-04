/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets phones and other devices on the local network load the dev server. Otherwise Next blocks
  // its dev resources, hydration fails and buttons and links stay dead.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*', '172.17.*.*', '172.18.*.*', '172.19.*.*', '172.2*.*.*', '172.30.*.*', '172.31.*.*', '*.local'],
};

export default nextConfig;
