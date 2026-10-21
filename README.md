# Auto Account Manager - 24/7 Railway Deployment Guide

This project is a full-stack Discord Multi-Account Orchestration tool featuring an Express dashboard, automated background worker manager, and a Python self-bot engine.

---

## 🚀 How to Export to GitHub & Host 24/7 on Railway

Follow these exact steps to host your bot **24 hours a day, 7 days a week, 365 days a year** for free or low cost on **Railway.app**.

### Step 1: Export this Project to GitHub from AI Studio

1. In the top right corner of the AI Studio window, click the **Settings / Menu** icon (or top bar menu).
2. Click **Export to GitHub** (or **Download ZIP** and upload it to your GitHub repository).
3. Name your repository: `auto-account-manager`.
4. Make the repository **Public** or **Private** and finish creating it.

---

### Step 2: Deploy on Railway (Railway.app)

1. Go to **[Railway.app](https://railway.app)** and log in with your GitHub account.
2. Click **"New Project"** (or **"+"** button).
3. Select **"Deploy from GitHub repo"**.
4. Search and select your repository: `auto-account-manager`.
5. Railway will automatically detect the included `Dockerfile` and start building the container!

---

### Step 3: Configure Environment Variables on Railway

In your Railway project dashboard:
1. Go to the **Variables** tab.
2. Add the following environment variables (copied from `.env` or your config):

| Variable Name | Description | Example Value |
|---|---|---|
| `PORT` | Web server port | `3000` |
| `MASTER_BOT_TOKEN` | Your Master Discord Bot token | `MTUyOD...` |
| `PREFIX` | Master Bot prefix | `!` |
| `OWNER_IDS` | Your Discord User ID(s) (comma separated) | `1505065613192728636` |
| `NOPE_CAPTCHA_KEY` | NopeCaptcha Key (optional) | `q4gd0knx5mzt60oe` |

3. Click **Deploy / Save**. Railway will re-deploy automatically with your environment variables applied.

---

### Step 4: Add Web Domain (To view dashboard 24/7)

1. On Railway, go to the **Settings** tab of your service.
2. Scroll down to **Networking** -> **Generate Domain**.
3. Railway will give you a public URL (e.g. `https://auto-account-manager-production.up.railway.app`).
4. You can open this link on your phone or browser anytime to check your bot status, logs, and account health live!

---

## ⚡ Features Included
- 🟢 **24/7 Voice Channel Stay** (!joinvc)
- 🟢 **Automatic Token Validation & Auto-reconnect**
- 🟢 **Live Web Dashboard & Logs**
- 🟢 **Discord Command Control (!addaccount, !joinvc, !leavevc, !react, !joinserver)**
