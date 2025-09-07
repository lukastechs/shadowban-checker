from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiohttp
from playwright.async_api import async_playwright, TimeoutError
import os
from dotenv import load_dotenv
import uvicorn

load_dotenv()

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

X_BEARER_TOKEN = os.getenv("X_BEARER_TOKEN")
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY")
PORT = int(os.getenv("PORT", 8000))

class CheckRequest(BaseModel):
    username: str
    recaptcha: str

async def fetch_user_details(username: str):
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                f"https://api.x.com/2/users/by/username/{username}?user.fields=public_metrics,profile_image_url,description,name",
                headers={"Authorization": f"Bearer {X_BEARER_TOKEN}"}
            ) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=resp.status, detail="Failed to fetch user details")
                data = await resp.json()
                user = data.get("data")
                if not user:
                    raise HTTPException(status_code=404, detail="User not found")
                return {
                    "username": user.get("username", username),
                    "nickname": user.get("name", "N/A"),
                    "followers": user.get("public_metrics", {}).get("followers_count", 0),
                    "description": user.get("description", "N/A"),
                    "avatar": user.get("profile_image_url", "https://via.placeholder.com/50"),
                }
        except Exception as e:
            print(f"User details API error: {str(e)}")
            raise HTTPException(status_code=500, detail="Unable to fetch user details")

async def check_search_ban_api(username: str):
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                f"https://api.x.com/2/tweets/search/recent?query=from:{username}&max_results=10",
                headers={"Authorization": f"Bearer {X_BEARER_TOKEN}"}
            ) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                tweets = data.get("data", [])
                return "No search ban" if tweets else "Search ban detected"
        except Exception as e:
            print(f"API error (search ban): {str(e)}")
            return None

async def check_search_ban_scraping(username: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        try:
            await page.goto(f"https://x.com/{username}", wait_until="networkidle", timeout=30000)
            has_tweets = await page.query_selector('[data-testid="tweet"]') is not None
            if not has_tweets:
                await browser.close()
                return "Unable to detect (no recent tweets on profile)"
            await page.goto(f"https://x.com/search?q=from%3A%40{username}&src=typed_query&f=live", wait_until="networkidle", timeout=30000)
            tweets_found = await page.wait_for_selector('[data-testid="tweet"]', timeout=10000) is not None
            await browser.close()
            return "No search ban" if tweets_found else "Search ban detected"
        except TimeoutError:
            await browser.close()
            return "Search ban detected"
        except Exception as e:
            print(f"Scraping error (search ban): {str(e)}")
            await browser.close()
            return "Error checking search ban"

async def check_search_suggestion_ban_api(username: str):
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                f"https://api.x.com/2/users/by/username/{username}",
                headers={"Authorization": f"Bearer {X_BEARER_TOKEN}"}
            ) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                return "No suggestion ban" if data.get("data") else "Suggestion ban detected"
        except Exception as e:
            print(f"API error (suggestion ban): {str(e)}")
            return None

async def check_search_suggestion_ban_scraping(username: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        try:
            await page.goto("https://x.com/explore", wait_until="networkidle", timeout=30000)
            await page.click('[data-testid="searchBox"]')
            await page.type('[data-testid="searchBox"]', f"@{username}")
            await page.wait_for_timeout(2000)
            suggestions = await page.evaluate("() => document.body.innerText")
            await browser.close()
            return "No suggestion ban" if f"@{username}" in suggestions else "Suggestion ban detected"
        except Exception as e:
            print(f"Scraping error (suggestion ban): {str(e)}")
            await browser.close()
            return "Error checking suggestion ban"

async def check_ghost_ban(username: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        try:
            await page.goto(f"https://x.com/search?q=from%3A%40{username}%20filter%3Areplies&src=typed_query&f=live", wait_until="networkidle", timeout=30000)
            reply_tweet = await page.query_selector('[data-testid="tweet"]')
            if not reply_tweet:
                await browser.close()
                return "Unable to detect (no recent replies)"
            reply_url = await page.evaluate("""
                () => {
                    const link = document.querySelector('[data-testid="tweet"] a[href^="/"][href*="status"]');
                    return link ? 'https://x.com' + link.getAttribute('href') : null;
                }
            """)
            if not reply_url:
                await browser.close()
                return "Unable to detect (could not extract reply URL)"
            await page.goto(reply_url, wait_until="networkidle", timeout=30000)
            visible_reply = await page.query_selector('[data-testid="reply"]') is not None
            await browser.close()
            return "No ghost ban" if visible_reply else "Ghost ban detected"
        except TimeoutError:
            await browser.close()
            return "Unable to detect (no recent replies)"
        except Exception as e:
            print(f"Scraping error (ghost ban): {str(e)}")
            await browser.close()
            return "Error checking ghost ban"

async def check_reply_deboost(username: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        try:
            await page.goto(f"https://x.com/search?q=from%3A%40{username}%20filter%3Areplies&src=typed_query&f=live", wait_until="networkidle", timeout=30000)
            reply_tweet = await page.query_selector('[data-testid="tweet"]')
            if not reply_tweet:
                await browser.close()
                return "Unable to detect (no recent replies)"
            reply_url = await page.evaluate("""
                () => {
                    const link = document.querySelector('[data-testid="tweet"] a[href^="/"][href*="status"]');
                    return link ? 'https://x.com' + link.getAttribute('href') : null;
                }
            """)
            if not reply_url:
                await browser.close()
                return "Unable to detect (could not extract reply URL)"
            await page.goto(reply_url, wait_until="networkidle", timeout=30000)
            show_more = await page.evaluate('() => document.body.innerText.includes("Show more replies")')
            await browser.close()
            return "Reply deboost detected" if show_more else "No reply deboost"
        except TimeoutError:
            await browser.close()
            return "Unable to detect (no recent replies)"
        except Exception as e:
            print(f"Scraping error (reply deboost): {str(e)}")
            await browser.close()
            return "Error checking reply deboost"

@app.get("/")
async def root():
    return {"message": "X Shadow Ban Checker API is running", "puppeteerAvailable": True}

@app.post("/check")
async def check(request: CheckRequest):
    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(
                "https://www.google.com/recaptcha/api/siteverify",
                data={"secret": RECAPTCHA_SECRET_KEY, "response": request.recaptcha}
            ) as resp:
                result = await resp.json()
                if not result.get("success"):
                    raise HTTPException(status_code=400, detail="reCAPTCHA verification failed")
        except Exception as e:
            print(f"reCAPTCHA error: {str(e)}")
            raise HTTPException(status_code=500, detail="reCAPTCHA service error")

    username = request.username.replace("@", "")
    user_details = await fetch_user_details(username)
    results = {
        **user_details,
        "search_ban": (await check_search_ban_api(username)) or (await check_search_ban_scraping(username)),
        "suggestion_ban": (await check_search_suggestion_ban_api(username)) or (await check_search_suggestion_ban_scraping(username)),
        "ghost_ban": await check_ghost_ban(username),
        "reply_deboost": await check_reply_deboost(username),
    }
    return {"results": results}

@app.get("/check/{username}")
async def check_get(username: str):
    username = username.replace("@", "")
    user_details = await fetch_user_details(username)
    results = {
        **user_details,
        "search_ban": (await check_search_ban_api(username)) or (await check_search_ban_scraping(username)),
        "suggestion_ban": (await check_search_suggestion_ban_api(username)) or (await check_search_suggestion_ban_scraping(username)),
        "ghost_ban": await check_ghost_ban(username),
        "reply_deboost": await check_reply_deboost(username),
    }
    return {"results": results}

@app.get("/health")
async def health():
    return {"status": "healthy", "timestamp": os.popen("date -u").read().strip(), "puppeteerAvailable": True}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
