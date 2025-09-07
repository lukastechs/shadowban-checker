const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

app.use(cors());
app.use(express.json());

// Puppeteer configuration for Render
const getPuppeteerConfig = () => {
  const config = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--remote-debugging-port=9222'
    ]
  };

  // Try to find Chrome in the cache directory
  try {
    const cacheDir = path.join(process.cwd(), '.cache', 'puppeteer');
    if (fs.existsSync(cacheDir)) {
      const chromeDir = fs.readdirSync(cacheDir)
        .find(dir => dir.includes('chrome') && dir.includes('linux'));
      
      if (chromeDir) {
        const chromePath = path.join(cacheDir, chromeDir, 'chrome-linux64', 'chrome');
        if (fs.existsSync(chromePath)) {
          config.executablePath = chromePath;
          console.log('Found Chrome at:', config.executablePath);
        }
      }
    }
  } catch (error) {
    console.log('Could not find custom Chrome path, using default');
  }

  return config;
};

// Check if Puppeteer is functional
let puppeteerAvailable = true;
(async () => {
  try {
    console.log('Initializing Puppeteer...');
    const browser = await puppeteer.launch(getPuppeteerConfig());
    const version = await browser.version();
    console.log('Puppeteer initialized successfully with:', version);
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
  let browser;
  try {
    browser = await puppeteer.launch(getPuppeteerConfig());
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2', timeout: 30000 });
    const hasTweets = await page.$('[data-testid="tweet"]') !== null;
    if (!hasTweets) return 'Unable to detect (no recent tweets on profile)';
    await page.goto(`https://x.com/search?q=from%3A%40${username}&src=typed_query&f=live`, { waitUntil: 'networkidle2', timeout: 30000 });
    const tweetsFound = await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 }).catch(() => null);
    return tweetsFound ? 'No search ban' : 'Search ban detected';
  } catch (error) {
    console.error('Scraping error (search ban):', error.message);
    return 'Error checking search ban';
  } finally {
    if (browser) await browser.close();
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
  let browser;
  try {
    browser = await puppeteer.launch(getPuppeteerConfig());
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto('https://x.com/explore', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.click('[data-testid="searchBox"]');
    await page.type('[data-testid="searchBox"]', `@${username}`);
    await page.waitForTimeout(2000);
    const suggestions = await page.evaluate(() => document.body.innerText);
    return suggestions.includes(`@${username}`) ? 'No suggestion ban' : 'Suggestion ban detected';
  } catch (error) {
    console.error('Scraping error (suggestion ban):', error.message);
    return 'Error checking suggestion ban';
  } finally {
    if (browser) await browser.close();
  }
}

async function checkGhostBan(username) {
  if (!puppeteerAvailable) return 'Scraping unavailable (Puppeteer failed)';
  let browser;
  try {
    browser = await puppeteer.launch(getPuppeteerConfig());
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto(`https://x.com/search?q=from%3A%40${username}%20filter%3Areplies&src=typed_query&f=live`, { waitUntil: 'networkidle2', timeout: 30000 });
    const replyTweet = await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 }).catch(() => null);
    if (!replyTweet) return 'Unable to detect (no recent replies)';
    const replyUrl = await page.evaluate(() => {
      const link = document.querySelector('[data-testid="tweet"] a[href^="/"][href*="status"]');
      return link ? 'https://x.com' + link.getAttribute('href') : null;
    });
    if (!replyUrl) return 'Unable to detect (could not extract reply URL)';
    await page.goto(replyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const visibleReply = await page.$('[data-testid="reply"]') !== null;
    return visibleReply ? 'No ghost ban' : 'Ghost ban detected';
  } catch (error) {
    console.error('Scraping error (ghost ban):', error.message);
    return 'Error checking ghost ban';
  } finally {
    if (browser) await browser.close();
  }
}

async function checkReplyDeboost(username) {
  if (!puppeteerAvailable) return 'Scraping unavailable (Puppeteer failed)';
  let browser;
  try {
    browser = await puppeteer.launch(getPuppeteerConfig());
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto(`https://x.com/search?q=from%3A%40${username}%20filter%3Areplies&src=typed_query&f=live`, { waitUntil: 'networkidle2', timeout: 30000 });
    const replyTweet = await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 }).catch(() => null);
    if (!replyTweet) return 'Unable to detect (no recent replies)';
    const replyUrl = await page.evaluate(() => {
      const link = document.querySelector('[data-testid="tweet"] a[href^="/"][href*="status"]');
      return link ? 'https://x.com' + link.getAttribute('href') : null;
    });
    if (!replyUrl) return 'Unable to detect (could not extract reply URL)';
    await page.goto(replyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const showMore = await page.evaluate(() => document.body.innerText.includes('Show more replies'));
    return showMore ? 'Reply deboost detected' : 'No reply deboost';
  } catch (error) {
    console.error('Scraping error (reply deboost):', error.message);
    return 'Error checking reply deboost';
  } finally {
    if (browser) await browser.close();
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
