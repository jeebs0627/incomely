// Only public browser credentials. Never expose service_role or secret keys.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key.startsWith('sb_publishable_')) {
    return res.status(200).json({ configured: false });
  }
  res.status(200).json({ configured: true, url, key });
};
