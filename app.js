const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || '/app/.cache/puppeteer';

app.use(cors());
app.use(express.json());

// Check if Puppeteer is functional
let puppeteerAvailable = true;
(async () => {
  try {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], cacheDirectory: PUPPETEER_CACHE_DIR });
    await browser.close();
  } catch (error) {
    console.error('Puppeteer initialization failed:', error.message);
    puppeteerAvailable = false;
  }
})();

// Fetch user details
async function fetchUserDetails(username) {
  try {
    const response = await axios.get(
      `https://api.x.com/2/users/by/username/${username}?user.fields=public_metrics,profile_image_url,description,name`,
      { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` } }
    );
    const user = response.data.data;
    if (!user) throw new Error('User not found');
    return {
      username: user.username || username,
      nickname: user.name || 'N/A',
      followers: user.public_metrics?.followers_count || 0,
      description: user.description || 'N/A',
      avatar: user.profile_image_url || 'https://via.placeholder.com/50',
    };
  } catch (error) {
    console.error('User details API error:', error.response?.status, error.message);
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
    console.error('API error (search ban):', error.response?.status, error.message);
    return null;
  }
}

async function checkSearchBanScraping(username) {
  if (!puppeteerAvailable) return 'Scraping unavailable (Puppeteer failed)';
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], cacheDirectory: PUPPETEER_CACHE_DIR });
  const page = await browser.newPage();
  try {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
    const hasTweets = await page.$('[data-testid="tweet"]') !== null;
    if (!hasTweets) return 'Unable to detect (no recent tweets on profile)';
    await page.goto(`https://x.com/search?q=from%3A%40${username}&src=typed_query&f=live`, { waitUntil: 'networkidle2' });
    const tweetsFound = await page.waitForSelector('[data-testid="tweet"]', { timeout: 5000 }).catch(() => null);
    return tweetsFound ? 'No search ban' : 'Search ban detected';
  } catch (error) {
    console.error('Scraping error (search ban):', error.message);
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
    console.error('API error (suggestion ban):', error.response?.status, error.message);
    return null;
  }
}

async function checkSearchSuggestionBanScraping(username) {
  if (!puppeteerAvailable) return 'Scraping unavailable (Puppeteer failed)';
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], cacheDirectory: PUPPETEER_CACHE_DIR });
  const page = await browser.newPage();
  try {
    await page.goto('https://x.com/explore', { waitUntil: 'networkidle2' });
    await page.click('[data-testid="searchBox"]');
    await page.type('[data-testid="searchBox"]', `@${username}`);
    await page.waitForTimeout(2000);
    const suggestions = await page.evaluate(() => document.body.innerText);
    return suggestions.includes(`@${username}`) ? 'No suggestion ban' : 'Suggestion ban detected';
  } catch (error) {
    console.error('Scraping error (suggestion ban):', error.message);
    return 'Error checking suggestion ban';
  } finally {
    await browser.close();
  }
}

async function checkGhostBan(username) {
  if (!puppeteerAvailable) return 'Scraping unavailable (Puppeteer failed)';
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], cacheDirectory: PUPPETEER_CACHE_DIR });
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
    console.error('Scraping error (ghost ban):', error.message);
    return 'Error checking ghost ban';
  } finally {
    await browser.close();
  }
}

async function checkReplyDeboost(username) {
  if (!puppeteerAvailable) return 'Scraping unavailable (Puppeteer failed)';
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], cacheDirectory: PUPPETEER_CACHE_DIR });
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
    console.error('Scraping error (reply deboost):', error.message);
    return 'Error checking reply deboost';
  } finally {
    await browser.close();
  }
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'X Shadow Ban Checker API is running', puppeteerAvailable });
});

// Check endpoint (POST for PHP frontend with reCAPTCHA)
app.post('/check', async (req, res) => {
  const recaptchaResponse = req.body.recaptcha;
  if (!recaptchaResponse) return res.status(400).json({ error: 'reCAPTCHA required' });
  try {
    const recaptchaVerify = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify`,
      new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: recaptchaResponse })
    );
    if (!recaptchaVerify.data.success) return res.status(400).json({ error: 'reCAPTCHA verification failed' });
  } catch (error) {
    console.error('reCAPTCHA error:', error.message);
    return res.status(500).json({ error: 'reCAPTCHA service error' });
  }

  const username = req.body.username.replace(/^@/, '');
  const userDetails = await fetchUserDetails(username);
  const results = {
    ...userDetails,
    search_ban: await checkSearchBanAPI(username) || await checkSearchBanScraping(username),
    suggestion_ban: await checkSearchSuggestionBanAPI(username) || await checkSearchSuggestionBanScraping(username),
    ghost_ban: await checkGhostBan(username),
    reply_deboost: await checkReplyDeboost(username),
  };
  res.json({ results });
});

// Check endpoint (GET for testing, no reCAPTCHA)
app.get('/check/:username', async (req, res) => {
  const username = req.params.username.replace(/^@/, '');
  const userDetails = await fetchUserDetails(username);
  const results = {
    ...userDetails,
    search_ban: await checkSearchBanAPI(username) || await checkSearchBanScraping(username),
    suggestion_ban: await checkSearchSuggestionBanAPI(username) || await checkSearchSuggestionBanScraping(username),
    ghost_ban: await checkGhostBan(username),
    reply_deboost: await checkReplyDeboost(username),
  };
  res.json({ results });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), puppeteerAvailable });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
