const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;

app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

async function checkSearchBanAPI(username) {
  try {
    const response = await axios.get(`https://api.x.com/2/tweets/search/recent?query=from:${username}&max_results=10`, {
      headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }
    });
    const tweets = response.data.data || [];
    return tweets.length > 0 ? 'No search ban' : 'Search ban detected';
  } catch (error) {
    console.error('API error (search ban):', error.response?.status);
    return null; // Trigger fallback
  }
}

async function checkSearchBanScraping(username) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  try {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
    const hasTweets = await page.$('[data-testid="tweet"]') !== null;
    if (!hasTweets) {
      await browser.close();
      return 'Unable to detect (no recent tweets on profile)';
    }
    await page.goto(`https://x.com/search?q=from%3A%40${username}&src=typed_query&f=live`, { waitUntil: 'networkidle2' });
    const tweetsFound = await page.waitForSelector('[data-testid="tweet"]', { timeout: 5000 }).catch(() => null);
    const result = tweetsFound ? 'No search ban' : 'Search ban detected';
    await browser.close();
    return result;
  } catch (error) {
    await browser.close();
    return 'Error checking search ban';
  }
}

async function checkSearchSuggestionBanAPI(username) {
  try {
    const response = await axios.get(`https://api.x.com/2/users/by/username/${username}`, {
      headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }
    });
    const user = response.data.data;
    // Simulate suggestion check (API doesn't directly expose this; heuristic based on user existence)
    return user ? 'No suggestion ban' : 'Suggestion ban detected';
  } catch (error) {
    console.error('API error (suggestion ban):', error.response?.status);
    return null;
  }
}

async function checkSearchSuggestionBanScraping(username) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  try {
    await page.goto('https://x.com/explore', { waitUntil: 'networkidle2' });
    await page.click('[data-testid="searchBox"]');
    await page.type('[data-testid="searchBox"]', `@${username}`);
    await page.waitForTimeout(2000);
    const suggestions = await page.evaluate(() => document.body.innerText);
    const result = suggestions.includes(`@${username}`) ? 'No suggestion ban' : 'Suggestion ban detected';
    await browser.close();
    return result;
  } catch (error) {
    await browser.close();
    return 'Error checking suggestion ban';
  }
}

async function checkGhostBan(username) {
  // API doesn't directly support thread visibility; use scraping
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  try {
    await page.goto(`https://x.com/search?q=from%3A%40${username}%20filter%3Areplies&src=typed_query&f=live`, { waitUntil: 'networkidle2' });
    const replyTweet = await page.waitForSelector('[data-testid="tweet"]', { timeout: 5000 }).catch(() => null);
    if (!replyTweet) {
      await browser.close();
      return 'Unable to detect (no recent replies)';
    }
    // Extract reply URL (simplified; needs dynamic extraction)
    const replyUrl = await page.evaluate(() => {
      const tweet = document.querySelector('[data-testid="tweet"] a');
      return tweet ? tweet.href : null;
    });
    if (!replyUrl) {
      await browser.close();
      return 'Unable to detect (could not extract reply URL)';
    }
    await page.goto(replyUrl, { waitUntil: 'networkidle2' });
    const visibleReply = await page.$('[data-testid="reply"]') !== null;
    const result = visibleReply ? 'No ghost ban' : 'Ghost ban detected';
    await browser.close();
    return result;
  } catch (error) {
    await browser.close();
    return 'Error checking ghost ban';
  }
}

async function checkReplyDeboost(username) {
  // API doesn't support "Show more replies" check; use scraping
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  try {
    await page.goto(`https://x.com/search?q=from%3A%40${username}%20filter%3Areplies&src=typed_query&f=live`, { waitUntil: 'networkidle2' });
    const replyTweet = await page.waitForSelector('[data-testid="tweet"]', { timeout: 5000 }).catch(() => null);
    if (!replyTweet) {
      await browser.close();
      return 'Unable to detect (no recent replies)';
    }
    const replyUrl = await page.evaluate(() => {
      const tweet = document.querySelector('[data-testid="tweet"] a');
      return tweet ? tweet.href : null;
    });
    if (!replyUrl) {
      await browser.close();
      return 'Unable to detect (could not extract reply URL)';
    }
    await page.goto(replyUrl, { waitUntil: 'networkidle2' });
    const showMore = await page.$('text="Show more replies"') !== null;
    const result = showMore ? 'Reply deboost detected' : 'No reply deboost';
    await browser.close();
    return result;
  } catch (error) {
    await browser.close();
    return 'Error checking reply deboost';
  }
}

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/check', async (req, res) => {
  const username = req.body.username.replace(/^@/, '');
  const results = {
    search_ban: await checkSearchBanAPI(username) || await checkSearchBanScraping(username),
    suggestion_ban: await checkSearchSuggestionBanAPI(username) || await checkSearchSuggestionBanScraping(username),
    ghost_ban: await checkGhostBan(username),
    reply_deboost: await checkReplyDeboost(username),
  };
  res.render('results', { results, username });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
