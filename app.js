const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');

// From attached code: Account age calculations
function calculateAccountAge(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  return years > 0 ? `${years} years, ${months} months` : `${months} months`;
}

function calculateAgeDays(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Fetch user details (integrated from attached code)
async function fetchUserDetails(username) {
  try {
    const response = await axios.get(
      `https://api.x.com/2/users/by/username/${username}?user.fields=public_metrics,created_at,profile_image_url,location,description,verified,verified_type`,
      { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` } }
    );
    const user = response.data.data;
    if (!user) throw new Error('User not found');
    return {
      nickname: user.name || 'N/A',
      estimated_creation_date: user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A',
      account_age: user.created_at ? calculateAccountAge(user.created_at) : 'N/A',
      age_days: user.created_at ? calculateAgeDays(user.created_at) : 0,
      followers: user.public_metrics?.followers_count || 0,
      total_likes: user.public_metrics?.like_count || 0,
      verified: user.verified ? 'Yes' : 'No',
      verified_type: user.verified_type || 'N/A',
      description: user.description || 'N/A',
      region: user.location || 'N/A',
      avatar: user.profile_image_url || 'https://via.placeholder.com/50',
    };
  } catch (error) {
    console.error('User details API error:', error);
    return { error: 'Unable to fetch user details' };
  }
}

async function checkSearchBanAPI(username) {
  try {
    const response = await axios.get(`https://api.x.com/2/tweets/search/recent?query=from:${username}&max_results=10`, {
      headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }
    });
    const tweets = response.data.data || [];
    return tweets.length > 0 ? 'No search ban' : 'Search ban detected';
  } catch (error) {
    console.error('API error (search ban):', error.response?.status);
    return null; // Fallback to scraping
  }
}

async function checkSearchBanScraping(username) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }); // Added --no-sandbox for Render compatibility
  const page = await browser.newPage();
  try {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
    const hasTweets = await page.$('[data-testid="tweet"]') !== null;
    if (!hasTweets) return 'Unable to detect (no recent tweets on profile)';
    await page.goto(`https://x.com/search?q=from%3A%40${username}&src=typed_query&f=live`, { waitUntil: 'networkidle2' });
    const tweetsFound = await page.waitForSelector('[data-testid="tweet"]', { timeout: 5000 }).catch(() => null);
    return tweetsFound ? 'No search ban' : 'Search ban detected';
  } catch (error) {
    return 'Error checking search ban';
  } finally {
    await browser.close();
  }
}

async function checkSearchSuggestionBanAPI(username) {
  try {
    const response = await axios.get(`https://api.x.com/2/users/by/username/${username}`, {
      headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }
    });
    return response.data.data ? 'No suggestion ban' : 'Suggestion ban detected';
  } catch (error) {
    console.error('API error (suggestion ban):', error.response?.status);
    return null;
  }
}

async function checkSearchSuggestionBanScraping(username) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto('https://x.com/explore', { waitUntil: 'networkidle2' });
    await page.click('[data-testid="searchBox"]');
    await page.type('[data-testid="searchBox"]', `@${username}`);
    await page.waitForTimeout(2000);
    const suggestions = await page.evaluate(() => document.body.innerText);
    return suggestions.includes(`@${username}`) ? 'No suggestion ban' : 'Suggestion ban detected';
  } catch (error) {
    return 'Error checking suggestion ban';
  } finally {
    await browser.close();
  }
}

async function checkGhostBan(username) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto(`https://x.com/search?q=from%3A%40${username}%20filter%3Areplies&src=typed_query&f=live`, { waitUntil: 'networkidle2' });
    const replyTweet = await page.waitForSelector('[data-testid="tweet"]', { timeout: 5000 }).catch(() => null);
    if (!replyTweet) return 'Unable to detect (no recent replies)';
    const replyUrl = await page.evaluate(() => {
      const link = document.querySelector('[data-testid="tweet"] a[href^="/"][href*="status"]');
      return link ? 'https://x.com' + link.getAttribute('href') : null;
    });
    if (!replyUrl) return 'Unable to detect (could not extract reply URL)';
    await page.goto(replyUrl, { waitUntil: 'networkidle2' });
    const visibleReply = await page.$('[data-testid="reply"]') !== null;
    return visibleReply ? 'No ghost ban' : 'Ghost ban detected';
  } catch (error) {
    return 'Error checking ghost ban';
  } finally {
    await browser.close();
  }
}

async function checkReplyDeboost(username) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto(`https://x.com/search?q=from%3A%40${username}%20filter%3Areplies&src=typed_query&f=live`, { waitUntil: 'networkidle2' });
    const replyTweet = await page.waitForSelector('[data-testid="tweet"]', { timeout: 5000 }).catch(() => null);
    if (!replyTweet) return 'Unable to detect (no recent replies)';
    const replyUrl = await page.evaluate(() => {
      const link = document.querySelector('[data-testid="tweet"] a[href^="/"][href*="status"]');
      return link ? 'https://x.com' + link.getAttribute('href') : null;
    });
    if (!replyUrl) return 'Unable to detect (could not extract reply URL)';
    await page.goto(replyUrl, { waitUntil: 'networkidle2' });
    const showMore = await page.evaluate(() => document.body.innerText.includes('Show more replies'));
    return showMore ? 'Reply deboost detected' : 'No reply deboost';
  } catch (error) {
    return 'Error checking reply deboost';
  } finally {
    await browser.close();
  }
}

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/check', async (req, res) => {
  // Verify reCAPTCHA (from attached code)
  const recaptchaResponse = req.body.recaptcha;
  if (!recaptchaResponse) return res.status(400).json({ error: 'reCAPTCHA required' });
  try {
    const recaptchaVerify = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify`,
      new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: recaptchaResponse })
    );
    if (!recaptchaVerify.data.success) return res.status(400).json({ error: 'reCAPTCHA verification failed' });
  } catch (error) {
    return res.status(500).json({ error: 'reCAPTCHA service error' });
  }

  const username = req.body.username.replace(/^@/, '');
  const userDetails = await fetchUserDetails(username);
  const results = {
    ...userDetails, // Add user details to results
    search_ban: await checkSearchBanAPI(username) || await checkSearchBanScraping(username),
    suggestion_ban: await checkSearchSuggestionBanAPI(username) || await checkSearchSuggestionBanScraping(username),
    ghost_ban: await checkGhostBan(username),
    reply_deboost: await checkReplyDeboost(username),
  };
  res.render('results', { results, username }); // Or res.json(results) if PHP frontend uses API
});

// Health check (from attached code)
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
